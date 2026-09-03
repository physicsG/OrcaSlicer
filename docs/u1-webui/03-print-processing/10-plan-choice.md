# Which plan the rewriter should emit

Written 2026-09-03, after the first real ACE plate went through the route C rewriter inside
the app. **No code was changed for this document.** It is the analysis behind a decision that
has not been taken.

The short version: the obvious diagnosis — *the planner shuffled my filaments for no reason* —
is real, and fixing it would not have made this plate printable. The plan is chosen without
reading the one thing that decides whether it can print, and that is a different problem with
a different repair.

---

## 1. The plate

`ChickenPark-multicolor`, four filaments, on a U1 with three stock feeders and Toolhead 4
wired to ACE unit A (`ace_mode = head`, `ace_head_capacity = 1,1,1,4`,
`ace_head_unit = -1,-1,-1,0`, all read back out of the sliced file).

| filament | colour | preset |
|---|---|---|
| 1 | `#FFFFDC` cream | Generic PLA |
| 2 | `#6D1D32` maroon | Generic PLA |
| 3 | `#000000` black | Generic PLA |
| 4 | `#E2DEDB` light grey | Snapmaker PLA SnapSpeed |

The hook fired, the rewriter ran, and it wrote its sibling beside the plate's temp gcode. The
header it wrote:

```
; multiACE plan: T0:H3S0 T1:H2S0 T2:H0S0 T3:H1S0 swaps:0 optimal:1
```

Filament 1 to Toolhead 4 in bay A1; filament 2 to Toolhead 3; filament 3 to Toolhead 1;
filament 4 to Toolhead 2. Zero swaps, proven optimal. **Every filament moved off the toolhead
Orca had it on**, and the file changed accordingly: the opening tool selection went from `T0`
to `T3`, and all eighteen tool changes were renumbered.

And the machine, read over Moonraker the same afternoon:

| bay | holds |
|---|---|
| A1 | PLA GST3D `#6D1D32` |
| A2 | empty |
| A3 | PLA Forshape `#FFFFDC` |
| A4 | PLA Jayo `#3B5759` |

The plan asks for cream in A1. A1 holds maroon. The panel judges that `differs`, and a
differing bay disables Send (`app.js`, the `badBay` term). **The feature refused its own first
real plate**, correctly, on the strength of a plan nobody would have chosen.

---

## 2. Two decisions, and the rewriter takes both blind

With three feeders and one ACE-fed head, a four-filament plate needs exactly one filament on
the ACE, presented from one bay for the whole print. So the plan is two choices, not one.

**Which filament rides the ACE head.** `AceMmuPlan.hpp` orders colours busiest-first and gives
each the lowest-index head with the cheapest swap delta. When every filament fits its own head
every delta is zero, so the ordering alone decides: the busiest colour takes Toolhead 1 and the
least busy is left with whatever is last, here the ACE.

**Which bay presents it.** `slot_of` is filled in first-use order within a head, so the single
filament on an ACE head always lands in slot 0, which is bay A1. Always, on every plate.

Neither choice reads the ACE. Neither reads Orca's own filament-to-toolhead assignment. The
first is decided by print frequency and the second is a constant.

---

## 3. What the planner optimises, and what it cannot see

It minimises exactly one number: ACE swaps over the file's collapsed colour sequence. Not in
the objective, and not available to it:

- **purge volume.** The flush matrix is per colour pair, so two plans with equal swap counts
  can waste different amounts. Nothing compares them.
- **what is in the bays.** No input carries it.
- **where Orca already put each filament.** The identity assignment has no standing.
- **which unit**, beyond the head it feeds.

That is the right objective for the problem the header was written for — more colours than
places, minimise the swapping — and it says nothing at all about a plate where the colours
already fit. This plate is entirely in that blind spot.

---

## 4. The search discards equal-cost alternatives on purpose

Worth knowing before proposing a nicer tie-break, because it rules out the obvious shape of
one. Read at the source:

- the greedy seed runs first and sets `best_cost` to its own cost;
- the branch and bound then opens each node with `if (swaps_cur >= best_cost) return;`.

On a plate that seeds at zero swaps the search therefore returns at the root, and **the greedy
answer is the answer**. More generally the first plan reaching the optimal cost wins and every
later tie is pruned unexplored. There is never a set of equal-cost optima to choose from.

So a preference among equal-cost plans cannot be expressed by picking a better optimum. It has
to be either a secondary term inside the objective, or a candidate priced outside the search
and compared against it. `evaluate_assignment()` already prices a given layout, so the second
is cheap.

---

## 5. Preferring Orca's own assignment is not sufficient — measured

The natural repair is: when the untouched arrangement costs the same, keep it. On this plate
it does cost the same, and it is still not printable.

| | filament on the ACE head | bay named | is that colour in a bay? | Send |
|---|---|---|---|---|
| what shipped | cream `#FFFFDC` | A1, holds maroon | **yes**, in A3 | blocked |
| Orca's own assignment | light grey `#E2DEDB` | A1 | **no**, in none | blocked |
| aware of the loadout | cream, or maroon | A3, or A1 | yes | clear |

Read that middle row carefully. Keeping the user's assignment puts the Snapmaker PLA on the
ACE-fed head, and that colour is in no bay at all, so the verdict differs for a worse reason
than before. **The shuffle is a real defect and it is not the reason Send is disabled.** The
plan's choice of *filament* was accidentally right; its choice of *bay* was wrong, and its
choice of bay is wrong on every plate because it is a constant.

---

## 6. The thing neither choice reads

