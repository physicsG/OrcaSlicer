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

[`js/registry.js`](js/registry.js) lists the five **slots**, in the order `A.bi3` builds
them; the shell is built from it and nothing else names them. There are six entries,
because one slot has two panels: `filament` (the four cards) and `grouping` (an ACE
plate's), and the FILE picks between them — see below.

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

### Bringing the transport up

`sw_GetMachineState` answers out of a Moonraker host, and **something has to attach one
first** — `sw_mqtt_set_engine` is what does it. Inside Orca the Device tab usually has,
and this popup inherits it. Opened without the Device tab having connected, or run
outside Orca, nothing has, and every state command comes back

```
no engine attached yet (sw_mqtt_set_engine has not run)
```

So the dialog brings it up itself, with the Device page's own connect path
(`shared/js/connection.js`): it tries, and on that error connects and tries again.
**Choosing a printer does the same**, because nothing has connected to *that* machine
either.

Getting this wrong is quiet rather than loud. An unattached transport draws four
toolheads reading `NONE` with no nozzles — which is exactly what a printer with nothing
loaded looks like, and is plausible enough for an operator to map filaments against. When
the connect fails the dialog says so and Send stays refused; a device *record* is not a
printer that answered.

### The one command that moves a machine

`sw_StartLocalPrint` starts a print. The bridge refuses it unless `--allow-print` is
passed, so the send path is exercised right up to that command and stopped there. A suite
that can start a print is a suite that will, on somebody's bed, at 3am.

## Where this departs from the shipped dialog

One place, deliberately, and it is worth listing because everything else is a
reproduction.

**The printer rows carry an address.** The shipped dialog draws a device as a cover, a
name, a "Lan Mode" label and a check — so two saved records with the same name are two
identical rows. That is not hypothetical: Orca's config routinely keeps a stale record
beside a live one, and the machine this was built against has exactly that — two `U1 G`
entries on the same address, differing only by serial (`811002511261022618B3` against a
`moonraker` placeholder). Picking the wrong one connects to nothing, and the dialog can
only report that the printer did not answer.

The address is on the record already — `connection.js` refuses to connect without one —
so drawing it costs a second line in a row that has 50 px for it. **The serial appears
only when it is the thing that tells two rows apart**; where a name and an address are
already unique it is noise, and it is not drawn. `deviceMeta()` in
[`printer-view.js`](js/views/printer/printer-view.js) is that rule.

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

## What a real machine showed

Driven against `811002511261022618B3` on 2026-09-02, Orca closed. It paired over
`mqtt://…:1884`, exchanged keys, opened `mqtts://…:8883`, attached the engine, and
`print_task_config` arrived:

```
filament_type       ["PLA","PLA","NONE","PETG"]
filament_vendor     ["Jayo","Forshape","NONE","Kingroon"]
filament_exist      [true,true,false,true]
extruder .. 3       nozzle 0.4 each
```

The plate wanted PLA throughout, so the picker offered heads 1 and 2 and refused 3 and 4
— with the two different tooltips, `_none_tips` for the empty head and `_not_match_tips`
for the PETG one. The refusal set was recomputed from the raw objects in the drive script
rather than read off the page, so the page could not agree with itself.

**It found a bug that the simulator could not.** `initialAssignment` fell back to
*identity* when Orca had no opinion — and this host has none, since
`filament_extruder_map` is Orca's own config. On this machine that put filament 3 on the
empty head and filament 4 on PETG: two toolheads **the picker itself refuses**, with
nothing on screen saying so, because the warning mark means *"nothing chosen"* and
something had been. Unassigned is now the default, which is the bundle's own answer, and
Send is refused while any filament has no home.

**Cancel was proven before anything was sent.** `sw_MachinePrintCancel` routes to this
firmware in 109 ms and answers `ok` on an idle machine. That is the route, not a promise:
`ok` is what a Klipper macro says to an argument it does not have, and this project has
been caught by that before. **That a running print stops has not been shown** and cannot
be without running one.

**The send path ran end to end**, and settled the two things Orca's source could not say.
The upload is a cross-origin multipart POST and answers `HTTP 201` with the item it
created; `start_local_print` wants that reply's `item.path` **without** the root glued on
(`gcodes/x.zip` gives `File not found`); and the firmware unpacks the archive, so the
start reply names the inner `.gcode`. A print was started and cancelled — `print_stats`
went `printing` → `cancelled` in about ten seconds, **while the cancel request itself
timed out**. All of it, with the wire, is
[05-hardware-e2e.md](../../../docs/u1-webui/03-print-processing/05-hardware-e2e.md); the
procedure is the `u1-hardware-test` skill.

## The ACE grouping panel

A plate sliced onto an ACE gets a different filament section, and the FILE picks: with an
`ace_plan` in the mapping reply the grouping panel is the panel, without one Edit Filament
is. **Every plate the slicer can produce on this branch has no plan**, so on a real Orca
today nothing changes at all — `drive/print-dialog.js` still passes 52/52 on the four-card
dialog.

Why it is a different panel rather than a bigger one: Edit Filament asks *which toolhead
does this filament print from*, and an ACE plate cannot be asked that. The file already
decided, and its `ACE_SWAP_HEAD HEAD=n` names the head directly — so a picker would offer
a way to desynchronise the swaps from the tool changes and print on the wrong heads. What
is left is reconciliation: the file says which bay each filament comes from, the machine
says what is in it, the panel says what to move.

It is option G from [the mockups](mockups/), and the whole account is
[06-multiace.md](../../../docs/u1-webui/03-print-processing/06-multiace.md).

```bash
R=resources/web/shared/tests
python3 $R/run_webkit.py --size 714x750 \
    --page 'web/print_processing/index.html?mock=1&plan=1' \
    --drive $R/drive/print-dialog-ace.js
```

`?plan=1` gives the simulator a seven-filament plate on **its own machine** — three stock
feeders and one four-bay ACE head — and `?plan=mismatch` moves one file filament off the
bay that holds it. Both run on the same simulator the four-filament default does, so a
mismatch has to be *created*: a check of the match must not be a check of two fixtures
agreeing with each other.

**One command, and it writes the identity.** `extruder_map_table` is machine state that
survives a print — a real U1 has been seen carrying `[0,1,1,0]` from an earlier job — so
sending nothing inherits it, and on an ACE plate any remap prints on the wrong heads. The
drive script asserts the map went out *and* that no line moves a tool off its own head.

**`hidden` hid nothing, and that is why this needed a check.** `.card` is `display: flex`
and `hidden` is a UA rule any author `display:` beats, so the four cards went on being
drawn beside the panel replacing them. `[hidden] { display: none !important }` is in
`preprint.css` now.

### The ACE is drawn on every plate, not only on one with a plan

Two facts, and they are independent — this was got wrong once and found by running the
page against a machine with an ACE and a plate without a plan, which is the only
combination that exists today:

| | decides |
|---|---|
| does the FILE address bays (`ace_plan`) | whether the mapping is a **choice** (the four cards) or fixed (the grouping panel, no picker) |
| is the MACHINE ACE-fed (`ace.present`) | how to **describe** what feeds each head |

Gating both on the first meant the page read the whole `ace` object, merged the override
store, resolved `T4:ace(A)` — and drew none of it, offering `head 4: PLA` for a head whose
filament is whichever of the unit's spools was last loaded. Edit Filament now carries the
machine's own line (mode, unit badge, which toolheads it feeds) and a per-row source note
in the picker, from `ace` alone. A printer with no ACE sees exactly the dialog it always
saw.

**No bay number when the machine reports none.** `head_source` is null on the reference
machine even for the ACE-fed head, so the note reads `ACE A`, not `ACE A1`. The override
store names what is in each bay; it does not say which is loaded, and inferring it by
colour would be a guess.

## Honest limits

- **Confirming a machine command against its ack is still wrong**, even though the
  timeout that made it visible is fixed. `shared/js/pending.js` exists for that shape and
  the print dialog uses it for the mapping and the preferences; the Device page's task
  panel still reads a cancel's outcome off the reply.
- **No plate has been left to run.** Everything is cancelled within seconds, so nothing
  past the first moments of a job has been observed.
- **The cloud path is untouched** — `sw_StartCloudPrint`, `server.files.pull` and the S3
  upload. This is the LAN route only.
- **Whether a started job honours the mapping and the preferences** has not been checked.
  The macros are written and acknowledged; that is not the same thing.
- **The multi-plate Model Information layout is not built.** `A.J9` has a second
  branch for a file with `partitions`, and `sw_GetFileFilamentMapping` as Orca
  implements it has no such key — the branch is unreachable through this host. It is
  recovered and drawn in the mockup.
- **A file filament's nozzle is inferred**, and it is the only inferred thing here:
  `nozzle_diameters` is per-extruder and `filament_type` per-filament, and the reply does
  not say how to pair them. See `fileFilaments` in `core/session.js`.
- **`filament_color_multi` is read and drawn**, but no plate observed so far has carried
  a gradient or segmented spool, so only the simulator has exercised those two branches.
- **The ACE grouping panel has never met a printer**, and cannot: no Orca on this branch
  produces a plate with an `ace_plan`. It is driven against the simulator only, and its
  `multi` and `normal` branches are drawn but unexercised — the simulator reports `head`.
- **The build badge covers the panel's last note at one scroll position.** It is fixed to
  the bottom-right and the body scrolls under it; this is the first panel on this surface
  long enough to put a line there. Scrolling reveals it, and the suite already guards the
  one thing that must never be covered — the Send button.
