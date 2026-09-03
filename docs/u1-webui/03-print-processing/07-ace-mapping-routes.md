# Getting ACE filaments into a print: three routes, and what each costs

The question this answers: **a plate is sliced knowing nothing about the ACE, the colours it
wants are sitting in ACE bays — does that need a re-slice?**

Short answer: **no, and it never did.** multiACE already solves it on the printer. Orca
bypasses the mechanism.

Everything below is measured against the U1 at 192.168.2.242 or quoted from source.

---

## 1. What "mapping" means on each machine

| | gcode holds | who resolves it | change a slot ⇒ re-slice? |
|---|---|---|---|
| **Bambu AMS** (the inspiration) | a **logical filament index** — `M620 S[next_extruder]A` / `T[next_extruder]` | the printer, from an `ams_mapping` array sent **with the job** | **no** |
| **U1 today** | a **logical `T<n>`** | the printer, from `print_task_config.extruder_map_table`, rewritten by macro seconds before the print | **no** |
| **U1 + multiACE, sliced natively** (unmerged branch) | a **physical head**, plus `ACE_SWAP_HEAD HEAD=n ACE=u SLOT=s` | nobody — it is already physical | **gcode re-export, not geometry** |

The first two are the same idea with different transport. Bambu's mapping crosses as MQTT
JSON; the U1's crosses as two Klipper macros over `sw_SendGCodes`. Neither touches the
slicer:

- Bambu computes the mapping at `SelectMachine.cpp:1091`, **exports the gcode at
  `SelectMachine.cpp:2036`, and attaches the mapping at `SelectMachine.cpp:2115`** — eighty
  lines *after* the file exists. A manual re-pick mutates an in-memory vector
  (`SelectMachine.cpp:2246`) and invalidates nothing.
- The U1's equivalent is `writeAssignment` in `filament-commands.js`, sending
  `SET_PRINT_EXTRUDER_MAP` / `SET_PRINT_USED_EXTRUDERS`.

**And that is the ceiling.** `extruder_map_table` is 32 entries whose values are only
`0..3` — measured on the machine — and it is consumed verbatim as a Klipper `extruder%d`
section index (`extruder_ace.py:1049`). It names a **toolhead**. There is no bay dimension
anywhere in `print_task_config`, and no runtime `T<n>`→bay resolution exists in the Klipper
plugin at all: no `T` handler, no `SET_*_MAP`, no toolchange interception.

So on the U1 a print-time mapping can move a filament to another **head**, and can never
move it to another **bay**.

---

## 2. The piece that was missing: multiACE has a preflight, and it rewrites the file

Not a Klipper macro — a **FastAPI service on the printer**, plus the same code compiled to
Pyodide so the browser can run it identically.

| | |
|---|---|
| `multiace/web/backend/preflight_core.py` (659 lines) | `parse_meta`, `build_report`, `rewrite_pipeline` |
| `multiace/tools/post_process_virtual_toolheads.py` (3210 lines) | the matcher, the optimiser, the streaming rewriters |
| `POST /multiace/api/preflight` and `/preflight/print` | analyse, and rewrite-then-print |

**Verified live on this machine**, 2026-09-03:

```
GET  /multiace/api/preflight/livedata  -> 200
  live_slots: A1 PLA #6d1d32 · A3 PLA #ffffdc · A4 PLA #3b5759
  head_ctx  : mode head, ace_heads [3], feeders head0 #000000 …
POST /multiace/api/preflight[/print]   -> 422 (endpoint present, body missing)
```

What it does: reads the uploaded gcode, works out which tools it uses, matches them against
the **live** bay contents, and **rewrites the file** — injecting
`ACE_SWAP_HEAD HEAD=h ACE=a SLOT=s` at each change and an auto-load block before the prime
line — then uploads the rewritten copy to Moonraker with `print=true`.

**It needs nothing from the slicer.** It keys on

```python
_TOOLCHANGE_RE = re.compile(r"^;\s*Change Tool\s*(\d+)\s*->\s*Tool\s*(\d+)", re.MULTILINE)
```

and that comment is emitted by the **stock** Snapmaker U1 profile
(`Snapmaker U1 (0.4 nozzle).json:11`). An ordinary Orca slice already carries it. multiACE's
own README: *"Just upload unprocessed GCode via Multiace-Web … Autoloads needed spools, no
need to preload."*

