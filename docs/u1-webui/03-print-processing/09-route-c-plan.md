# Route C, made ready: the host-side rewriter

**Branch:** `feat/u1-print-multiace`. **Written:** 2026-09-03 against `b9b6224989`, plus the
lift and the rewriter described in §4. **Decision:** route C of [08-handover.md](08-handover.md) §3 — rewrite
the sliced gcode in Orca, after slicing, the way multiACE's preflight does on the printer.
Nothing below re-opens that.

> **On the label.** [07-ace-mapping-routes.md](07-ace-mapping-routes.md) §4 numbers the
> routes differently: its **C** is *"Today"* — no ACE in the file. The handover's **C**, and
> this document's, is *rewrite in Orca*. 07 carries a note now.

This is the pre-implementation check the handover asked for. Every claim was re-verified
against the tree at the commit above; every open question that reading could settle is
settled; the reusable pieces are on the branch and their tests run. What remains is the
rewriter itself, and §5 says in what order.

---

## 0. The short version

- **The hook holds.** One call site covers every exit (§2.1). One thing changes from the
  handover: the rewrite writes a **sibling** file, and the four places that pick up "the
  gcode to send" ask the plate for it, rather than rewriting the plate's temp file in place.
  §3.2 says why.
- **The specification is at a tag, not in the checkout.** `~/proj/multiACE` sits at
  `e691f2e` (2026-08-05, a side branch); the printer runs `v0.99.8b` (2026-08-20). Neither
  is an ancestor of the other, and the rewriter differs by 600 lines between them in ways
  that matter (§2.3). Read the spec with `git show v0.99.8b:…`, never from the working tree.
- **The planner, the reconcile and the identity guard are here now**, lifted unchanged from
  `origin/feat/ace-mmu-slicing` with 1,091 lines of tests (§4.1). **The rewriter is built
  and tested (§4.2), and the hook, the sibling, the zip fix, the page contract and the cost
  notification are built and compile (§4.3).** None of §4.3 has been observed in the running
  app yet; §5 says what to look at.
- **Two pre-existing defects sit on route C's path** and are part of the work: the cached
  send zip (§2.5) and the disabled extruder check (§2.4).
- **What was unread is read.** The preflight does *not* refuse an over-capacity plate on its
  `loadout` plan — its UI does, and its rewriter passes the unplaceable tool through as a
  bare `T5` (§2.4). Orca refuses before rewriting.

---

## 1. Scope of the first cut

**In:** `head` mode with one unit per ACE-fed head; the stock feeders; the swap-minimal
plan; the identity map on send; the header the page and the bridge already read.

**Designed, gated off:** `multi` mode (R9). **Out:** background swaps, pickup cleaning,
per-swap `ANTI_OOZE`, the layer plan, pins, "what is loaded" planning. Each has a line in §6.

---

## 2. Verified, with the lines

### 2.1 The hook, and every consumer of the file it writes

| where | what | role |
|---|---|---|
| `BackgroundSlicingProcess.cpp:239-242` | `export_gcode` writes `m_temp_output_path`; the BBL-only post-process runs right after it | **the hook** |
| `:200-222` | a finished `Print` re-uses the temp file: *Export G-code* **copies**, never re-exports | one hook is enough |
| `:794` `finalize_gcode` | copies `m_temp_output_path` to the export path (user post-process on a copy) | consumer |
| `:918` `prepare_upload` | copies it for a print-host upload | consumer |
| `Plater.cpp:21953` | `send_gcode_legacy`, U1 branch: hands `get_tmp_gcode_path()` to `WebPreprintDialog`; `WebPreprintDialog.cpp:122` makes it the active file, which `sw_GetFileStream` zips (`SSWCP.cpp:660-700`) | **the U1 send** |
| `PartPlate.cpp:5460` | the sliced 3MF takes `m_gcode_result->filename` — the same path | Ctrl+G |
| `PartPlate.cpp:2903-2911` | the path is `<project backup>/Metadata/.<pid>.<n>.gcode`, chosen **once per plate** and reused by every re-slice | matters for §2.5 |

`SelectMachine.cpp:2948` and `Plater.cpp:22091` also read it; both are Bambu paths a U1
never takes.

### 2.2 The preview's bookkeeping

- `GCodeProcessor.cpp:710` and `:858`: `extruders_count = filament_diameter.size()` — the
  **filament** count, not the nozzle count. A 7-filament plate's `T4`..`T6` are valid tools
  to the processor, so the preview of the *logical* file is right as it is.
