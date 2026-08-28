#!/usr/bin/env python3
"""Load a surface from ORCA'S OWN page server and say whether the document ran.

    python3 resources/web/shared/tests/check_app_serve.py            # Orca must be running
    python3 resources/web/shared/tests/check_app_serve.py --port 13619
    python3 resources/web/shared/tests/check_app_serve.py --url http://127.0.0.1:13619/web/...

`run_webkit.py` serves the tree from Python, so it proves the page agrees with the
printer - not that it agrees with the host that actually serves it. On 2026-08-26 those
were different answers: Orca's `HttpServer` was losing one request per page load, the
Device tab was blank in the app, and all three suites were green. The module graph has no
partial success, so a single module that never arrives is a document that never runs -
and it says nothing about it. `readyState` stays at "interactive", the console is empty,
and the page shows its static shell with an empty `.content`.

Two numbers answer it, and they are the two this prints:

    readyState        must reach "complete"
    pending resources must be 0

Round seven of docs/u1-webui/02-device-page/08-function-gap-analysis.md is the whole
story. Exit code is 0 when the document completed with nothing outstanding.
"""
import argparse
import os
import sys

os.environ.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
os.environ.setdefault("GDK_BACKEND", "x11")

import gi                                                    # noqa: E402
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib                  # noqa: E402

# Orca's own page server. PAGE_HTTP_PORT in src/slic3r/GUI/HttpServer.hpp; it moves only
# when the port is taken, and the app logs the one it settled on.
PAGE_HTTP_PORT = 13619
# The query Orca itself appends. Kept because the request LENGTH is what decides whether
# the server's header parse desynchronises, so a check that drops it is checking a
# different request than the app makes.
SURFACES = {
    "device": "/web/device_page/index.html?locale=en-US&dark_mode=0",
    "print": "/web/print_processing/index.html?mode=print",
    "upload": "/web/print_processing/index.html?mode=upload",
}

REPORT = r"""
(function () {
  const c = document.querySelector('.content, .app, body');
  return JSON.stringify({
    ready: document.readyState,
    nodes: document.querySelectorAll('*').length,
    content: (document.querySelector('.content') || {}).childElementCount ?? -1,
    booted: typeof window.__devicePage,
    status: (document.querySelector('#status') || {}).textContent || null,
  });
})()
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--surface", choices=sorted(SURFACES), default="device")
    ap.add_argument("--port", type=int, default=PAGE_HTTP_PORT)
    ap.add_argument("--url", help="a full URL, instead of --surface/--port")
    ap.add_argument("--wait", type=float, default=12.0, help="seconds to let it settle")
    ap.add_argument("--runs", type=int, default=1,
                    help="load it this many times; the fault was one load in one")
    args = ap.parse_args()

    url = args.url or f"http://127.0.0.1:{args.port}{SURFACES[args.surface]}"
    print(f"{url}\n")

    # A page that will not load because nothing is serving it is not the fault this
    # checks for, and saying so would send the next person after the wrong thing.
    import socket
    host, port = "127.0.0.1", args.port
    if args.url:
        from urllib.parse import urlparse
        u = urlparse(args.url)
        host, port = u.hostname or host, u.port or 80
    with socket.socket() as probe:
        probe.settimeout(2)
        if probe.connect_ex((host, port)) != 0:
            print(f"nothing is listening on {host}:{port} - start Orca first.")
            return 2

    failures = 0
    for run in range(1, args.runs + 1):
        ok, line = load_once(url, args.wait)
        print(f"  run {run}: {line}")
        if not ok:
            failures += 1

    print()
    if failures:
        print(f"FAIL  {failures}/{args.runs} loads did not complete.\n"
              "      A pending resource with a silent console is the app's HTTP server "
              "losing a request,\n      not a fault in the page - see round seven of "
              "docs/u1-webui/02-device-page/08-function-gap-analysis.md.")
        return 1
    print(f"PASS  {args.runs}/{args.runs} loads completed with nothing outstanding.")
    return 0


def load_once(url, wait):
    """One load in WebKitGTK. Returns (ok, one line saying what happened)."""
    win = Gtk.OffscreenWindow()
    win.set_default_size(1920, 1080)
    view = WebKit2.WebView()
    win.add(view)
    win.show_all()

    started, done, failed = [], set(), []

    def on_resource(_v, res, req):
        started.append(req.get_uri())
        res.connect("finished", lambda r: done.add(r.get_uri()))
        res.connect("failed", lambda r, e: (done.add(r.get_uri()),
                                            failed.append((r.get_uri(), e.message))))

    view.connect("resource-load-started", on_resource)
    view.load_uri(url)

    out = {}

    def finish():
        def got(_v, res, *_):
            # Anything thrown in here would skip the quit below and leave the run to the
            # watchdog, which reads as a page that never loaded. It is not.
            try:
                val = view.evaluate_javascript_finish(res)
                out["dom"] = val.to_string() if val else ""
            except Exception as e:                                    # noqa: BLE001
                out["dom"] = ""
                out["err"] = str(e)
            Gtk.main_quit()
        view.evaluate_javascript(REPORT, -1, None, None, None, got, None)
        return False

    # Both are removed below. A watchdog left armed from an earlier run fires inside the
    # NEXT run's main loop and quits it early, which reads as a page that never loaded -
    # `readyState` unread with every resource finished, which is not a state the page can
    # actually be in.
    settle = GLib.timeout_add(int(wait * 1000), finish)
    guard = GLib.timeout_add(int((wait + 20) * 1000), lambda: (Gtk.main_quit(), False)[1])
    Gtk.main()
    for src in (settle, guard):
        GLib.source_remove(src) if GLib.MainContext.default().find_source_by_id(src) else None
    win.destroy()

    import json
    try:
        dom = json.loads(out.get("dom") or "{}")
    except ValueError:
        dom = {}
    pending = [u for u in started if u not in done]
    ok = dom.get("ready") == "complete" and not pending and not failed

    if "err" in out:
        bits_err = f"  (probe: {out['err']})"
    else:
        bits_err = ""
    bits = [f"readyState={dom.get('ready')!r}",
            f"resources {len(done)}/{len(started)}",
            f"pending {len(pending)}",
            f"nodes {dom.get('nodes')}"]
    line = "  ".join(bits) + bits_err
    for u in pending:
        line += f"\n           PENDING  {u}"
    for u, msg in failed:
        line += f"\n           FAILED   {u}: {msg}"
    return ok, line


if __name__ == "__main__":
    sys.exit(main())
