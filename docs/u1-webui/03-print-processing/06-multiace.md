# The print popup and multiACE

What the dialog would have to become for a plate sliced onto an ACE, and what has to
exist before it can. Written on `develop/add-multiace-support`; every claim about the
code is a file and a line on this branch unless it says otherwise.

The mockups are
[`resources/web/print_processing/mockups/multiace.html`](../../../resources/web/print_processing/mockups/multiace.html)
— four designs, seven scenarios, at the 714 x 750 the host actually opens.
[`multiace-g.html`](../../../resources/web/print_processing/mockups/multiace-g.html)
is G's three marks on a machine with two ACE units.

---

## 1. Slicing does not support multiACE on this branch. Measured.

The question splits in two and the answers are opposite.

**Four filaments on four toolheads works today, and has for a while.** The U1 is a
toolchanger, not an MMU: `resources/profiles/Snapmaker/machine/fdm_U1.json` inherits
`fdm_toolchanger` with `single_extruder_multi_material: "0"`, and each of the four
instantiated variants carries a four-entry `nozzle_diameter`, which is where Orca gets
the extruder count (`src/slic3r/GUI/Tab.cpp:4263`). The toolchange macro is in the
shipped profile — `change_filament_gcode` emits `M109 T<n>` / `M400` / `T<n>` /
`SM_PRINT_PREEXTRUDE_FILAMENT INDEX=<n>` — and there is a vendor-indexed process preset
whose whole reason to exist is multi-filament printing,
`0.10mm Color Mixing @Snapmaker U1 (0.4 nozzle)`, which tunes the prime tower.