- `GCodeViewer.cpp:483-497`: the G-code window memory-maps `gcode_result.filename` and
  indexes it by `lines_ends`; `moves[].gcode_id` is a line number in that file.
  `GCodeProcessor.cpp:4181` and `:4377-4382` (`ExportLines::synchronize_moves`) are the
  existing pattern for shifting ids after lines are inserted. Route C does not need it
  (§3.2).
- `Print.cpp:3497-3515`: a re-opened sliced 3MF is re-processed from its gcode. A rewritten
  file re-processes with physical tools, so the preview then colours by head. Known,
  accepted for v1, listed in §6.

### 2.3 The specification, at the tag

```bash
cd ~/proj/multiACE
git show v0.99.8b:multiace/tools/post_process_virtual_toolheads.py   # the rewriter
git show v0.99.8b:multiace/web/backend/preflight_core.py             # the pipeline
git show v0.99.8b:multiace/klipper/extras/ace.py                     # what the macros accept
```

What `v0.99.8b` has that the checkout does not, in the two functions being ported:

| at `v0.99.8b` | what it is | v1 |
|---|---|---|
| `scan_cooling_standbys` (`:963-1039`) | replays the file and drops an `M104`/`M109` that provably leaves the *printing* head under 170 °C before it extrudes again. Orca sets every parked tool to a standby temperature with a `;cooldown` marker (`OozePrevention::pre_toolchange`, `GCode.cpp:258-282`, driven by `standby_temperature_delta`); once two tools share a head, a standby meant for the parked one can land on the head that prints the next. The reference file has 400 of them. | **port** |
| `PURGE_MATRIX_ENABLE`, `parse_flush_matrix_raw_from_file`, `_matrix_purge_mm` (`:1041-1160`) | reads `flush_volumes_matrix` and `flush_multiplier` out of the file's own config block and stamps `ACE_SET_PURGE LENGTH=<mm>` before each swap: `clamp(40, 150, 0.45 × volume ÷ 2.405)`, multiplier applied upward only | **the matrix is not Orca's exclusive knowledge** — the handover's point 3 overstated it. Orca's edge is the exact sequence and being on every exit. v1 stamps the slicer's own pair length (R7). |
| `INITIAL=1` on the preload swaps | `ace.py:12258`, `:12704`, `:12736`: an initial swap parks at the discard position instead of restoring the print position — right for a swap before the prime line, where there is no part | **adopt** |
| `ACE_SET_PURGE RESET=1` at the top of the preload block | falls back to `swap_purge_length`; on the machine's own macro help | **adopt** |
| `; multiACE processed: format=4` | the preflight's re-entrancy marker (`PP_FORMAT_VERSION`) | **write it**, so a file that already went through is recognisable |

Unchanged between the two: `_scan_body_tools`, `_scan_post_t_unretracts`, the anchor
logic, the dedupe, the `M104` remap, the pre-extrude rules.

**What the macros accept at `v0.99.8b`** (`ace.py:12243-12300`): `HEAD`, `ACE`, `SLOT`
(defaults to `HEAD`), `ANTI_OOZE` (float, default from config), `INITIAL`;
`SKIP_POS_RESTORE` is read and ignored. A swap to the (unit, slot) the head already holds is
**skipped** with a log line, and re-heats if it is the active head. In `head` mode a swap
naming a unit other than the head's wired one is **refused** (code 207). The machine's own
help string (`data/ace-macros.json`) lists only `HEAD ACE [SLOT]`; it is stale relative to
the code, and the code is what runs.

### 2.4 More colours than places — the preflight's answer, read

- `optimize` / `layer`: `compute_head_mode_optimize` returns `(None, None)` and
  `rewrite_pipeline` raises `RuntimeError("no feasible head-mode loadout …")`. Refused.
- `loadout`: `compute_head_mode_layout` marks the unplaceable tools
  `{'kind': 'none', 'tier': 'no_slot'}` and reports `feasible: false`; the **frontend**
  disables Print on that (`web/frontend/app.js:4526`). `rewrite_pipeline` never checks it,
  and `rewrite_head_mode_to_file` writes a `none` tool's bare `T<n>` **through unchanged**.

So the preflight's rewrite has no refusal of its own; its UI has one. Orca's must be in the
rewriter (R11). The check in `Print.cpp:1783-1790` stays inside its `#if 0`: it would refuse
every 5-filament U1 plate, ACE or not.

