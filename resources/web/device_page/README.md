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

**Start at [`js/registry.js`](js/registry.js)** — it lists the page's two destinations
and which panels each one has. Everything inside `.content` is built from it.

Then **one panel is one directory**, and everything about it is in there:

```
js/views/device-control/camera/
    camera-panel.js      what it reads, and its mount/update
    camera-view.js       its DOM: built once, then patched
    camera-commands.js   everything it can ask the machine to do
```

| | |
|---|---|
| `index.html` | The shell, and only the shell: the rail and an empty `.content` |
| `js/registry.js` | **What this page is made of.** Destinations, panels, order |
| `js/shell.js` | Builds the page from the registry; scopes each panel's commands |
| `js/app.js` | Startup, the rail's device menu, the render loop |
| `js/page-commands.js` | The few commands that belong to no single panel |
| `js/views/<destination>/<panel>/` | One directory per panel — see above |
| `js/core/store.js` | **What the page remembers** — view, tab, fetched lists, chosen tool |
| `../shared/js/pending.js` | What was asked for and not yet confirmed. Neither state nor store. **Shared** — the print dialog uses it too |
| `../shared/js/render.js` | The one update discipline: rebuild on a signature, reconcile by key. **Shared** |
| `../shared/js/dom.js` | `$`, `el`, `icon` — the three primitives every view builds with. **Shared** |
| `js/core/session.js` | Having a printer on the other end: connect, staleness, retry, the stream |
| `../shared/js/connection.js` | The connect path itself: pairing, mTLS, the MQTT engine |
| `js/core/overlay.js` | Menus, dialogs and popovers |
| `js/core/diag.js` | The `?diag=1` beacon |
| `js/core/mock.js` | Installs the shared simulator, so the page runs with no hardware |
| `js/core/thumbs.js` | The thumbnail sniffer, shared by the job card and Storage |
| `js/widgets/` | The rail, the trace pane, and art/formatting used by more than one view |
| `css/device.css` | Styling |

Every filename carries its component, so nothing in the tree is called `panel.js`.

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

Make `js/views/<destination>/<id>/` with its three files, and add the panel to `PANELS`
in the registry. That is the whole change — the
`<section>`, the 40px header, the title, the header buttons and the paint loop all come
from the declaration. It used to mean editing five files with nothing to check you had
done all five.

A panel is handed **its own command module and nothing else**, so reaching for another
panel's command is a `TypeError` rather than a quiet dependency. That is also what makes
the tooling honest: `check_coverage.py` reads the `CMD.` references out of
`commands/<id>.js` to answer *which panel can issue this*, and a conformance check fails
on any handler nothing calls. Both are facts about the code rather than declarations
that can drift — an earlier version had each panel declare a `sends` list, and one of
them claimed a command no code issued.

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

`run_webkit.py --shots DIR` writes real PNGs: an unattended run renders into a
`Gtk.OffscreenWindow` with the accelerated compositor off, which needs no EGL driver.
(A `--watch` run keeps its real window, and on a machine with no working EGL that
window still reads back blank.) The images are worth having and are still the weaker
half — the DOM assertions are what catch a seam three pixels out of true.

`conformance_test.py` re-derives the constant tables from `docs/u1-webui/data/`
and fails if `protocol.js` has drifted — it is the regression guard tying this code to
the reverse-engineering evidence. `selftest.html` exercises the real modules against
the simulator: envelope shape, subscription ack-then-push, partial-state merging,
control round-trips, error decoding, and failure handling.

### multiACE

The Filament panel integrates with **multiACE**
([decay71/multiACE](https://github.com/decay71/multiACE)), a third-party Klipper plugin
deployed onto a U1 — not with Snapmaker's own firmware. A printer without it reports no
`ace` object and gets the four filament slots this page always drew.

Everything about it is in [`../shared/js/multiACE.js`](../shared/js/multiACE.js): the
macro names and the line builder, the unit letters, the dryer presets, the override-store
URL, the state model and the bay merge. `MachineState.ace()` calls into it. Two sources
feed that model and they do not carry the same thing — the `ace` Klipper object has the
topology and what is *loaded*, and multiACE's override store has what is in each *bay* —
so the precedence (**rfid → override → derived**) lives there too, as pure logic
`unit_jsc.py` can test.

## What it does not do

The shipped page is much larger in scope. Deliberately out of scope here: device
discovery and pairing, cloud login and binding, file browser and upload, camera and
timelapse, firmware update, filament mapping dialogs, and the model library. The
protocol for all of those is documented in `docs/u1-webui/`; only the live
machine-control surface is implemented.

Also note the page assumes a printer is already connected — it calls
`sw_GetConnectedMachine` and proceeds. Connection state handling is the shipped page's
job (see the seven `device*.webp` states in the routes doc).
