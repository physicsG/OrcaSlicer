# Screenshot harness

Runs the **real** shipped bundle in a headless browser against a **simulated**
Orca host, so the Device page and the print popup can be captured, inspected and
instrumented without building Orca or owning a U1.

It is also the fastest way to check a protocol claim: implement the host side in
`inject-state.js`, load the page, and see whether it behaves. That is how the
`code: 200` rule in [the envelope doc](../../04-bridge-wcp/01-envelope.md) was
found — replying `0` produced a login gate, replying `200` did not.

## What it does

```
harness tree (symlinks to the real bundle, plus an edited index.html)
        │
        ├─ cloud-stub.js    intercepts fetch/XHR to *.snapmaker.com
        ├─ wcp-bridge.js    implements window.wx, records every request
        └─ inject-state.js  canned responses, per command
        │
harness_server.py  serves it at /web/flutter_web/ (the bundle's <base href>)
        │
cdp.py + shoot.py  drive headless Chrome over the DevTools Protocol
        │
        └─> screenshots/*.png  and  a JSON log of every bridge call
```

Nothing writes into `resources/` — the harness tree is symlinks plus one edited
`index.html`, built in a scratch directory.

## Requirements

- A Chromium build. Playwright's cached one works:
  `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`
- Its NSS dependencies (`libnss3`, `libnspr4`). If they are missing system-wide,
  extract them locally and point `LD_LIBRARY_PATH` at them — no root needed:
  ```bash
  apt-get download libnss3 libnspr4
  dpkg-deb -x libnss3_*.deb x && dpkg-deb -x libnspr4_*.deb x
  find x -name '*.so*' -exec cp -a {} ./libs/ \;
  ```
- Python 3. `cdp.py` implements the WebSocket framing itself, so there are no
  Python package requirements at all.

## Building the tree

```bash
BUNDLE=resources/web/flutter_web
H=/tmp/harness/web/flutter_web
mkdir -p "$H"
for f in "$BUNDLE"/*; do
  [ "$(basename "$f")" = index.html ] || ln -s "$(realpath "$f")" "$H/"
done
cp docs/u1-webui/tools/harness/{wcp-bridge,inject-state,cloud-stub}.js "$H/"
# index.html with the three scripts injected before flutter_bootstrap.js
sed 's|<script src="flutter_bootstrap.js" async></script>|<script src="cloud-stub.js"></script>\n<script src="wcp-bridge.js"></script>\n<script src="inject-state.js"></script>\n&|' \
    "$BUNDLE/index.html" > "$H/index.html"
```

The `<base href="/web/flutter_web/">` in `index.html` is why the tree must be
served with that exact prefix.

## Running

```bash
python3 harness_server.py /tmp/harness 8765 /tmp/dumps &
python3 shoot.py device-control 2 16 1280x900
python3 shoot.py preuploadandprint 4 14 714x750 click=295,400 post=3
```

`shoot.py NAME PATH [WAIT] [WxH] [click=x,y[;x,y]] [post=SECONDS]`

- `PATH` is the `?path=` value — see [entry points](../../01-architecture/03-entry-points.md)
- `WAIT` is real seconds to let Flutter boot and settle
- `click=` dispatches real mouse events, e.g. to dismiss the login gate
- writes `shots/NAME.png` and `dumps/NAME.json`

The dump holds every bridge request the page made, plus the list of commands no
fixture answered — which is the quickest way to find what a screen actually needs.

## Notes and limits

- **Use real waits, not `--virtual-time-budget`.** The app schedules periodic
  timers and retry loops; under virtual time these run away and the browser hangs
  or exits before network callbacks land.
- **Serve with `Cache-Control: no-store`** (the server does). Chrome will
  otherwise reuse a stale `wcp-bridge.js` between runs and silently ignore edits.
- `/json/new` is PUT-only in current Chrome; `cdp.py` attaches to the target the
  browser already opened and navigates that instead.
- **There is now a second way to run the bundle**, it needs no chromium, and it
  reaches a **connected** page with live telemetry:

  ```bash
  python3 resources/web/shared/tests/run_webkit.py --original --sn <SN> --watch
  ```

  It loads the bundle in WebKitGTK - the engine Orca itself renders with - against a
  real printer, answered by [`u1_bridge.py`](../u1_bridge.py) rather than fixtures.
  This directory's `cloud-stub.js` is injected for the same reason this harness injects
  it. `--sn` matters: Orca's config can hold stale records, and the bundle tries to
  connect every device it is handed.

  Four things had to be right, and each was read out of the C++ rather than guessed:

  1. **Orca posts replies as a JSON STRING.** `send_to_js` builds
     `window.postMessage(JSON.stringify({...}), '*')`. Posting the object instead - which
     the reconstruction's client happily parses - makes the bundle ignore every reply in
     silence. This one masquerades as "the page will not pick a device".
  2. **TLS is decided by the credentials, not the scheme**: `if (ca != "" && cert != ""
     && key != "")`. The bundle asks for `mqtt://<ip>:8883` - plain scheme, TLS port.
  3. **Orca keeps its own connection to the printer.** `get_connect_host()` is what
     answers `sw_GetMachineState`, and it is not the MQTT clients the page creates. The
     bundle never calls `sw_mqtt_set_engine` because in Orca a host is already attached,
     so the bridge brings up a session of its own.
  4. **`sw_GetConnectedMachine` is the gate.** It returns the first saved device flagged
     `connected`; with none, the page sits at `sn=` forever. The bridge probes each
     saved device with a TCP connect and reports the ones that answer.

  Also measured: **the bundle's own request timeout is 3 seconds**, against the
  reconstruction's 15. And `local_devices_arrived` - which Orca posts on a separate,
  non-envelope channel - appears **zero** times in `main.dart.js`; it is for Orca's own
  non-Flutter device cards, not for this bundle.

  Still rough: a "Binding rejected" dialog from the cloud stub, and toolheads 2-4 read
  `_/_ °C` while toolhead 1 and the bed carry real numbers.

- A **fully connected** Device page with live telemetry was not reached. The
  session additionally depends on the page's own `deviceList` /
  `deviceFilamentInfo` cache — written by the page, only relayed by the host — so
  the control grid renders disabled. Everything up to `ConnectionStatus.connectedOnline`
  does work with `cloud-stub.js` in place.