### 2.5 The send zip is cached with no freshness check — pre-existing

`SSWCP.cpp:348-360` names the zip `<dir of the gcode>/<display name>.zip`; `:418-435` reuses
it if it exists, comparing nothing; `:366-376` reads it back whole. Nothing deletes it. With
the temp path fixed per plate (§2.1) and the display name carrying only the estimated
time, **a resend of the same plate after a re-slice that did not change the estimate ships
the previous zip.** A re-map (§3.7) changes nothing in the name, so it would ship the first
plan every time. The SHA-256 (`:396-416`, `:709`) is over the gcode and the payload is the
zip, so the printer cannot notice either. Step 3 of §5 fixes it.

### 2.6 The flush matrix on a U1, precisely

`GCode.cpp:8537-8560`: the toolchange template's `flush_length` is
`matrix[prev][next] × flush_multiplier ÷ filament_area` — mm of filament for the pair. That
is the number route B stamped (`LENGTH=47.271` in the reference file) and R7 stamps.
`Print.cpp:3151-3161`: the **wipe tower** replaced every non-zero entry with `prime_volume`
because `purge_in_prime_tower = 0` and `single_extruder_multi_material = 0` on
`fdm_U1.json`, so the matrix is what the slicer *estimates* for the pair and not what its
tower purged. Say that in the cost line; claim no more.

### 2.7 The rest

- **A refusal at the hook blocks the send.** An exception thrown after `export_gcode`
  reaches `on_process_completed` as an error event and `Plater.cpp:15736` marks the plate's
  slice result invalid. No sibling is written; a send from an invalid plate re-slices, and
  the hook throws again.
- **Progress and cancellation are free** on the background thread: `m_print->set_status()`
  between 80 (`Print.cpp:2719`) and 95 (`BackgroundSlicingProcess.cpp:790`), and
  `throw_if_canceled()`.
- **The topology is in the print config** — `PrintConfig.hpp:1249-1251` (`ace_mode`,
  `ace_head_capacity`, `ace_head_unit`) — so the hook reads it from `m_fff_print->config()`
  with no reach into the GUI. `AceMmuTopology.hpp` and `AceMmuProvider::fetch_once()`
  (native HTTP, so the CORS hole does not apply) are the live-contents path for a later cut.
- **The toolchange marker has no space** — `; Change Tool1 -> Tool4 (layer 0)`. The initial
  selection is a marker too, at layer -1, and the stock start gcode selects
  `T{initial_extruder}` twice before it (R2).
- **The two planner defects** (`docs/ace-mmu/15-printer-panel.md`, "Two defects"): a shared
  unit double-counts capacity; Combined mode's slot→(unit, slot) map does not exist. v1
  refuses a shared unit (R11) and gates Combined (R9).
- **`SM_PRINT_PREEXTRUDE_FILAMENT … FORCE=1`**, which the preflight writes, is a
  stock-firmware argument nobody here has verified; the hardware-verified reference file used
  the plain form. v1 follows the reference (R4).
- **Licence:** multiACE's `LICENSE` is GPL-3.0; `LICENSE.txt` here is AGPL-3.0. AGPLv3 §13
  permits the combination. The ported logic carries a header naming the source file and tag.

---

## 3. The design

### 3.1 When, and on what

At `BackgroundSlicingProcess.cpp:242`, on the background thread, once per export, **only**
when the printer preset has an ACE-fed head (`ace_head_capacity[h] > 1` for some `h`, and
`ace_mode != normal`) on a U1 plate. Every other plate takes the path it takes today, byte
for byte — that is 06 §3.7, and the suites hold it.

### 3.2 A sibling, not an in-place rewrite

The handover's three traps are all consequences of rewriting the file the preview is
mapping. The rewrite writes `<tmp>.ace.gcode` beside the plate's temp file and leaves the
temp file alone. The four consumers in §2.1 ask `PartPlate::get_print_gcode_path()`, which
answers the sibling when the plate has one and the temp file otherwise.

1. **The preview keeps the logical file.** No `lines_ends` rebuild, no `gcode_id` shift, no
   window drift; the processor already read the right file (§2.2).
2. **Re-mapping is a re-run, not a re-export.** The pristine logical file is always there.
   In place, a second rewrite would need the pristine copy *and* the pristine line ids,
   composed through the first shift.
3. **Drift is measurable.** multiACE's own rewriter can be run over the same logical file
   with the same assignment and the two outputs diffed (§4.3). That is the answer to the
   handover's "a second implementation drifts".
