# The ACE visual standard

Interactive sheet: [ace-visual-standard.html](ace-visual-standard.html)

An ACE was drawn four different ways. The device page gave it 60 px circular spools; the
assignment dialog 96 px cards in a teal-banded box; the printer panel 7×15 px bars; and
the filament-mapping popup — which reads the ACE through `amsList` — **Orca's real AMS
widgets**. Four languages for one object.

That last one is the way out. The ACE is already projected onto `Ams`/`AmsTray`, so the
AMS widgets are the standard, and **the geometry below is lifted from
`src/slic3r/GUI/Widgets/AMSItem.hpp` rather than invented** — which is what stops it
drifting again.

## The three forms

One treatment — **outlined chassis, solid bays, one stroke weight** — in three
proportions. Four bays is not a variable: `/api/state` returns `"slots": [/* exactly 4 */]`
and `SLOT_COUNT = 4` is a constant. There is no single-bay form; an AMS Lite has one
spool, an ACE never does.

| Form | Size | Where | Function |
|------|------|-------|----------|
| **Badge** | 44×26 fill | a head box | `ace_badge()` · JS `aceBadge()` |
| **Glyph** | 44×26 line, stroke 1.6 | a popover row, a label | `ace_glyph()` · JS `aceGlyph()` |
| *the two above are **G** and **O5**: one rounded body, 4 px of margin all round, spools 6×16 on a pitch of 10 at x 4/14/24/34* ||||
| **Glyph, square** | 24×24 line, stroke 1.6 | a tab, a menu, a `ScalableButton` | `ace_glyph_square()` · JS `aceGlyphSquare()` |

The JS half is [`resources/web/shared/js/multiACE.js`](../../resources/web/shared/js/multiACE.js),
where the geometry is `ACE_ART` and the three builders sit beside it. The Device page's
Filament panel draws all three: the badge in each unit row, the square in a menu row, the
wide glyph beside a label.

**The sizes are nominal, and the builders take a zoom** — the wide forms are 44×26 *at
z = 1*. That matters where a slot is smaller than the drawing: the Device page's unit row
is 17 px, because that panel's body is 456 and measured, so its badge is the same drawing
at `17/26`. A zoom is not a second set of proportions; redrawing it would have been.

**The badge is G and the outline is O5.** A and O2 stay on the sheet as what they are
corrections of; the sheet opens on the new pair and every specimen on it follows.

**F** is the same badge with its two halves the *same* width — one rounded rectangle split
by a colour stop, with no inset hood. That is the silhouette the Device page's own cabinet
actually has (`.ace-cab-top`, radius 9, `#EEEEEE` over `#CECECE`, sides parallel), so a
badge meant to be a portrait of it arguably should not narrow its top.

**G** finishes the thought. A and F both draw the base *over* the bays, which crops their
lower 2.5 px; G draws the spools **last**, so a spool is a whole spool. That exposes an
unequal margin — 6 px at the sides against 3.5 at the top — so it is made **one number on
all four sides: 4 px**, which is the gap's own number and the proportion A already states
(*padding 4 == gap 4*). The badge stays 44×26 and its body stays 24 tall, so the margin
comes out of the spools: **5×13 becomes 6×16**, on a pitch of 10 at x 4/14/24/34.

**O5 · Flush, solid bays** is G's outlined twin — O2's treatment on G's body. The other
four outlines all wear `CAB`, which is A's stepped silhouette; if the badge stops stepping
then its twin has to stop too, or the pair say two different things about one object.

`check_mockup.py` holds each one's geometry — G's margin as `4,4,4,4` computed from the
rendered rects, its spools as 6×16, its body height as unchanged at 24, its draw order by
document position, and O5's bays as byte-identical to G's.

**The implementation has followed.** `ACE_ART.badge` and `ACE_ART.glyph` in
[`shared/js/multiACE.js`](../../resources/web/shared/js/multiACE.js) are G and O5 now, so
the Device page's Filament panel draws the new pair — the unit-row badge at 17 px, the wide
glyph in the help dialog. `aceGlyphSquare()` is untouched: the square was S4 before and is
S4 still. It was one edit in one place, because the drawing has one home.