multiACE's own preflight offers three plans and route C ported one of them. `loadout` matches
the file's colours against the live bays. `optimize` is swap-minimal and ignores them.
`layer` is the per-layer variant. We built `optimize`, deliberately: the rewrite runs at slice
time on the background thread, where the printer may be off, unreachable, or holding different
spools than it will hold when the print starts.

That timing is the whole question, and it splits cleanly:

- **the head assignment has to be in the file.** It *is* the tool number, and the emitted
  `ACE_SWAP_HEAD HEAD=n` names it. Changing it means rewriting the file.
- **the bay assignment does not have to be.** It is one argument, on the preload line and on
  each swap. Nothing else in the file depends on it.

The popup already reads the bays, already merges the override store, and already judges each
one. It is the first moment in the whole chain when the bay contents are known, and it is
downstream of every decision the rewriter took.

---

## 7. The options

**A — keep Orca's assignment when it ties.** Price the untouched arrangement with
`evaluate_assignment` and keep it whenever its swap count equals the optimiser's. Small,
self-contained, offline, deterministic. Buys the invariant *a plate that fits one filament per
toolhead is never rearranged*, which restores the correspondence between the Prepare sidebar,
the machine-filament sync marks and the file. Does not unblock this plate.

**B — bind bays late.** Slicing chooses the head; the dialog chooses the bay, when it opens
and can see them, rewriting only the `SLOT=` arguments before the upload. Turns a differing bay
into a match wherever some bay holds the right colour, with no re-slice. This is §3.7 of
[09-route-c-plan.md](09-route-c-plan.md), listed there as a later cut. This plate says it is
not a later cut.

**C — plan against the loadout at slice time.** Read the ACE through
`AceMmuProvider::fetch_once()` during the rewrite and prefer an assignment whose colours are in
the bays. The best single-shot answer, and it makes slicing depend on a reachable printer; a
slice is also not a print, so the spools can change in between.

**D — leave it.** What ships. The panel names the offending bay and the operator walks over.
Honest, and it turns a four-colour plate on a four-head machine into an errand.

---

## 8. Recommendation

**A then B, and not C yet.**

A is worth doing on its own merits and is nearly free: it stops the gratuitous shuffle, and a
rearrangement that costs nothing and gains nothing is a defect whatever else is true.

B is what makes the plate printable, and it puts the decision where the knowledge already is.
Teaching the dialog to pick a bay is a smaller step than teaching the slicer to phone the
printer, and it survives the spools changing between slicing and sending, which C does not.

C becomes worth having once B exists, as a slice-time convenience that gets the common case
right before the dialog opens — not as the mechanism the feature depends on.

---

## 8a. Decided and built, 2026-09-03

**A and B, as recommended.** Both are in, both are tested, and one of them was tested on
the machine that raised the question.

**A — Orca's own assignment wins a tie.** `plan_for` prices the identity with
`evaluate_assignment`, takes the optimiser's answer, and keeps the identity whenever the
two cost the same. It could not be done inside the search, for the reason in §4: the greedy
seed sets the bound and the first plan reaching it wins, so there is never a set of tied
optima to choose from. The invariant is *a plate that fits one filament per toolhead is
never rearranged*, and it is a test.

**B — the bay is chosen late, and it is free.** Three pieces:

| | |
|---|---|
| `RewriteInput::slot_override` | per filament, the bay it must come from. Honoured after the plan is priced, so `swaps` is untouched — addressing is not a cost. A named bay wins; a filament that was sitting in it and was not itself named moves to the lowest free bay of the same head. Two filaments named onto one bay is refused, not resolved. |
| `sw_SetAceBays` | the host command. Re-runs the rewriter over the same logical gcode and answers with the new `ace_plan`. No re-slice, no geometry. A bay it cannot honour comes back as a sentence. |
| `bayFix` + the panel's offer | the page computes whether re-addressing would clear **every** bay, and only then offers *Use the bays they are in*. A fix that clears half of them leaves the plate just as unprintable. |

### What the machine said

Driven read-only against the U1 (`811002511261022618B3`) with three plates:

| plate | result |
|---|---|
| `Test_Cube_PLA_4h15m.gcode` (no plan) | 15/15 — the four-card panel, toolhead 3 reporting `NONE` and refused by the picker |
| `ChickenPark-multicolor_PLA_2h3m.gcode` (no plan) | 15/15 — the same |
| `Test_Cube_PLA_4h15m_multiACE.gcode` (a plan) | 17/17 — the grouping panel, four bays judged `differs`, Send refused |

**And the offer correctly stayed away on all three.** The unit holds three named PLA spools
and one empty bay against a plate wanting seven colours, so no permutation exists and
`bayFix` returns null. That is the honest limit of the cheap fix and it is now a check that
runs in both directions: offered exactly when it would clear every bay, verified true on the
simulator's `?plan=bayswap` and false on the machine.

---

## 9. What this does not settle

- **Whether the head choice should be loadout-aware too.** It probably should, once B has
  proven the bay path. On a plate with more colours than heads it matters much more than here.
- **Purge as a secondary objective.** Among equal-swap plans, prefer the cheaper pair
  sequence. Nothing measures it today and no plate has been costed.
- **More than one ACE unit.** The bay choice becomes a unit-and-bay choice, and the identity
  argument gets weaker because there are more places a colour could legitimately live.
- **The colour that is in no bay.** When nothing holds what the plan wants, the dialog should
  say which bay to put it in and it cannot: writing a bay's identity is unbuilt
  (`ACE_SPOOL_ASSIGN` is the reachable route, per the Device page's account).
- **Whether the plate should be rewritten at all** when the ACE is being used as a plain
  single-bay feeder. It must be — something has to present a bay to that head — but the
  preload is then the entire content of the rewrite, and it is worth asking whether that is
  better expressed as a machine command at send time than as a file edit.
