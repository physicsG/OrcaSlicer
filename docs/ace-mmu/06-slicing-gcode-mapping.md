# 06 · Slicing, Virtual Tool Indices & G-code

This is where the integration pays off: how a filament placed in ACE `a`, slot
`s` becomes the right tool change in the printed gcode.

## 6.1 The numbering identity (restated)

| Layer | Formula | Range |
|-------|---------|-------|
| Orca AMS mapping | `tray_index = ams_id * 4 + tray_id` | 0..15 |
| multiACE post-processor | `ACE = T // 4`, `SLOT = T % 4`, `HEAD = T % 4` | T = 0..15 |

Set `ams_id = ACE index` and `tray_id = slot index` and the two coincide:

```
T (virtual tool) = ams_id*4 + tray_id = ace*4 + slot
```

- ACE 0 → `T0 T1 T2 T3`
- ACE 1 → `T4 T5 T6 T7`
- ACE 2 → `T8 T9 T10 T11`
- ACE 3 → `T12 T13 T14 T15`

Up to **16 logical filaments** (4 ACE × 4 slots). The printhead has 4 physical
heads; `HEAD = T % 4` selects which head, and `ACE_SWAP_HEAD` swaps that head's
feed to the requested `(ACE, slot)`.

## 6.2 Mapping at slice time

The user assigns each project filament (extruder) to a physical `(ACE, slot)`
via the existing AMS mapping popup (which now shows ACE units, per
[03 §3.4](03-orca-ams-data-model.md)). `ams_filament_mapping()` fills each
`FilamentInfo` with `ams_id` / `slot_id`. The slicer must ensure the **exported
gcode's tool index for that filament is `ams_id*4 + slot_id`**.

Two possibilities depending on how Orca currently numbers tools for the U1:

1. **If the U1 already exports one `T<n>` per project filament in project order**
   (n = filament index), then the mapping must *reorder/relabel* so tool `n`'s
   physical slot is `ace*4+slot`. This is exactly what multiACE's post-processor
   `--live-lookup` / colour-matcher does today: it rewrites `T<n>` to the slot
   whose colour/material matches. Two clean designs:
   - **A. Slicer emits physical indices directly.** Make the exporter number the
     tool as `ace*4+slot` from the mapping result. Then post-processing only
     needs the `T4..T15 → ACE_SWAP_HEAD` expansion, no colour matching.
   - **B. Slicer emits project indices; post-processor matches.** Leave export as
     is and rely on `--live-lookup` against `/multiace/api/state`. Simpler slicer
     change, but depends on colour/material matching heuristics.

**Recommendation:** aim for **A** (deterministic, matches Bambu/Anycubic where
the slot is explicit), but **B works today with zero export changes** and is a
valid first release.

## 6.3 What the exported gcode looks like

multiACE recognises virtual tool changes in the body and rewrites them. From
`post_process_virtual_toolheads.py`:

```
; body, before post-processing
; Change Tool 0 -> Tool 6
T6
```
becomes
```
T2
ACE_SWAP_HEAD HEAD=2 ACE=1 SLOT=2      ; ACE=6//4=1, SLOT/HEAD=6%4=2
```

The post-processor also:
- Rewrites `M104/M109 T<n>` heater lines (`n%4`).
- Drops/rewrites `SM_PRINT_PREEXTRUDE_FILAMENT INDEX=<n>`.
- Dedupes consecutive same-slot swaps (`; skipped (already loaded)`).
- Injects an initial auto-load block (`ACE_SWAP_HEAD` per used head) before the
  first extrusion.
- Optionally runs swap-minimising optimisers (`--optimize`, `--layer`).

The slicer does **not** need to emit `ACE_SWAP_HEAD` itself; it only needs the
tool indices to encode `(ACE, slot)`.

## 6.4 Invoking the post-processor

Two supported user paths (document both):

### On the PC (recommended for large files)
Add to `Print Settings → Output options → Post-processing Scripts`:
```
"C:\Python\python.exe" "C:\multiace\post_process_virtual_toolheads.py" --layer
```
Orca appends the exported gcode path automatically. Options:
- `--live-lookup [ip]` — match tool colours to the printer's currently loaded
  slots via `GET http://<ip>/multiace/api/state` (design **B**).
- `--aces N` — override auto-detected ACE count.
- `--optimize` / `--layer` — swap minimisation.

If the slicer uses design **A** (indices already physical), the post-processor
runs without `--live-lookup` and simply expands `T4..T15`.

### On the printer (multiACE Web Preflight)
Upload the raw gcode via `POST /multiace/api/preflight` then
`/api/preflight/print`; the printer runs the same logic and starts the print.
Not recommended for very large files (the U1 is slow; there's a size cap around
110 MB, configurable via `MULTIACE_PREFLIGHT_MAX_MB`).

## 6.5 Live-lookup contract (for design B / validation)

`lookup_live_slots(host, port=80, path='/multiace/api/state')` returns, for every
slot with `state != "empty"` and `source in ("rfid","override")`:

```python
{ 'ace': idx, 'slot': idx, 'material': str, 'color': '#rrggbb' (lower) }
```

The Orca provider should surface the **same slot identity** the post-processor
sees, so what the user maps in the UI equals what prints. If Orca exposes a slot
with `source == "derived"` in the UI, note that the post-processor's live-lookup
will **ignore** it (it only trusts `rfid`/`override`) — a source of confusion to
call out in the UI (e.g. badge "identity inferred, not from spool").

## 6.6 Materials & compatibility

- `GET /multiace/api/materials` returns the printer's known materials and a
  `type → vendor → subtypes` DB (from the firmware `filament_parameters.py`).
  Use it to validate/normalise material names shown in mapping and to build the
  filament preset resolution table.
- The AMS mapping already checks material compatibility
  (`FilamentComboBox::is_compatible_with_printer`); populating `AmsTray::type`
  from `slots[].material` makes this work for ACE trays.

## 6.7 Send-to-printer

Orca's `SelectMachineDialog` builds an AMS mapping array (`ams_id`, `slot_id`,
colour, filament id) for the print job. With ACE trays in `amsList` this array is
produced by the existing code. If the U1's print submission uses Moonraker
(upload + print via `Moonraker_Mqtt`), the mapping is carried by the gcode's tool
indices (post-processed to `ACE_SWAP_HEAD`) — i.e. **the mapping is realised in
gcode, not in a separate AMS command payload** (unlike Bambu's cloud mapping).
Confirm this against the U1 send path during Phase 4.
