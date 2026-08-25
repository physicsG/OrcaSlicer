#!/usr/bin/env python3
"""Drive the Device page in WebKitGTK - the engine Orca's own webview uses.

    python3 resources/web/shared/tests/run_webkit.py [--shots <dir>]
    python3 resources/web/shared/tests/run_webkit.py --real       # against the printer
    python3 resources/web/shared/tests/run_webkit.py --real --watch   # and stay open

`run_selftest.py` wants playwright and a chromium that will not start here (no
libnspr4/libnss3), which is why nothing had actually opened either page in a browser
for a long while. WebKitGTK is present, because it is what Orca renders with, and
PyGObject can drive it - so these checks run against the same engine that will run the
page for real, which is a better witness than chromium would have been anyway.

What this catches that a source-text check cannot: whether focus really selects the
field, whether a committed value survives the next state push, whether a number input
accepts `select()` at all. Every one of those is engine behaviour.

Without `--watch` this is a test: it checks, reports and exits. With `--watch` it is a
window - the checks still run and report, then it stays up until you close it, driving a
live printer if `--real` is on.

`--real` swaps the simulator for a real printer: `window.wx` is installed as a user
script and answered by `docs/u1-webui/tools/u1_bridge.py`, which speaks MQTT to the
machine. **Orca must be closed** - it authenticates with the same saved clientId and a
broker evicts the older holder. It also does not test Orca's own bridge; it is a second
host speaking the same contract. See the note at the top of u1_bridge.py.

Needs a display (WSLg provides one) and the GTK3/WebKit2 typelibs. Screenshots come
from GdkPixbuf rather than WebKit's own snapshot API, which hands back a cairo surface
there is no pycairo here to receive.
"""
import argparse
import functools
import http.server
import json
import os
import signal
import socketserver
import sys
import threading
import time

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib, Gdk       # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(os.path.dirname(HERE))
ROOT = os.path.dirname(os.path.dirname(WEB))
TOOLS = os.path.join(ROOT, "docs", "u1-webui", "tools")

# The page reaches a printer through `window.wx`. Orca installs that; outside Orca it
# has to be installed here, and answered by something that can talk to the machine.
DRIVE_LIMIT = 300      # a --drive script waits on a machine, so give it room

WX_SHIM = """
window.wx = { postMessage: function (s) {
  window.webkit.messageHandlers.wx.postMessage(String(s));
} };
"""

