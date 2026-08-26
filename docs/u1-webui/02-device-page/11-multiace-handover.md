# multiACE on the Device page — handover

**Read this first.** It says what is decided, what is drawn, what is built (nothing yet),
and what will bite you.

Design record: [10-multiace-filament.md](10-multiace-filament.md) · Status:
[../STATUS.md](../STATUS.md)

---

## Where this stopped

**Design complete, no code written.** Five interactive studies in this directory hold every
decision, each one checked in WebKitGTK. Nothing in `resources/web/device_page/` has been
touched.

| study | answers | checks |
|---|---|---|
| [multiace-filament-mockup.html](multiace-filament-mockup.html) | Seven shapes for the panel; five machine states | 92 |
| [multiace-f2-iterations.html](multiace-f2-iterations.html) | Four arrangements of a per-toolhead subpanel | 74 |
| [multiace-toolhead-card.html](multiace-toolhead-card.html) | What goes under the header: filament, box, tube, marker | 81 |
| [multiace-cabinet.html](multiace-cabinet.html) | **The settled card**, and its five states | 104 |
| [camera-layout-ace-mockup.html](camera-layout-ace-mockup.html) | The earlier layout/camera study, incl. the first ACE pass | 94 |

```bash
for f in docs/u1-webui/02-device-page/*mockup*.html docs/u1-webui/02-device-page/multiace-*.html; do
  python3 docs/u1-webui/tools/check_mockup.py "$f"; done
```

---

## The design, in one table

Everything below is settled. `multiace-cabinet.html` is the drawing it is settled *as*.