4. **Route A stays open for free:** the unmodified file is what the printer's preflight would
   take.
5. **The failure mode is safe.** The sibling is deleted before every export and written after;
   if the hook throws there is no sibling and the plate is invalid (§2.7).

Cost: four one-line consumer changes plus the accessor, against one gate change. The sliced
3MF then embeds the sibling, which is the file a printer should get from a 3MF too.

### 3.3 The rewriter's rules

Ported from `v0.99.8b` `rewrite_head_mode_to_file` + `inject_auto_load_to_file`, with the
reference file (`~/proj/models/Test_Cube_PLA_4h15m_multiACE.gcode`, printed for 4 h 15 m) as
the tie-breaker where the two disagree.

**Input:** the logical gcode; the topology; per-filament colour, type, diameter, density;
the flush matrix and multiplier; an optional assignment override. **Output:** the sibling
and a `RewriteResult` — the plan, swaps, `optimal`, purge in mm and g, per-head runs in
first-use order.

- **R1 Sequence.** Read from the file: `; Change Tool<a> -> Tool<b>` markers
  (`^;\s*Change Tool\s*(\d+)\s*->\s*Tool\s*(\d+)`) and the bare `T<n>` that follows each.
  The first marker (layer -1) names the initial tool and opens the body. The planner takes
  the body sequence. Reading the file rather than `ToolOrdering` keeps the rewriter
  standalone, testable on a fixture, and identical to what the preflight sees.
- **R2 `T<n>` lines.** In the body every `T<n>` is logical: `T<head>`; then, for an
  ACE-fed tool whose bay differs from what the head holds in the simulation:
  `; multiACE: head h must present ACE u slot s`, the purge stamp (R7),
  `ACE_SWAP_HEAD HEAD=h ACE=u SLOT=s`. If the head already holds it, nothing is added.
  **Before the body only the initial tool is logical.** The stock start gcode selects
  `T{initial_extruder}` twice and shuts the physical heads down as `M104 S0 T<n> A0`; the
  two use the same digits. So pre-body, a `T<n>` with `n` equal to the initial tool maps to
  its head, and any other `T<n>` below the head count is left alone. Route B mapped none of
  them, and its reference file selected, preheated and primed head 1 while the initial
  filament sat on head 3 (`Test_Cube_PLA_4h15m_multiACE.gcode:582-623`); multiACE maps all
  of them and redirects the shutdowns. Neither is right, and this is the narrow rule that is.
- **R3 `M104` / `M109 … T<n>`.** In the body, `T<n>` → `T<head>`. Pre-body the initial tool's
  lines are recognisable by the template's own spelling: it writes the logical tool as
  `M104 T{initial_extruder} S…` (T before S) and the physical heads as `M104 S0 T<n> A0`
  (S before T). A pre-body temperature line is mapped only when its `T` precedes its `S`
  or there is no `S`. Then the standby replay (§2.3): a temperature line that leaves the
  printing head under 170 °C before it extrudes again becomes
  `; multiACE dropped: <line>  ; would cool the printing head below 170 C`. A file with no
  collision comes out with none dropped.
- **R4 `SM_PRINT_PREEXTRUDE_FILAMENT INDEX=<n>`.** A feeder tool: `INDEX=<head>`. An ACE
  tool: dropped, except the head's first body use, which keeps `INDEX=<head>` — the reference
  file's behaviour (its template: `if ace_is_ace then if ace_first_use then …`). The
  preflight's `FORCE=1` form is unverified here (§2.7).
- **R5 The preload block.** Inserted before the structural boundary that precedes the first
  extruding move — in the stock start gcode that is the `;===== 画起始线 =====` line, and the
  reference file has it exactly there (lines 665-669). Fallbacks, in order: the first
  `; Change Tool`, the first `SM_PRINT_PREEXTRUDE_FILAMENT`. Contents: `; multiACE plan: …`
  (R8), `; multiACE processed: format=4`, `; multiACE auto-load: load initial filaments`,
  `ACE_SET_PURGE RESET=1`, one `ACE_SWAP_HEAD HEAD=h ACE=u SLOT=s INITIAL=1` per ACE-fed
  head the plate uses with that head's first-used slot, `; multiACE auto-load: end`.
- **R6 Dedupe state** starts from the preload block: the first body use of a preloaded head
  emits no swap. (The preflight emits it and relies on the plugin's already-loaded skip; the
  reference file does not. Both are safe on the machine; fewer lines wins.)
