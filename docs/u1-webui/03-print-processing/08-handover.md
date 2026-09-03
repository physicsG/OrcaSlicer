# Where this stopped, and what to do next

**Branch:** `feat/u1-print-multiace`, cut from `develop/add-multiace-support`.
**State:** four commits, working tree clean, pushed. Read this before touching anything.

The short version: **the print popup understands multiACE, and the machine cannot yet be
told to use it.** The panel can describe an ACE-fed printer; nothing carries a bay choice
from the dialog to the print. The next piece of work is deciding which of three routes
carries it, and the recommendation is in §4.

---

## 1. What is built and proven

| | |
|---|---|
| `js/views/grouping/` | the ACE panel: mode, unit band, per-head box with its badge, chips, per-bay verdict, feeder limit, cost |
| `core/session.js` | `filePlan` · `refreshAce` · `syncBays` · `judgeBay` / `reconcile` (three-valued) |
| `views/filament/` | the four-card panel now **also describes an ACE machine** — mode pill, unit badge, which heads it feeds, and a per-row source note in the picker |
| `views/model-info/` | a strip of every filament the plate uses |
| `u1_bridge.py` | parses the emitter's own `; multiACE plan:` header out of a real file |
| `mockhost.js` | `usePlan()` — an ACE plate on the simulator's own machine |
| `drive/print-dialog-ace.js` | the suite |

**Driven against the real U1** (`811002511261022618B3`), read-only, 16/16 — a real
multiACE plate, the real `ace` object, the real override store, and a correct verdict
(the plate wants 7 PLA colours, the unit held 4 PETG spools → 4 differs, Send refused).

**And a send was run end to end** on an ordinary plate: map → `sw_GetFileStream` → real
multipart POST → `sw_StartLocalPrint` → cancel. `standby → printing → cancelled` in 32.6 s,
file deleted afterwards.

Suites: `print-dialog.js` 52/52 · upload route 5/5 · `print-dialog-ace.js` 18/18 and 17/17 ·
`print-dialog-machine.js` 15/15 · Device page 61/61 · coverage clean · conformance 165 ·
unit 231.

---

## 2. What is NOT built, and why it matters

**The dialog cannot make a bay choice mean anything.** `SET_PRINT_EXTRUDER_MAP` names a
toolhead; `extruder_map_table` is 32 entries valued 0-3 (measured on the machine) consumed
verbatim as a Klipper `extruder%d` index. There is **no runtime tool→bay resolution
anywhere** — no `T` handler in `ace.py`, no `SET_*_MAP`, nothing. A bay's filament reaches
a nozzle only by being loaded into the head, or by the file naming it.

So today the panel *describes* and cannot *use*. That is the gap.

---

## 3. The three routes (full account: [07-ace-mapping-routes.md](07-ace-mapping-routes.md))

| | how | re-slice? | cost |
|---|---|---|---|
| **A** | send through multiACE's **printer-side preflight** | never | **blocked**: no CORS header on `/multiace/` (measured; Moonraker `:7125` reflects Origin). C++ send-path change, and depends on an optional web service |
| **B** | **slice ACE-aware** (the unmerged branch) | gcode re-export, not geometry | the whole planner + emitter + the identity guard; touches `GCode.cpp`, `GCodeWriter`, `Print` |
| **C** | **rewrite in Orca after slicing** — the preflight's job, host-side | never | a new rewriter; **slicing pipeline untouched** |

---

## 4. Recommendation: route C, and why

Route C is route A's outcome with none of route A's dependencies and none of route B's
blast radius.

**Why in Orca rather than on the printer:**

1. **It covers every exit.** The printer's preflight only runs for files uploaded through
   multiACE's own web UI. A file exported to SD, sent by Fluidd, or sent by Orca today is
   unprocessed — a bare `T5` with nothing to map it.
2. **No dependency on an optional service.** `ace.py` is what makes the ACE work; the web
   stack (FastAPI, nginx, Pyodide, `S98multiace-web`) is a separate deployment that may be
   absent, versioned differently, and is unreachable from the webview.
3. **Orca knows what the preflight has to guess.** The preflight reconstructs the colour
   sequence from `; Change Tool` comments. Orca has the real tool ordering, the layer
   structure, and the **flush matrix** — and `ACE_SET_PURGE`'s own help says it is
   *"intended for multiACE Pro to set per-colour-pair purge from the slicer."* The printer
   is asking for a number only the slicer has.
4. **The plan and its cost are visible before committing**, in Preview, with no printer.
5. **Re-mapping is cheap** — re-run the rewrite over the same sliced gcode.

**The honest counter, and it is real:** a second implementation drifts. multiACE built the
Pyodide worker specifically so there would not be two copies of the matcher; a C++ port
recreates that risk against a plugin on its own release schedule. Mitigate by treating
`post_process_virtual_toolheads.py` as the specification and porting behaviour, not by
inventing.

---

## 5. What route C actually takes

### Already written, reusable as-is

**`AceMmuPlan.hpp` on `origin/feat/ace-mmu-slicing` is a pure header** — STL includes only,
no Slic3r dependency. A branch-and-bound optimiser: colour-change sequence + a list of
heads `{capacity, ace}` → assignment minimising ACE swaps. 535 lines, with 444 lines of
tests (`tests/libslic3r/test_ace_mmu_plan.cpp`). **Lift it unchanged.** Two known defects
recorded in `docs/ace-mmu/15-printer-panel.md`: a shared unit double-counts capacity, and
Combined mode emits the wrong `ACE=`/`SLOT=`.

