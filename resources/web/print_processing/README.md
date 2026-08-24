# Print processing — clean-room reimplementation

A dependency-free HTML/CSS/JS reconstruction of the Snapmaker U1 **print-processing
popup** — the modal Orca opens between "Send to printer" and the job starting — built
from the reverse engineering in [`docs/u1-webui/`](../../../docs/u1-webui/).

This is **one of two** reconstructed surfaces. The bridge client, the state model, the
protocol constants and the simulated host live in [`../shared/`](../shared/) and are
shared with [`../device_page/`](../device_page/); only this surface's own `app.js`,
`ui.js`, `mock.js` and `preprint.css` are here.

A build badge in the bottom-right corner names the surface and the build it reports —
the marker that tells this reconstruction apart from the shipped Flutter page.

## Running it

ES modules need a real origin, so serve rather than opening the file directly:

```bash
python3 -m http.server 8099 --directory resources/web
```

| Mode | URL | Mirrors |
|---|---|---|
| Upload **and** print | `http://127.0.0.1:8099/print_processing/index.html?mock=1` | Orca's `?path=4` `preUploadAndPrint` |
| Upload **only** | `http://127.0.0.1:8099/print_processing/index.html?mock=1&mode=upload` | Orca's `?path=5` `preUpload` |

Drop `?mock=1` when running inside Orca — the page uses the real bridge whenever
`window.wx` is present, and only falls back to the simulator when it is not.

## What it covers

- **Model Information** — filename, estimated time, estimated materials
- **Select Printer** — resolved from `sw_GetConnectedMachine`, with the
  `sw_GetPrintLegal` preset-vs-machine check
- **Edit Filament** — one row per filament with its colour, type, weight and toolhead
  assignment, written back as `extruder_map_table`
- **Print Preferences** — Extrusion Flow Calibration, Time-lapse Camera, Auto Leveling
- **Send** — the real three-command close protocol, in order

Upload-only mode hides the filament and preference sections entirely and keeps Send
disabled until a printer resolves, matching the shipped popup.

## Tests

The shared conformance test guards this surface too, since both import the same
constants:

```bash
python3 resources/web/shared/tests/conformance_test.py
```

## Limits

The printer picker is a stub, upload progress is simulated locally, and everything is
verified against the shared simulator rather than real hardware. See
[the implementation notes](../../../docs/u1-webui/03-print-processing/03-implementation.md).
