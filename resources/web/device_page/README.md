# Device page — clean-room reimplementation

A dependency-free HTML/CSS/JS Device page for the Snapmaker U1, built from the
reverse engineering in [`docs/u1-webui/`](../../../docs/u1-webui/).

It exists to prove the protocol documentation is correct and complete: it speaks the
same WCP bridge, subscribes to the same 24-object state model, and issues the same
control commands as the shipped 5.2 MB Flutter bundle — with no build step.

This is **one of two** reconstructed surfaces. The bridge client, the state model, the
protocol constants and the simulated host live in [`../shared/`](../shared/) and are
shared with [`../print_processing/`](../print_processing/); only this surface's own
`app.js`, `ui.js` and `device.css` are here. See
[what the two surfaces share](../../../docs/u1-webui/00-shared/01-shared-models.md).

A build badge in the bottom-right corner names the surface and the build it reports —
the marker that tells this reconstruction apart from the shipped Flutter page.

## Running it

**Standalone** (simulated printer, no Orca, no hardware) — ES modules need a real
origin, so serve rather than opening the file directly:

```bash
python3 -m http.server 8099 --directory resources/web
```

Then open `http://127.0.0.1:8099/device_page/index.html?mock=1`.

**Inside Orca** — the app's own HTTP server already serves `resources/web`, so the page
is reachable at `/web/device_page/index.html`. It auto-detects the host: if
`window.wx` is present it drives the real printer, otherwise it falls back to the
simulator. To load it in place of the Flutter page, point `PrinterWebView` at it:

```cpp
// src/slic3r/GUI/PrinterWebView.cpp
wxString url = wxString::FromUTF8(LOCALHOST_URL
    + std::to_string(wxGetApp().get_page_http_port())
    + "/web/device_page/index.html");
```

## Files

**Start at [`js/panels/registry.js`](js/panels/registry.js)** — it lists what is on this
page, what each panel reads, and which bridge commands each panel can send. Everything
inside `.content` is built from it.

| File | Role |
|---|---|
| `index.html` | The shell, and only the shell: the rail and an empty `.content` |
| `js/panels/registry.js` | **What this page is made of.** Panel order, headers, `reads`, `sends` |
| `js/panels/*.js` | One module per panel |
| `js/shell.js` | Builds the page from the registry; the header-control vocabulary |
| `js/store.js` | **What the page remembers** — view, tab, fetched lists, chosen tool |
| `js/pending.js` | What was asked for and not yet confirmed. Neither state nor store |
| `js/render.js` | The one update discipline: rebuild on a signature, reconcile by key |
| `js/dom.js` | `$`, `el`, `icon` — the three primitives panels build with |
| `js/session.js` | Having a printer on the other end: connect, staleness, retry, the stream |
| `js/connection.js` | The connect path itself: pairing, mTLS, the MQTT engine |
| `js/diag.js` | The `?diag=1` beacon |
| `js/app.js` | Startup, and the control handlers |
| `js/ui.js` | Rendering (plain DOM). Being emptied into `js/panels/` a panel at a time |
| `js/overlay.js` | Menus, dialogs and popovers |
| `js/mock.js` | Installs the shared simulator, so the page runs with no hardware |
| `css/device.css` | Styling |

The bridge client, protocol constants, state store, activity table, fault catalogue and
simulated host are shared with the print-processing popup and live in
[`../shared/js/`](../shared/js/).

### The three stores, and why there are three

A panel is handed one `ctx` with three of them, because they answer three different
questions:

| | |
|---|---|
| `ctx.state` | what the **machine** says. A mirror, not a memory |
| `ctx.store` | what the **page** knows — which view, which tab, what it has fetched |
| `ctx.pending` | what has been **asked for** and not yet confirmed |

The third is the one that has to exist separately. Keeping a request in the thing that
mirrors the machine is a bug this page has had in three unrelated controls, because the
next state push arrives before the printer has acted and writes the pre-click value back
over what the user just asked for. `pending.js` documents all three.

### Adding a panel

Write `js/panels/<id>.js` with `mount`/`update` and its `reads`/`sends`, then add it to
`PANELS` in the registry. That is the whole change — the `<section>`, the 40px header,
the title, the header buttons and the paint loop all come from the declaration. It used
to mean editing five files with nothing to check you had done all five.

`sends` is not decoration. `check_coverage.py` reads it and fails on any implemented
command no panel claims, which is how a handler nothing calls gets found.

## Tests

```bash
# 1. constants match the RE evidence, and the page's decisions match the write-up
python3 resources/web/shared/tests/conformance_test.py

# 2. the page itself, in WebKitGTK - the engine Orca renders with
python3 resources/web/shared/tests/run_webkit.py

# 3. the pure logic, in JavaScriptCore, against captured hardware payloads
python3 resources/web/shared/tests/unit_jsc.py

# 4. every command implemented, and reachable from a control
python3 docs/u1-webui/tools/check_coverage.py
```

`run_webkit.py --shots DIR` also writes PNGs, but on a machine with no working EGL
driver they come out blank — the DOM assertions are the evidence, not the images.

`conformance_test.py` re-derives the constant tables from `docs/u1-webui/data/`
and fails if `protocol.js` has drifted — it is the regression guard tying this code to
the reverse-engineering evidence. `selftest.html` exercises the real modules against
the simulator: envelope shape, subscription ack-then-push, partial-state merging,
control round-trips, error decoding, and failure handling.

## What it does not do

The shipped page is much larger in scope. Deliberately out of scope here: device
discovery and pairing, cloud login and binding, file browser and upload, camera and
timelapse, firmware update, filament mapping dialogs, and the model library. The
protocol for all of those is documented in `docs/u1-webui/`; only the live
machine-control surface is implemented.

Also note the page assumes a printer is already connected — it calls
`sw_GetConnectedMachine` and proceeds. Connection state handling is the shipped page's
job (see the seven `device*.webp` states in the routes doc).