Also on that branch and worth taking: `AceMmuReconcile.hpp` (217) and its 373 lines of
tests — the same three-valued verdict the JS now implements, so the two should agree.

### The genuinely new part

A **rewriter over an emitted gcode**. multiACE's is the specification:

- `rewrite_head_mode_to_file` (~185 lines) — per tool: feeder → bare `T<pin_head>`;
  ACE → `T<entry_head>` + `ACE_SWAP_HEAD HEAD=h ACE=a SLOT=s`, deduped against a simulated
  load state
- `inject_auto_load_to_file` (~218 lines) — the preload block, anchored **before** the
  prime line (it lists four anchors in priority order)
- for `multi` mode, the synthetic-T encoding `T = ace*4 + bay` and its decode

Call it 400-600 lines of C++ plus tests.

### Where it hooks — and the one that matters

**There is already a post-process hook**, `run_post_process_scripts`
(`src/libslic3r/GCode/PostProcessor.cpp:238`), called from three places — **verified**:

| | | runs for a U1? |
|---|---|---|
| `BackgroundSlicingProcess.cpp:242` | straight after `export_gcode` writes `m_temp_output_path = get_tmp_gcode_path()` | **no** — gated `if (m_fff_print->is_BBL_printer())` |
| `:800` | `finalize_gcode`, the export-to-file path, `make_copy=true` | yes |
| `:929` | the **print-host** upload path | yes — gated `if (!is_BBL_printer())` |

**The U1's own send is none of these.** `send_gcode_legacy` hands
`get_tmp_gcode_path()` to `WebPreprintDialog`; the page then fetches `sw_GetFileStream`,
which zips that same temp file. So `:929` never fires for it.

**`:242` is the hook to use.** It runs once, immediately after export, on exactly the file
that the U1 send zips *and* that Ctrl+G packages. One hook covers every route. The change
is to widen its gate from `is_BBL_printer()` to include the U1 and call the rewriter there
rather than an external script.

> Not yet verified, and worth ten minutes before building: whether `Export G-code`
> (`:800`) re-exports from the `Print` or copies `m_temp_output_path`. If it re-exports,
> `:242` alone may not cover it and both sites need the call.

---

## 6. Traps

- **`extruder_map_table` survives a print.** A real U1 was seen carrying `[0,1,1,0]` from an
  earlier job. On an ACE plate the map must go out as the identity — that is what
  `grouping-commands.js` does, and the branch has a C++ guard (`AceMmuToolMap.hpp`) that is
  **not on this branch**.
- **`hidden` is a UA rule any author `display:` beats.** Cost an afternoon; there is now a
  `[hidden] { display: none !important }` in `preprint.css`. Do not remove it.
- **The usage filter drops filaments on a real ACE plate.** `filament used [g]` is indexed
  by emitted extruder and zero-padded while `filament_type` is per project filament, so
  three of seven read as unused. Worked around by keeping anything the plan references; the
  real repair is §3 item 2 of [06-multiace.md](06-multiace.md).
- **Do not write to the machine on dialog open.** The identity map was written by
  `bringUpAce()` and merely opening the dialog changed `extruder_map_table`. It is on the
  send now.
- **A `--drive` script that throws sets no report and the harness waits forever.** Two of
  mine did. `full.sh`-style sweeps must treat "no result" as a failure — `grep | tail` exits
  0 on empty input.
- **Licence:** multiACE is **GPL-3.0**, Orca **AGPL-3.0**. AGPLv3 §13 permits the
  combination; attribution required if code is ported.

---

## 7. Open questions, in the order they will bite

1. **Does `Export G-code` re-export or copy?** Decides whether `:242` is one hook or two.
2. **What does the preflight do with more colours than places?** Orca's native path throws a
  `SlicingError`; the preflight's behaviour is unread. Route C needs an answer.
3. **`multi` and `normal` modes have never been exercised in the page** — the simulator
  reports `head`. Only the mockups draw them.
4. **Colour is not compared** in the match rule, by design (type + nozzle is the bundle's).
  On a plan-less plate a plate wanting colours that exist nowhere still enables Send. Design
  question 2, still open — and probably *should* stay open, since remapping colours is what
  the panel is for.
5. **No print has been run past its first seconds**, and the ACE half of the send path is
  entirely unobserved.

---

## 8. How to pick it up

```bash
git checkout feat/u1-print-multiace

# the page, on an ACE plate, against the simulator
R=resources/web/shared/tests
python3 $R/run_webkit.py --size 714x750 \
    --page 'web/print_processing/index.html?mock=1&plan=1' \
    --drive $R/drive/print-dialog-ace.js

# and against the real machine, read-only (Orca closed)
python3 $R/run_webkit.py --real --sn <SN> --size 714x750 --settle 25 \
    --gcode ~/proj/models/Test_Cube_PLA_4h15m_multiACE.gcode \
    --page web/print_processing/index.html --drive $R/drive/print-dialog-ace.js
```

Read in this order: [07-ace-mapping-routes.md](07-ace-mapping-routes.md) for the decision,
[06-multiace.md](06-multiace.md) for the design and what the C++ owes the page, then
`docs/ace-mmu/13-roadmap.md` on `origin/feat/ace-mmu-slicing` for what route B already did.
