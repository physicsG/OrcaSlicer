# The Filament panel, with more than one ACE

> **Picking this up?** Start at [11-multiace-handover.md](11-multiace-handover.md) — what
> is settled, what to build first, and the traps. This file is the reasoning behind it.

Studies: [multiace-filament-mockup.html](multiace-filament-mockup.html) — seven shapes,
five machine states, every number measured in WebKitGTK ·
[multiace-f2-iterations.html](multiace-f2-iterations.html) — the follow-on, which **runs**:
four rearrangements of a per-toolhead subpanel, driven by source, mode, unit count and
Sync ·
[multiace-toolhead-card.html](multiace-toolhead-card.html) — what goes *under* the header:
five mixable axes for the filament, the box, the tube and the head's own marker ·
[multiace-cabinet.html](multiace-cabinet.html) — the chosen card, with the cabinet drawn
as the badge and everything on one centred axis. All three carry pre-rendered copies of
every option so they read with no script at all.

> **This is the reasoning. The panel is built** — see the handover for what landed,
> what changed on the way in, and what is still unproven against hardware.

The panel shows one slot per toolhead and knows nothing about an ACE. This is the design
for the version that does: **several ACE units, each able to feed a toolhead in place of
its stock feeder**, drawn so that *which bay feeds which head* is the thing you see first.

Bambu Studio's AMS display
(`ui-snapshots-inspiration/Device-page_AMS-info/AMS_display.png`) is the reference for the
shape — slot cards, an address badge per slot, a humidity pill, wires converging on a
merge bar, the nozzle at the bottom — and
`No_ams_nozzle_1.png` for the case where one side is a plain external spool rather than a
cabinet. Bambu draws that for **one or two nozzles**. The U1 has **four**, and up to four
units that may each feed more than one of them, which is the whole of the problem.

## What is not negotiable

Four numbers, none of them chosen here, and between them they eliminate three of the six
shapes before any is judged on how it reads.

| | | from |
|---|---|---|
| Panel width | **830** | `--col-w`; the side column is `flex: 0 0 var(--col-w)` |
| Panel body height | **456** | Measured at 1920×1080 with `run_webkit.py --size 1920x1080`. Filament is the `grows` panel in its column, so a taller window gives more — and `.panel-body` is `overflow: hidden`, so a body past it is **clipped in silence** |
| A toolhead | **64×140** | `icons/extruderBackground.svg`, drawn by `.slot` |
| A bay | **64×61** | The same 36 px disc at (15,29) and 58×19 `#6E6E6E` name pill at (3,71), without the extruder body |

**The artwork decides which way up the picture goes.** `extruderBackground.svg` draws two
stubs from `y=15` to `y=0` at `x=26` and `x=38` — the filament inlet — and its nozzle is
a triangle at `y=133..138` pointing down. A diagram that puts the ACE *below* the
toolheads draws filament climbing into a nozzle. Bambu's own display puts the cabinet
above and the nozzle at the bottom for the same reason.

That is the one thing the earlier study's **P1**
([camera-layout-ace-mockup.html](camera-layout-ace-mockup.html), part 03) got backwards,
and it was invisible until the real artwork replaced a placeholder rectangle. Everything
else about P1 is sound; the chosen design is P1 turned over.

**A bay is drawn as a head.** The page already has one way to say *some filament, this
colour, called this*: a 36 px disc that falls back to an 8 px checkerboard when empty,
over a `#6E6E6E` pill holding the material name. A bay is the same statement about the
same substance at the other end of one tube, so it is the same drawing. Not Orca's
`AMSLib` tube — that is the standard for the **C++** surfaces in
[16-ace-visuals.md](../../ace-mmu/16-ace-visuals.md), and it would be a fifth language on
a page that already has one. It also assumes a fill level, and there is none: see below.

## The fork every shape is an answer to

`ACE_SET_HEAD_ACE` binds a head to one unit and says nothing about the reverse, so **one
unit may feed several heads**. That splits the shapes in two:

- **Head-major** — a group per toolhead, Bambu's layout repeated. A shared unit is drawn
  **once per head it feeds**, with as many humidity readings as copies, all of which have
  to agree. With one unit and four heads — the cheapest setup anyone will own — that is
  four drawings of one cabinet.
- **Unit-major** — a box per unit, drawn once, sprouting a wire per head. Nothing is
  duplicated; the cost is that the wires have to get somewhere.

## The six, and what each measures

Body heights in WebKitGTK, against the 456 the panel has.

| | shape | body | |
|---|---|---|---|
| **F0** | Today: four slots, no ACE | 272 | Ships now. Says nothing about an ACE |
| **F1** | Four lanes — Bambu's group per toolhead, flexing to its source | 403 | **Rejected.** A shared unit is drawn twice; and the lane cannot flex, because a feeder lane's min-content is the 102 px source switch. It sits at 115 where its share is 109, so the ACE lane gets 416 not 434. A *second* ACE lane would get 265 and a unit needs 298 |
| **F2** | Two by two — Bambu's two-group frame, wrapped | 686 | **Rejected on height** — 230 over. *Narrowed later:* the rejection holds for this arrangement, not for the idea. See below |
| **F3** | Heads over units — the earlier P1, in the real artwork | 391 | **Rejected.** The wire climbs into the nozzle |
| **F4** | **The bus** — sources above, merge bar, four heads below | **395** | **Chosen.** 61 px spare |
| **F5** | The spine — heads on a vertical trunk, sources beside it | 282 | **Rejected.** Four 140 px toolheads stacked is 560, so it gives the artwork up and draws a 30 px disc instead — solving a layout problem by leaving the design language |
| **F6** | The ledger — four rows and a source rack, no wires | 312 | **Kept**, as F4's dense form |

### F4, in one paragraph