- **R7 Purge stamp.** `ACE_SET_PURGE LENGTH=<mm>` with
  `mm = matrix[prev_tool][next_tool] × flush_multiplier ÷ filament_area` (§2.6), `prev_tool`
  being the tool the *head* last held, not the previous tool in the print. No stamp when the
  pair has no matrix value. The result records Σ mm and grams (× area × density). The
  preflight's `clamp(40, 150, 0.45 × …)` policy is computed into the result beside it, not
  stamped, until the prime-tower question is settled (§6).
- **R8 Header.** `; multiACE plan: T<i>:H<h>S<s> … swaps:N optimal:0|1` — the exact line
  `u1_bridge.py:289-346` parses, so the bridge needs no change. `AceMmuPlanHeader.hpp`
  writes it and parses it back; the round trip is a unit test.
- **R9 Combined (`multi`) mode.** The plugin's encoding is `T = unit × 4 + head`,
  `SLOT = head`: bay *i* of every unit feeds head *i*, so a head's places are the units. In
  the plan a head's capacity is the unit count and slot *s* means unit *s*; the emitted
  line is `ACE_SWAP_HEAD HEAD=h ACE=s SLOT=h`. That is the slot→(unit, slot) map the second
  planner defect asks for, and it is one table. **Gated off in v1** with a message: the page
  has never observed the mode either (`STATUS.md`, "What is open").
- **R10 Nothing to do.** `normal` mode, or every used tool already on its own stock feeder:
  no sibling, no header, nothing changes. The second case is decided before the optimiser
  runs - the identity is priced with `evaluate_assignment` and kept when it is feasible - so
  a tie-break can never move an ordinary plate's filament to another feeder.
- **R11 Refusal.** Used tools exceed places, or two heads share a unit (until the pool
  constraint lands): throw a `SlicingError` in route B's wording — *"this plate uses 7
  filaments, but this printer has 5 places for them — 3 stock feeder(s) and 2 ACE
  slot(s)…"* — naming the least-used filaments as cheapest to drop. Hard, no override: a
  missing place is not a judgement call.

### 3.4 What the page gets

`sw_GetFileFilamentMapping` (`SSWCP.cpp:3039`) gains `ace_plan` in the shape
`session.js:335-360` already normalises:
`{mode, swaps, purge_g, heads: [{head, feeder, unit, run: [{filament, unit, slot}]}]}`, `run`
in first-use order. Source: the plate's `RewriteResult`; for a re-opened sliced 3MF, parsed
from the header of the active file (R8). Everything the page does with it is built and green
(`drive/print-dialog-ace.js`).

The identity map goes out from `grouping-commands.js` as it does now; the C++ belt and
braces is `AceMmu::non_identity_tool_map()` over the batch in `sw_SendGCodes`, refusing a
batch that moves a tool off its head while the current plate has a plan (06 §3.4).

### 3.5 The plan

v1 plans with `plan_loading()` over the file's sequence and the preset topology:
swap-minimal, deterministic, `optimal` flagged. `evaluate_assignment()` prices an override
for the re-map. Pins and "what is loaded" are later cuts; their inputs exist
(`AceMmuProvider::fetch_once()`, `reconcile()`).

### 3.6 Cost before Send

The result's swaps and purge go into the post-slice notification (route B's *"N ACE swaps"*
line at `ImportantNotificationLevel`) and into the popup's grouping panel through
`ace_plan`. Nothing in the gcode header beyond R8.

### 3.7 Re-map — a later cut, designed now

A host command taking a filament → (head, slot) override: `evaluate_assignment` → rewrite
from the logical file → new sibling → new `ace_plan` → the page re-reads. It depends on §2.5
being fixed first, or it ships the old zip.

---

## 4. What is on the branch now

### 4.1 Lifted unchanged from `origin/feat/ace-mmu-slicing`

| file | lines | what |
|---|---|---|
| `src/libslic3r/AceMmuPlan.hpp` | 535 | the branch-and-bound planner; STL includes only |
| `src/libslic3r/AceMmuReconcile.hpp` | 217 | the three-valued verdict; needs `AceMmuState.hpp`, already here and byte-identical on both branches |
| `src/libslic3r/AceMmuToolMap.hpp` | 133 | the identity guard |
| `tests/libslic3r/test_ace_mmu_{plan,reconcile,tool_map,state}.cpp` | 444 + 373 + 105 + 169 | registered in `tests/libslic3r/CMakeLists.txt` |
| `tests/data/ace_mmu/` | | the live-state fixture the state test reads |

