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
| **Badge** | 44×26 fill | a head box | `ace_badge()` |
| **Glyph** | 44×26 line, stroke 1.6 | a popover row, a label | `ace_glyph()` |
| **Glyph, square** | 24×24 line, stroke 1.6 | a tab, a menu, a `ScalableButton` | `ace_glyph_square()` |

**Badge** — hood, four bays, base drawn *over* them; the base is slightly wider than the
hood, which is what makes it read as a cabinet rather than a bar chart. Bays are 5×14
capsules at x 6/15/24/33 — **padding 4 = gap 4**, matching the proportions of the reference's
own icon. Colour and emptiness are all that survive at this size, so the badge carries
colour only; an empty bay is white against the grey hood, with no outline. Trust and
staleness live wherever the badge is a control.

**Glyph** — the badge's own silhouette in line: one stepped path, hood shoulders on top,
base stepping out at the bottom, bays filled.

**Glyph, square** — body and four bays, no hood or base step. It is deliberately *not*
the same silhouette: the family is carried by the bay treatment and the stroke, because
the square has a third of the width to say the same thing in. If the two ever sit side by
side and the mismatch shows, the fallback is the wide drawing letterboxed into the square.

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

**Note on `AMSPreview`.** The 82×27 strip of 14×14 cubes is real, shipping code, but it
has only two call sites — `AMSControl.cpp:1173` (the unit selector) and
`CalibrationWizardPresetPage.cpp:617`. `AMS_ITEM_CUBE_SIZE` appears nowhere else: the
cube is internal to that widget and is never drawn alone. It is documented here so the
two native surfaces are not diverged from, not as a form to build with.

**One arithmetic snag** if `AMSPreview` is ever reused: padding 7 plus four 14 px cubes
plus three 5 px gaps is 85, not the 82 the constant states. Callers size the preview
themselves today. Fix it once rather than per surface.
