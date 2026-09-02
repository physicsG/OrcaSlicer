# The print-processing popup

The dialog Orca opens between "Send to printer" and the print starting, rebuilt from the
shipped Flutter bundle. `WebPreprintDialog` gives it 714 × 750 DIP and one of two routes:

| Orca | here | shows |
|---|---|---|
| `?path=4` `preUploadAndPrint` | `?mode=print` *(default)* | all five sections |
| `?path=5` `preUpload` | `?mode=upload` | Model Information + Select Printer |

**The specification is
[`docs/u1-webui/03-print-processing/original-dialog-mockup.html`](../../../docs/u1-webui/03-print-processing/original-dialog-mockup.html)** —
the shipped dialog recovered widget by widget, with the source cited for every
measurement, and held to those numbers by `check_mockup.py`. This page is built against
it; `drive/print-dialog.js` asserts the same numbers survive a real layout.

No rebuild is needed: `build/resources` is a symlink to `resources/`, the page server
sends no cache headers, so edit and reload.

## Structure

The Device page's contract, because it is the same idea and the primitives are now
shared. **One panel is one directory**, holding all of what it is:

```
js/views/filament/
    filament-panel.js      its declaration, and mount/update
    filament-view.js       its DOM: built once, then patched
    filament-commands.js   everything it can ask the machine to do
```

[`js/registry.js`](js/registry.js) lists the five, in the order `A.bi3` builds them; the
shell is built from it and nothing else names them.

| | |
|---|---|
| `js/core/session.js` | the two sources this surface reconciles, and the match rule |
| `js/core/send.js` | packaging, uploading, starting, and the close protocol |
| `js/core/shell.js` | the sections and the spacing between them |
| `js/core/mock.js` | a thin adapter over the shared simulation |
| `js/widgets/picker.js` | the dropdown all three pickers use |
| `js/widgets/art.js` | the colour block and the target disc |
| `js/widgets/format.js` | this dialog's own number formats |

### What is shared rather than local

Everything that is not about this dialog in particular:

| from `../shared/js/` | |
|---|---|
| `dom.js` `render.js` `pending.js` | the primitives that grew on the Device page |
| `dialog.js` | the modal sheet - the help control uses it |
| `trace.js` | the WCP trace pane |
| `sswcp.js` `protocol.js` `state.js` | the bridge, the constants, the machine model |
| `mockhost.js` | **the simulated U1 *and* Orca**, shared with the Device page |
| `buildinfo.js` | the build badge |

`cssColor` is *not* reimplemented here. It is in `protocol.js`, because the alpha-zero
rule — multiACE wipes a head's identity with `00000000` while the spool is still in it,
so alpha zero is an absence and not black — must have exactly one implementation.

## The two sources, and why neither is derived from the other

This dialog exists to match **the file's** filaments against **the machine's**:

* the file — `sw_GetFileFilamentMapping`, answered by Orca out of the sliced plate
* the machine — `print_task_config` on the state stream, plus each extruder's
  `nozzle_diameter`

The bundle names a third command for the machine side, `sw_GetMachineFilamentMapping`
(index 29). Orca does not implement it (`implemented_in_cpp: false`), so
`print_task_config` is the only source there is.

**The match rule is the bundle's, and it refuses**: a toolhead may take a file filament
only when its *type* and its *nozzle* both match, and a head that fails is passed
`enabled: false` — it cannot be picked at all, only shown at half opacity with one of two
tooltips. That is behaviour, not decoration, and `drive/print-dialog.js` checks it by
clicking a refused item and asserting nothing moved.

## Testing it — mock, and a real U1

Both, the same way the Device page does it, through `run_webkit.py --page`.

**Against the simulator**, no printer and no Orca:

```bash
R=resources/web/shared/tests
python3 $R/run_webkit.py --size 714x750 --page 'web/print_processing/index.html?mock=1' \
    --drive $R/drive/print-dialog.js
```

**Against a real U1**, with Orca closed — `u1_bridge.py` is a second host speaking Orca's
contract. The printer answers the machine half; the *job* half is read out of a real
sliced `.gcode`, because outside Orca there is no plate to ask:

```bash
python3 $R/run_webkit.py --real --size 714x750 --watch \
    --gcode ~/models/plate_1.gcode \
    --page web/print_processing/index.html
```

`--gcode` is what makes the Orca-side commands answerable. The bridge parses the file's
own trailing metadata — `filament_type`, `filament colour`, `filament used [g]`,
`nozzle_diameter`, the estimate and the embedded thumbnail — so the dialog sees a real
plate rather than a fixture. Without it those commands refuse and say why.

**With no printer at all**, which is the branch worth forcing on anything touching the
device record:

```bash
python3 $R/run_webkit.py --real --device-ip 192.0.2.1 --size 714x750 \
    --gcode ~/models/plate_1.gcode --page web/print_processing/index.html \
    --drive $R/drive/print-dialog-real.js
```

### The one command that moves a machine

`sw_StartLocalPrint` starts a print. The bridge refuses it unless `--allow-print` is
passed, so the send path is exercised right up to that command and stopped there. A suite
that can start a print is a suite that will, on somebody's bed, at 3am.

## The send

Four things here are not what the previous reconstruction did, each read off the host:

1. **The file comes as a URL.** `sw_GetFileStream {is_zip:true}` returns
   `{file_name, file_url, origin_size, checksum}`. `sw_GetPrintZip` returns the *bytes*,
   from a `std::vector<char>` that serialises as one JSON integer per byte — a 12 MB zip
   crosses the bridge as ~40 MB of JSON.
2. **The upload is the page's.** A multipart POST to `/server/files/upload` on the
   printer, so the bar is a byte count from `upload.onprogress` and not a timer.
3. **`sw_StartLocalPrint` needs `{type, path}`** and fails the request without them.
4. **Closing is two commands and only the second closes.**
   `sw_SetFilamentMappingComplete` records; `sw_FinishFilamentMapping` ends the modal.

## Honest limits

- **Never driven against a connected printer.** The Orca half runs on a real plate and
  the not-connected branch is covered; nothing in the send path past
  `sw_GetFileStream` has been observed with a machine on the other end.
- **The multi-plate Model Information layout is not built.** `A.J9` has a second
  branch for a file with `partitions`, and `sw_GetFileFilamentMapping` as Orca
  implements it has no such key — the branch is unreachable through this host. It is
  recovered and drawn in the mockup.
- **A file filament's nozzle is inferred**, and it is the only inferred thing here:
  `nozzle_diameters` is per-extruder and `filament_type` per-filament, and the reply does
  not say how to pair them. See `fileFilaments` in `core/session.js`.
- **`filament_color_multi` is read and drawn**, but no plate observed so far has carried
  a gradient or segmented spool, so only the simulator has exercised those two branches.
