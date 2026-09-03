# Print dialog — three designs

Three interactive answers to the same question, at the size the host actually opens
(714 × 750), running on the **real** `sw_GetFileFilamentMapping` reply shape and the
**corrected** send sequence. Open the chooser:

```bash
python3 resources/web/shared/tests/run_webkit.py \
    --size 1500x980 --watch \
    --page web/print_processing/mockups/index.html
```

Or one at a time, in the dialog's own size:

```bash
python3 resources/web/shared/tests/run_webkit.py --size 714x750 --watch \
    --page 'web/print_processing/mockups/option-b.html?scenario=mismatch'
```

`build/resources` is a symlink to `resources/`, so these need no build — edit and reload.

## The three

| | | The bet |
|---|---|---|
| **A** | [Faithful](option-a.html) | The shipped four cards, in the shipped order, carrying the fields the host was already returning. Familiarity is worth more than a better layout for a step most people click through. |
| **B** | [Match sheet](option-b.html) | The mapping *is* the page: file filaments on the left, what is loaded on the right, a wire between them. Showing the destination beats the four-card layout. |
| **C** | [Preflight](option-c.html) | A run of checks that resolve themselves — one line each when fine, open where a decision is needed. Most sends want one glance; the ones that do not want the problem in front of them. |

## Switches

Both are query parameters, on any of the four pages; the chooser drives all three frames
at once so they can be compared in the same state.

