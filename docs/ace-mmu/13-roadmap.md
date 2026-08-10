# multiACE slicing — front-to-back plan

Docs 01–12 each cover one area and PROGRESS.md is a running log; neither answers
"what is left". This is that document. It is written against **verified reality**:
every "done" below was checked by slicing the 7-colour cube on the real
`Snapmaker U1 (0.4 nozzle) - multiACE` preset, not by reading the code.

Status vocabulary: **done** = observed working end to end · **built** = written and
compiles, not yet observed · **gap** = not written.

---

## The shape of the feature

A U1 with an ACE-fed head is both a toolchanger and an MMU. Four heads print
directly; one of them can be fed by an ACE unit holding several spools. So a plate
with more colours than heads is printable, but every revisit to a colour that
shares the ACE costs a swap, and every swap costs purge. The feature is therefore
three things:

1. **Know the topology** — which head is fed by which ACE, and how many slots.
2. **Decide the layout** — which spool sits where, minimising swaps.
3. **Emit it** — gcode the printer can execute, with the cost recorded.

---

## Phase 1 — Topology (done)

Printer settings › Multimaterial: a **multiACE** section with a **Sync from
printer** button, then one group per toolhead with **Fed by**
(`Stock feeder` / `ACE - N slots`) and **ACE unit** (`None` / `ACE 1..4`).

- done — labelled values, no raw numbers; `None` on stock feeders
- done — sync reads `/multiace/api/state` and reports divergence rather than
  silently correcting it
- done — values persist in the preset, so slicing works with the printer off

## Phase 2 — Planner (done)

`AceMmuPlan.hpp`: branch-and-bound with greedy seed, pigeonhole bound, symmetry
breaking, work budget. Swaps are counted exactly (runs of the head-restricted
collapsed sequence − 1), not by pairwise adjacency.

- done — 207 assertions / 28 cases
- done — on the real cube: 7 colours over 3 feeders + one 4-slot ACE → 300 swaps,
  rare colours sharing the ACE (S0/S3 swap 50×, S1/S2 100×)

## Phase 3 — Slicing and gcode (done)

- done — virtual tools remapped to physical heads: `T0–T3` only, never `T4+`
- done — `ACE_SWAP_HEAD HEAD=n ACE=u SLOT=s`, `ACE=` always present
- done — `ACE_SET_PURGE` per colour pair, all 300 adjacent to their swap
- done — pre-extrude suppressed on the ACE head, emitted on the three feeders
- done — initial auto-load block before the prime line
- done — `; multiACE plan: … swaps:300 optimal:1` header

## Phase 4 — Assignment dialog (done)

Opens on export **and on print** when the plate has an ACE-fed head and more than
one filament.

- done — live topology header, spools placed per the computed plan
- done — Manual mode re-prices as you move spools (300 → 349 swaps, 40.4 → 47.0 g)
  with "Auto would need 300" alongside
- done — waste derived from what slicing actually flushed
- done — **Apply to plate reaches the gcode.** The earlier diagnosis was wrong: the
  override was never discarded by recomputation. `Plater::export_gcode_3mf` (Ctrl+G,
  the toolbar, "Export plate sliced file") *packages the gcode the last slice wrote*
  and never regenerates it, so the applied layout could not appear no matter what the
  `Print` held. The plain "Export G-code" path always worked, because it re-runs the
  export through the background process. Both export paths and the print path now
  rewrite the gcode before using it — see "The rewrite-then-resume rule" below.

## Phase 5 — Cost visibility (done)

- done — cost in the gcode header
- done — cost in the dialog
- done — post-slice notification naming the swap count with a *Review assignment*
  link. It **does** fire; a 2 s screenshot loop caught it in a single frame, which is
  what "never observed" had been. Raised from `RegularNotificationLevel` (10 s) to
  `ImportantNotificationLevel` (20 s) and confirmed on screen for ~14 s.

## The rewrite-then-resume rule

An applied assignment changes **only the gcode** — no geometry, no tool ordering. Every
route to a file or a printer therefore has to answer one question: does it *generate*
gcode, or does it *reuse* what the last slice left in the plate's temp file?

| Route | Reuses temp gcode? | How the override gets in |
|-------|--------------------|--------------------------|
| File › Export › Export G-code | no, re-exports | already worked |
| Ctrl+G / Export plate sliced file | yes | rewrite, then resume |
| Print (Snapmaker U1 upload) | yes | rewrite, then resume |

"Rewrite, then resume" is `Plater::priv::ace_after_reslice`: a one-shot continuation set
before `restart_background_process(FORCE_RESTART)` and run from `on_process_completed`.
`set_ace_plan_override` invalidates `psGCodeExport` only, so the restart re-writes the
gcode without re-slicing geometry, and `m_ace_plan_user` keeps the layout across it. The
continuation is taken unconditionally on completion and run only on success, so a
cancelled or failed rewrite cannot leave it armed for an unrelated slice.

**Any future route that uploads or packages `get_tmp_gcode_path()` needs the same
treatment.** Multi-plate export (G) is the one known to still be missing it.

---

## What is still missing

### A. The print path (done)

The dialog now runs in `Plater::send_gcode_legacy`'s Snapmaker U1 branch, before the
upload dialog, and an applied layout rewrites the temp gcode before it is sent.
Verified: the file staged for upload carried `swaps:349 optimal:0` and 350
`ACE_SWAP_HEAD` after applying a manual layout.