# Driven in the page, against the simulator's seeded values. Each line of the report is
# "PASS  name" or "FAIL  name   got X want Y", which is what the Python side prints.
CHECKS = r"""
(function () {
  const out = [];
  const say = (name, got, want) =>
    out.push(`${got === want ? 'PASS' : 'FAIL'}  ${name}` +
             (got === want ? '' : `   got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  const rows = [...document.querySelectorAll('.status-row')];
  const key = (n, k) => n.dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true}));
  if (rows.length !== 5) return `FAIL  five reading rows   got ${rows.length}`;

  // ---- the target field ------------------------------------------------
  // Toolhead 1 is seeded at 220 and the bed at 60 by mockhost.js.
  const t = rows[0].querySelector('.tgt');
  say('the machine target is in the field', t.value, '220');
  say('a heater that is off shows nothing, so the dash placeholder is what is seen',
      rows[2].querySelector('.tgt').value, '');

  t.focus();
  document.execCommand('insertText', false, '9');
  say('focus selects, so a keystroke replaces rather than appends', t.value, '9');
  key(t, 'Escape');
  say('Escape puts the machine value back', t.value, '220');

  t.focus(); t.value = ''; t.blur();
  say('an empty field is not an instruction to switch the heater off', t.value, '220');
  say('and nothing was sent for it', String(rows[0].dataset.pend), 'undefined');

  t.focus(); t.value = '205'; key(t, 'Enter');
  say('Enter sends the value and holds it on screen', t.value, '205');
  say('and the row waits for the printer to confirm', rows[0].dataset.pend, '1');

  const b = rows[4].querySelector('.tgt');
  b.focus(); b.value = '0'; key(b, 'Enter');
  say('zero is how off is asked for, and it is explicit', rows[4].dataset.pendVal, '0');

  const n = rows[1].querySelector('.tgt');
  n.focus(); n.value = '400'; n.blur();
  say('a value past the machine limit reverts', n.value, '215');

  // ---- the column still holds its widest reading -----------------------
  // 350 nozzle over a 350 reading is the worst case the row can be asked to show.
  const r0 = rows[0];
  r0.querySelector('.cur').textContent = '350';
  r0.querySelector('.tgt').value = '350';
  say('the widest reading does not overflow the 126px column',
      r0.scrollWidth <= r0.clientWidth, true);
  say('and the target is not clipped inside its own field',
      r0.querySelector('.tgt').scrollWidth <= 35, true);

  // ---- the row must not move as the numbers do -------------------------
  // A reading going 99 -> 100 used to carry the slash, the field and the unit along
  // with it, and five rows at different temperatures never lined up with each other.
  const widths = ['9', '26', '100', '350', '_'];
  rows.forEach((r, i) => { r.querySelector('.cur').textContent = widths[i]; });
  const left = (r, sel) => Math.round(r.querySelector(sel).getBoundingClientRect().left);
  for (const sel of ['.sl', '.tgt', '.unit']) {
    const seen = [...new Set(rows.map(r => left(r, sel)))];
    say(`${sel} sits at the same place on every row, whatever the reading`,
        seen.length, 1);
  }
  say('and no row overflows at three digits',
      rows.every(r => r.scrollWidth <= r.clientWidth), true);

  // ---- and the block sits over the squares below it --------------------
  const card = document.querySelector('#status-card').getBoundingClientRect();
  const r = rows[0];
  const mid = (r.querySelector('img').getBoundingClientRect().left
               + r.querySelector('.unit').getBoundingClientRect().right) / 2;
  say('the readings are centred in their column, like the tiles under them',
      Math.abs(mid - (card.left + card.width / 2)) <= 1, true);
  return out.join('\n');
})()
"""


# With --real there are no seeded values to assert against, so these check the things
# that are true of any printer: that a host answered at all, that state arrived, and
# that what the rows show is what the machine reported.
REAL_CHECKS = r"""
(function () {
  const out = [];
  const say = (name, got, want) =>
    out.push(`${got === want ? 'PASS' : 'FAIL'}  ${name}` +
             (got === want ? '' : `   got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  const dp = window.__devicePage;
  if (!dp) return 'FAIL  the page did not finish booting';
  say('a real host answered, so the simulator never installed itself', dp.mock, null);

  const st = dp.state;
  const objs = Object.keys(st.objects);
  say('machine state arrived', objs.length > 0, true);
  out.push(`INFO  ${objs.length} objects: ${objs.slice(0, 10).join(', ')}`);
  if (!objs.length) return out.join('\n');

  const heads = st.toolheads(), bed = st.bed();
  heads.forEach((h, i) =>
    out.push(`INFO  toolhead ${i + 1}: ${h.temperature} / ${h.target} \u00B0C  ` +
             `state=${h.state} power=${h.power}`));
  out.push(`INFO  bed: ${bed.temperature} / ${bed.target} \u00B0C`);

  const rows = document.querySelectorAll('.status-row');
  say('five reading rows', rows.length, 5);
  say('the row shows the temperature the machine reported',
      rows[0].querySelector('.cur').textContent, String(Math.round(heads[0].temperature)));

  const reading = [...heads.map(h => h.target), bed.target];
  const off = reading.findIndex(t => !t);
  if (off >= 0) {
    say(`a heater that is off shows a dash, not a zero (row ${off + 1})`,
        rows[off].querySelector('.tgt').value, '');
  } else {
    out.push('INFO  every heater has a target, so the dash case was not exercised');
  }
  const hot = reading.findIndex((t, i) =>
    t > 0 && (i < 4 ? heads[i].temperature : bed.temperature) < t - 2);
  out.push(hot >= 0 ? `INFO  row ${hot + 1} is heating: ${rows[hot].dataset.heat}`
                    : 'INFO  nothing is heating right now');
  return out.join('\n');
})()
"""


