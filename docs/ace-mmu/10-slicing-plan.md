# 10 · Multi-colour slicing with the U1 + multiACE — design

> Branch: `feat/ace-mmu-slicing`. Goal: make OrcaSlicer slice multi-colour prints
> for the Snapmaker U1 driven by multiACE, and choose the **best spool loading** so
> physical filament swaps are minimised. This document designs the approach, draws on
> how other slicers do it, and defines what to build (and in what order).

## 1. The machine model (a multi-tool machine, some tools MMU-fed)

The U1 is a **multi-tool machine where each tool may be MMU-fed**. The truly
comparable machine — same problem, already handled by an existing slicer — is the
**Bambu H2D**:

- **Bambu H2D** (Bambu Studio / OrcaSlicer): one toolhead with **two nozzles**, and
  **each nozzle can be fed by its own AMS — even several AMS combined per nozzle**.
  So each nozzle is a "tool", and each tool is MMU-fed with N slots; changes between
  the two nozzles are cheap, swaps *within* a nozzle's AMS are costly. **This is the
  direct precedent** for our optimiser — the U1 is the same idea generalised from 2
  MMU-fed tools to up to 4 heads.

(The Prusa XL, by contrast, is a *pure* toolchanger — one fixed spool per head, no MMU
— so PrusaSlicer never has to solve the overflow/grouping problem we do. It only
confirms the free-tool-change half of the model and the toolchanger gcode contract.)

The U1 combines both: **4 physical toolheads** (`fdm_U1` inherits `fdm_toolchanger`,
`single_extruder_multi_material = 0`, up to 5 extruders) where each head is either a
stock feeder or ACE-fed:

- A change between two colours on **different heads** is a **tool change** — fast, no
  purge beyond a wipe, no filament wasted on the swap itself.
- A change between two colours on **the same ACE head** is an **ACE swap** — retract
  ~1.4 m of filament, load the next slot, purge (length set via `ACE_SET_PURGE`; the
  exact firmware config key is still to be confirmed from the multiACE config). Slow,
  wasteful.

multiACE has three run modes (`SET_ACE_MODE`, live via the Config tab):
- **normal** — every head uses its stock side feeder (1 spool/head). Pure
  toolchanger, ≤4 colours, **zero swaps**.
- **head** — exactly one head is ACE-driven (its slots feed that one head, e.g. via a
  4→1 combiner); the others are stock feeders. Live example: `head_feeder =
  {0:T,1:T,2:T,3:F}`, `ace_head=3` → heads 0–2 (T0–T2) are 1-spool feeders, **head 3
  (T3)** carries up to 4 ACE spools. Capacity = 3 + 4 = **7 colours**; swaps happen
  only on head 3.
- **multi** — several ACE units feed several heads. Capacity = Σ(ACE slots) + the
  remaining stock-feeder heads (e.g. 2 feeders + 2×4 slots = 10); swaps on each ACE
  head independently.

**The unifying abstraction (covers every case above, incl. multi-ACE).** Model the
machine as a list of **heads**, each with a `capacity` and an `ace` flag:
- stock feeder → `capacity = 1`, `ace = false` (a change to another head is free);
- ACE head → `capacity = <slots>`, `ace = true` (swaps within it are costly).

This one abstraction handles **any** multiACE configuration without special cases:
- multiple ACE units feeding multiple heads → multiple `ace` heads in the list;
- **combining >1 ACE unit into a single head (as the H2D combines AMS per nozzle)** →
  that head's `capacity` is simply the **sum** of the combined units' slots;
- a Prusa-XL-style pure toolchanger → all heads `capacity = 1`.

**Consequence:** the U1's optimal-loading problem is richer than a single-nozzle MMU.
On a plain AMS (1 nozzle, N slots) *every* colour change is a swap. Here, up to
(number of heads) colours change **for free**; only the overflow needs an ACE head,
and those swaps should be minimised — exactly the H2D "filament grouping" problem,
generalised to N heads.

## 2. Where the ACE logic lives — in Snapmaker Orca (decided)

**Decision: Snapmaker Orca slices multiACE prints natively.** The ACE macros are
emitted *inline during Orca's own gcode generation* — this is NOT "slice normally,
then run a preflight to stamp macros afterward". Orca already knows the loading plan
(Problem B) and the whole colour-change sequence at export time, so it is the right
and only place that has the full picture; a second post-processing pass on the printer
would just re-derive what Orca already computed, and can get it wrong.