| | |
|---|---|
| **Frame** | Four toolhead cards, 2×2, in the 830×456 Filament panel. Each has its own header |
| **Header** | Two lines — *Toolhead N* and its source selector above; the unit below: badge, `ACE A · ACE 2 Pro`, humidity pill, Dry chip |
| **Source** | A list, not an icon switch: *Default feeder · ACE A…D · Manual*. Resolve `head_manual` → `head_feeder` → `head_ace`, **in that order** |
| **Cabinet** | Two halves, `#EEEEEE` over `#CECECE` (Orca's own AMS neutrals). Seam **through the roll**, hard stop. Hugs its four spools with 16 px of shoulder |
| **Bay** | `.slot`'s own — 36 px disc over a 58×19 `#6E6E6E` name pill, 6 px apart. Nothing drawn round it at rest |
| **Feeder** | The same drawing in `#FFFFFF` over `#1F1F1F` — the U1's Automatic Filament Feeder Module. Its badge is that frame at badge size, square, 17 px |
| **Provenance** | Eye on the roll for an RFID tag (read only), pencil for typed or unnamed |
| **Pointer** | A 1.5 px `#0C63E2` edge round the roll and its chip, no fill. Nothing else — no metadata layer |
| **Head** | Below the box at **0.50** (32×70). Sensor dot centred on the artwork's body — `(32, 72.5)` of its 64×140 |
| **Tube** | Manifold **below** the cabinet, drawn **behind** it, vertical into the artwork's inlet |
| **Dryer** | Chip offers *Dry*, reports `1 h 19 m / 4 h`. Clicking it — and only that — opens the dialog |
| **Dialog** | Bambu's shape in `device.css`'s chrome: droplet filled to the reading, Humidity and Temperature, four presets **plus an empty field** per value, Start↔Stop, `ACE_SET_AUTO_DRY` |
| **Menus** | Two `⋯`: the panel's is the machine, a subpanel's is one toolhead. Each names its scope |

**Two numbers hold the whole thing up.** `--col-w` is **830** and `.filament-body` measures
**456** at 1920×1080 — measured, not estimated, with
`run_webkit.py --size 1920x1080`. `.panel-body` is `overflow: hidden`, so a body past 456
is **clipped in silence**. Every study asserts its own height against it.

---

## Build order

Off `develop/add-multiace-support`. Each step is useful alone.

1. **The subpanel and its source selector.** Four cards, two-line headers, the selector
   resolved in the right order, the ACE-mode pill in the panel header. No cabinet, no
   wires — this is the whole of the panel's behaviour with no ACE attached, and it ships.
2. **The cabinet.** Two halves, four bays drawn as heads, the badge, the humidity pill.
   Read from `sw_GetMachineState {objects:{ace:null}}` — **277 ms, no new bridge command**.
3. **The tube.** Manifold below, drawn behind, coloured from `head_source`. Plus the head's
   sensor dot from `feedChannels()`.
4. **The feeder and its module badge**, and the collapsed unit row for two or more units.
5. **The sheets and menus** — load / unload / swap, the dryer dialog, the panel overflow.
6. **Tier 2** — an `sw_` proxy for `/multiace/api/state`, so an unloaded bay can be named.

---

## What is true, and what is only drawn

**Measured on 811002511261022618B3, 2026-08-25:** one ACE 2 Pro (`protocol: "v2"`,
V1.1.26), `mode: "head"`, `device_count: 1`, 38 % RH at 31 °C, feeding Toolhead 4 from bay
3, four PETG spools. `head_feeder {0,1,2 true, 3 false}`. Every raw slot reads
`{material:"", brand:"", rfid:0}` and `spool_binding` is `{}`.

**Drawn but invented, and labelled so in the studies:** units B, C and D; any tagged spool
(the machine has none); the dryer running.

**Two claims that were wrong and are worth remembering:**

- **`head_ace` does not answer "what feeds this head".** It reads `{0:0, 1:1, 2:2, 3:0}`
  with `device_count: 1` — heads 2 and 3 name units that do not exist. Same bug class as
  `toolhead.extruder` naming a parked head.
- **"A running dryer refuses loads" was never true.** It entered as prose in a caption,
  was carried into three files and a dialog, and `/printer/gcode/help` says nothing of the
  kind. Removed everywhere; `check_mockup.py` now asserts the panel claims no such thing.

---

## Traps

**Every one of these was invisible on screen and obvious in a number.**

| trap | how it showed |
|---|---|
| `flex: 0 0 64px` on a column's main axis silently collapsed the 140 px toolhead to 64 | measured, not seen |
| `align-items: flex-start` inherited from a row layout left every card left-aligned | tube endpoints |
| `.sb-head-0.45` — a `.` in a class name — invalidated the **whole comma-joined rule list** | all pre-rendered copies vanished |
| `const DRY` declared twice threw, so the first script never defined `S` | page blank, functions present (they hoist) |
| `value` and `selected` are **not reflected attributes** | pre-rendered copies lost what the control held |
| A glyph placed *in* a row centred the row, not the spool | tubes no longer vertical |
| A view applied inside `render()` undid every keystroke | a typed value reset itself |
| **A `clipPath` id resolves document-wide**; two baked copies shared one and the second pointed into a `display:none` block | a droplet's fill drew as a bare rectangle |
| A string replace that matches nothing still returns a string | four separate patches "succeeded" and changed nothing |

**Habits that caught them:**

- **Assert after replacing.** Do not trust a print. Four patches reported success and did
  nothing.
- **Subtract two numbers.** Alignment, verticality and height are all differences; none of
  them is visible in a picture, and `--shots` writes blank PNGs here anyway (EGL finds no
  driver under WSL).
- **Bake, then assert the bake matches.** `check_mockup.py` fails if a pre-rendered copy no
  longer matches what the renderer produces, so a forgotten bake is caught.
- **A rig control that outlives its decision is a way to reach a state no user has.**
  Delete it when the axis closes.
- **An option that wins a comparison has not thereby earned a place in the design.** The
  amber droplet and the hover card both survived their comparison and had to be taken back
  out later.

---

## The tooling

```bash
# re-render a mockup's no-script copies (after ANY change to its JS or panel CSS)
python3 docs/u1-webui/tools/bake_mockup.py  docs/u1-webui/02-device-page/multiace-cabinet.html

# check one mockup: per-file checks, both themes, and the whole no-script path
python3 docs/u1-webui/tools/check_mockup.py docs/u1-webui/02-device-page/multiace-cabinet.html

# where 456 comes from
python3 resources/web/shared/tests/run_webkit.py --size 1920x1080
```

`check_mockup.py` dispatches on basename; a file with no `CHECKS` entry is an error rather
than a silent pass. `bake_mockup.py` does the same, and namespaces each copy's ids on the
way in.

**Each interactive study carries pre-rendered copies of every state**, because the first one
shipped rendering everything from script and arrived **blank** in a viewer that strips
script tags — and `<noscript>` does not fire for a *removed* tag, only for scripting being
*disabled*.