The unit box on top, Bambu's merge bar with its grey nub beneath the bays, and the four
toolheads in one row under it, each wire landing on the inlet the artwork already draws.
An available bay drops to the bar in **grey**; the bay the head is actually loaded from is
drawn in **its own colour**, from `head_source[n]`. A head on a stock feeder has no wire
at all, which is true — its spool is at the head and the ACE never touches it. The bay's
address (`A1`…`D4`, Bambu's scheme) sits **inside its disc**, the way a toolhead's number
already sits inside its own; that is a departure from Bambu, and it is what buys the
20 px a second unit needs.

### F4 and F6 are one design at two densities

That is the finding, and it is what stops the panel choosing between drawing the routing
and surviving four units.

| units | body | what is drawn |
|---|---|---|
| 0 | 229 | The head row and its switches, no bus. Also the degradation path if `ace` stops answering |
| 1 | 395 | The full picture |
| 2 | 445 | One unit open, one collapsed to a 42 px row. **A collapsed unit draws no wire** — collapsing it is giving up its picture, and the head it feeds still names the bay |
| 3–4 | 435 | Folds to the rack: every unit one line, every head naming its bay. Opening one swaps its line back for the box |

A fifth state, **ND**, is the dryer running: `dryer_status` gives target, duration and
remaining, so the pill counts down, and every source switch goes inert **with the dryer
named as the reason** rather than the mode. The routing is untouched — what is in a head
is still in it. The Normal-mode state is unchanged from part 03 of the earlier study.

A unit box is **130** and a row is **42**, so four open boxes plus the bus and the head row
would be **815** against 456. The fold is not a preference. It is also the move Storage
already made, and the reason the unit box is a component from the first commit.

## The follow-on: a subpanel per toolhead

[multiace-f2-iterations.html](multiace-f2-iterations.html) re-opened F2, because the
rejection was of **one arrangement** and the idea underneath it — every toolhead gets its
own card, and that card's header chooses what feeds it — is a good one. Four
rearrangements, all of them running from a state object:

| | arrangement | body | |
|---|---|---|---|
| **I1** | **Bands** — four full-width cards, header turned ninety degrees into a 292 px left column | **417** | **Build this** |
| **I2** | Side by side — 2×2, toolhead *beside* the bays at **full scale** | 427 | The alternative, if the artwork is judged to carry weight at 1.0 |
| **I3** | Half-scale head — 2×2, Bambu's order, artwork at 0.5 | 421 | Fits |
| **I4** | Full-scale head — the arrangement the first study drew | 561 | Still over, by 105 |

Three findings, all of them from building it rather than drawing it:

- **The heights do not move.** 417 / 427 / 421 / 561 are the measurements at **zero, one,
  two and four** units, and at every source combination including all four toolheads on
  one unit. A subpanel is the same height whether its source is one spool or four bays, so
  the panel does not resize when you change what feeds a head — which on an
  `overflow: hidden` body is the difference between a layout and one that clips later.
- **It never folds.** Four units is **16 bays**, drawn in the same 417 px as none, because
  a subpanel shows only *its own* source. F4 has to collapse to a rack at three units
  because it draws every unit whether or not the head you are looking at can reach it.
  Head-major pays for *sharing*; unit-major pays for *counting* — and four units on a
  four-head machine is the common shape, so head-major pays in the cheaper currency.
- **The duplication objection was half wrong.** "A shared unit is drawn once per head,
  with as many humidity readings as copies, all of which have to agree" is an objection to
  *drawing*. Four copies bound to one state object cannot disagree. What survives is the
  reading risk — four cabinets where there is one — and that is answered where it happens:
  a dashed card edge and a `⇄` in the unit's own pill, with the sentence in its title.

**The source selector is what makes any of this possible.** The first study gave each head
a `feeder / ACE / manual` icon triple: 102 px wide, and unable to name *which* ACE. With
four units the question has six answers, so it is a list — 24 px, and it is `shell.js`'s
existing `pill` header kind.

**Sync is the tier-1 / tier-2 boundary turned into a button.** It sets every source from
`head_manual` → `head_feeder` → `head_ace`, and fills the bay identities that the Klipper
object does not carry. Before it runs, an occupied-but-unnamed bay is drawn as a solid
neutral disc with `?` — never the 8 px checkerboard, which is the shipped page's word for
*empty*.

**Keep F4 as a second view, not a rival.** A per-toolhead panel cannot say "one cabinet,
feeding these three heads" in one picture, and when a unit *is* shared that is the sentence
someone opened the panel to read. It belongs behind the header's overflow as *Show
routing*.

## The card: the toolhead stops carrying filament

[multiace-toolhead-card.html](multiace-toolhead-card.html). The subpanel header is settled;
this is what goes under it, and one decision drives the rest.

**No colour, no material name, no pencil on the artwork.** Filament belongs to the
*source*. The head's copy of it was the one that could go stale, and with four bays visible
it added nothing the tube did not already say. What the head does have of its own is a
**sensor marker**, and the printer reports that properly: `filament_feed left|right` →
`extruder0..3` gives four positions along the path plus a fault — `filament_in_ace`,
`filament_in_toolhead`, `filament_at_extruder`, `channel_error` — already parsed in
`state.js`'s `feedChannels()` and shown, until now, nowhere but a dialog.

### I3 or I4 — the answer is neither, quite

| frame | S1 disc | S2 reel | S3 card | S4 well | |
|---|---|---|---|---|---|
| Head below, **0.45** | 467 | 487 | 463 | 499 | 7–43 over |
| Head below, **0.40** | 431 | 443 | **427** | 427 | **13–29 spare** |
| Head below, **full** (I4) | 599 | 611 | 595 | 595 | **139–155 over** |
| Head **beside**, full | 417 | 417 | 417 | 417 | **39 spare** |

**I4 is not available and the number is not close.** Two rows of a 140 px toolhead with a
box above each is 595–611 against 456, and nothing in the card can pay that back — the
whole box, its bays and its tube together are 84 px. So the choice is between Bambu's
vertical order at a **0.40** head, and a **full-scale** head with the box beside it.

Only the frame costs height. The box is 427 / 425 / 425 / 389 for cabinet / tray / rail /
none; the four tube routings are all 427; the three markers are all 427.

### What to take

| axis | take | runner-up |
|---|---|---|
| **Frame** | Head below at **0.40** — Bambu's order, tube straight down into the inlet | Head beside at full, if the artwork is judged to carry weight at 1.0 |
| **Filament** | **S3 slot card** — the material name sits *inside* the colour, so a bay is one object rather than a drawing with a label under it | **S4 well**, the only one that says the amount is unknown rather than implying full |
| **Box** | **B1 cabinet** — the base drawn wider than the body is what makes it read as furniture, and the geometry is lifted from [16-ace-visuals.md](../../ace-mmu/16-ace-visuals.md) rather than invented | **B2 tray**, 2 px cheaper, introduces no new material |
| **Tube** | **W3 manifold** — tubing, not a line: a `#C9C9C9` casing with the filament's colour as a **core**. The casing is always there and the core only where there is filament, which settles wired-versus-loaded without a second colour | **W2 tubing**, direct, no merge |
| **Marker** | **M1 dot** — four real states in 11 px | **M2 chip**, the only one that survives greyscale |

**Worth arguing about:** at 0.40 the toolhead is 26×56, a small grey silhouette carrying
one dot. Now that it holds no colour and no name, it is fair to ask what it is doing. Two
answers, both real: it is where the tube *lands*, so removing it removes the diagram; and
it is the only part of the card that is the machine rather than the filament. If neither
convinces, take the head-beside frame.

### The card, settled

[multiace-cabinet.html](multiace-cabinet.html) is where the card is decided. What is fixed:

| | |
|---|---|
| **Frame** | Head below the box at **0.50**, 32×70, everything on the card's centre line |
| **Bay** | **The shipped one** — `.slot`'s own 36 px disc over its 58×19 name pill, not a shrunken copy |
| **Seam** | **Through the roll**, as a hard colour stop: half of every spool in each half |
| **Greys** | `#EEEEEE` over `#CECECE` — Orca's own `AMS_CONTROL_DEF_BLOCK_BK_COLOUR` and `AMS_CONTROL_DISABLE_COLOUR` |
| **Manifold** | **Below** the cabinet, so the tube layer paints behind it |
| **Marker** | A dot, **centred on the artwork's body** — `extruderBackground.svg` draws that body `y=17.4..127.6` of its 64×140, so its middle is `(32, 72.5)`, at whatever scale |
| **Feeder** | Bare, and at an ACE bay's exact height |
| *open* | how tightly the box hugs its spools, how much room the chip gets under the roll, and what shape the socket is |

**Two halves, and each half has a job.** Spools above, materials named below. **Splitting
the bay across the halves is what made the shipped bay affordable** — with both in the
upper half the cabinet was 71 px and a bay had to be 26/52; with the chip below, the box is
61 and 36/58 fits with room over. A bay and a toolhead are now the same drawing at the same
size, which was the point of drawing a bay as a head.

**The box hugs its spools**: 294 px around 278 of bays, centred in a 371 px card. That is
the change that makes the cabinet an *object sitting in the card* rather than the card's own
ground — at four bays, full width was mostly empty grey. All four fits cost the same 434, so
it is decided purely on reading; room under the roll costs 6 px of body per 3 px of gap, and
**9 px** is where the roll and its label read as two things rather than one stacked object.

**Faults the checks caught and no screenshot would have.** Across this study: an
`align-items: flex-start` inherited from the previous file left every card silently
left-aligned; an option named `0.45` produced the selector `.sb-head-0.45`, which CSS parses
as `.sb-head-0` plus an invalid `.45` — invalidating the **whole comma-joined rule list**
and taking every pre-rendered copy down while the live panel looked perfect; a feeder glyph
placed *in* its row centred the row rather than the spool and bent three tubes out of true;
a text replacement that did not match left the feeder being built by the previous version of
its own function, rendering a 5×19 bay with no sizes; D6's overhang was applied to the
cabinet but not the feeder, dropping every feeder spool half a disc below its neighbours;
and finally the shoulder fit changed *vertical* padding along with horizontal, and the
whole-bay socket padded the bay, each moving the ACE's spools and not the feeder's.

Every one of those is a position, and every one was found by subtracting two numbers rather
than by looking. Fallback rules are written one per line; fit is a horizontal decision only;
and the feeder wears whatever the bay wears.

## Two traps carried over, both still true

**`head_ace` is not the answer to "what feeds this head".** The live machine reports
`head_ace {0:0, 1:1, 2:2, 3:0}` with `device_count: 1` — heads 2 and 3 name ACE 2 and
ACE 3, which do not exist. Resolve `head_manual` first, then `head_feeder`, and
`head_ace` only for what is left. Same bug class as `toolhead.extruder` naming a parked
head.

**No bay has a level.** `spool_mode` is `spoolman` and `spool_binding` is `{}`, so nothing
is bound and no bay has a weight behind it. The disc is a colour, not a gauge. Anything
that draws a fill height here is drawing a number the machine did not give it.

## What can be built now

`ace` is a Klipper object and `sw_GetMachineState {objects:{ace:null}}` answers in
**277 ms** — no new bridge command. That covers topology, unit health, humidity and
temperature, the dryer, occupancy, and the full identity of what is *loaded* in each head.

What it cannot do is name the filament in an **unloaded** bay: every raw slot reads
`{material:"", brand:"", rfid:0}`, and `/multiace/api/state` — which has it — is
CORS-refused. So the panel draws an occupied-but-unidentified bay as exactly that, and
tier 2 fills in pills which already exist.

> **Corrected against hardware, 2026-08-26.** Tier 2 does *not* need an `sw_` proxy. The
> machine has `ACE_SPOOL_ASSIGN ACE=n SLOT=n [ID=n]` and a local spool table in
> `ace.spools` — 19 entries, each with material, vendor, colour, weight and SKU — so a
> bay is named with one macro the page can already send. What is missing is the bay's own
> sheet, not a piece of C++. See
> [11-multiace-handover.md](11-multiace-handover.md).

Every control is a documented G-code macro and the page already owns `sw_SendGCodes`; the
full table is in the study. Two rules apply without amendment: the settings that are set
once live behind the header's overflow, not on the face of the panel; and **an instant
`ok` is indistinguishable from success** — `ACE_BG_UNLOAD`'s own help says ~3 min — so
nothing is awaited and everything is confirmed against machine state through
[`core/pending.js`](../../../resources/web/device_page/js/core/pending.js).

The `[EXPERIMENTAL]` macros (`ACE_BG_SWAP`, `ACE_BG_UNLOAD`, `ACE_BG_MOVE`) carry
preconditions in their own help — *requires head mode, 1:1 wiring, an OPEN dock below the
head (purges ~60 mm!)*. They stay out of v1 and go in `check_coverage.py`'s `EXCLUDED`
list with that reason, so "not built" stays visible.

## Build order

**Steps 1-5 are built** (`resources/web/device_page/js/views/device-control/filament/`);
step 6 is tier 2, which needs a bay sheet rather than the C++ it was written down as
needing. The list is kept as written, because what each step *was*
is the record of why the panel is shaped the way it is — and step 4 is the one that turned
out not to be needed, since a head-major panel never folds.

1. **Four toolhead subpanels**, each with a header carrying its name and a **source
   selector** resolved `head_manual` → `head_feeder` → `head_ace` *in that order*, and the
   ACE-mode pill in the panel header. With no ACE attached this is today's row plus a
   selector, and it is worth shipping alone.
2. **The unit box** — the ACE cabinet with its four bays drawn as slot cards, and the
   humidity pill in the subpanel header.
3. **The tube** — casing plus core, merged at a manifold, landing on the artwork's inlet;
   and the head's sensor marker from `feedChannels()`.
4. **The collapsed row and the rack** — states **N2** and **N4**.
5. **The sheets** — load, unload, swap, dry, and the overflow's settings list.
6. **Tier 2** — naming an unloaded bay. Written down as an `sw_` proxy for
   `/multiace/api/state`; measured as `ACE_SPOOL_ASSIGN` plus a bay sheet.

## Checking it

```bash
python3 docs/u1-webui/tools/check_mockup.py docs/u1-webui/02-device-page/multiace-filament-mockup.html
python3 docs/u1-webui/tools/check_mockup.py docs/u1-webui/02-device-page/multiace-f2-iterations.html
python3 resources/web/shared/tests/run_webkit.py --size 1920x1080
```

The second one **drives** its study rather than reading it: every arrangement at every
unit count, every source combination, the wire endpoints, that no subpanel header overflows
its cell, and then the whole no-script path with `.js-on` removed. Four real faults turned
up that way — a band header that grew a third row once four toolheads shared a unit and
went 17 px over, a source list whose longest option pushed the header past its cell, a
humidity pill that could not coexist with a spelled-out shared tag in 391 px, and an
`<option selected>` that lived in the DOM and vanished from the serialised copy, because
`selected` is not a reflected attribute.

### A mockup that renders itself is a mockup that can arrive empty

The interactive study first shipped drawing *everything* from its state object, and it
arrived **blank**: the viewer stripped its script tags, and `<noscript>` never fired —
because a **removed** tag is not the same as scripting being **disabled**, and only the
second makes a `noscript` block render. The two static siblings were written under exactly
that lesson and it still had to be re-learnt.

The fix is progressive enhancement with a build step:

- **16 pre-rendered copies** — every arrangement at every unit count, written into the file
  as static markup and switched with radio inputs and the sibling combinator. Script sets
  `.js-on`, which swaps them for the live panel.
- **[`tools/bake_mockup.py`](../tools/bake_mockup.py)** re-renders them in WebKitGTK. Run
  it after any change to the mockup's JavaScript or panel CSS.
- **`check_mockup.py` fails if a copy has gone stale**, so a forgotten bake is caught
  rather than shipped — and it fails on any script-looking string outside a real script
  tag, because one of those in a CSS comment let a regex sanitiser swallow all sixteen
  copies the first time they were baked.

```bash
python3 docs/u1-webui/tools/bake_mockup.py docs/u1-webui/02-device-page/multiace-f2-iterations.html
python3 docs/u1-webui/tools/bake_mockup.py docs/u1-webui/02-device-page/multiace-toolhead-card.html
python3 docs/u1-webui/tools/bake_mockup.py docs/u1-webui/02-device-page/multiace-cabinet.html
```

`check_mockup.py` dispatches on the file's basename now; a mockup with no `CHECKS` entry
is an error rather than a silent pass, because the checks are keyed to one file's ids.

**The wires are checked by arithmetic, not by looking.** `--shots` writes blank PNGs
here — EGL finds no driver under WSL — so each coloured path is asked for its endpoints
with `getPointAtLength` and `getScreenCTM`, and those are compared with the centre of the
bay it claims to leave and the toolhead it claims to enter. That check has already earned
its keep three times: the coordinates were 2 px out because the body is 790 px of content
and not the 788 the arithmetic assumed (the card has no border); `.slot`'s
`flex: 0 0 64px` set a flex-*basis* on a column's main axis and silently collapsed the
140 px artwork to 64; and two claims in the prose — the F1 lane width and the F2 bay
count — were simply wrong and were caught by the checker rather than by review.