Neither `src/libslic3r/CMakeLists.txt` nor anything under `src/slic3r` changed: the headers
are included where used.

**Built and run on this branch** (`cmake --build build --config Release --target
libslic3r_tests`, 2026-09-03):

```
libslic3r_tests "[ace_mmu]"        All tests passed (191 assertions in 30 test cases)
libslic3r_tests "[ace_mmu_plan]"   All tests passed (140 assertions in 20 test cases)
```

`[ace_mmu]` is the tag the state, reconcile, tool-map and topology suites share; the planner
has its own. Four assertions elsewhere in the binary fail before and after the lift
(`test_3mf.cpp:128`, `test_config.cpp:22/29/68` — unknown legacy option names and a
segfault in the config test); they are not this branch's and not touched.

### 4.2 The rewriter - step 1 of §5, done 2026-09-03

| file | lines | what |
|---|---|---|
| `src/libslic3r/AceMmuRewrite.hpp` | 137 | the contract: `RewriteInput` (mode, per-head unit and capacity, per-filament colour/type/diameter/density, the flush matrix and multiplier, an optional head override), `ToolSequence`, `RewriteResult`, `RewriteRefusal` |
| `src/libslic3r/AceMmuRewrite.cpp` | 793 | pass A `scan_tool_sequence`, `plan_heads`, `plan_for`, `needs_rewrite`, pass B (the standby replay), pass C (emission), `rewrite_gcode` over streams and `rewrite_file` over paths, the header writer and parser, the two purge formulas, `format_length` |
| `tests/libslic3r/test_ace_mmu_rewrite.cpp` | 478 | 12 cases, 235 assertions, `[ace_mmu_rewrite]`; green with the other ACE suites unchanged (`[ace_mmu]` 30/191, `[ace_mmu_plan]` 20/140) |

It is pure: STL, `AceMmuPlan.hpp`, and `boost::nowide` for the file streams. No `Print`,
no config, no GUI. What the hook (step 2) has to do is fill a `RewriteInput` from
`m_fff_print->config()` and the filament presets, call `rewrite_file(tmp, sibling, input,
tick)` with a `tick` that calls `throw_if_canceled()`, turn a `RewriteRefusal` into a
`SlicingError`, and keep the `RewriteResult` on the plate for `ace_plan`.

**What the tests pin down.** The synthetic input is built in the stock template's shape -
the start gcode with its two selections of the initial tool, the four physical shutdowns
and the prime line; the layer -1 marker; then one `change_filament_gcode` block per tool
change with OozePrevention's cooldown before it and the writer's temperature line after.
A two-filament plate forced onto the ACE head is checked **line by line** (the exact
block, the exact swap triplet, which pre-body lines move and which stay, the purge
lengths to the third decimal). The seven-filament plate checks the invariants: no tool
above `T3` survives, emitted swaps equal the planner's count, every swap carries its
stamp, the busy pair never lands on the ACE, the header round-trips. The standby replay
is checked on the print-by-object shape that makes it necessary, with the harmless
cooldowns on either side of it kept. Refusals: more filaments than places (with the
counts and the cheapest filament to drop named), a tool the project has no filament for,
Combined mode, a shared unit, an ACE-fed head with no unit. `rewrite_file` creates the
sibling only when there is something to write, leaves the input byte-identical, gives
the same bytes as the stream version, and leaves nothing behind on a refusal.

**Deliberate differences from `v0.99.8b`**, which the drift check (§4.3) normalises:

| | multiACE | here | why |
|---|---|---|---|
| pre-body `T` and `M104`/`M109` | every one mapped through the plan | only the initial tool's (R2, R3) | the stock start gcode's physical shutdowns must stay physical |
| a body `T` whose bay is already presented | `; ACE_SWAP_HEAD … ; skipped (already loaded)` | nothing added | a comment per skipped swap is noise on the machine's console |
| the preload's first body use | a real `ACE_SWAP_HEAD`, relying on the plugin's already-loaded skip | no swap (R6) | the reference file; fewer lines |
| purge stamp | `clamp(40, 150, 0.45 × …)`, integer mm | the slicer's own pair length, three decimals (R7) | the reference file; the other policy is recorded in the result |
| pre-extrude on an ACE head | dropped, then `FORCE=1` at first use | dropped, the template's own line kept at first use (R4) | `FORCE=1` is unverified on this firmware |
| the `; multiACE: head h must present …` comment and the plan header | not written | written | the bridge and the page read the header; the comment is route B's and reads well in a trace |
| `ANTI_OOZE=` on swaps, `ACE_BG_SWAP`, `ACE_PICKUP_CLEAN` | written when enabled | not written | out of scope (§1) |