def _sigint(handler):
    """Ask GLib to deliver Ctrl-C. The call moved namespaces; take whichever is here."""
    try:
        gi.require_version("GLibUnix", "2.0")
        from gi.repository import GLibUnix                            # noqa: PLC0415
        GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, handler)
    except (ValueError, ImportError):
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, handler)


def serve(directory):
    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    class Q(socketserver.TCPServer):
        allow_reuse_address = True

    httpd = Q(("127.0.0.1", 0), functools.partial(H, directory=directory))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", help="directory to write screenshots into")
    ap.add_argument("--settle", type=float, default=None,
                    help="seconds to let state arrive before checking "
                         "(default 3, or 15 with --real: a connect has to happen first)")
    ap.add_argument("--real", action="store_true",
                    help="talk to the real printer instead of the simulator "
                         "(Orca must be closed)")
    ap.add_argument("--device-ip", metavar="IP",
                    help="with --real: pretend the saved printer is at this address. "
                         "Point it somewhere unroutable (192.0.2.1) to exercise the "
                         "page with no printer there.")
    ap.add_argument("--drive", metavar="FILE",
                    help="run this JavaScript in the page instead of the built-in "
                         "checks; it reports by setting window.__report when done")
    ap.add_argument("--watch", type=float, nargs="?", const=0.0, default=None,
                    metavar="SECONDS",
                    help="leave the window open after the checks so it can be used by "
                         "hand: bare --watch stays until the window is closed, "
                         "--watch 90 stays that long")
    args = ap.parse_args()
    if args.settle is None:
        args.settle = 15.0 if args.real else 3.0

    if not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        print("no display: this needs one (WSLg provides it). Skipping.")
        return 0

    port = serve(WEB)
    bridge = None
    ucm = WebKit2.UserContentManager()

    if args.real:
        sys.path.insert(0, TOOLS)
        from u1_bridge import Bridge                                 # noqa: PLC0415
        ucm.add_script(WebKit2.UserScript.new(
            WX_SHIM, WebKit2.UserContentInjectedFrames.TOP_FRAME,
            WebKit2.UserScriptInjectionTime.START, None, None))
        ucm.register_script_message_handler("wx")

    win = Gtk.Window()
    win.set_default_size(1500, 980)
    view = WebKit2.WebView.new_with_user_content_manager(ucm)
    win.add(view)
    win.show_all()

    if args.real:
        def to_page(msg):
            js = f"window.postMessage({json.dumps(msg)}, '*')"
            # The bridge answers on its own threads; WebKit is main-loop only.
            GLib.idle_add(lambda: bool(view.evaluate_javascript(
                js, -1, None, None, None, None, None) and False))

        devices = None
        if args.device_ip:
            from u1_bridge import orca_devices                        # noqa: PLC0415
            devices = [dict(d, ip=args.device_ip) for d in orca_devices()]
            print(f"  pretending the printer is at {args.device_ip}")
        bridge = Bridge(send=to_page, devices=devices)

        def on_wx(_ucm, result):
            # 4.1 hands over a JSCValue; 4.0 wrapped it in a JavascriptResult.
            val = result if hasattr(result, "to_string") else result.get_js_value()
            bridge.handle(val.to_string())
        ucm.connect("script-message-received::wx", on_wx)

    url = f"http://127.0.0.1:{port}/device_page/index.html"
    view.load_uri(url if args.real else url + "?mock=1")
    print(f"serving {WEB} on {url}"
          + ("  [real printer]" if args.real else "  [simulator]"))

    state = {"rc": 1, "report": "the page never finished loading", "printed": False}

    def report():
        """Print now rather than after the loop: when the window stays open, a report
        that waits for the loop to end is a report the user cannot read yet."""
        if state["printed"]:
            return
        state["printed"] = True
        lines = state["report"].split("\n")
        for line in lines:
            print("  " + line, flush=True)
        bad = sum(1 for line in lines if line.startswith("FAIL"))
        ran = sum(1 for line in lines if line.startswith(("PASS", "FAIL")))
        print(f"\n{ran - bad}/{ran} checks passed", flush=True)

    def wrap_up():
        """The checks are done. Either that was the whole job, or the window is the job."""
        shot("checked")
        report()
        if args.watch is None:
            Gtk.main_quit()
            return False
        if args.watch:
            print(f"\n  window open for {args.watch:.0f}s - close it to finish sooner",
                  flush=True)
            GLib.timeout_add(int(args.watch * 1000),
                             lambda: (shot("watched"), Gtk.main_quit(), False)[2])
        else:
            print("\n  window open - close it, or Ctrl-C here, to finish", flush=True)
        return False

    def shot(name):
        if not args.shots:
            return
        os.makedirs(args.shots, exist_ok=True)
        gw = win.get_window()
        pb = Gdk.pixbuf_get_from_window(gw, 0, 0, gw.get_width(), gw.get_height())
        if pb is None:
            print(f"  (no pixbuf for {name})")
            return
        pb.savev(os.path.join(args.shots, f"{name}.png"), "png", [], [])
        print(f"  wrote {name}.png")

    def done(v, res):
        try:
            state["report"] = v.evaluate_javascript_finish(res).to_string()
            state["rc"] = 1 if "FAIL" in state["report"] else 0
        except Exception as e:                                   # noqa: BLE001
            state["report"] = f"FAIL  the checks did not run: {e}"
        wrap_up()

    def go():
        shot("loaded")
        if args.drive:
            # A driving script is asynchronous by nature - it waits on the machine -
            # so it hands its report back through window.__report rather than by
            # returning, and this polls for it.
            view.evaluate_javascript(open(args.drive, encoding="utf-8").read(),
                                     -1, None, None, None, None, None)
            deadline = time.time() + DRIVE_LIMIT
            def poll():
                if time.time() > deadline:
                    state["report"] = "FAIL  the driving script never reported"
                    return wrap_up()
                view.evaluate_javascript("window.__report || ''", -1, None, None, None,
                                         picked)
                return False
            def picked(v, res):
                try:
                    got = v.evaluate_javascript_finish(res).to_string()
                except Exception:                                    # noqa: BLE001
                    got = ""
                if got:
                    state["report"] = got
                    state["rc"] = 1 if "FAIL" in got else 0
                    wrap_up()
                else:
                    GLib.timeout_add(500, poll)
            poll()
            return False
        view.evaluate_javascript(REAL_CHECKS if args.real else CHECKS,
                                 -1, None, None, None, done)
        return False

    view.connect("load-changed", lambda v, e:
                 GLib.timeout_add(int(args.settle * 1000), go)
                 if e == WebKit2.LoadEvent.FINISHED else None)
    # Closing the window is how a person ends this, and Ctrl-C is how they end it from
    # the terminal - GLib swallows SIGINT otherwise, so it has to be asked for.
    win.connect("destroy", lambda *_: Gtk.main_quit())
    _sigint(lambda *_: (Gtk.main_quit(), False)[1])
    if args.watch is None:
        # An unattended run must not hang if the page never answers.
        GLib.timeout_add(int((args.settle
                              + (DRIVE_LIMIT + 15 if args.drive else 30)) * 1000),
                         Gtk.main_quit)
    Gtk.main()
    if bridge:
        bridge.stop()
    report()
    return state["rc"]


if __name__ == "__main__":
    sys.exit(main())
