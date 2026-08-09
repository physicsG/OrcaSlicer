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

## Phase 4 — Assignment dialog (done, with one gap)

Opens on export when the plate has an ACE-fed head and more than one filament.

- done — live topology header, spools placed per the computed plan
- done — Manual mode re-prices as you move spools (300 → 349 swaps, 40.4 → 47.0 g)
  with "Auto would need 300" alongside
- done — waste derived from what slicing actually flushed
- **gap** — **Apply to plate did not reach the gcode.** Exporting after applying a
  349-swap manual layout wrote the 300-swap auto plan. Cause: export re-processes
  and recomputes, discarding the override. A fix keeping the user layout in a
  separate member is written but **not yet verified**.

## Phase 5 — Cost visibility (built)

- done — cost in the gcode header
- done — cost in the dialog
- **built** — post-slice notification naming the swap count with a *Review
  assignment* link. Never observed firing; it auto-dismisses faster than a
  screenshot loop. Unknown whether it renders and is simply missed, or does not fire.

---

## What is still missing

### A. The print path (gap — highest value)

The dialog is hooked to **export only**. Printing straight to the machine never
shows it, so the most common route to a print skips the decision entirely.
*Mockup needed: where the assignment step sits in the send flow.*

### B. Reconciling with what is actually in the ACE (gap)

Orca decides "slot 2 holds the red". Nothing checks the machine agrees. A plan
that contradicts the loaded spools prints the wrong colours with no warning.
*Mockup needed: mismatch state — planned vs actual, per slot, with a way to
accept the machine's truth or reload the spools.*

### C. Infeasible plates (gap)

More colours than total capacity has no layout. The planner returns infeasible
and slicing proceeds as a plain toolchanger — silently wrong for the user's
intent. *Mockup needed: the refusal, saying how many slots short and what to drop.*

### D. Persistence (gap)

An applied layout lives on one `Print`. Re-slice or reopen the project and it is
gone. Needs storing in the 3MF alongside the plate.

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

1. **Verify the override fix** (Phase 4 gap) — without it the dialog is decoration.
2. **Notification**: settle whether it fires; give it a lifetime that survives a glance.
3. **Print path** (A) — the dialog must be on the route people actually use.
4. **Persistence** (D) — an applied layout that evaporates is worse than none.
5. **Reconciliation** (B) — the highest-consequence correctness gap.
6. **Infeasible plates** (C), then **pinning/drying** (E), **multi-ACE** (F),
   **multi-plate** (G).

## Mockups to produce

| # | Mockup | For |
|---|--------|-----|
| 1 | Assignment step in the send/print flow | A |
| 2 | Planned vs actual ACE contents, with reconcile actions | B |
| 3 | Infeasible plate refusal | C |
| 4 | Pinned / drying spool states | E |
| 5 | Two-ACE assignment board | F |

## Standing risks

- **Cost is inherent, not a bug.** 7 colours all used every layer on 3 feeders and
  one ACE head is ~300 swaps whatever the layout. The UI must make that legible
  rather than imply the planner failed.
- **Profile edits need a version bump**, or the app keeps its cached copy and the
  change silently does nothing.
- **GUI verification must be empirical.** Three crashes in this feature were
  misdiagnosed from code reading; each was settled in one run by
  `.claude/tools/start.sh` (headless X, crash catcher, `THROW_LOG=1`).
