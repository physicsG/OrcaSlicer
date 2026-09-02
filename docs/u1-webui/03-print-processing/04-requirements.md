# Print popup: what it needs before it can ship

The [reconstruction](03-implementation.md) renders, and against a real Orca most of it
would not. This is what a read of the host's own handlers turned up — every item below is
a line of C++ in `SSWCP.cpp`, not a design opinion. The design questions are at the end,
and the [mockups](../../../resources/web/print_processing/mockups/) are how they get
answered.

## The shape is wrong, and only the mock hides it

`sw_GetFileFilamentMapping` returns **parallel arrays**. It has never returned a
`filaments[]` array of objects. `ui.js` reads `mapping.filaments[i]`, which exists only
because `mock.js` invented it — so the popup renders four rows against the simulator and
*"No filament requirements read from this file yet."* against Orca.

This is the failure CLAUDE.md already names: a suite green while the page is broken. The
mock was written from the same head as the client instead of from the handler.

What `SSWCP.cpp:3039` actually builds:

| Key | Type | Note |
|---|---|---|
| `filename` / `filepath` | string | display name / the source `.gcode` on disk |
| `machine_model` | string | the **edited printer preset**, base name if it is a derivative |
| `estimated_time` | seconds | `ETimeMode::Normal` from the plate's slice result |
| `filament_type[]` | `["PLA", …]` | trimmed; length is `max(type, colour)` |
| `filament_color_rgba[]` | `["#RRGGBB"]` or `#RRGGBBAA` | the string form |
| `filament_color[]` | int | the same colour packed, for the Flutter side |
| `filament_color_multi[]` | array | **gradient / multi-colour spools** — `BuildPreprintColorMultiItem` |
| `filament_weight[]` | grams | per filament, `density × volume × 0.001` |
| `filament_weight_total` | grams | their sum |
| `filament_used_mm[]` | mm | length, from `filament_diameter` |
| `nozzle_diameters[]` | `["0.4", …]` | what the **file** was sliced for, one per extruder |
| `nozzle_info[]` | `["0.4", …]` | the current plate's, snapped to 0.2/0.4/0.6/0.8 |
| `filament_extruder_map` | `{"0":"0", …}` | **Orca's own** filament→extruder map, from `AppConfig` |
| `thumbnails[]` | `{url, width, height}` | `data:image/png;base64,…` — **the rendered plate** |

Three of those change what the popup can be:

- **`thumbnails[]` is a real picture of the plate.** The popup draws a grey box saying
  "G-code" and always has, in the shipped bundle too. The picture is right there in the
  reply that is already being made.
- **`nozzle_diameters[]` vs `nozzle_info[]`** is a check nothing performs. The file says
  what it was sliced for; the plate says what is fitted.
- **`filament_extruder_map`** is the Prepare sidebar's assignment, already made, arriving
  as the popup's starting point. The popup currently starts from nothing.

## The send would fail

```cpp
void SSWCP_MachineOption_Instance::sw_StartLocalPrint()
{
    if (!m_param_data.count("type") || !m_param_data.count("path")) {
        handle_general_fail(-1, "param [type] or [path] required!");
```

The reconstruction sends `{}`. On a real machine the send stops there, and because the
error arrives as a rejected request the popup would report `send failed:` and stay open.

## There are two doors for the file, and the popup uses the wrong one

Both hand over the same zip; they differ in how it crosses the bridge.

| | `sw_GetPrintZip` | `sw_GetFileStream { is_zip: true }` |
|---|---|---|
| returns | `{name, content}` | `{file_name, file_url, origin_size, checksum}` |
| `content` is | `json = std::vector<char>` | — |
| on the wire | **a JSON array of one integer per byte** | a `localhost` URL |
| a 12 MB zip becomes | ~40 MB of JSON, as a string | 90 bytes |
| integrity | none | SHA-256, base64 |