Concretely, Orca's tool-change machinery becomes ACE-aware. The emitter tracks which
colour each head **currently has loaded** (exactly like `simulate_swaps` in
`AceMmuPlan.hpp`). For each filament change in the sliced sequence:
- target head already holds the needed colour → a **free tool change**: emit the
  normal `T<head>`, cheap wipe;
- target head holds a **different** colour → an **ACE swap**: emit `T<head>` plus the
  ACE macros to swap that head's spool, with the right purge. Note this can happen
  even when the *previous* extrusion came from another head (print X on head A, a
  feeder colour, then Y on head A → returning to A still requires the A-swap) — the
  decision depends on the target head's loaded state, never on sequence adjacency.

The multiACE Klipper macros Orca emits (as observed live in the U1's
`/printer/gcode/help` — re-verify against the firmware before shipping, since the
multiACE macro surface is still evolving):
- `ACE_PRELOAD` / `ACE_SEQ` — preload every head at the start from the computed plan.
- `ACE_LOAD_HEAD HEAD=n [ACE=] [SLOT=]` / `ACE_UNLOAD_HEAD` — load/unload a head.
- `ACE_SWAP_HEAD HEAD=n ACE=n [SLOT=n]` — mid-print swap of an ACE head's spool.
- `ACE_SET_PURGE LENGTH=<mm>` — per-colour-pair purge, straight from Orca's flush
  matrix (the field the firmware documents as "per-colour-pair purge from the slicer").
- `ACE_PICKUP_CLEAN`, `SET_ACE_MODE`, etc. as needed.

These hang off the existing gcode hooks — `change_filament_gcode` / the toolchanger
tool-change templates and machine start-gcode — parameterised by the plan (placeholder
variables for head, ace unit, slot, purge). No `docs/MULTIMMU_PLAN.md`-style external
preflight is part of *our* path.

**The firmware's own preflight stays as a fallback**, only for gcode sliced by other
tools; when the file comes from Snapmaker Orca it is already ACE-complete, so the
operator can print it directly.

**Upload path.** The U1 runs Moonraker; files upload via `POST /server/files/upload`
(405 to GET → exists) — the same endpoint the existing U1 send flow uses. Orca uploads
its already-ACE-complete gcode there and it prints as-is.

## 3. Problem A — colour slicing (mostly reuse)

OrcaSlicer (a Bambu Studio fork) already slices multi-filament prints: assign a
filament/colour per object or by painting, and the engine emits tool changes, a wipe
tower / flush, ooze prevention, and per-pair flush volumes. For the U1 this is the
**toolchanger path**, which already works for ≤ (number of heads) colours.

What's U1/ACE-specific and needs work:
- **Filament list ↔ physical head/slot.** Today the flat filament index == tool
  index `T<i>`. We must map each project filament to a real (head, slot) — the output
  of Problem B — and make the exported tool index equal the head that carries it.
- **Wipe/flush tuning.** Tool-change wipe (head→head) is cheap; ACE swaps need the
  ACE purge (`ACE_SET_PURGE`). The flush matrix should reflect "0-ish for cross-head,
  real purge for same-ACE-head".
- **> capacity colours.** If colours exceed total capacity, warn (like other slicers
  cap AMS colours), or require a mode change.

## 4. Problem B — optimal spool loading (the interesting part)

**Goal:** assign the project's colours to (head, slot) positions to minimise the
number of **ACE swaps** during the print (tool changes between heads are free).

**Inputs**
- Hardware from the live `AceSnapshot` / config: per head, is it a 1-spool *feeder*
  or an *ACE* head (capacity = ACE slots), and which ACE unit feeds it.
- The **colour-change sequence** of the sliced print: the ordered list of tool/colour
  uses (from the gcode tool changes, or per-layer colour sets). The optimiser works on
  this sequence directly; a **transition graph** `w(a,b)` (how often the print
  switches directly between colours a and b) is kept only as a diagnostic for UIs
  that want a conflict heatmap — it is *not* the objective (see below).