| | |
|---|---|
| `?scenario=` | `ready` · `mismatch` · `wrongmodel` · `noprinter` |
| `?mode=` | `print` (Orca's `?path=4`) · `upload` (`?path=5`) |

`mismatch` is the one worth looking at: toolhead 3 is empty, no PETG is loaded, and
toolhead 4 has a 0.2 mm nozzle where the file was sliced for 0.4. The three designs
differ most in what they do about it.

## What they have in common

Everything except the design, deliberately — so a comparison is between designs and not
between fixtures.

- **[`fixture.js`](fixture.js)** is the `sw_GetFileFilamentMapping` reply as
  `SSWCP.cpp:3039` builds it: parallel arrays, the plate thumbnail, per-filament grams
  and length, and the nozzle diameters the file was sliced for. The shipped
  reconstruction reads `mapping.filaments[i]`, which the host has never returned — see
  [04-requirements](../../../../docs/u1-webui/03-print-processing/04-requirements.md).
- **[`shell.js`](shell.js)** holds the send: `sw_GetFileStream` → `fetch` → a multipart
  POST with a real byte count → `sw_StartLocalPrint { type, path }` → the three-command
  close protocol. The progress bar moves on bytes, not on a timer.
- **[`mockup.css`](mockup.css)** is the dialog frame and the primitives more than one
  design draws.

These are **mockups**, not the page: no bridge, no printer, no `window.wx`. Each marks
itself in the corner and hands a `--drive` script `window.__mockup`.

## Checking one

```bash
python3 resources/web/shared/tests/run_webkit.py --size 714x750 \
    --page 'web/print_processing/mockups/option-a.html?scenario=mismatch' \
    --drive resources/web/shared/tests/drive/print-mockups.js
```

Dumps the tree, then asserts the handful of things that would be quietly wrong: the
thumbnail is visible without a click and decoded, there is a way to choose a destination
per filament, Send agrees with the scenario, and an edit reaches the model *and*
repaints. It found two real faults that a screenshot did not — a filament name column
squeezed to 22 px, and a lane that had fallen into the 54 px wire gutter.

## What is deliberately not here

No printer picker and no live state. The mockups answer *what shape should this dialog
be*; the plumbing is settled and written down.

The ACE bays were not here either, and now they are — in three more designs of their own,
below, because a plate sliced onto an ACE asks the dialog a different question.

---

# multiACE — four more

The three above answer *which toolhead does this filament print from*. A plate sliced onto
an ACE cannot ask that: the gcode's `ACE_SWAP_HEAD HEAD=n` names the head directly, so
remapping the tools without remapping the swaps prints on one head while the ACE feeds
another. The map has to go out as the identity, and **none of these three has a head
picker.** What is left is reconciliation — the file says which bay each filament comes
from, the machine says what is in it, and the dialog says what to move — or, in G,
offers to change the plan instead.

The whole account, including what has to exist in C++ first, is
[03-print-processing/06-multiace.md](../../../../docs/u1-webui/03-print-processing/06-multiace.md).

```bash
python3 resources/web/shared/tests/run_webkit.py --size 1500x980 --watch \
    --page web/print_processing/mockups/multiace.html
```

| | | The bet |
|---|---|---|
| **D** | [Per head, two across](option-d.html) | The Prepare tab's Printer section, in the dialog: a bordered box per toolhead with its `ACE` row and the same green corner tick. Nobody learns a new picture. |
| **E** | [The machine, whole](option-e.html) | The Device page's Filament panel as one row — every place a spool can be, the tubes to the head each feeds. A picture of the thing you are about to walk over to. |
| **F** | [One line per filament](option-f.html) | The Prepare sidebar's Project Filaments list at print time. The only shape that survives four ACE units. |
| **G** | [The grouping, and a way back](option-g.html) | Another slicer's two-nozzle flow, adapted. The only one that can fix a mismatch **without walking to the printer** — and the only one that fits with nothing below the fold. |

## G is the one with a second door

D, E and F treat the plan as fixed, so a mismatch is an errand: walk to the printer, move
a spool. G is adapted from `ui-snapshots-inspiration/Slicing/`, whose four steps —
*Slicing Result* → *Filament grouping* → *Send print job* → *Select filament* — carry one
idea the other three do not have: **Convenience Mode**, which groups filaments around the
spools that are *already* in the machine. A mismatch then stops existing rather than
being reported. Where the printer is two floors away that is usually the cheaper door.

It costs a re-slice, and it says so. On an ACE plate **both** levers are written into the
gcode — the head as `T<n>`, the bay as `ACE_SWAP_HEAD SLOT=` — so changing either needs
the plate sliced again, and G's button says **Re-slice** rather than Send. The flow it is
adapted from sends its slot mapping at print time and pays nothing for the same move;
that difference is a slicer decision, not a dialog one. The mapping of all four steps onto
the U1 is
[06-multiace.md §3a](../../../../docs/u1-webui/03-print-processing/06-multiace.md).

## Where the drawing comes from

Not from here. [`ace-art.js`](ace-art.js) says which mark is borrowed from where, and the
sources are the three places this machine is already drawn:

* **the Device page's Filament panel** — the cabinet and the feeder module with the seam
  through the middle of the roll, the `A1` disc over a name chip, the eye/pencil and the
  green tag mark, the tubes drawn *behind* the box
* **the Prepare tab's Printer section** — the bordered box per head two across, the `ACE`
  row with a badge or the words `Stock feeder`, and `SyncMarkBox`'s green corner tick
* **Bambu Studio's AMS display** (`ui-snapshots-inspiration/`) — which is where both of
  those came from: an addressed bay over a colour-filled spool, a humidity pill, tubes
  converging on the toolhead

The one mark that is new is a **ring behind a disc** carrying what the *plate* wants of
that place. The Device page never needs it: it draws a machine, not a machine against a
file.

## The mode, and multi

`SET_ACE_MODE MODE=normal|multi|head` is not a preference — it decides what a head's
places *are*, so every design states it in a read-only pill using the Device page's own
words. The three shapes are `shapeOf()`'s, followed rather than re-derived:

| mode | a head's places | where the cabinets are named |
|---|---|---|
| **head** | its own feeder, or all four bays of **one** unit | on the head — the badge beside `Toolhead N` |
| **multi** | its **lane**: bay *i* of *every* unit | a band **above** the grid |
| **normal** | its own feeder | a band **below** the grid — an idle cabinet still reports humidity |

In multi, toolhead 1 can be fed `A1` or `B1` and nothing else, so a head's box draws one
bay from each cabinet — `laneBoxes()` in `ace-art.js`, the Device page's `laneBox` lifted
rather than redrawn.

**The Prepare tab disagrees.** `Plater.cpp:9845` calls this mode *"Units pooled onto a
single ACE head"*; the Device page says every head gets a lane. Only one is true of the
hardware. These follow the Device page, which was built against the live mode switch.

```bash
python3 resources/web/shared/tests/run_webkit.py --size 1500x980 --watch \
    --page web/print_processing/mockups/multiace-g.html
```

## The badge goes on the head

Which unit feeds a head is a property of **the head** — `ACE_SET_HEAD_ACE` binds one to
one, and the Prepare tab's per-head `ACE` row is that fact in that place. So the badge sits
beside `Toolhead N` and the chips carry only the address. Drawn on every chip it was the
same cabinet three times on one toolhead.

A **stock feeder** gets `feederBadge()` — the Device page's `moduleBadge()` — and never a
small ACE: at 13 px the ACE's square glyph was the same picture, which is the mistake
`device.css` warns about in as many words. In multi a head has no unit, so it carries its
lane (`Lane · A3 · B3`) and no badge.

## A second ACE, and the two bugs it found

`?scenario=twoace` gives toolhead 3 its own unit: ten places, and the swap count falls
**300 → 164**. `?scenario=multi` is the same two cabinets with far less freedom — a lane
is fixed — at 214.

- D, E and F each read `units[0]` for every head, so toolhead 3's bays were judged against
  toolhead 4's cabinet. `reconcile()` had it too; a plan step now carries its own `unit`,
  because in multi one head's places come from different cabinets.
- In multi a head has no unit, so `bayAddr(planned.unit, …)` rendered every chip as
  **`NaN1`** — on screen, and green on every check that counted elements. The drive script
  now asserts an address is one of `A`–`D` and `1`–`4`.

## G, settled

Its four sections are taken from wherever each was best, which is what a set of mockups is
for: **Model Information** from D (the render, the file's numbers, and a strip of every
filament — seven do not fit four cards, which is the point), **Printer** and the **plate**
card from G, **Filament** from G, and **Print Preferences** from D and E.

That last one is a correction rather than a preference. The flow G is adapted from offers
its settings as three-state segments — *Auto / On / Off* — and here that was wrong twice:
`SET_PRINT_PREFERENCES` takes **booleans** (`prefsLine()` sends `1` or `0`), so an `Auto`
segment could never leave the page; and `PRINT_PREFERENCES` has **three** toggles, not
four — `shaper_calibrate` is a `print_task_config` field, not one of the popup's. The
fourth row was the screenshot's, not this machine's.

**Check the macro before copying the widget.** A control shape borrowed from another
machine's UI carries that machine's capabilities with it.

It costs height: 166 px of switches against 88 of segments, so G overflows the 650 px body
by 42 where it fitted exactly. Still the smallest of the four, and only the last
preference row is below the fold.

## Switches

| | |
|---|---|
| `?scenario=` | `ready` · `swapped` · `unnamed` · `wrong` · `twoace` · `multi` · `noace` · `plain` |
| `?mode=` | `print` · `upload` |

`wrong` is the one worth looking at: A2 holds PETG where the plate wants PLA and A4 is
empty. `unnamed` is the one that separates a good design from a loud one — the bay is
occupied by a spool nothing has named, so the honest verdict is *cannot tell*, and a
design that calls it wrong is crying wolf. `plain` is a four-filament plate with no plan,
which is **every plate the slicer can produce today**: all three must degrade to the
dialog that already ships.

## Checking them

They have their own drive script. The four-card one reads `model.assignment`, which these
do not have — and a drive script that throws sets no report, so the harness waits for it
forever. That is how `print-mockups-ace.js` came to exist rather than being folded in.

```bash
R=resources/web/shared/tests
python3 $R/run_webkit.py --size 714x750 \
    --page 'web/print_processing/mockups/option-e.html?scenario=wrong' \
    --drive $R/drive/print-mockups-ace.js
```

It asserts the handful of things that would be quietly wrong: every file filament reaches
the screen (the four-card dialog draws four labels for seven), no head picker exists on an
ACE plate, a disagreement is marked, **no green tick claims agreement that was never
checked**, Send matches the scenario, what the arrangement costs is stated before Send,
and **a blocked send offers a way forward** — an override, or a regroup, but never
nothing.

Two things it had to be taught, both by a design arriving after it:

- **Ask about the fact, not the class name.** Three of its checks knew only D, E and F's
  markup and reported G — which draws the same things under different names — as broken.
  They are unions now, and "is every filament on screen" reads `data-fil` rather than
  guessing from the text, because G legitimately draws three chips that read the same.
- **A way forward is not always an override.** G has none, by design: it offers to change
  the plan instead.

Sweeping found one real fault: option E blocked Send on `noace` and offered no override —
a refusal with no door, on the one scenario where the page has no evidence either way.

## Opening them without a checkout

`run_webkit.py` needs a display, a checkout and WebKitGTK, and the people who have to
choose between three designs do not all have those. One command bundles all three into a
single file that opens in any browser:

```bash
python3 resources/web/print_processing/mockups/build_standalone.py
```

It is a **generator, never a second copy** — every byte comes from the files beside it, so
the bundle cannot drift from what the harness drives. Two things it has to do that are
worth knowing, because both failed silently first:

- **The modules stay modules.** Flattening them into one script is a SyntaxError:
  `multiACE.js` and `ace-art.js` both have a private `r1`, and two `const r1` in one scope
  takes the whole bundle down with no visible error. Each file is handed to the page as
  source and made into a blob URL at load, with its specifiers rewritten to its
  dependencies' blobs — which is what the module loader would have done with real files.
- **`</script>` has to be split.** `json.dumps` leaves `/` alone, so an embedded
  document's own closing tag ended the *outer* script and the page died quietly.

It emits **two** pages — the four designs, and the three ACE modes — from the two chooser
shells beside them. Both are gitignored: three quarters of a megabyte each of inlined
copies of files already in the tree.

## What is deliberately not here either

**No machine actions.** It is tempting to offer a load, and the dialog must not: a swap is
`ACE_UNLOAD_HEAD` then `ACE_LOAD_HEAD` (never `ACE_SWAP_HEAD` — that one hops Z), it takes
three minutes and a purge, and naming a bay is not built at all. The operator's fix is
spools. The dialog's job is to say precisely which.

---

# Plan choice — what to offer when the plan and the machine disagree

`plan-choice.html`. **It is the popup, not a picture of one:** it loads the dialog's own
two stylesheets and mounts the shipped panels — `model-info`, `printer`, `grouping` or the
four cards, `preferences` — straight out of `../js/views/`, on this directory's fixture.
Exactly one thing in it is new, and everything new is prefixed `pc-`. A difference between
this and the live dialog is therefore a bug in one of them, not a drawing choice in here.

```bash
python3 resources/web/shared/tests/run_webkit.py --size 714x750 --watch \
    --page 'web/print_processing/mockups/plan-choice.html?scenario=aware'
```

`?scenario=` is `aware` (sliced onto the ACE; two bays hold the other spool, so the real
reconciliation refuses the send) or `unaware` (sliced with no ACE in the preset, on a
printer that has one; seven filaments, four heads, and the real four-card panel marks
three of them `!`). The page carries its own switcher, so `--watch` reaches both.

## What it is for

D, E and F treat the plan as fixed and a mismatch as an errand. G offers to change the plan
and says the button must read **Re-slice**, because when G was drawn the slicer emitted the
plan and both levers were baked into the gcode. Route C does the rewrite in the host *after*
export, and that splits them apart:

| lever | where it lives | changing it costs |
|---|---|---|
| which toolhead a filament prints from | the tool number itself | re-export the gcode |
| which bay feeds an ACE-fed head | one argument per swap line | a text edit, free |

So there is a third answer none of the earlier designs could offer — **keep the layout, fix
the bay addresses** — which costs nothing and turns a refused send into a send with nothing
to carry to the printer. Drawing that is the whole point.

The reasoning, and the measurement that says preferring Orca's own filament assignment is
**not** on its own enough, is
[03-print-processing/10-plan-choice.md](../../../../docs/u1-webui/03-print-processing/10-plan-choice.md).

## Where the answers sit, and what that cost

Above the toolhead grid, not below it. The decision is what the section is for and the boxes
are what justifies it — and measured, a chooser under four boxes and seven chips is three
hundred pixels below the fold. One line per answer for the same reason: prose rows took the
body past 500 px of overflow.

| | body overflow at 714 × 750 |
|---|---|
| the shipped dialog on this fixture | 182 |
| with the answers added | 356 |

## Checking it

```bash
python3 resources/web/shared/tests/run_webkit.py --size 714x750 \
    --page 'web/print_processing/mockups/plan-choice.html?scenario=aware' \
    --drive resources/web/shared/tests/drive/plan-choice.js
```

33 checks, and most of them are about the shipped panels rather than the new block: the
sections in the registry's order, the real grouping view drawing four heads and seven chips,
two of them marked by the real three-valued reconciliation, and the real four-card panel
marking three filaments unset in the other state.

## The dropdowns, and what each one holds

`picker.js` documents three, measured off the bundle — the item heights, widths and
offsets are its `KINDS` table. Two are wired into the page; this mockup adds the fourth,
which is the one an ACE plate needs and does not have.

| dropdown | opened from | holds | refuses |
|---|---|---|---|
| **printer** | Select Printer | the saved devices: cover, name, LAN line, a tick on the current one | nothing |
| **toolhead** | a card in Edit Filament | the four toolheads: the head's disc in its own colour, what it holds, where that came from | a head whose **type or nozzle** does not match the file filament, with one of two tooltips. Not a suggestion — `enabled: false`, and the widget will not fire `onPick` |
| **plate** | — | the build surfaces. Measured (80 px items, matches the button, max 480) and unused in the reconstruction | — |
| **source** *(new)* | a chip in the Filament grid | the four bays of **this head's own unit**, then the other toolheads. A bay row is its address on a disc in the bay's own colour, the material, and who named it; a toolhead row is its number and what it holds now | a bay that is **empty**, or whose material the machine is sure about and which is not this filament's. **Colour never refuses** — remapping colour is what the menu is for, and the verdict line already says when one differs |

**Every row carries its own cost**, `free` on a bay and `re-export` on a toolhead, because
that is the asymmetry the whole panel turns on. Headings per group were the first shape and
the widget will not have them: it focuses the first enabled item when it opens, which
scrolls a disabled heading out of the menu. The cost belongs to the choice anyway.

**Two lines per row, not two columns.** The toolhead menu is 200 px — the bundle's own
number — and a material, a vendor and a cost tag side by side truncated all three. The row
is 48 px tall and was carrying one line of it. A check asserts nothing truncates.

Picking by hand becomes a fourth answer, *Chosen by hand*, and the picks belong to it
alone: flipping between the four is non-destructive, because a suggestion is an alternative
to your picks rather than a base for them.

## Sharing it

```bash
python3 resources/web/print_processing/mockups/bake_page.py plan-choice.html
```

`bake_page.py` is the general form of `build_standalone.py`: it walks the page's import
graph rather than carrying a fixed chain, so a mockup that mounts a dozen of the popup's
modules bundles without anyone maintaining a list. Modules stay modules — flattening them
is a silent `SyntaxError` — and are handed to the page as source, turned into blob URLs
with their specifiers rewritten. The bundle passes the same 33 checks with the same
measurements, which is the point of generating it rather than writing it.