It offers **three plans** — `loadout` (match what is physically loaded), `optimize`
(swap-minimal), `layer` — with per-tool user overrides, and
`POST /api/preflight/print` **accepts an externally computed `head_assignment`**.

> Those three are the inspiration's Convenience / Filament-Saving modes and option G's
> regroup sheet, arrived at independently. The planner we were going to build already
> exists, on the printer, and takes our answer as an argument.

**Orca bypasses all of it.** `send_gcode_legacy`'s U1 branch (`Plater.cpp:21919`) hands the
last slice's temp gcode to the webview, which POSTs it to Moonraker's
`/server/files/upload`. Anything arriving that way is unprocessed: a bare `T5` is an
out-of-range tool and nothing maps it.

---

## 3. This was considered and reversed, in hours

`docs/ace-mmu/11-assignment-dialog.md` §2b on `feat/ace-mmu-slicing` reads the preflight's
source and concludes:

- `AceMmuPlan.hpp` **duplicates** multiACE's planner;
- emitting `ACE_SWAP_HEAD` from `change_filament_gcode` is *"probably the wrong mechanism …
  Candidate for reverting"*;
- the API accepts an externally computed assignment.

Commit `6b67565e9e` (2026-08-07) set the direction to **"Orca owns the UX and the plan;
multiACE owns the rewrite."** Commit `2e71733a77`, the same day, replaced it with
**"DECIDED: native in Orca"**, demoting the preflight to *"available as a fallback"* and
turning `post_process_virtual_toolheads.py` into the specification for Orca's own emitter.

Going native was a choice, not a necessity. It has real advantages — Orca knows the flush
matrix, the toolpath and the layer sequence, so it can price a plan properly and refuse an
infeasible plate at slicing. It also cost the guard in `AceMmuToolMap.hpp`, because once
tool numbers are physical the printer's print-time remap becomes actively dangerous.

---

## 4. The three routes

### A. Send through the preflight

Orca uploads the **unmodified** gcode to `POST /multiace/api/preflight/print`, optionally
with a `head_assignment` the dialog computed. The printer plans, rewrites and prints.

- **No re-slice, ever** — for any plate, including ones sliced with no ACE awareness.
- No planner, no emitter, no feasibility check in Orca.
- The dialog becomes exactly option G's regroup sheet over the preflight's three plans.
- **Blocker: no CORS header on that endpoint.** Measured — Moonraker `:7125` reflects the
  Origin, `/multiace/` returns none — so the *webview cannot POST it*. This is a C++ change
  to the send path, not a page change.
- Costs the slicer's knowledge: purge lengths come from a matrix the printer does not have,
  and an infeasible plate is discovered late.

### B. Slice ACE-aware (the unmerged branch)

The file arrives print-ready and the preflight is unnecessary.

- Changing which bay feeds a filament is a **gcode re-export, not a geometry re-slice**:
  `set_ace_plan_override` invalidates `psGCodeExport` alone, and the "rewrite-then-resume"
  continuation re-exports and then resumes the upload that asked for it.
- Requires the whole planner + emitter + the identity-map guard.

### C. Today

No ACE in the file, head-only mapping, bays unusable except whatever happens to be loaded.
This is what ships.

---

## 5. What this means for the panel

Whichever route, the dialog needs the same three things, and it has two of them:

1. **Show what is in the bays** — built; it reads `ace` and merges the override store.
2. **Let the operator choose a bay per filament** — *only meaningful under A or B*. Under C
   there is nowhere to send the choice.
3. **Say what the choice costs** — swaps and purge. Under A the preflight prices it
   (`_real_swap_count`); under B the planner does.

The honest position today is that the panel can **describe** an ACE-fed machine and cannot
**use** it, because the route that would carry the choice is not connected at either end.

---

## 6. Not established

- **Whether the preflight's rewrite is acceptable for a Snapmaker-sliced plate in general.**
  It is exercised through multiACE's own web UI; it has never been driven with a file Orca
  produced, from Orca.
- **What the preflight does with a plate that has more colours than places.** Orca's native
  path throws a `SlicingError`; the preflight's behaviour is unread.
- **Whether `POST /api/preflight/print` can be reached from Orca's C++** — the CORS header
  is irrelevant to a native HTTP client, but nothing has tried it.
