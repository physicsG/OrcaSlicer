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
- A **fully connected** Device page with live telemetry was not reached. The
  session additionally depends on the page's own `deviceList` /
  `deviceFilamentInfo` cache — written by the page, only relayed by the host — so
  the control grid renders disabled. Everything up to `ConnectionStatus.connectedOnline`
  does work with `cloud-stub.js` in place.