**Objective (exact).** Partition the colours into groups (one per head): feeder-head
groups have size 1 (no swaps); an ACE head's group ≤ its slot count. **The number of
swaps a head performs is the number of runs in the whole print sequence restricted to
that head's colours, minus one** (the first load is free). Total swaps = Σ over ACE
heads. **Minimise** it ⇒ put colours that alternate a lot on **different** heads;
colours used in disjoint phases — and especially **rarely-used colours** — can share
an ACE head cheaply.

> **Important — swaps aren't pairwise.** A tempting shortcut is to score each pair of
> colours by how often they are *directly adjacent* and minimise the intra-group sum.
> That is **wrong**: if the ACE head holds X and Y and the print goes `X → (a feeder
> colour) → Y`, that is still a real X→Y swap on the ACE head, even though X and Y were
> never adjacent. The cost must be evaluated by **simulating the sequence** (walk the
> collapsed colour sequence; a head swaps whenever it must present a colour different
> from the one currently loaded). See `simulate_swaps` in `AceMmuPlan.hpp`.

**Why rarely-used colours belong on the ACE head.** A colour that is printed in only a
few short stretches contributes only a few runs to its head's restricted subsequence,
so parking several such colours together on one ACE head costs only a handful of
swaps. Meanwhile a colour that alternates constantly would, on a shared head, add a
run every time it reappears — so those belong on their own feeder heads where changes
are free. Minimising the true swap count produces exactly this: busy/alternating
colours claim the free feeder heads, rare colours cluster on the ACE.

**Nature & algorithm.** This is a capacity-constrained sequence-partition problem
(NP-hard in general). N is usually small — but not always tiny: **someone can attach
4 ACE units to the U1 (one per head) for a 16-colour palette, and in theory more via
extra combiners**, where plain enumeration (millions of assignments × a full-sequence
simulation each) is hopeless. So `plan_loading` is a **branch-and-bound**:
- **Greedy seed** (busiest-first, cheapest-head-each-time) gives an immediate upper
  bound, so pruning bites from the first node — and is the guaranteed floor for the
  result quality if the search is cut short.
- **Admissible lower bounds**: a partial assignment's own swap count (adding a colour
  to a head can only add runs, never remove them), plus a pigeonhole term — every
  still-unassigned *used* colour beyond the heads that can still take a free first
  load costs ≥ 1 swap.
- **Incremental cost**: placing colour c on head h re-scans only head h's restricted
  subsequence; colours are tried busiest-first, children cheapest-delta-first, and
  interchangeable empty equal-capacity heads are symmetry-broken.
- **Work budget**: a fixed op budget (default ~64M sequence-scan steps, well under a
  second) guarantees bounded runtime; if exhausted, the best plan found so far is
  returned with `optimal = false` instead of hanging.

Behaviour: if `colours ≤ heads`, one colour per head ⇒ **0 swaps** (found
automatically); else the search parks the least-disruptive colours together on the
ACE head(s). Typical U1 jobs (≤ ~10 colours) are solved to proven optimality;
16-colour full build-outs get an optimal-or-near-optimal plan within the budget.

**Constraints — pins (hard) and Auto vs Manual.** Each filament can carry a **pin**
(`PlanPin`): to a head, to an ACE unit, or to an exact slot. Pins are *hard*: the
optimiser shrinks that filament's candidate set before searching and plans the free
filaments around it. The flagship case is **drying** — a hygroscopic spool sitting in
an ACE that is actively drying it must stay in that ACE (even its exact slot) for the
whole print, whatever the swap count would prefer; a pinned spool occupies its slot
even on plates that never print it. Pins also give us **Auto vs Manual** for free,
mapping onto Bambu's `FilamentMapMode`:
- **Auto** (`fmmAutoForFlush`-equivalent): optimise, honouring any pins.
- **Manual** (`fmmManual`): the user places everything; `evaluate_assignment` only
  validates capacities and prices the layout, so the UI can show
  "your layout: N swaps — Auto would need M".
Unused, unpinned filaments never make a plate infeasible: they park in leftover
slots, or stay unloaded (`head = -1`) when no room remains.

**Output — the load plan**
- colour → (head, slot); which spools go where (and which pins constrained it).
- Predicted **swap count** and **purge/filament waste** (swaps × purge); in Manual,
  the delta vs the Auto plan.