**An ACE bay as a filament source does not exist in the slicer at all.** The *topology*
landed with the printer panel (#38) and stops there:

| on `develop` | |
|---|---|
| `PrintConfig.cpp:3989` `ace_mode` | `normal` / `head` / `multi`, mirroring `SET_ACE_MODE` |
| `PrintConfig.cpp:4006` `ace_head_unit` | which unit feeds each head, `-1` for a stock feeder |
| `PrintConfig.cpp:4033` `ace_head_capacity` | slots per head, `1` for a stock feeder |
| `libslic3r/AceMmuTopology.hpp` | preset ↔ machine, pure |
| `GUI/AceMmuProvider`, `AceBadge`, `AceAssignPopup` | reading it, drawing it, choosing it |

**None of those three keys is read by one line of the slicing core.** Their only
consumers are `AceMmuTopology.hpp`, the printer-options list in `Preset.cpp:989`, and
the sidebar in `Plater.cpp`. `GCode.cpp`, `Print.cpp` and `ToolOrdering.cpp` contain no
occurrence of `ace` at all, and `AceMmuState.hpp` / `AceMmuTopology.hpp` are included
only by GUI files. So:

- there is **no planner** — `AceMmuPlan.hpp` does not exist here;
- there is **no logical→physical tool remap** — `GCodeWriter::set_tool_remap` does not
  exist here;
- **nothing emits `ACE_SWAP_HEAD` or `ACE_SET_PURGE`** — not in `GCode.cpp`, not in
  `change_filament_gcode`, not in `machine_start_gcode`.

**And a five-filament plate is not refused.** The check that would reject an object
assigned to an extruder the printer does not have is inside `#if 0` at
`src/libslic3r/Print.cpp:1783-1790`, and `MAXIMUM_EXTRUDER_NUMBER` is 64
(`libslic3r.h:65`). A U1 plate with seven filaments therefore **slices without complaint
and emits `T4`, `T5`, `T6`** — tool numbers no head can honour. That is the state of the
world the print dialog would meet today if anyone tried.

The other half of the work — planner, tool remap, `ACE_SWAP_HEAD HEAD=n ACE=u SLOT=s` at
`GCode.cpp:2781`, an assignment dialog, feasibility refusal — exists and is
hardware-verified on the **unmerged** `feat/ace-mmu-slicing` (117 commits). It is not
here, and the two branches have since diverged: the topology work above is newer than it
and absent from it.

> **So the honest position is:** the popup is being designed for a file the slicer on
> this branch cannot yet produce. That is the right order — the popup is the last thing
> in the chain and the only one that has been rebuilt in a language we own — but nothing
> below can be tested end to end until the planner lands.

---

## 2. What changes for the dialog, and why it is not a bigger filament grid

Four things, and only the first is obvious.

**The plate stops fitting in the dialog's own shape.** Four cards is four labels. In
`head` mode with one ACE the machine has **3 + 4 = seven** places, and every one of them
can be a distinct filament in a single print. The shipped dialog describes such a plate
as four spools and says nothing about the other three.

**The mapping stops being a choice.** This is the part that inverts the dialog's job. A
`T<n>` in the file is a *logical* tool that the U1 resolves through
`print_task_config.extruder_map_table`, and the preprint page rewrites that table
immediately before every print with `SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=<logical>
MAP_EXTRUDER=<physical>`. For an ordinary plate a remap is a *feature* — it lets a file
authored for head 0 print from the spool that happens to be in head 2. **For an ACE plate
it is never right**, because the gcode's `ACE_SWAP_HEAD HEAD=n` names the physical head
directly: remap the tool changes without remapping the swaps and the plate prints on one
head while the ACE feeds another. So on an ACE plate the map must go out as the identity,
and a dialog whose central control is a head picker is offering the operator a way to
ruin the print.

What replaces it is **reconciliation**: the file says which bay each filament comes from;
the machine says what is in that bay; the dialog compares them and says what to move.

**The verdict has to be three-valued.** multiACE's bay identity has a precedence —
`rfid > override > derived` — and only the first two are things somebody asserted. An
inferred identity that disagrees is not evidence of a wrong spool. So: **agrees**,
**differs**, **cannot tell**, plus **not checked** for the places no ACE reports. Calling
a derived spool wrong is a false accusation, and a check that cries wolf gets ignored,
which costs more than no check. An empty bay is always `differs` — the machine is not
guessing about emptiness.

**A cost appears that the operator is entitled to see.** Seven colours on three feeders
and one four-bay head is ~300 ACE swaps and ~40 g of purge for the test plate, and that
is inherent rather than a defect. It belongs before Send, not in the gcode header.

**What does *not* change: the nozzle.** A nozzle belongs to a head, not to a bay, so no
ACE swap can fix a nozzle mismatch. It stays exactly the refusal the bundle already makes.

---

## 3. What has to exist. Seven items.

Ordered by what blocks what.

### 1. The reply has to say a plate is an ACE plate — `SSWCP.cpp:3039`

Nothing in `sw_GetFileFilamentMapping` distinguishes a plate sliced onto an ACE from any
other. Every design below needs one key. The mockups call it `ace_plan` and it carries
only things the slicer already computes:

```
ace_plan: { mode, swaps, purge_g,
            heads: [ { head, feeder, unit,
                       run: [ { filament, slot }, … ] } ] }
```

`run` is the filaments that head prints **in the order it prints them**, which is what
turns "four labels" into "seven filaments behind four heads".

### 2. The two index spaces have to be reconciled — same handler

`filament_color` / `filament_type` are indexed by **project filament**;
`filament_weight` / `filament_used_mm` come from `total_volumes_per_extruder` and are
indexed by **emitted extruder**. On an ordinary printer the two coincide and the bug is
invisible. The moment several filaments share one head they diverge, and the client pairs
them by position. This is not optional and it is not the popup's to fix.

### 3. The page has to read the ACE — it does not today

`print_processing/` never imports `shared/js/multiACE.js`. Two reads are needed and the
Device page already does both:

- **`ace`, `ace_bg_swap`, `save_variables`** are *not* on `SUBSCRIBE_OBJECTS` (that list
  is pinned to the shipped bundle's), so they are fetched on their own and re-read after
  anything that changes them.
- **the override store**, `config/extended/multiace/slot_overrides.json`, over Moonraker
  on `:7125` — `/multiace/` itself serves no CORS header, `:7125` reflects the Origin.

Without the second, a bay named by hand rather than by tag reads as `?`.

### 4. The mapping write has to become the identity, and be refused otherwise

`filament-commands.js` sends `SET_PRINT_EXTRUDER_MAP` + `SET_PRINT_USED_EXTRUDERS`
today. On an ACE plate the first must be the identity. Belt and braces: `sw_SendGCodes`
on the C++ side can refuse a batch that moves a tool off its own head when the current
plate has a plan — that guard exists on `feat/ace-mmu-slicing` and has fired against a
real machine, leaving `extruder_map_table` untouched.

### 5. The dialog needs the reconciliation, and one override

Blocking on `differs`, warning on `unsure`, silent on `unchecked`, with a single
**"Send anyway — I have checked the spools"** that names what is being overridden. A tick
whose sentence is generic gets ticked without being read.

**Scope limit that has to be on screen:** the ACE reports its own bays and nothing else,
so a wrong colour on a *stock feeder* is undetectable. Three of this machine's seven
places are stock feeders. Saying so is the difference between a check and a claim.

### 6. What the dialog may *do* about a mismatch — mostly nothing, today

Worth being blunt, because it is the most tempting place to invent capability:

| | |
|---|---|
| **Load / unload a head** | `ACE_UNLOAD_HEAD` then `ACE_LOAD_HEAD`. **Never `ACE_SWAP_HEAD`** — that one is the *print's* swap, it opens with a `G1 Z2` hop and Klipper refuses it on an unhomed Z. Three minutes and a purge, so it is a person's decision. |
| **Rename a bay** | **Unbuilt.** `ACE_SPOOL_ASSIGN ACE=n SLOT=n ID=n` is the reachable route; multiACE's own `POST /api/slot-override` is behind the CORS hole. So the dialog can *report* a bay mismatch and cannot *fix* one. |
| **Pre-load to a plan, before the print** | `ACE_PRELOAD` — and it is **foreground**, not a background verb. Its whole body is `run_script_from_command('ACE_SEQ PLAN=%s UNLOAD=%d')` (`ace.py:10540-10547`), so it is `ACE_SEQ` with the final unload defaulted off, and `PLAN=` is mandatory. Useful for staging *before* a print starts and useless during one. Nothing in this repo references it and it is not in `check_coverage.py`'s table. |
| **Stage while printing** | `ACE_BG_SWAP` — a background swap of a *parked* head, so the arrival toolchange is a no-op. Needs head mode, 1:1 wiring, a head declared with `ACE_BG_SET_HEAD`, and an **open dock** below it because the cold-pull purges ~60 mm through it. On the reference machine `enabled_heads` is `[]`: nothing is declared, so the refusal is the state to draw first. |

**And background staging is globally serialized — one operation at a time, across every
head.** Read at the source, `ace_bg_swap.py:603-607` (swap) and `:707-711` (unload):

```python
if self._busy:
    return _refuse('another bg op is running (head %s) - bg ops are '
                   'serialized (shared move queue), one at a time' …)
```

Nothing in `docs/u1-webui/` states this, because it was written from the macro help
rather than from the plugin. It rules out the obvious design — stage all four heads while
the plate uploads — at about three minutes each, so three heads is nine minutes serial. A
dialog that offered it would have to own the scheduling and the progress, and
`ace_bg_swap`'s `get_status` does publish a per-head `state` for exactly that, which
`parseBgSwap` currently drops.

The mockups therefore offer **no machine actions at all**. The operator's fix is spools,
and the dialog's job is to say precisely which.

> Source read: the multiACE plugin checkout at `e691f2e`, which is a **different branch**
> from the `0.99.8b` the hardware runs — `ACE_BG_SET_HEAD`'s help disagrees with the
> machine's own dump about whether it persists. Argument shapes off this source get the
> same treatment as everything else here: an `ok` is not a yes.

### 7. The plain path must not regress

Every plate the slicer can produce today has no plan, and all three designs must be the
dialog that already ships for it. That is the `plain` scenario, and it is in the sweep
for exactly that reason.

---

## 3a. The sequence, adapted from a two-nozzle slicer

`ui-snapshots-inspiration/Slicing/` holds another slicer's flow for the same problem —
more filaments than physical outputs, grouped onto them by the slicer — on a machine with
**two nozzles, each fed by its own AMS**. It is worth adapting because it answers a
question the reconciliation above does not: *what if the plan is the thing that should
change?*

Its four steps, and what each becomes on a U1:

| | there | here |
|---|---|---|
| **01** | **Slicing Result** in the Preview sidebar: *Filament Grouping*, the filaments boxed under `Left nozzle` / `Right nozzle`, and one line — *"Save 25 g filament and 100 nozzle purges compared to a printer with one nozzle."* Plus *Why this grouping* and *Regroup filament*. | The same panel, boxed under **Toolhead 1–4**. The saving is not against one nozzle — the U1 has four — but against the same plate run **entirely off the ACE head**, which is what a machine with no free tool changes must do. Three of seven ride stock feeders, so every change into those three is a tool change instead of a swap. |
| **02** | **Filament grouping** dialog: **Auto** / **Custom**, and under Auto two modes — *Filament-Saving* ("most filament-saving principles, to minimize waste") and *Convenience* ("based on the printer's actual filament status, reducing the need for manual filament adjustment"). | **Fewest swaps** / **What is loaded** / **Choose myself**. This is the piece that was missing. |
| **03** | **Send print job**: thumbnail, printer card, plate card, then per-nozzle boxes of filament chips each carrying **the AMS slot it comes from** (`A2`, `B3`) as a dropdown, a *Regroup and slice →* link, four three-state options, Send. | The popup. Per-**toolhead** boxes; a chip's source is an ACE bay (`A2`) or `Feeder`. |
| **04** | **Select filament**: the two AMS units drawn as four addressed slots each, **the one that cannot feed this nozzle greyed out**, the chosen slot marked with a filled corner wedge and a tick. An `External` slot below each. | The same, with ACE A–D and the **stock feeder** as the `External` analogue. |

### What that buys, and the one place it does not carry over

**The second door.** D, E and F treat the plan as fixed, so a mismatch is an errand: walk
to the printer and move a spool. Step 02's *Convenience Mode* is the other answer — group
around the spools that are **already** in the bays, and the mismatch stops existing. On a
machine that is not in the room, that is usually the cheaper door, and no amount of
polish on a reconciliation panel substitutes for it.

**Both levers cost a re-slice here, and there they do not.** That slicer sends its slot
mapping at print time, so changing which AMS slot feeds a filament is free. On an ACE
plate **both** levers are written into the file — the head as `T<n>`, the bay as
`ACE_SWAP_HEAD SLOT=` — so changing either means slicing the plate again. Option G says
so, on the picker and on the button, which changes from **Send** to **Re-slice**. Making
the bay mapping a print-time argument instead would be a slicer change, not a dialog one,
and it is worth knowing that it is available: it would turn G's expensive door into a
free one.

### What this asks of the slicing side

Beyond §1's planner and emitter, the flow needs three things none of which exist:

1. **A grouping mode.** The enum is already here from the Bambu lineage —
   `enum FilamentMapMode { fmmAutoForFlush, fmmAutoForMatch, fmmManual, fmmDefault }` at
   `PrintConfig.hpp:350`, whose first three are exactly step 02's three choices. It is
   vestigial: `filament_map` is **not a registered config key** (no
   `this->add("filament_map…")` anywhere in `PrintConfig.cpp`), and the 3MF writer
   hardcodes the mode with the comment `// TODO: Orca: hack` —
   `bbs_3mf.cpp:7712` writes `"Auto For Flush"` unconditionally and the line under it maps
   every filament to extruder 1. So the vocabulary exists and nothing is behind it.
   `fmmAutoForMatch` is Convenience Mode, and making it real needs the planner to take the
   machine's **current bay contents** as an input rather than only the plate's.
2. **The saving figure.** The planner already computes the chosen layout's cost; the line
   needs the counterfactual too — the same plate with every filament on the ACE head.
3. **A re-slice entry point from the dialog.** The popup is opened by
   `WebPreprintDialog` after a native send dialog has already been answered; a *Regroup
   and re-slice* that closes the popup and returns to Prepare with a new grouping mode is
   a host command that does not exist.

## 4. The four designs

The visual language is not new. It is the Device page's Filament panel, the Prepare tab's
Printer section and — behind both — Bambu Studio's AMS display, which is where the
`A1`-on-a-disc bay, the colour-filled spool box, the humidity pill and the converging
tubes come from. `ace-art.js` says which mark is borrowed from where. The one new mark is
the **ring behind a disc** carrying what the *plate* wants of that place; the Device page
never needs it, because it draws a machine rather than a machine against a file.

| | | The bet |
|---|---|---|
| **D** | [Per head, two across](../../../resources/web/print_processing/mockups/option-d.html) | The Prepare tab's grid, with its green corner tick. Nobody learns a new picture. |
| **E** | [The machine, whole](../../../resources/web/print_processing/mockups/option-e.html) | The Device page's panel as one row: seven places, seven tubes, four heads. A picture of the thing you are about to walk over to. |
| **F** | [One line per filament](../../../resources/web/print_processing/mockups/option-f.html) | The Prepare sidebar's Project Filaments list at print time. The only shape that survives four ACE units. |
| **G** | [The grouping, and a way back](../../../resources/web/print_processing/mockups/option-g.html) | §3a's flow. The only one that can fix a mismatch without walking to the printer — and the only one that fits with nothing below the fold. |

Measured in WebKitGTK at 714 x 750 on the `wrong` scenario, against a 650 px
`.dlg-body` and **221 for the existing option A**:

| | overflow | above the fold |
|---|---|---|
| **D** | 242 | the ACE head is the last of four boxes, so the one that can be wrong is furthest down |
| **E** | 255 | the machine and the to-do list; Print Preferences is below |
| **F** | 211 | the whole list, each bad row's fix, and the override |
| **G** | **0** | everything |

Three of them sit in the shipped dialog's own range, and **G does not scroll at all**. It
buys that by dropping the cabinet drawing entirely, which is also its main cost: a chip
says `A2`, and which cabinet that is has to be known. In D the footer's status line names
the blocker without scrolling, but which bay it is takes one.

### The mode decides what an address means

`SET_ACE_MODE MODE=normal|multi|head` is the printer's own three-way switch, and it is not
a preference — it changes what a head's places *are*. So every design states it, in a
read-only pill in the machine's own words (`ACE_MODE_LABELS`, so this surface and the
Device page call one state one thing). Read-only on purpose: `SET_ACE_MODE` re-plumbs the
printer and some of it only takes effect after a restart, and a dialog that sends one
plate has no business changing the machine between Print and Send.

| mode | a head's places | where the cabinets are named |
|---|---|---|
| **head** | its own feeder, or all four bays of **one** unit | **on the head** — the badge beside `Toolhead N` |
| **multi** | its **lane**: bay *i* of *every* unit | a **band above** the grid — no head is wired to a cabinet, so nothing about one belongs on a head |
| **normal** | its own feeder; no ACE feeds anything | a **band below** the grid — an idle cabinet still reports humidity and can still dry |

That table is the Device page's `shapeOf()`, followed rather than re-derived. In multi,
toolhead 1 can be fed `A1` or `B1` and nothing else — `A2` is unreachable from it at any
price — so a head's box draws **one bay from each cabinet**, which is `laneBoxes()`, the
Device page's `laneBox` lifted into `ace-art.js`.

> **The Prepare tab disagrees, and one of them is wrong about the hardware.**
> `Plater.cpp:9845` labels this mode *"Units pooled onto a single ACE head"* and
> `PrintConfig.cpp:3995` *"\"Combined\" pools several units onto a single head"* — every
> unit converging on **one** head. The Device page says every head gets a lane. These are
> different machines. The mockups follow the Device page, which is the surface that was
> built against the live mode switch; settling it needs a machine in multi mode and a look
> at `ace_heads`.

### The badge goes on the head, once

Which unit feeds a head is a property of **the head** — `ACE_SET_HEAD_ACE HEAD=n ACE=a`
binds one to one, and the Prepare tab's per-head `ACE` row is that same fact in that same
place. So the badge sits beside `Toolhead N`, filled with that unit's four bay colours,
and the chips carry only the address, which is the half that differs between them.

The first draft put it on every chip. That drew the same cabinet three times on one
toolhead and said nothing a fourth copy could add; on the head it is drawn once and two
units read as two different objects rather than two letters. A **stock feeder** gets the
feeder module's own white-over-black badge and never a small ACE — a different device with
one bay, and at 13 px the ACE's square glyph was the same picture, which is the mistake
`device.css` warns about in as many words. In **multi** a head has no unit to name, so it
carries its lane (`Lane · A3 · B3`) and no badge: one badge there would name one cabinet
out of a set and be wrong about the rest.

`multiace-g.html` is the three modes, side by side, across D, E and G.

### A second ACE, and what it found

`?scenario=twoace` gives toolhead 3 its own unit. Ten places — two stock feeders and eight
bays — hold the same seven filaments, so the planner spreads them instead of stacking four
on one head and **the swap count falls from 300 to 164**. In `multi` the same two cabinets
give eight places but far less freedom, because a lane is fixed: 214 swaps.

**It found a bug three designs had carried through every green sweep.** D, E and F each
read `model.ace.units[0]` for every head, so on a two-ACE machine toolhead 3's bays were
judged against toolhead 4's cabinet — four bays that agree with themselves and are the
wrong four. `reconcile()` had it too, and a plan step now carries its own `unit` because in
multi one head's places come from different cabinets. Invisible while every scenario had
one unit.

**And multi found a second.** A head has no unit there, so `bayAddr(planned.unit, slot)`
was `bayAddr(undefined, …)` and every chip read **`NaN1`** — on screen, in the DOM, and
green on every check that counted elements. The drive script now asserts that every
address is one of `A`–`D` and `1`–`4`.

### G, settled — and the one thing the flow got wrong for this machine

The four sections are now taken from wherever each was best, which is what a set of
mockups is for:

| section | from | |
|---|---|---|
| **Model Information** | **D** | the render, the file's numbers, and a wrapping strip of *every* filament the plate uses. Seven do not fit four cards, and saying so before the machine is discussed is the point of the whole exercise. |
| **Printer** | **G** | the printer card with its re-read, and beside it the **plate** — which build surface is fitted. A fact about the machine that neither the file nor the plate can answer, and the only place in the dialog it appears. |
| **Filament** | **G** | the mode, the grouping per toolhead, the badge on the head, and the way back. |
| **Print Preferences** | **D** and **E** | switches. |

That last row is a correction, not a preference. The two-nozzle flow offers four settings
as three-state segments — *Auto / On / Off* — and `Auto` is genuinely useful there: it
means the printer decides. Copied here it was wrong twice:

- **`SET_PRINT_PREFERENCES` takes booleans.** `prefsLine()` sends `1` or `0`
  (`shared/js/protocol.js`), because the shipped bundle keeps two parallel maps of the
  same toggles — bools for the checkboxes, ints for the wire — and builds the macro line
  from the int one. There is no third value to send, so an `Auto` segment is a control
  whose middle position can never leave the page.
- **There are three of them, not four.** `PRINT_PREFERENCES` is Extrusion Flow
  Calibration, Time-lapse Camera and Auto Leveling. `shaper_calibrate` is a field on
  `print_task_config` and is not one of the popup's toggles; the fourth row was the
  screenshot's, not this machine's.

It costs height — switches with hints are 166 px against the segments' 88 — so G now
overflows the 650 px body by **42** where it fitted exactly. Still the smallest of the
four by a wide margin, and the last preference row is the only thing below the fold.

**The lesson generalises**, and it is the one this whole exercise keeps re-learning:
a control shape borrowed from another machine's UI carries that machine's *capabilities*
with it. Check the macro before copying the widget.

### What they share

- **No head picker**, for the reason in §2, and the drive script asserts its absence.
  G's chip dropdown is not one: it picks the *bay*, and it costs a re-slice.
- The same three-valued verdict and the same override.
- `SET_PRINT_EXTRUDER_MAP` as the identity, listed in the send trace so it can be read
  rather than believed.
- The cost line, before Send.

---

---

## 6. What is built

Option G is implemented in `resources/web/print_processing/`, driven against the
simulator only. **Nothing here has been run against a printer**, by instruction and
because there is nothing to run it against: no Orca on this branch can produce the plate
it draws.

### It is inert on every plate that exists today

`filePlan()` returns null when the mapping reply has no `ace_plan`, and every plate the
slicer can produce has none. With no plan the grouping panel is hidden, Edit Filament is
the panel, the Send gate is the one it always was, and the dialog is the dialog that
already ships. `drive/print-dialog.js` still passes **52/52** on it.

### The pieces

| | |
|---|---|
| `core/session.js` | `filePlan()` normalises the proposed key; `refreshAce()` reads the `ace` object on its own (it is not on `SUBSCRIBE_OBJECTS`); `syncBays()` fetches multiACE's override store over Moonraker; `judgeBay()` / `reconcile()` are the three-valued verdict |
| `views/grouping/` | the panel: the mode, the unit band, one box per toolhead with its badge and chips, the per-head verdict, the feeder limit and the cost |
| `views/grouping/grouping-commands.js` | **one command, and it writes the identity** |
| `views/model-info/` | gains the strip of every filament the plate uses |
| `registry.js` | `filament` and `grouping` are one slot; the FILE picks |

### Two things worth calling out

**The identity map is written, and writing it is not optional.**
`print_task_config.extruder_map_table` is machine state that *survives a print* — a real
U1 has been observed carrying `[0,1,1,0]` left by an earlier job — so a page that sends
nothing inherits whatever the last plate left, and on an ACE plate any remap prints on the
wrong heads. `writeIdentityMap()` sends `CONFIG_EXTRUDER=i MAP_EXTRUDER=i` for every
filament plus the de-duplicated `EXTRUDERS` set. The drive script asserts both that it went
out and that **no line moves a tool off its own head**.

**The gate changed shape, because the decision did.** With no plan the refusal is "a
filament has no home". With one, nothing is unassigned — the file assigned everything —
and what can be wrong is a *bay*. `differs` blocks; `unsure` does not, because refusing on
an identity nobody asserted is crying wolf. There is **no override yet**: the mockups
offered one and it is the right shape, but it belongs with the regroup route, which is not
built.

### Found by building it

- **`hidden` hid nothing.** `.card` is `display: flex`, and `hidden` is a UA rule that any
  author `display:` beats — so the four filament cards went on being drawn beside the
  panel that had replaced them, and the head pickers with them. `[hidden] { display: none
  !important }` is now in `preprint.css`. The nozzle banner never hit this only because it
  sets `hidden` on a `.bare` body with no `display` of its own; that was an accident, and
  it is no longer the reason anything works.
- **The override store has to be merged before the verdict, not at draw time.** The Device
  page merges when it draws, which is fine where nothing judges. Here the raw slots carry
  no identity at all, so merging late would have `reconcile()` call every named bay
  unnamed.

### Verified against the real U1 — 2026-09-03

Driven against `811002511261022618B3` at 192.168.2.242, Orca closed, **read-only**: the
machine was left at `standby`, `extruder_map_table` at the identity, 184 files in the
gcodes root and nothing uploaded. `drive/print-dialog-ace.js` **16/16**.

**The plate is real, and it carries the plan in its own header.**
`Test_Cube_PLA_4h15m_multiACE.gcode`, sliced by the unmerged branch, opens with

```
; multiACE plan: T0:H3S3 T1:H3S0 T2:H0S0 T3:H1S0 T4:H2S0 T5:H3S2 T6:H3S1 swaps:300 optimal:1
```

followed by one `ACE_SWAP_HEAD HEAD=h ACE=u SLOT=0` per ACE-fed head, and 302
`ACE_SWAP_HEAD` / 301 `ACE_SET_PURGE` through the body. That is the emitter's own format
and it was not known when `ace_plan` was designed — so `u1_bridge.py` now **parses it**
rather than being handed a fixture, the same discipline it already follows for the
filament list and the thumbnails. The C++ can build the proposed key from exactly this.

**What the machine said.** `ace` present, `mode: head`, one unit; the override store
fetched over Moonraker and merged, naming all four bays. The plate wants seven PLA colours
and the ACE holds four PETG spools, so the verdict was **4 differs** and Send was refused
— a real reconciliation, against real hardware, with the right answer.

**Two defects it found that the simulator could not:**

- **The usage filter drops filaments on a real ACE plate.** The file declares seven and
  reports usage for four — `filament used [g] = 7.27, 7.36, 7.58, 26.52, 0.00, 0.00,
  0.00` — because the type array is indexed by project filament and the usage arrays come
  from `total_volumes_per_extruder`, indexed by emitted extruder and zero-padded. This is
  §3 item 2 *in the wild*, and `A.bEE`'s "keep what the plate consumes" filter therefore
  threw away three of the seven. A filament the plan references is now kept whatever the
  numbers say.
- **Opening the dialog changed the machine.** The identity tool map was written by
  `bringUpAce()`, so merely *looking* at an ACE plate rewrote `extruder_map_table`. It is
  written by the **send** now, before the upload — which is where the shipped page emits
  its own map, and it is right to. A refused send writes nothing, and the suite asserts
  that too.

Also cosmetic: the real header carries no purge figure, so the cost line read
"300 ACE swaps — purged". The clause is drawn only when there is one.

### Not covered

- **No print was started**, and the ACE half of the send path is therefore unobserved:
  rung 3 of the `u1-hardware-test` ladder was not run. The tool-map write is covered by
  the simulator only.
- **The plate cannot be satisfied on this machine** — it wants PLA and the ACE holds PETG
  — so the `agrees` path was exercised against the simulator and the `differs` path
  against hardware, not the other way round.
- **The build badge covers the note at one scroll position.** It is `position: fixed` at
  the bottom-right, the body scrolls under it, and this panel is the first on this surface
  long enough to put a line there — measured: the plain plate covers nothing. Scrolling
  reveals it, and the existing suite already guards the one element that must never be
  covered (the Send button). Left alone rather than changing a marker shared with the
  Device page.
- **`multi` and `normal` modes are drawn but not exercised here**: the simulator reports
  `head`, and the mode branch is only covered by the mockups.

## 5. Not decided, and not knowable from here

- **Which design.** They differ on a real question — whether the operator needs a picture
  of the machine or a list — and that is a judgement, not a measurement.
- **`multi` mode.** Everything here is drawn for `head`. In `multi`, bay *i* of *every*
  unit is plumbed to head *i*, so the places a filament can come from are a different set
  and the drawing changes. `normal` mode has never been observed on hardware at all.
- **More than one ACE.** Every scenario has a single unit, because that is the hardware
  this was measured against. D and E both have a fixed budget for the second one; F does not.
- **Whether a started job honours any of this.** Nothing past the first seconds of a
  print has ever been observed on this machine.
