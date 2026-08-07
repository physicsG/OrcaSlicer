# 11 · Filament assignment dialog — design & progress

> Branch: `feat/ace-mmu-slicing`. Living document: updated as the work proceeds.
> Companion to `10-slicing-plan.md` (the optimiser) — this covers the **UI and the
> printer-side mapping** that turn a computed plan into a print.
>
> **Status:** page built and verified in WebKit; C++ dialog + send-flow wiring next.

## 1. Why we need our own dialog

Snapmaker's send flow shows a **"Print Preprocessing"** dialog (`WebPreprintDialog`,
`flutter_web/index.html?path=5`). For a 7-filament plate it marks every filament with
a red `(!)` and the per-filament dropdown offers exactly **four** targets. Two hard
reasons it can never do what multiACE needs:

1. **It models 4 physical spools.** The dropdown is driven by the printer's four
   extruders (`print_task_config.filament_type` has 4 entries). ACE slots live in
   multiACE's own API (`/multiace/api/state`), which that page knows nothing about.
   With `1,1,1,4` there are **7** logical spools to place, and it cannot express them.
2. **It is not editable.** It is a *compiled* Flutter web app — 5 MB minified
   `main.dart.js` + CanvasKit WASM, no Dart source in this repo — and CanvasKit paints
   the whole UI into a single `<canvas>`. There is no DOM to restyle, extend or inject
   into. (Same wall as the Device page, see `09-u1-multiace-page.md`.)

**Decision: build our own dialog** and use it in place of that step for ACE-equipped
printers. Stock printers keep the existing flow untouched.

**This is cheap because the send pipeline is not in that page.** `send_gcode_legacy`
already builds a `PrintHostJob` and calls `background_process.schedule_upload(...)` →
`PrintHostJobQueue` → Moonraker upload + start print (`Plater.cpp:20705-20741`,
`13017`, `BackgroundSlicingProcess.cpp:734`). That is native Orca and already works
for the U1. The Flutter page is an extra layer on top; replacing it does not touch
uploading or printing.

## 2. The machine's mapping contract (verified on the printer)

Queried live on 2026-08-07 (`/printer/objects/query?configfile`, `?print_task_config`,
`/printer/gcode/help`):

- The slicer already emits **`T0…Tn`, one virtual tool per project filament** — an
  unmodified 7-filament slice emits `T0…T6`. No tool re-indexing is required.
- The printer holds a 32-entry **virtual-tool → physical-head** table:
  `print_task_config.extruder_map_table = [0,1,2,3, 0,0,…]` (identity for T0–T3;
  T4+ unmapped, which is exactly what the red `(!)` badges mean).
- `T4…T31` are macros → `SWITCH_OF_EXTENDED_EXTRUDER INDEX=n`, resolved through that
  table (a Snapmaker Klipper extension, not a gcode_macro).
- `SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=<virtual> MAP_EXTRUDER=<head>` writes one
  entry. `SET_MAP LANE=<lane> MAP=T<n>` is the lane-oriented wrapper and binds an
  **AFC lane** (`printer['AFC_lane <id>']`) to a virtual tool.

**Consequence for the design.** The optimiser's output *is* this mapping. Our job is
to fill the table the machine already understands, not to invent a parallel mechanism.

> **RESOLVED — see §2b. The question below is answered: the preflight rewrites the
> gcode itself, so no slicer-side slot mechanism is needed.**
>
> ~~**Open question (blocking the slot half).**~~ `extruder_map_table` carries
> virtual-tool → **head** only; it has no slot. For 4 colours sharing one ACE head,
> something must still select the slot per change — either `SET_MAP`'s lane binding or
> multiACE's own layer. **To be pinned down on the printer before writing the
> push code.** This also puts a question mark over the `ACE_SWAP_HEAD` emission
> already committed in the U1 `change_filament_gcode`: if the firmware resolves swaps
> through the map, that emission may be redundant or conflicting. It is inert today
> (guarded by `{if ace_swap}`, and nothing sets `ace_head_capacity` by default).

## 2b. RESOLVED: multiACE's preflight already does the mapping (and the planning)

Read the source (`decay71/multiACE`, `multiace/web/backend/preflight_core.py` +
`main.py`). The preflight is not a thin macro-stamper — it is a full planner and
gcode rewriter that runs **on the printer**:

- `parse_meta()` scans the sliced file for `; Change Tool N -> Tool M` comments —
  which the U1's stock `change_filament_gcode` already emits — to recover the
  colour-change sequence.
- `_head_proposal_plan()` / `plan_loadout_from_file()` compute a **colour → head**
  assignment; `head_plan` selects `loadout | optimize | layer`.
