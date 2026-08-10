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

### B. Reconciling with what is actually in the ACE (done)

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
- done — the UI, as an **ACE contents** strip inside the assignment dialog. The
  dialog reads `/multiace/api/state` as it opens (short timeouts, so a printer that
  is configured but off costs a moment, not the poller's eight seconds) and the page
  judges each slot against whatever layout is on the board — so moving a spool
  updates the verdicts live.
- done — **blocking, with an explicit override**. While anything is unresolved,
  *Apply to plate* is disabled and a *Print anyway — I have checked the spools* tick
  appears. Closing the dialog instead returns `AceReview::Abort` and the export or
  print is abandoned; C++ re-checks the committed layout, so the gate cannot be
  skipped by closing the dialog, and resolving a mismatch by moving spools genuinely
  resolves it.
- **"Use what is loaded" was dropped** (user's call). It rewrote the user's own
  assignment on their behalf, which is what Manual mode already does deliberately:
  drag spools to where the machine has them and the verdicts clear as you go.
- Scope limit stated on screen: the ACE reports its own slots and nothing else, so a
  wrong colour on a stock feeder stays undetected.
- Verified against the live printer, not a fixture: with one PETG spool named by hand
  in S1 and three empty slots, a 7-colour PLA plate reported **4 wrong**, Apply was
  disabled, ticking the override enabled it, and closing the dialog cancelled the
  export where it previously proceeded.

### C. Infeasible plates (refusal done; tray dialog outstanding)

More colours than total capacity has no layout. **Measured, not assumed:** slicing
the 7-colour cube with a 2-slot ACE (5 places, 7 colours) succeeds with no error,
writes an **empty** plan header, emits **300 tool changes to `T4`/`T5`/`T6`** on a
four-head machine (plus `M109 … T5`, `SM_PRINT_PREEXTRUDE_FILAMENT INDEX=5`) and
**zero** `ACE_SWAP_HEAD`. The "physical heads only" contract breaks silently because
an infeasible plan hands `set_tool_remap` an empty map.

The dialog misdiagnoses it too — *"These pins cannot all be satisfied. Unpin
something"* when C++ sent no pins at all — omits the filaments that did not fit, and
lists `ACE 1 · S0` twice.

- done — **slicing refuses.** `Print::process` throws a `SlicingError` at the end of
  `psWipeTower` when the plan is infeasible, so no file is written at all. Verified:
  the plate does not slice, no gcode appears, and the error reads *"this plate uses 7
  filaments, but this printer has 5 places for them — 3 stock feeder(s) and 2 ACE
  slot(s)…"* with the **least-used** filaments named as cheapest to drop and their
  colours. A feasible plate is unaffected — still `swaps:300 optimal:1`, T0–T3 only.
- **Hard, no override.** A wrong spool is a judgement call; a missing toolhead is not.
- Only filaments the plate actually **prints** need a place, so a project carrying
  spare filaments is never falsely refused. The trigger is exactly
  `used colours > total places`.
- **gap** — the tray. Refusing at slicing means the assignment dialog never opens for
  an over-capacity plate, so the drawn tray of unplaced spools has no home there. It
  needs a small refusal dialog of its own, raised by throwing a type derived from
  `SlicingError` and catching it in `on_process_completed` (clean, no string matching).
  Mockup: [infeasible-plate-mockup.html](infeasible-plate-mockup.html).

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

### E. Pinning (done)

Drying is **out of scope for this page** (user's call): the assignment dialog is
about where spools go, not about conditioning them.

The planner already honours pins as hard constraints (`PlanPin` takes a head, a unit
or an exact slot) and the board already sets them by click and drag. Two things are
wrong:

- **Everything arrives pinned.** C++ seeds the page with the computed plan expressed
  as one pin per filament, so the board opens on *"Auto plan honours 7 pin(s)"* with
  an orange badge on every spool. A badge everything carries distinguishes nothing,
  and a deliberate pin is indistinguishable from the optimiser's own choice. The
  seeding exists for a real reason — it guarantees the board shows the layout the
  gcode will use rather than an equal-cost rearrangement from the page's own
  optimiser — so the fix is to send the layout *as a layout* and keep `pins` for pins.
- **Pins do not survive** the dialog closing, unlike an applied layout.

Plus a bug found while reading: `pinTo()` records the slot only when the head index
is literally `3` (`state.slotPins[c] = head===3 ? slot : -1`). With two ACE-fed heads
— now a tested configuration — pinning into the other ACE head keeps the head and
silently loses the slot.

All four fixed, to the decisions taken on
[pinning-mockup.html](pinning-mockup.html):

- done — **seeded is no longer pinned.** C++ sends its plan as `layout`/`slots` and only
  real pins as `pins`. The board still opens on exactly the arrangement the gcode holds
  — verified: *"Auto plan honours 0 pin(s)"* with no badges, same layout, same 300 swaps
  — and the page falls back to its own optimiser only once a pin is actually touched.
- done — **pins persist**, as a per-plate `ace_plan_pins` in the 3MF: two values per
  filament, head then slot. Verified across a process restart: pins `1 0` and `3 2`
  came back and the slicer honoured them (`T3:H1S0`, `T5:H3S2`, where the unpinned plan
  had T5/T6 in the opposite slots).
- done — **slot-exact.** Head-only would let the optimiser reshuffle within the ACE,
  which is not what a pin is for.
- done — **a pin that no longer fits says so**, and `pinTo()` now tests whether the head
  is ACE-fed rather than whether it is literally head 3.
- **A stale pin can never trigger the infeasible-plate refusal.** An infeasible pinned
  plan retries unpinned; if that succeeds the pins are dropped and reported, because the
  plate is the job and a pin is only a preference.

### F. More than one ACE (tested, short of second hardware)

- done — planner and reconciliation now have two-unit coverage:
  `1 + 1 + 4 + 4 = 10` places accept ten colours and refuse eleven, with four on
  each ACE; and each slot is judged against **its own unit**. That last one mattered:
  slot numbers are per head, so unit 0 slot 0 and unit 1 slot 0 are different physical
  places that anything matching on slot number alone would cross over.
- done — the board renders two units: `ACE 1 → T3` and `ACE 2 → T4` as separate
  boxes, wires to the right heads, and the gcode carries both `ACE=0` and `ACE=1`.
- done — **a plan addressing an ACE the machine does not report is now a mismatch.**
  Found by measuring, not reading: with two units configured and one connected, the
  strip judged only the unit that answered and said nothing about the spool bound for
  the other. If the connected unit happened to match, the plate would have passed the
  gate with a filament assigned to a unit that is not there. It now reports
  *ACE 2 · S1 — not connected* and holds the gate shut.
- Still unverified: **real two-ACE hardware**. Everything above is one physical unit
  plus a fabricated topology, so wiring, unit indices and swap behaviour on a second
  physical ACE remain untested.

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
5. ~~**Reconciliation** (B)~~ — done 2026-08-10.
6. ~~**Infeasible plates** (C)~~ — refusal done 2026-08-10; tray dialog deferred.
7. ~~**Multi-ACE** (F)~~ — tested 2026-08-10, short of second hardware.
8. ~~**Pinning** (E)~~ — done 2026-08-10.
9. **Multi-plate export** (G) — the last gap, plus the deferred tray dialog for C.

## Mockups to produce

| # | Mockup | For | Status |
|---|--------|-----|--------|
| — | [Remembering a filament layout](assignment-persistence-mockup.html) | D | built to it |
| — | [What the ACE actually holds](reconciliation-mockup.html) | B | built to it |
| — | [More colours than places](infeasible-plate-mockup.html) | C | awaiting decisions |
| — | [Pinning a spool in place](pinning-mockup.html) | E | built to it |
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