- An `ACE_PRELOAD`/`ACE_SEQ`-style plan string that Orca emits into the start-gcode,
  and the operator-facing "load this spool here" instructions (reuse the multiACE
  page's tray view).

## 5. Inspiration from other slicers

- **Bambu H2D — the conceptual precedent (but its optimiser is closed).** The H2D
  (2 nozzles on one toolhead, each AMS-fed, AMS-combinable) already faces our exact
  problem: "assign each filament to one of several MMU-fed tools to minimise cost".
  Bambu exposes the *result* as `filament_map` + `FilamentMapMode` (`fmmAutoForFlush`
  = auto-group to minimise flush, `fmmAutoForMatch`, `fmmManual`), and this fork keeps
  that plumbing (the enum in `PrintConfig.hpp`, write-only 3mf metadata in
  `bbs_3mf.cpp`, and GUI-side project/plate config in PartPlate, Plater,
  DeviceManager, SelectMachine, CalibrationWizard). **But the auto-grouping algorithm
  itself is not open
  — it is absent from this fork's `libslic3r`** (grep finds only the config field and
  enum). So `AceMmuPlan` is a **clean-room** optimiser, not a port: it is the U1's
  equivalent of `fmmAutoForFlush`, generalised from 2 nozzles to N heads and driven by
  swap count. **We store our result as a `filament_map`** to reuse Bambu's
  persistence/GUI plumbing — but note that in this fork *nothing in `libslic3r`
  consumes a filament map during slicing* (it is GUI project config + write-only 3mf
  metadata), so the actual consumption (re-indexed tool export, ACE-aware
  tool-change gcode) is new wiring we add in build-order step 3. Reuse the
  flush-volume matrix (`flush_volumes_matrix`, `flush_multiplier`) and the
  change-sequence extraction; the one difference is that our cross-head changes are
  ~free.
- **PrusaSlicer MMU2 / MMU3** (open source) — single-nozzle MMU: purge/wipe-tower,
  tool-change ordering, per-pair purge. The MMU half of our model, and an open
  reference for the gcode/tool-change contract. (The Prusa XL is a pure toolchanger
  with no per-head MMU, so it never solves the overflow/grouping problem we do — it
  only confirms the free-tool-change half.)
- **Anycubic Slicer Next / ACE** — the ACE hardware's own swap/purge model; the
  multiACE project (`postapocalyptic-diy.com`, `docs/MULTIMMU_PLAN.md`) is the
  authoritative source for the **macro contract** (`ACE_SWAP_HEAD`, `ACE_SET_PURGE`,
  `ACE_PRELOAD`/`ACE_SEQ` syntax) — mirror that contract in what Orca emits natively
  (§2) rather than re-inventing it. (We do *not* route through its preflight; that
  stays a fallback for gcode sliced elsewhere.)
- General MMU slicing: minimise number of changes (group same-colour regions), order
  changes to minimise flush, and place the wipe/prime tower.

## 6. Extra considerations (things easy to miss)

- **Mode awareness.** normal ⇒ ≤4 colours, no ACE. head ⇒ 3 feeders + 1 ACE head.
  multi ⇒ several ACE heads. The optimiser must read the live mode/head map; if the
  project needs more colours than the current mode allows, prompt to switch
  (`SET_ACE_MODE`) or reduce colours.
- **Material compatibility.** TPU/soft filaments may need the manual/bypass head
  (`ACE_SET_HEAD_MANUAL`); don't assign them to an ACE head.
- **Purge waste vs swap count.** Minimising swaps also minimises the big ACE purge —
  the dominant waste. Report grams/length saved.
- **Send flow.** The U1 send goes through `WebPreprintDialog` (webview) and uploads to
  Moonraker. Since the gcode is already ACE-complete, nothing extra needs to travel
  with it — it prints as-is.