- `_layout_from_head_assignment()` turns that into `(ace, slot)` per colour;
  `_real_swap_count()` prices it; `_bg_stats_for()` accounts for background swaps
  (`ACE_BG_SWAP`).
- `head_mode_targets()` is literally "the dropdown universe: each pin-able feeder +
  each ACE slot on a wired ACE" — multiACE already has a pinning assignment UI.
- `rewrite_pipeline()` **rewrites the gcode** into a print-ready file and uploads it.

So the slot dimension never needed a slicer-side mechanism: the preflight rewrites the
file. **Consequences, stated plainly:**

1. Our optimiser (`AceMmuPlan.hpp`) **duplicates** multiACE's planner. It is still
   useful — it is exact/optimal and runs at slice time — but it is no longer the only
   implementation, and we should not pretend otherwise.
2. The `ACE_SWAP_HEAD` / `ACE_SET_PURGE` emission committed into the U1
   `change_filament_gcode` is **probably the wrong mechanism**: multiACE rewrites the
   file rather than relying on slicer-stamped macros. Candidate for reverting.
3. **The API accepts an externally computed assignment** — this is the opening:

   | endpoint | purpose |
   |---|---|
   | `POST /api/preflight` | upload + analyse, returns the plan preview |
   | `POST /api/preflight/print` | run it; body takes **`head_assignment`** and `head_plan` |
   | `POST /api/upload-and-print` | upload + print |
   | `POST /api/head-ace`, `/api/head-feeder`, `/api/head-manual` | topology |

### Direction (DECIDED: native in Orca)

**Decided: Orca emits print-ready ACE gcode natively** (option B), bypassing the
preflight. The alternative (hand `head_assignment` to `POST /api/preflight/print` and
let multiACE rewrite) was recommended but not chosen; it remains available as a
fallback since the endpoint accepts an external assignment.

Going native makes multiACE's rewriter our **specification**. It is
`multiace/tools/post_process_virtual_toolheads.py` ->
`rewrite_head_mode_to_file(in_path, out_path, assignment, ...)`, and the contract is:

| rule | what Orca must emit |
|---|---|
| feeder colour (`'pin'`) | `T<pin_head>` - remapped, **no swap** |
| ACE colour (`'ace'`) | `T<entry_head>` **+** `ACE_SWAP_HEAD HEAD=<head> ACE=<a> SLOT=<s>` |
| dedupe | emit the swap only when that head's loaded `(ace,slot)` actually changes |
| temperatures | `M104`/`M109 T<n>` remapped to the **assigned physical head** |
| initial tool | pre-body tool selection remapped to the head |
| priming | `SM_PRINT_PREEXTRUDE_FILAMENT` is **DROPPED for ACE colours** - a real swap flushes anyway, and per-swap primes stacked ooze drops on the tower whose `SKIP_POS_RESTORE` coupling knocked docked heads off (their note: HW 2026-07-04). Instead **one forced prime per ACE head at its first body use**; pinned colours keep the stock line remapped to the head (first one `FORCE=1`) |
| cleaning | `ACE_PICKUP_CLEAN HEAD=n` after a bare-T pickup, when pickup-cleaning is on |

Two things this **validates** in what we already have: the emitted form
`ACE_SWAP_HEAD HEAD= ACE= SLOT=` is exactly right, and our per-head loaded-spool
tracking in `GCode::set_ace_toolchange_vars` implements precisely their dedupe rule.

**Gotcha found while reading our own code (must fix for native mode).** The exported
tool index has to become the *head*, not the filament index - but `GCode::set_extruder`
(GCode.cpp:8721-8723) does:

```cpp
std::string toolchange_command = m_writer.toolchange(extruder_id);
if (!custom_gcode_changes_tool(toolchange_gcode_parsed, m_writer.toolchange_prefix(), extruder_id))
    gcode += toolchange_command;      // appends T<extruder_id> if the template didn't
```

If the template emits `T{ace_head}` (say `T3`) while `extruder_id` is 5, that check
looks for `T5`, does not find it, and Orca appends a **second** tool change - emitting
both `T3` and `T5`. So the remap cannot live only in the template: it must be central
(`m_writer.toolchange()`, the `custom_gcode_changes_tool` probe, and the `M104/M109 T`
emitters) so every site agrees on the physical head.

## 3. Architecture

Same "Flutter-like" pattern as the U1 + multiACE page: a `wxWebView` hosting a local
HTML page, fed live JSON from C++.

```
Plater::send_gcode_legacy
  └─ (ACE-equipped?) AceMmuPlanDialog            [C++, wxWebView]
        ├─ push:  window.setPlanState(<json>)    plan + filaments + hardware
        ├─ recv:  wx.postMessage("apply:<json>") user's final assignment
        └─ on OK: push mapping to the printer, then the existing
                  PrintHostJob / schedule_upload path runs unchanged
```