### 4.3 The hook, the sibling, the zip and the page contract - steps 2 to 4 of §5

| where | what changed |
|---|---|
| `BackgroundSlicingProcess.cpp`, `process_fff` | `clear_ace_rewrite()` right before `export_gcode`, then `rewrite_for_ace()` on the non-BBL branch of the hook. The method fills a `RewriteInput` from `m_fff_print->config()` alone - `printer_model` for the U1 gate, `ace_mode`, `ace_head_unit`, `ace_head_capacity`, the four per-filament vectors, `flush_volumes_matrix`, `flush_multiplier` - and calls `rewrite_file(tmp, sibling, input, tick)` with `throw_if_canceled()` as the tick. A `RewriteRefusal` becomes a `SlicingError`; a cancel or an I/O failure removes the half-written sibling and rethrows. Status 90, between the export's 80 and the post-process's 95. |
| `PartPlate` | `m_ace_rewrite` (the `RewriteResult`), `ace_gcode_path()` = `<tmp>.ace.gcode`, `get_print_gcode_path()` = the sibling when the result says `rewritten` and the file exists, else the temp gcode; `clear_ace_rewrite()` forgets the result and deletes the file. |
| the four consumers | `Plater.cpp` `send_gcode_legacy` (the U1 send), `BackgroundSlicingProcess.cpp` `finalize_gcode` (Export G-code) and `prepare_upload` (print host), `PartPlate.cpp` `store_to_3mf` (Ctrl+G) - each now asks `get_print_gcode_path()`. |
| `SSWCP.cpp`, the zip | `generate_zip_path` keys the zip to the source file's name as well as the display name, and `get_or_create_zip_json` writes a `<zip>.src` stamp (the source's size and mtime) beside it and reuses the zip only when the stamp still matches. Two plates with one display name, or one plate around a re-slice or a re-map, get their own bytes. |
| `SSWCP.cpp`, `sw_GetFileFilamentMapping` | `ace_plan` in the page's shape, from the plate's `RewriteResult`; for a re-opened sliced 3MF, whose gcode is already the rewritten file, it is read back from the file's `; multiACE plan:` header with a head's run in bay order, the way the bridge does it. |
| `SSWCP.cpp`, `sw_SendGCodes` | when the current plate has a plan, a batch carrying a `SET_PRINT_EXTRUDER_MAP` that moves a tool off its head is refused with a message, and logged. |

Nothing changed in the page: `filePlan()` was written for exactly this key, and
`grouping-commands.js` already writes the identity.

**Step 5** is one notification in `Plater::priv::on_process_completed`, on the success
branch: *"This plate needs N filament swaps on the ACE, about X g of purge."* at
`ImportantNotificationLevel`, from the plate's result; a plate that needed no rewrite says
nothing.

### 4.4 The drift check - built, and run

[`tools/ace_rewrite_diff.py`](../tools/ace_rewrite_diff.py) loads multiACE's rewriter from
`git show v0.99.8b:…` - never the working tree - reads the assignment out of the sibling's
own header and preload block, runs `rewrite_head_mode_to_file` + `inject_auto_load_to_file`
over the same logical file, and diffs the two outputs after normalising exactly the
differences the table in §4.2 calls deliberate (plus multiACE's `ACE_BG_SWAP` look-ahead,
out of scope here). Anything left is drift, and the exit code says so.

```bash
ACE_REWRITE_KEEP_DIR=/tmp/keep build/tests/libslic3r/Release/libslic3r_tests "[ace_mmu_rewrite]"
for n in two-on-ace seven standby; do
    python3 docs/u1-webui/tools/ace_rewrite_diff.py /tmp/keep/$n.logical.gcode /tmp/keep/$n.ace.gcode
done
```

Run on 2026-09-03 over the three synthetic pairs the tests keep:

| pair | multiACE lines | Orca lines | differing after normalising |
|---|---|---|---|
| two filaments forced onto the ACE head | 101 | 104 | **0** |
| seven filaments, three feeders and a four-bay head | 513 | 522 | **0** |
| the print-by-object standby collision | 103 | 104 | **0** |