- **Runout / replenish.** multiACE supports replenish; the plan should note spares.
- **Prime/wipe tower** placement for the ACE-head swaps.
- **Pre-print spool verification (the user gets time to sort the trays).** Three
  layers, from soft to hard:
  1. *Orca gate (primary UX):* the send flow shows a **readiness checklist** built by
     comparing the plan against the **live tray state** (the existing `AceMmuState`
     2-second poll): per position "Amber → A1·S2 ✓ / currently holds Forest ✗ /
     empty ✗". The user physically sorts spools and watches items flip green; Print
     is gated until green (with an explicit override, since colour identity comes
     from the user-maintained `SET_COLOR` tray metadata — the ACE senses occupancy,
     not colour).
  2. *Firmware backstop:* the start gcode's `ACE_PRELOAD` runs before any motion; a
     required slot that is empty pauses the print (Klipper `PAUSE` + message), so a
     missing spool can never start a print even when Orca was bypassed. Resume after
     fixing the tray.
  3. *Optional confirm gate:* a setting "Confirm spool layout before printing" emits
     a prompt + `PAUSE` right before `ACE_PRELOAD`; the user resumes from the U1
     screen or the device page when the trays match. Unlimited time, zero risk.
  And reduce the problem at the source: the assignment dialog defaults to **pinning
  spools that are already loaded to their current positions** ("prefer current
  layout"), so the optimal plan usually requires little or no physical sorting.
- **Pinning / Auto-Manual UI.** The plan gets its own **assignment dialog** (mockup:
  `docs/ace-mmu/load-plan-mockup.html`), reusing the multiACE page's tray design:
  heads at the bottom, ACE trays above, project filaments rendered as spools placed
  where the plan puts them. An **Auto | Manual** toggle at the top (backed by
  `filament_map_mode`). In Auto, dragging a spool onto a head/slot **pins** it there
  (pin badge appears; click to unpin) and the optimiser re-plans live around the
  pins. In Manual, every spool sits where the user drags it and the dialog prices it:
  "your layout: N swaps — Auto: M". A drying ACE shows a "drying" chip; spools
  already in it get a one-click "keep here while drying" pin suggestion. Secondary
  entry points: a small pin toggle on each filament's mapping row in the Sync
  Filament dialog, and "pin this spool" in the device page's spool edit sheet.

## 7. Build order

1. **Core optimiser (this branch, first).** A pure, unit-tested module
   `libslic3r/AceMmuPlan.hpp`: given hardware capacities + a colour-change sequence,
   return the colour→(head,slot) assignment and predicted swaps. No GUI/printer deps.
   *(done — see `tests/libslic3r/test_ace_mmu_plan.cpp`.)*
2. **Wire real inputs.** Feed it the live hardware model (from `AceSnapshot`) and the
   sliced colour-change sequence; expose the plan (swaps, waste, per-slot loading) in
   the sync dialog / the U1+multiACE page, and store it as a `filament_map`.
3. **ACE-aware export (native, no preflight).** Make the exported tool indices equal
   the assigned heads, and teach Orca's tool-change gcode to emit the ACE macros inline
   — `ACE_PRELOAD` from the plan at start; per change, either a free `T<head>` or a
   `T<head>` + `ACE_SWAP_HEAD` with `ACE_SET_PURGE` from the flush matrix. Tune the
   flush matrix (cheap cross-head, real ACE purge) so the wipe tower is right.
4. **Upload & print.** Upload the already-ACE-complete gcode via the existing U1 send
   flow (Moonraker `/server/files/upload`); it prints directly, no printer-side
   preflight. (The firmware preflight remains only for files sliced elsewhere.)
5. **Mode + material guards, waste reporting, runout spares.**

Start with (1): it's the algorithmic heart, testable without hardware, and everything
else consumes its output.

## 8. Integration points (verified recon, file:line)

Verified against the codebase (2026-08); anchors may drift with rebases.

**Colour-change sequence.** `ToolOrdering` owns it: per layer,
`LayerTools::extruders` (`GCode/ToolOrdering.hpp:119`, 0-based after
`reorder_extruders`). The flattened plan input is
`concat(lt.extruders for lt in m_tool_ordering.layer_tools())`. `m_tool_ordering`
is populated in the `psWipeTower` step (`Print.cpp:2553-2565`); the cleanest hook is
**end of that step (`Print.cpp:2564`)**: flatten → `plan_loading(...)` → store the
`LoadingPlan` on `Print` (mirror `MixedFilamentManager`, `Print.hpp:1100` — the
fork's prior art for a Print-owned filament→extruder resolver consumed by
`ToolOrdering`). Do NOT reorder `lt.extruders` from the plan — the plan decides
*where* colours live, not *when* they print;
`reorder_extruders_for_minimum_flush_volume` (`ToolOrdering.cpp:1123`) owns ordering.
Note: on the U1 path (`single_extruder_multi_material=0`, non-BBL) that optimiser
currently uses a **uniform** prime volume (`ToolOrdering.cpp:1143-1145`), not the
flush matrix — a later improvement is an ACE-aware cost there so layers avoid
intra-head alternation.

**`filament_map` is dead plumbing in this fork — register it before use.** The enum
exists (`PrintConfig.hpp:341`) but there is **no ConfigOptionDef**: grep of
`PrintConfig.cpp` finds nothing, so `Plater::set_global_filament_map`
(`Plater.cpp:22295`) would null-deref and `PartPlate::on_extruder_count_changed`
(`PartPlate.cpp:3170`) is unreachable (dispatcher commented out,
`PartPlate.cpp:5790`). The 3mf writer emits a hardcoded `"1"` per filament
(`bbs_3mf.cpp:7715-7722`, `:7893-7899`, "Orca hack") and has **no reader**. Intended
semantics: filament-indexed vector of **1-based** extruder ids (opposite of
`LoadingPlan::head_of`, which is 0-based). To adopt it: register `filament_map` +
`filament_map_mode` in `PrintConfig.cpp`, add to the project-key list
(`PresetBundle.cpp:184-194`), fix writer + add reader; per-plate authoritative,
global as seed.

**Machine capability, not printer-name checks.** Gate everything on a new printer
config option, e.g. `ace_head_capacity` (`ConfigOptionInts`, one entry per toolhead,
default all-1 = plain toolchanger ⇒ plan is a no-op identity) — maps 1:1 onto
`PlanHead{capacity, ace, ace_unit}`. The one existing U1 string check
(`WipeTower2.cpp:1233 is_snapmaker_u1()`) and the abandoned commented attempt at
`GCode.cpp:8381` show why not to add more.

**Tool-change gcode injection.** The U1's live path is `GCode::set_extruder`
(`GCode.cpp:8421`); its `dyn_config` block (`GCode.cpp:8541-8591`) feeds
`change_filament_gcode` expansion at `:8600`. Add `ace_unit`, `ace_slot`, `ace_head`,
`ace_swap` (bool: spool swap vs free toolchange), `prev_ace_unit`/`prev_ace_slot`
right after `next_wipe_y` (`:8590`), mirror into the wipe-tower path
(`WipeTowerIntegration::append_tcr`, `GCode.cpp:513-580`), and register both in
`s_CustomGcodeSpecificPlaceholders` (`PrintConfig.cpp:8759`) and
`CustomGcodeSpecificConfigDef` (`:8824`) — the exact three-edit pattern used for
`next_wipe_x/y` ("For Snapmaker Artision"). The U1 leaf profile
(`Snapmaker U1 (0.4 nozzle).json`) already carries the real `change_filament_gcode`
(`fdm_toolchanger`'s is empty); it can then guard with `{if ace_swap}`.

**Start gcode / ACE_PRELOAD.** `machine_start_gcode` expands at `GCode.cpp:2724`
with the full print config as external context (`PrintBase.hpp:387`), so per-filament
vectors are already subscriptable. Publish the plan via
`placeholder_parser().set("ace_plan_head", new ConfigOptionInts(...))` (+ slots, + a
prebaked preload line) right after the `chamber_cooling_mode` precedent at
`GCode.cpp:2721` — that path bypasses the placeholder whitelist, which only checks
`config_override`.

**Flush pricing.** `flush_volumes_matrix`/`flush_multiplier` are consumed at
`ToolOrdering.cpp:1134-1146`, `Print.cpp:3137-3162` (wipe tower build; U1 takes the
`WipeTower2` branch, `Print.cpp:3151`), `WipeTower2.cpp:2401`, and
`GCode.cpp:8509-8524` (the `flush_length*` placeholders). The flush matrix prices
tool-change purge; the ACE swap purge is separate (`ACE_SET_PURGE`) — keep them
distinct.

**Send flow.** `BackgroundSlicingProcess.cpp:229/240` is the process→export seam if
the plan should ever consult live printer state (current tray contents from
`AceMmuState`) on the GUI thread.