`m_res_data["content"] = res["zip_data"]` where `zip_data` is a `std::vector<char>`
serialises as `[80,75,3,4,…]`. `sw_GetFileStream` instead writes the zip to disk and
returns `make_wcp_download_url()` — a URL on Orca's own page HTTP server, which this popup
is already being served from. The page `fetch`es it.

`check_coverage.py` files `sw_GetFileStream` under *"cloud file transfer"*. The handler
does not care: it is the general "hand the page the active file" door, and the LAN path
wants it more than the cloud one does.

## Upload progress can be real

The upload is **the page's job**, not Orca's. The LAN route is a multipart POST to
`/server/files/upload` on the printer — the bundle's own strings say so, and
`LavaDevice uploadFileAndPrint` reads the LAN IP to do it. The page already talks HTTP
straight to the machine (`aceOverridesUrl`, `gcodeStoreUrl` both do).

So `XMLHttpRequest.upload.onprogress` gives a true byte count. The current bar is a
`setTimeout` loop counting to 100 in 600 ms whatever happens, including when nothing is
being uploaded at all — the one element on the screen that is purely decorative.

Then, and only then, `sw_StartLocalPrint { type, path }`.

## Three things that are stubs

- **The printer picker.** `sw_GetLocalDevices` returns the saved-device array and
  `sw_SubscribeLocalDevices` pushes it; neither is wired. "Click to select printer" does
  nothing but set a status line.
- **The legality warning.** `sw_GetPrintLegal` is called and its `legal:false` draws one
  line of prose. Nothing decides what a mismatch should *do*.
- **`filament_color_multi`.** Read, never drawn. A gradient spool is a flat swatch.

## What the popup does not show, and is asking about

The grid says *"Filament 3 → Toolhead 3"* while showing nothing about toolhead 3. The
destination is the whole question, and the answer is already in the state stream the
popup subscribes to: `state.filaments()` gives type, vendor, colour, tag and `loaded` per
head, and on a machine running [multiACE](../02-device-page/10-multiace-filament.md) a
head is fed by a bay, so the real sentence is *"bay B2, which feeds head 3"*.

A mapping UI that does not draw its destination is asking the operator to remember what
is in the printer. That is the single largest design decision here, and it is what the
mockups differ on.

## Two dialogs in a row

`Plater.cpp:21966` opens `PrintHostSendDialog` — a native modal asking for the filename,
the post-upload action and *"open the device tab afterwards"* — and **then** opens this
one. The second dialog re-asks nothing but inherits every consequence: `post_action` is
what picks `?path=4` over `?path=5`, so the mode is decided before the page loads and
cannot be changed from inside it.

Worth knowing while judging a design: the user has already answered three questions and
pressed OK once.

## Still true from before

- **Never driven against hardware.** Nothing in the send path has been observed.
- **No restructure.** Flat `app.js` + `ui.js`, where the Device page has `registry.js`, a
  folder per panel and the `pending` / `render` primitives. Lifting them across is what
  would show whether they generalise ([09-restructure](../02-device-page/09-restructure.md)).
- **`sw_UpdateMachineFilamentInfo` does not reach the printer.** `app.js` already sends
  `SET_PRINT_EXTRUDER_MAP` / `SET_PRINT_USED_EXTRUDERS` instead, which is right; the
  Device page's account of why is [12-orca-integration](../02-device-page/12-orca-integration.md).

## The design questions

Everything above is settled by reading. These are not:

1. **Is the mapping the page, or a section of it?** Four cards is what shipped, and it
   gives the mapping a quarter of a 714 × 750 dialog.
2. **What does an unsatisfiable plate look like?** A PETG filament with no PETG loaded, a
   head with the wrong nozzle, a head with nothing in it. Block, warn, or say nothing?
3. **How much of the machine belongs in a print dialog?** Showing what is loaded is
   obviously right; showing ACE bays, humidity and dryers is obviously not. The line is
   somewhere between.
4. **What is the thumbnail for?** Confirming the right plate, or filling a corner.

[The mockups](../../../resources/web/print_processing/mockups/) are three answers, at the
dialog's true size, with the scenarios above switchable.