So on these inputs the port and the original place every `T`, every swap, every preload,
every kept and every dropped temperature line identically; the extra lines on Orca's side
are the plan header, the per-swap comment and the purge stamps. The script is the
regression check for the real fixture (§4.5) once one exists.

### 4.5 The fixture that is still missing

There is no *logical* 7-filament U1 file on disk: the reference file is route B's output.
`snapmaker-orca --allow-newer-file --slice 0 …` over `~/proj/models/Test_Cube_U1_multiACE.3mf`
segfaults in `calc_exclude_triangles` headlessly. Slice it once in the app with the stock
`Snapmaker U1 (0.4 nozzle)` preset and keep the temp file as
`tests/data/ace_mmu/cube7_logical.gcode` — trimmed to the first two layers for the unit test,
whole for the drift check.

---

## 5. Order of work

Each step ends green on every existing suite plus its own.

1. **`AceMmuRewrite`** (pure, `libslic3r`) — **done, §4.2.** R1-R11 over a file,
   `RewriteResult`, the header writer and parser in the same module. The tests are the
   synthetic file in the stock template's shape and the checks listed there. Swaps and the
   header match the planner on the same sequence; the preload sits before `画起始线`; a
   plan-less input is not touched; an over-capacity input throws; the one dangerous standby
   is dropped and no other is.
2. **The hook and the sibling** — **built, §4.3; compiles; not yet observed in the app.**
   The gate at `:242`, `get_print_gcode_path()`, the four consumers, delete-before /
   write-after. *Done when:* an ordinary plate's temp file and every export are
   byte-identical to before; an ACE plate's send, export and Ctrl+G all carry the sibling;
   a thrown refusal leaves the plate invalid with no sibling. What to look at in the app:
   slice `~/proj/models/Test_Cube_U1_multiACE.3mf` with the stock U1 preset's head 4 set to
   *ACE - 4 slots* / *ACE 1*, then `ls <project backup>/Metadata/` for `.<pid>.<n>.gcode` and
   its `.ace.gcode` sibling, the log line `rewrite_for_ace: … swaps`, and the notification;
   Export G-code and `grep -c ACE_SWAP_HEAD`; set head 4 back to *Stock feeder*, re-slice,
   and the sibling is gone.
3. **The zip** — **built, §4.3; compiles.** Keyed to the source and stamped with its size
   and mtime. *Done when:* two sends of the same plate around a re-slice upload different
   bytes — the harness can show it: `sw_GetFileStream` twice, compare `checksum`.
4. **`ace_plan` and the guard** — **built, §4.3; compiles.** *Done when:*
   `print-dialog-ace.js` passes against Orca's reply and not only the bridge's; a
   non-identity batch on an ACE plate is refused and logged.
5. **The cost notification** — **built, §4.3; compiles.**
6. **Hardware**, on `u1-hardware-test`'s ladder: read-only first (the popup over the
   sibling, verdicts against the real bays), then one send-and-cancel, then a short ACE
   print — the first time the ACE half of a send is observed at all.
7. **The drift check and the fixture** (§4.4, §4.5), alongside step 1 and kept as a script.

Later cuts, by value: re-map (§3.7); the per-unit pool constraint, which lifts the
shared-unit refusal; Combined mode (R9); pins and "what is loaded".

---

## 6. Still open

0. **Which plan to emit, when several cost the same.** The first real ACE plate through this
   pipeline was rearranged across all four toolheads for no gain, and then refused at Send
   because the bay it named held another colour. Both choices — which filament rides the ACE,
   and which bay presents it — are taken without reading the machine, and preferring Orca's own
   assignment fixes the first and not the second. The measurement and the options are
   [10-plan-choice.md](10-plan-choice.md). **Decide this before building anything else here.**

1. **`FORCE=1`** on the pre-extrude macro: what the stock firmware does with it.
   `printer.gcode.help` does not show arguments; read the macro on the machine or send one
   line.
2. **Purge policy:** the slicer's pair length (R7) against the preflight's clamped 45 % for a
   tower-less print. Turns on whether ACE plates keep the prime tower.
3. **`multi` and `normal` modes** are unobserved on the page and gated here.
4. **A re-opened sliced 3MF** previews by physical head (§2.2). A processor tag would fix
   it; not in v1.
5. **No print has run past its first seconds** with the ACE half engaged. Step 6 is the
   first.
6. **Colour is not compared** in the popup's match rule, by design (08 §7.3). Unchanged.