`run_webkit.py` holds the panel to it: the badge must be one body the full width, split by
a colour stop rather than a second box, with the spools drawn **over both** and 6×16 on a
4 px margin. The old assertion — *its base is drawn wider than its hood* — was the thing
that had to change, and it is the only line that did.

**Badge (G)** — one rounded body, 44×24 inside the 44×26 box, split by a hard colour stop
at y 16, with the four spools drawn **last** so none is cropped. Bays are 6×16 capsules at
x 4/14/24/34 — **margin 4 = gap 4** on all four sides, which is Bambu's own proportion and
the thing A states. Colour and emptiness are all that survive at this size, so the badge
carries colour only — *not* a level, even where Spoolman has bound one; an empty bay is
white against the grey body, with no outline. Trust and staleness live wherever the badge
is a control.

*A, the starting point, put a narrower hood over a wider base and drew that base over the
bays, cropping their lower 2.5 px. G is that drawing corrected against the cabinet it is a
portrait of: the cabinet has parallel sides and whole spools, so its badge should too.*

**Glyph (O5)** — the badge's own silhouette in line: G's body as one rounded rectangle
inset by half a stroke, with G's own bays filled. *O2 drew A's stepped path; when the badge
stopped stepping the glyph had to stop too, or the pair say two different things about one
object.*

**Glyph, square** — body and four bays, no hood or base step. It is deliberately *not*
the same silhouette: the family is carried by the bay treatment and the stroke, because
the square has a third of the width to say the same thing in. If the two ever sit side by
side and the mismatch shows, the fallback is the wide drawing letterboxed into the square.

## The third box, and the one in use

The three forms are icons; they stand for an ACE where there is no room to draw one.
**Section 3 of the sheet carries the drawings themselves** — beside the AMS strip and the
AMS unit box, because they are three boxes for the same four spools and the third is the
one the Device page draws today. At its own size, with `device.css`'s own numbers, so the
two cannot drift without something failing:

| | | |
|---|---|---|
| **The ACE cabinet** | 310×71 | `#EEEEEE` over `#CECECE`, seam through the roll at `5px + --disc/2`, 16 px of shoulder either side |
| **The stock feeder** | 94×71 | the same drawing in `#FFFFFF` over `#1F1F1F`, one bay instead of four |
| **The feeder badge** | 17×17 | 24×24 nominal — the frame at badge size, square, because a wide badge for it read as a squashed ACE |
| **The toolhead** | 64×140, and 32×70 | `extruderBackground.svg`, with the sensor marker on the artwork's **body** at (32, 72.5) rather than on its box |

**When Spoolman is bound, a bay can say how much is left.** An ACE slot has no
`material_remain`, which is why a disc is a colour and not a gauge — but that holds only
while nothing is bound. With `spool_mode: "spoolman"` and `spool_binding` mapping the slot
to a Spoolman id there *is* a weight, and then the disc follows the rule the AMS column
already follows: **the filament colour from the bottom up to what is left**, with the grams
on the bay. One drawing with two states rather than two drawings. **Unmeasured is hatched
rather than empty**, because *unmeasured* and *used up* are different things and a bar at
zero says the second one. The badge does not follow: at 6×16 a level is not readable, and
colour and emptiness are all it claims to carry.

**310 is not a choice, it is arithmetic.** A bay is `.slot`'s own — a 36 px disc over a
58×19 name pill, 6 px apart — in a 62 px column at `flex: 0 0`, with 10 px gaps; four of
those plus the shoulders is 310 px at every panel width there is. What that costs is
measured in
[the actions study](../u1-webui/02-device-page/multiace-actions.html): the card needs a
330 px cell, and below a 655 px panel a bay is cut.

```bash
python3 docs/u1-webui/tools/check_mockup.py docs/ace-mmu/ace-visual-standard.html   # 55
```

## The box the spools sit in

Orca's AMS already owns the neutrals, and uses them for exactly these roles:

- `AMS_CONTROL_DEF_BLOCK_BK_COLOUR` **#EEEEEE** — the band, and an empty tube
- `AMS_CONTROL_DEF_LIB_BK_COLOUR` **#F8F8F8** — the box the tubes stand in
- `AMS_CONTROL_BRAND_COLOUR` **#009688** — hover, 2 px
- `AMS_CONTROL_DISABLE_COLOUR` **#CECECE** — a unit configured but not answering