- **Page:** `resources/web/aceplan/index.html` — derived from the reviewed mockup
  (`docs/ace-mmu/load-plan-mockup.html`) so the shipped UI *is* the approved design.
- **Dialog:** `src/slic3r/GUI/AceMmuPlanDialog.{hpp,cpp}` (to build), modelled on
  `AceMmuPanel` (webview creation, `window.wx.postMessage` handler, worker-thread
  fetch + `CallAfter`).

### Data contract

C++ → page, via `window.setPlanState(json)`:

| field | meaning |
|---|---|
| `filaments[]` | `{name, hex, mat, drying}` per project filament, in filament order |
| `capacities[]` | per head: 1 = stock feeder, >1 = ACE slots (`ace_head_capacity`) |
| `units[]` | per head: ACE unit feeding it, -1 for feeders (`ace_head_unit`) |
| `sequence[]` | the colour-change sequence (flattened `ToolOrdering`) |
| `pins[]` | `{filament, head, slot}` hard constraints (e.g. a drying spool) |
| `mode` | `"auto"` or `"manual"` |
| `grams_per_swap` | purge estimate for the waste readout |

page → C++, via `wx.postMessage("apply:" + json)`:

```json
{ "mode": "auto", "swaps": 3,
  "assign": [ {"filament":0, "head":0, "slot":0, "unit":-1, "pinned":false}, … ] }
```

### Behaviour (from the mockup, already implemented in the page)

- **Auto | Manual** toggle, backed by `filament_map_mode` semantics.
- **Auto:** optimiser runs; drag a spool onto a position to **pin** it there (hard
  constraint, re-plans live); click to pin/unpin. "Clear pins" is Auto-only.
- **Manual:** drag to move; a displaced spool swaps into the old spot; the header
  prices the layout against the Auto optimum ("Auto would need M").
- Feeders and ACE trays render as the same family of source boxes (`T1…` vs `A1…`),
  one tray per ACE-fed head, toolheads along the bottom with feed wires.
- Drying spools show a chip and are pin candidates.

## 4. Verification

The page is exercised headlessly in **WebKitGTK** (`scratchpad/pagecheck.c`): it loads
the page, injects an error trap, evaluates probes, and prints console errors. This
already caught a real `ReferenceError` (an out-of-scope `COLL`) before any C++ was
written. Current results:

| check | result |
|---|---|
| JS errors (demo state) | none |
| head-mode `1,1,1,4`, 7 filaments | 7 positions, **Swaps 3** |
| multi-ACE `1,1,4,4`, 9 filaments | 4 source boxes, 10 positions, 4 toolheads |

The JS optimiser is a port of `AceMmuPlan.hpp`; **"Swaps 3" matches the hand-verified
optimum asserted by the C++ unit test** for the same 7-colour scenario — a useful
cross-check that the two agree.

## 5. Build order & status

| # | step | status |
|---|---|---|
| 1 | Data-driven page from the mockup (`resources/web/aceplan/`) | **done** — verified in WebKit |
| 2 | `AceMmuPlanDialog` webview host + state serialisation | next |
| 3 | Feed real data (plan, filament colours, live ACE state) | |
| 4 | Persist pins + mode per plate (`filament_map` / plate config) | |
| 5 | ~~Pin down the slot half~~ — resolved: preflight rewrites the file (§2b) | **done** |
| 6 | Native export: remap tool index + temps to the head, drop ACE preextrude, one prime per ACE head (§2b) | **next** |
| 7 | Insert into `send_gcode_legacy` ahead of the Flutter page; keep the existing `PrintHostJob` upload | |
| 8 | Pre-print spool readiness checklist (see `10-slicing-plan.md` §6) | |

## 6. Decisions & open questions

- **Decided:** own dialog rather than editing Snapmaker's page (§1 — it is compiled
  and canvas-rendered, and structurally limited to 4 spools).
- **Decided:** keep the native `PrintHostJob`/`schedule_upload` send path; do not
  reimplement uploading, progress or printer selection.
- **Decided:** the shipped page is derived from the mockup, so design review and
  implementation cannot drift apart.
- **Keep** the `ACE_SWAP_HEAD` emission - the spec confirms the exact form and the
  dedupe rule we already implement. Native mode (B) is the chosen path.
- **Open:** what happens to Snapmaker's *Print Preferences* toggles (flow calibration,
  time-lapse, auto-leveling) if we bypass their page — replicate the ones that matter
  or keep their page as a second step.
- **Open:** `ACE_BG_SWAP` swaps a *parked* head's spool during printing. If reliable,
  some swaps become nearly free and the optimiser's cost function should model it.
