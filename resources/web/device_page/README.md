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

| File | Role |
|---|---|
| `index.html` | Page shell |
| `js/protocol.js` | **Every constant recovered by RE** — commands, state model, limits, error scheme |
| `js/sswcp.js` | Bridge client: envelope, seqid correlation, ack-then-push subscriptions |
| `js/state.js` | State store with the partial-merge semantics the transport requires |
| `js/ui.js` | Rendering (plain DOM) |
| `js/app.js` | Startup sequence and control handlers |
| `js/mock.js` | Simulated Orca host + U1, so the page runs with no hardware |
| `css/device.css` | Styling |

## Tests

```bash
# 1. constants match the RE evidence (no browser needed)
python3 resources/web/shared/tests/conformance_test.py

# 2. end-to-end behaviour in a real browser
python3 resources/web/device_page/tests/run_selftest.py      # needs playwright
```

Or open `tests/selftest.html` in any browser.

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