All go through `StateColor::darkModeColorFor`, so dark mode is not a second palette.

**The spool object is `AMSLib`** — 58×80 (`AMS_CAN_LIB_SIZE`), a well inset by 4, the
filament colour drawn **from the bottom up to how much is left**. Not a swatch on a card:
a level in a tube, so a row reads as an inventory. Selection is 2 px in *the filament's
own colour* (`AMSLib`'s rule); hover is the brand teal. Label ink follows the fill's
luminance, the same `< 0.6` test `AMSLib` uses for its badge.

## Moisture and temperature

`AMSHumidity`, unchanged: a pill (radius = half the height) on `#EEEEEE`, the
`hum_level1..5` droplet at 16 px, a 1 px `#C2C2C2` divider, then the dryer glyph
(`ams_drying` / `ams_is_drying`). `AMS_HUMIDITY_SIZE` 93×26 with a percentage,
`AMS_HUMIDITY_NO_PERCENT_SIZE` 60×26 without.

`AMSinfo` already handles the ACE's exact case: `humidity_raw = -1` selects the numbered
droplet, anything else the plain droplet plus the number. Bucket the raw percentage
1 = ≤20, 2 = ≤35, 3 = ≤50, 4 = ≤65, 5 = >65 to pick the glyph.

**Temperature is the one addition.** The AMS carries `current_temperature` but never
draws it here; the ACE reports `temp` per unit and it matters while drying. It goes in
the same pill behind a second divider — one chip, not three. Absent when unreported,
never zeroed.

## Where a level comes from

An ACE slot has **no remain field**: `/api/state`'s `slots[]` carries material, brand,
colour and source, and nothing about quantity. But a Spoolman-backed printer binds them:

```jsonc
"spool_mode": "spoolman",
"spool_binding": { "0_0": "15", "0_1": "10", "0_3": "16" },
"spools": { "15": { "weight_g": 500.1, "used_mm": 0.0, "density": 1.27, ... } }
```

So bound slots can drive the column honestly, and an unbound one is drawn full but
hatched and labelled *amount unknown* rather than pretending to be full.

**What is not available is a percentage.** Spoolman knows the initial weight; this
payload does not, so a column scaled to 1 kg would call an 843 g spool 84% when it may be
a full 850 g one. Show the grams and treat the column as a gauge — or fetch
`remaining_weight` from Spoolman directly and scale it properly, which is its own piece
of work. `AceSlot` parses none of the binding today; wiring it through is the
prerequisite for the column meaning anything.

## Adoption

| Surface | Draws now | Becomes |
|---------|-----------|---------|
| Filament mapping popup (`AmsMappingPopup.cpp`) | Orca's AMS widgets, via the `amsList` projection | **Nothing** — it is already the standard, and the reference |
| Device / AMS tab (`AMSControl`, `AmsItem`) | Orca's AMS widgets, fed by the projection | **Nothing**, beyond naming the unit *ACE 2 Pro* rather than *AMS* |
| Printer panel (`Plater.cpp` sidebar) | 7×15 px bars in an ad-hoc strip | **Badge** in the head box |
| Assignment dialog (`resources/web/aceplan`) | 96 px `.pos` cards in a teal `.acebox` | **Spool box** + `AMSLib` columns; keep the drag targets |
| U1 + multiACE page (`resources/web/multiace`) | 60 px circular spools; 36 px circular swatches | **Spool box** + `AMSLib` columns. The circles are the biggest departure and the one worth losing — nothing else in Orca draws filament round |
| Rebuilt Device page (`resources/web/device_page`) | **Done, 2026-08-26.** All three forms, from `shared/js/multiACE.js` | — |

**Note on `AMSPreview`.** The 82×27 strip of 14×14 cubes is real, shipping code, but it
has only two call sites — `AMSControl.cpp:1173` (the unit selector) and
`CalibrationWizardPresetPage.cpp:617`. `AMS_ITEM_CUBE_SIZE` appears nowhere else: the
cube is internal to that widget and is never drawn alone. It is documented here so the
two native surfaces are not diverged from, not as a form to build with.

**One arithmetic snag** if `AMSPreview` is ever reused: padding 7 plus four 14 px cubes
plus three 5 px gaps is 85, not the 82 the constant states. Callers size the preview
themselves today. Fix it once rather than per surface.