### B. Reconciling with what is actually in the ACE (comparison done, UI pending)

Orca decides "slot 2 holds the red". Nothing checks the machine agrees. A plan
that contradicts the loaded spools prints the wrong colours with no warning.

- done — `AceMmuReconcile.hpp`: `reconcile()` judges every ACE slot against the
  plan, and `spool_matches()` on **colour + material** (brand ignored: colour alone
  passes PLA where PETG is loaded, brand flags Kingroon-vs-Generic differences
  nobody cares about). 8 cases in `tests/libslic3r/test_ace_mmu_reconcile.cpp`.
- The verdict is **three-valued**, not two. `AceSlot::identity_trusted()` already
  separates a spool read from RFID (or named by hand) from one merely inferred, so
  the answers are *agrees* / *differs* / *cannot tell*. Calling an inferred spool
  "wrong" is a false accusation, and a check that cries wolf gets ignored — which
  costs more than no check. An empty slot is always a mismatch: the machine is not
  guessing about emptiness.
- `checked = false` when there is no snapshot. The ACE is LAN-only, so this is the
  ordinary case over a cloud connection, and a green tick meaning "could not check"
  would be worse than nothing.
- **gap** — the UI. Mockup at
  [reconciliation-mockup.html](reconciliation-mockup.html); five decisions open:
  where it lives, blocking vs advisory, what counts as a match, how unverified slots
  are treated, and whether "Use what is loaded" should re-plan around reality.
- Scope limit worth stating on screen: the ACE reports its own slots and nothing
  else, so a wrong colour on a stock feeder stays undetected.

### C. Infeasible plates (gap)

More colours than total capacity has no layout. The planner returns infeasible
and slicing proceeds as a plain toolchanger — silently wrong for the user's
intent. *Mockup needed: the refusal, saying how many slots short and what to drop.*

### D. Persistence (done)

A hand layout is stored on its plate as `ace_plan_layout` (one toolhead index per
filament) and rides in the 3MF as plate metadata. `Print::process` re-prices it
against the plate's *current* sequence rather than trusting a saved swap count, and
marks it `optimal` only when it agrees with what the planner chose.

Only a **hand** layout is remembered. Applying in Auto means "yes, use the computed
plan", so it clears any stored layout rather than freezing today's answer onto a
plate whose colours may change.

The dialog states what the plate is carrying — see
[assignment-persistence-mockup.html](assignment-persistence-mockup.html) for the
three states and why each is shaped the way it is:

- restored → opens in **Manual**, banner *Saved with this plate* naming the extra
  cost, and *Use auto instead* to hand the plate back
- a remembered layout arrives as `manual`, **never as pins**, so the page's own
  optimiser stays free and "Auto would need N" is a real comparison
- saved for a different filament count → dropped, and the banner says so

Verified end to end: apply by hand → save → reopen in a **new process** → slices
straight to `swaps:349 optimal:0`; *Use auto instead* → 300; applying in Auto clears
the key from the saved 3MF; 7-filament layout on a 6-filament plate → dropped, and
the plate plans fresh at `swaps:200 optimal:1`.

**Known wart (pre-existing, not introduced here):** the waste figure is
swaps × (what this slice actually flushed ÷ this slice's swaps), so the same layout
is quoted ~47.0 g when priced from an auto slice and ~40.4 g when priced from its
own. The swap counts are exact; only the gram estimate drifts.

### E. Pinning and drying (partial)

The page supports pinning a spool to a position and the planner honours pins, but
nothing persists them and drying is not modelled at all.
*Mockup needed: a pinned/drying spool and what the planner does around it.*

### F. More than one ACE (built, untested)

Planner and config handle up to 4 units; only a single-unit machine has been
tested. *Mockup needed: the assignment board with two units.*

### G. Multi-plate export (gap)

"Export all sliced files" never calls the review. Either run it per plate or state
that only the current plate is reviewed.

---

## Order of work

1. ~~**Verify the override fix**~~ — done 2026-08-09; the cause was the packaging
   path, not recomputation. See Phase 4.
2. ~~**Notification**~~ — done 2026-08-09; it fires, and now lasts 20 s.
3. ~~**Print path** (A)~~ — done 2026-08-09.
4. ~~**Persistence** (D)~~ — done 2026-08-09.
5. **Reconciliation** (B) — the highest-consequence correctness gap, and next.
6. **Infeasible plates** (C), then **pinning/drying** (E), **multi-ACE** (F),
   **multi-plate** (G).

## Mockups to produce

| # | Mockup | For | Status |
|---|--------|-----|--------|
| — | [Remembering a filament layout](assignment-persistence-mockup.html) | D | built to it |
| 2 | [What the ACE actually holds](reconciliation-mockup.html) | B | awaiting decisions |
| 3 | Infeasible plate refusal | C | to produce |
| 4 | Pinned / drying spool states | E | to produce |
| 5 | Two-ACE assignment board | F | to produce |

## Standing risks

- **Cost is inherent, not a bug.** 7 colours all used every layer on 3 feeders and
  one ACE head is ~300 swaps whatever the layout. The UI must make that legible
  rather than imply the planner failed.
- **Profile edits need a version bump**, or the app keeps its cached copy and the
  change silently does nothing.
- **GUI verification must be empirical.** Three crashes in this feature were
  misdiagnosed from code reading; each was settled in one run by
  `.claude/tools/start.sh` (headless X, crash catcher, `THROW_LOG=1`).
