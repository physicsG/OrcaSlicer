# The U1 plate template

Interactive sheet: [plate-thumbnails-options.html](plate-thumbnails-options.html) ·
Used by: [15-printer-panel.md](15-printer-panel.md) (the plate card)

One silhouette, four plates, two ways of filling it. The same relationship
[16-ace-visuals.md](16-ace-visuals.md) has to the ACE: a shape that is fixed, so every
surface that draws a build plate draws the same object.

## The silhouette

**Measured, not traced.** A first attempt was drawn by eye from the product photos and was
wrong in every dimension — deep crenellations where the plate has small nicks. So the
product PNG was decoded to raw pixels (pure Python: `zlib` + manual unfiltering, no imaging
library needed), thresholded against the background, and the top and bottom edges sampled
column by column.

| Property | Measured |
|----------|----------|
| Plate | 391 × 413 px → **aspect 0.947**, slightly taller than wide |
| Top notches | three, centred at **x 26 / 50 / 74** |
| Notch size | ~**6 wide**, **2.9 deep** |
| Bottom tongue | **x 23 → 77.5**, protruding **2.9** below the side edges |
| Corner radius | **~2** |

All as percentages of the plate's own box: width 100, height 105.6. **Do not re-trace by
eye.**

## Drawing it: emphasised, deliberately

At 44 × 40 — the plate card's thumbnail — a 2.9 % notch is **just over one pixel**. Drawn
truthfully the U1 plate is a rounded square with three nicks nobody can resolve, and the
silhouette contributes nothing. Exaggerating is a normal icon convention, but it is a
decision, so it was taken explicitly rather than arrived at by sloppy tracing.

Four points along that axis were drawn and compared (*As measured*, *Emphasised*,
*Exaggerated*, *Plain*). **Emphasised** was chosen: the measured notches roughly doubled,
enough to register as a notched plate at a glance without reading as a different object.

```
platePath(notchDepth, notchHalfWidth, tongueDepth, cornerRadius)
  measured    (3.06, 3.0,  3.06, 2)
  emphasised  (5.5,  3.8,  4.2,  2)   ← chosen
```

The chosen path, in a `0 0 100 105.6` viewBox:

```
M2 0 H22.2 L26 5.50 L29.8 0 H46.2 L50 5.50 L53.8 0 H70.2 L74 5.50 L77.8 0
H98 A2 2 0 0 1 100 2 V99.40 A2 2 0 0 1 98 101.40
H79.5 L77 105.60 H23 L20.5 101.40 H2 A2 2 0 0 1 0 99.40 V2 A2 2 0 0 1 2 0 Z
```

**Aspect is preserved, never stretched.** The plate is taller than wide and the card slot
is 44 × 40, so the drawing letterboxes. Squashing it would change the notch proportions,
which is the one thing the silhouette exists to carry.

## Filling it

**Photograph Snapmaker's own plates. Draw everything else generically.**

The three plates Snapmaker sells for the U1 are first-party products for their bed types,
so a photograph is simply what the plate looks like. Anything else is drawn: the nearest
real product is somebody else's, and using it would brand a **bed type** — an abstract
setting — with a vendor the app never otherwise mentions. Whoever selects *Cool Steel
Plate* may own any plate, or none.

| Bed type | Enum | Fill | Source |
|----------|------|------|--------|
| Textured PEI Plate | `btPEI` | photo | Snapmaker product shot |
| Smooth PEI Plate | `btPTE` | photo | Snapmaker product shot |
| Graphic Effect Plate | `btGESP` | photo | Snapmaker product shot |
| Cool Steel Plate | `btSuperTack` | **drawn** | cool blue, soft sheen, no maker's marks |

That is the U1's whole default set. The advanced-mode plates
(`support_multi_bed_types`: Cool Plate, Engineering, Textured Cool) are out of scope; when
they arrive they are **drawn**, by the same rule.

**Sampling a photograph.** Take the middle of the flat product shot, zoomed ~150–195 % so
the crop lands inside the plate's surface, then clip to the silhouette. Never fit the whole
photo — the background and the plate's own edge would come with it, and the silhouette is
already doing that job. *Smooth PEI is matte black*, not amber; only Textured PEI is the
bronze people picture when they hear "PEI".

**Drawing a plate.** Paths and gradients only — icon SVGs go through **nanosvg**
(`BitmapCache.cpp:18`), which has no filters, no `<pattern>` and no CSS. A base gradient
plus one or two soft highlight sweeps is enough; do not invent surface detail that claims
to be a particular product.

## Sizes and formats

| Where | Size |
|-------|------|
| Plate card thumbnail | **44 × 40** |
| Plate picker cell | **40 × 36** |

Photographs ship as **PNG at 1× / 2×** — the sources are `.webp` and `.jpg`, which Orca's
icon path cannot read. Drawn plates ship as **SVG**.

## Two traps

**Key off the enum, never the label.** The same `BedType` is named differently per printer:
`btPTE` is *Smooth High Temp Plate* generically and *Smooth PEI Plate* on the U1;
`btSuperTack` is *Cool Plate (SuperTack)* generically and *Cool Steel Plate* on the U1.
Match on the label and the U1 shows a Bambu plate under a Snapmaker name.

**The card cannot be narrow without a picture.** Bambu's plate card is 92 px, so the label
clips to *Textur…* and the picture carries the identification. Without art, a 92 px card is
just clipped text — worse than the full-width `Bed type` row it replaces. Which is why the
row stays as it is until these exist.

## Open

**Licensing.** The three photographs are Snapmaker's, used here as design reference the way
`bambu_studio_inspiration/` holds Bambu's screenshots. Shipping them in an **AGPL-3.0**
repository needs permission. What can ship: ask Snapmaker, photograph the plates yourself,
or draw all four. The drawn cool plate has no such problem and is the model for anything
that has to be replaced — the silhouette and the sampling rules are unaffected either way,
so it is a swap of the fill, not a redesign.
