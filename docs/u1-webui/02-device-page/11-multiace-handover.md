# multiACE on the Device page — handover

**Read this first.** It says what is decided, what is drawn, what is built, and what will
bite you.

Design record: [10-multiace-filament.md](10-multiace-filament.md) · Status:
[../STATUS.md](../STATUS.md)

**What this integrates with.** Not "ACE support". **multiACE**
([decay71/multiACE](https://github.com/decay71/multiACE)) is a third-party Klipper plugin
someone chooses to **deploy onto** a U1, and everything this panel reads and sends belongs
to it: the `ace` Klipper object, the macros, the override store, the web service. A stock
U1 has none of them and gets the four filament slots the page always drew — which is not
a fallback bolted on, it is the state every printer without the plugin is in. The plugin
is pre-1.0 and versioned, so the integration carries what it was verified against rather
than assuming: **`0.99.8b+9ba137e1` on a U1 running 1.5.2, `api_version: 1`,
`ace_bg_swap v0.9`** — in `MULTIACE_VERIFIED`, and shown in the panel's own help.

**The ACE is drawn from the visual standard now, not from a shape of its own.**
[`docs/ace-mmu/16-ace-visuals.md`](../../ace-mmu/16-ace-visuals.md) settles three forms —
**badge** 44×26 fill, **glyph** 44×26 line, **glyph square** 24×24 line — lifted from
Orca's own `AMSItem.hpp` geometry, and the C++ Prepare page draws from the same sheet. An
ACE had been drawn four different ways across the app and this panel had quietly made it
five. All three are in the module now (`ACE_ART` plus the builders): the badge in each
unit row, the square in a menu row, the wide glyph beside a label. The sizes are nominal
and the builders take a **zoom**, which is what lets a 17 px unit row carry the same
drawing as a 26 px one — the row is 17 because the body is 456, and that number cannot
move.

**It is one module.** [`shared/js/multiACE.js`](../../../resources/web/shared/js/multiACE.js)
owns all of it — macro names and the line builder, the unit letters, the dryer presets and
limits, Orca's humidity buckets, the override-store URL, the state model, and the merge.
It is named for the plugin and not for the hardware because they are not the same thing.
`MachineState.ace()` is a call into it, `protocol.js` keeps only what is not multiACE's,
and the panel imports from it — so "where is this defined" has one answer. It was three
before, and that is how the panel came to read bay identity from a source that does not
carry it.

---

## Where this stands

**Built, and verified against the real ACE** on 2026-08-26 — 811002511261022618B3, one
ACE 2 Pro on firmware V1.1.26. Steps 1-5 of the build order below are in
`resources/web/device_page/`; step 6 turned out not to need the C++ it was waiting for
(see *Tier 2 was wrong*).

**Four things the machine disagreed with, and every one answered `ok` first.** They are
listed in full further down; the short version is that a macro accepting an argument
proves nothing, and neither does a field name that reads plausibly:

| guessed | measured |
|---|---|
| `ACE_DRY DURATION=` is hours | **minutes** — the dialog asked for 4 hours and would have dried for four minutes |
| `ACE_SET_AUTO_DRY THRESHOLD=` | **`ENABLE=0\|1 RH_START=%`** — `THRESHOLD=` returns `ok` and changes nothing |
| `ACED__DRY_STOP` | **`ACE_STOP_DRYING ACE=n`** — the first stops *the current* unit, not the one whose chip was pressed |
| `dryer_status {remaining}`, running word `running` | **`{status, target_temp, duration, remain_time}`**, seconds, and the running word is **`keeping`** |

| | where |
|---|---|
| **The whole multiACE surface** — macros, constants, the state model, the override merge | [`shared/js/multiACE.js`](../../../resources/web/shared/js/multiACE.js) |
| `MachineState.ace()`, which is a call into it | [`shared/js/state.js`](../../../resources/web/shared/js/state.js) |
| The panel: the card, the cabinet, the feeder, the tube, the dryer dialog, both menus | [`filament-view.js`](../../../resources/web/device_page/js/views/device-control/filament/filament-view.js) |
| Fifteen macros, none awaited, each confirmed against machine state | [`filament-commands.js`](../../../resources/web/device_page/js/views/device-control/filament/filament-commands.js) |
| The one-shot read, because `ace` is not on the subscription | `refreshAce()` in [`core/session.js`](../../../resources/web/device_page/js/core/session.js) |
| The `ace` object as the machine reports it, macros included | [`shared/js/mockhost.js`](../../../resources/web/shared/js/mockhost.js) |
| 14 geometric checks, 60 driven against the simulator, 26 against the printer | `run_webkit.py` · [`drive/ace-panel.js`](../../../resources/web/shared/tests/drive/ace-panel.js) · [`drive/ace-real.js`](../../../resources/web/shared/tests/drive/ace-real.js) |
| The macro surface as the machine reports it | [`tools/ace_macros.py`](../tools/ace_macros.py) → [`data/ace-macros.json`](../data/ace-macros.json) |
| The precedence rule, held to account as pure logic | `unit_jsc.py` — 9 checks, no DOM |

```bash
R=resources/web/shared/tests
python3 $R/run_webkit.py --size 1920x1080                      # 54, incl. the card's geometry
python3 $R/run_webkit.py --size 1920x1080 --drive $R/drive/ace-panel.js   # 60, simulator
python3 $R/run_webkit.py --real --size 1920x1080 --drive $R/drive/ace-real.js   # 26, printer
python3 $R/run_webkit.py --real --device-ip 192.0.2.1 --drive $R/drive/no-printer.js
python3 docs/u1-webui/tools/check_coverage.py                  # both surfaces
```

**`ace-real.js` is read-only, deliberately and permanently.** `ace-panel.js` switches
sources, loads bays and starts the dryer; every one of those is minutes of physical work
on a machine with filament in it, and a suite is not a thing that should be able to purge
a nozzle. The real-hardware script asks the printer what it has, dumps the raw object, and
checks the panel drew that. **`--real` needs Orca closed.**

**Screenshots are real again.** `--shots` used to write blank PNGs — no EGL driver under
WSL, so WebKit composited into a window `GdkPixbuf` read back empty. An unattended run
renders into a `Gtk.OffscreenWindow` with the compositor off, through cairo, on the CPU.
It is still the weaker half: the seam through a spool looked three pixels out and measured
exactly right.

Five interactive studies in this directory hold every decision, each one checked in
WebKitGTK.

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

**The card needs a 330 px cell, and the panel is not the first thing to run out.**
Measured, at 1100 and at 1000: the cabinet is 310 px wide and fits a card down to a
**1010 px window**, below which `.ace-card`'s `overflow: hidden` clips it. `.control-grid`
is 758 px fixed and is already clipped at **1100** (`#control-body: 770/722`), so the
Device page's horizontal floor is set by the Control panel and not by this one. Worth
knowing before shrinking anything: the ACE card would be the second thing to break, not
the first.

**Two numbers hold the whole thing up.** `--col-w` is **830** and `.filament-body` measures
**456** at 1920×1080 — measured, not estimated, with
`run_webkit.py --size 1920x1080`. `.panel-body` is `overflow: hidden`, so a body past 456
is **clipped in silence**. Every study asserts its own height against it.

---

## Build order

| | | |
|---|---|---|
| 1 | **The subpanel and its source selector** — four cards, two-line headers, the selector resolved in the right order, the ACE-mode pill in the panel header | built |
| 2 | **The cabinet** — two halves, four bays drawn as heads, the badge, the humidity pill, from `sw_GetMachineState {objects:{ace:null}}` (**277 ms, no new bridge command**) | built |
| 3 | **The tube** — manifold below, drawn behind, coloured from `head_source`; the head's sensor dot from `feedChannels()` | built |
| 4 | **The feeder and its module badge** | built |
| 5 | **The sheets and menus** — load / unload / swap, the dryer dialog, the panel overflow | built |
| 6 | **Tier 2** — naming an unloaded bay | **not built**, and it no longer needs the C++ it was waiting for: `ACE_SPOOL_ASSIGN` and `ace.spools` do it. See *Tier 2 was wrong* |

**The collapsed unit row is not in the list any more, because head-major does not need
one.** That was step 4 of the *unit-major* plan, where three units forces a fold to the
rack. A card shows only its own source, so four units is sixteen bays drawn in the same
height as none — asserted in `ace-panel.js`, not assumed.

### What changed on the way in, and why

- **No Sync pill.** The study's header had one beside the mode. On the page the refresh
  button already re-reads everything and now re-reads `ace` with it, so a second control
  saying the same thing was a second control saying the same thing. The half of Sync that
  was *not* refresh — filling in bay identities the Klipper object does not carry — is
  tier 2, and it is not built, so a button for it would be a promise.
- **The mode is a list, not a cycle.** The study's pill cycled `normal → multi → head`;
  that sends `SET_ACE_MODE` twice to get from the first to the last, and a mode change is
  not a thing to do twice by accident. `shell.js`'s `pill` kind grew a live `label` and an
  `enabled` so the pill can report the mode and go dead when there is no ACE.
- **Clicking a bay asks first.** The study left the bay's own sheet unbuilt. A swap is
  minutes of physical work that purges filament and the bays sit under the pointer while
  someone reads the card, so the click opens a confirmation that names the macro and its
  arguments. That is also where `Swap to another bay…` in the toolhead menu points.
- **`openMenu` marks its own anchor.** The document listener that closes a menu skips
  anything inside `[data-menu-anchor]`, and only the device selector had that attribute
  written on it by hand — so every menu added since would have opened and shut in the same
  tick. It is set in `openMenu` now.
- **The panel's menu is a gear, not a second `⋯`.** The design called for two `⋯` a few
  pixels apart, each naming its scope. Both menus still name their scope — that was the
  point — but the panel-level one is `settings.svg`, because the ambiguity the naming was
  compensating for is cheaper to just not create. A card's is still `⋯`.
- **`hm()` prints `4 h`, not `4 h 0 m`.** The dryer chip shares a 391 px cell with the
  unit's name, its model and a humidity pill, and those 26 px were the difference between
  `ACE 2 Pro` and `ACE 2 …`.

---

## What is true, and what is only drawn

**Measured on 811002511261022618B3, 2026-08-25:** one ACE 2 Pro (`protocol: "v2"`,
V1.1.26), `mode: "head"`, `device_count: 1`, 38 % RH at 31 °C, feeding Toolhead 4 from bay
3, four PETG spools. `head_feeder {0,1,2 true, 3 false}`. Every raw slot reads
`{material:"", brand:"", rfid:0}` and `spool_binding` is `{}`.

**Drawn but invented, and labelled so in the studies:** units B, C and D; a tagged spool
in an ACE *bay*; the dryer running.

**Corrected on 2026-08-26, when the panel was run against the machine:** the spools at
Toolheads 1 and 2 *are* RFID-tagged and the panel draws them with the eye, so that half of
the provenance mark is exercised by real data. What has no tag is every ACE **bay** —
`rfid: 0` on all four raw slots — which is a different question with a different source:
a head's tag comes from `filament_detect`, a bay's from the unit.

---

## What the machine said, 2026-08-26

The simulator is now a copy of the payload below, field for field, and `ace-real.js`
asserts each of these against the printer so a firmware that moves one fails loudly.

**The object is much bigger than the study knew.** 38 top-level keys, not the eight the
design was drawn from:

```
ace_head ace_heads aces active_device airprint_detection api_version auto_dry_masters
calibration calibration_unload confirm_commands device_count dryer_status event_seq
gate_status head_ace head_feeder head_manual head_reader_spool head_source head_tag_seen
last_swap_result mode pickup_cleaning purge_matrix quad_first quad_replenish
settings_volatile spool_binding spool_mode spoollink spoollink_agent spoolman_auto
spoolman_url spools status swap_in_progress swap_phase temp
```

| | |
|---|---|
| **A unit names itself** | `model: "ACE 2 Pro"`, `firmware: "V1.1.26"` — deriving the model from `protocol` was only ever the fallback |
| **Auto-dry is the unit's own object** | `{enabled, rh_start, rh_end, temp, master, add_time}` — not part of `dryer_status`, and `rh_start` is the humidity the panel calls *above* |
| **The dryer** | `{status, target_temp, duration, remain_time}`; `stop` idle and **`keeping`** running; **both times in seconds** |
| **The settings are readable** | `confirm_commands`, `spoolman_url`, `spoolman_auto`, `purge_matrix` are all reported. They were written as write-only on the assumption none of them was |
| **The flush length is not** | `purge_matrix` is a boolean about honouring the slicer's per-pair stamps; the length lives in the config. That one field really does set rather than show |
| **A raw slot is empty** | `{index, status:"unknown", sku:"", material:"", subtype:"", rfid:0, brand:"", color:[0,0,0]}` on all four, exactly as the study said |
| **`head_source` is null for a feeder head** | and carries `{ace_index, slot, type, subtype, color, brand}` for the ACE-fed one |

**How the four wrong guesses were settled.** Each is reversible and each was put back:

- **`ACE_SET_AUTO_DRY`** — sent `RH_START=50` with `enabled:false` and read `rh_start`
  back as 50; sent `THRESHOLD=52` and read it back **unchanged**, with `ok` both times.
  Then `ENABLE=1` and `ENABLE=0`, watching `enabled` follow. Restored to 45 / off.
- **The dryer** — run at its mildest setting for about ten seconds and stopped.
  `DURATION=3` came back as `duration: 180`, `DURATION=240` as `14400`, and `remain_time`
  ticked down one per second. That is minutes in, seconds out, and it is what proved the
  dialog's `DURATION=4` was asking for four minutes.

---

## The bay identity the panel was missing

**The panel shipped drawing three of four bays as `?` on a machine that knew all four.**
The report was "filament is not correctly read from multiACE", and it was right. What
found it was the comparison the reporter suggested: **look at how the Prepare page syncs.**

Orca's own `AceMmuProvider` (on `feat/ace-mmu-slicing`) polls
`http://<host>/multiace/api/state` from C++, and that endpoint answers with all four bays
named — `source: "override"`. The Device page reads the `ace` Klipper object, and that
object carries **no per-bay identity at all**: every raw slot is
`{material:"", brand:"", rfid:0}` because these spools have no tags. multiACE keeps the
names its own web UI shows in an **override store** and merges them in `_parse_state()`.
So both were reading correctly, from two sources that do not carry the same thing — and
C++ has no CORS to stop it.

**The route the page can use, measured:**

| | |
|---|---|
| `http://<ip>/multiace/api/state` | **no CORS header at all** (nginx). The original claim holds — a browser cannot read it |
| `http://<ip>:7125/…` | **reflects the Origin.** Moonraker sends `Access-Control-Allow-Origin`, and this page already fetches camera frames and job thumbnails from it |
| the store itself | `config/extended/multiace/slot_overrides.json`, **under Moonraker's `config` root** — 565 bytes, keyed `"<ace>_<slot>"` → `{ace, slot, material, brand, subtype, color}` |

So reading it needs **no proxy, no C++ and no new bridge command** — one HTTP GET, the
pattern `cameraFrameUrl()` already uses. It is `syncBays()` in the panel's commands, it
lands in `store.aceBays` (the page's knowledge, not the machine's), and the session starts
it the same way it starts `queryException()`.

**multiACE's precedence is kept verbatim: `rfid` → `override` → `derived`.** A tag is the
hardware's own answer and beats a name someone typed; both beat an identity inferred from
what happens to be loaded in the head. Those are multiACE's own words for it and the panel
uses the same ones rather than inventing a second vocabulary — the mark's title says which.

**It fails quietly, and that is the correct behaviour.** No file, no multiACE, no route, or
a Moonraker with auth on all mean the same thing: nothing to merge, and a bay nobody has
named goes on being drawn as a bay nobody has named. `ace-panel.js` reaches that state
deliberately.

Two things checked and ruled out on the way: **`save_variables`** carries only
`ace__mode`, `ace__head_ace`, `ace__head_feeder`, `ace__head_manual`, `ace__head_source`,
`ace__auto_dry` and `ace__revision` — the head mapping, not the bays; and
**`spool_binding` is `{}`**, so the Spoolman table is not where these names are either.

**Writing one is still open.** Reading is done; naming a bay *from the panel* needs either
`ACE_SPOOL_ASSIGN ACE=n SLOT=n [ID=n]` (binds an entry of `ace.spools` — 19 here, each
with material, vendor, colour, `weight_g`, density and SKU — maintained by
`ACE_SPOOL_ADD` / `_SET` / `_DELETE` / `_LIST`) or multiACE's own
`POST /api/slot-override`, which is behind the same missing CORS header. **The macro is
the reachable one**, and that decides where the bay sheet's Save button points.

**Tier 2 was wrong, and in the useful direction.** The design record says it needs an
`sw_` proxy past CORS and a piece of C++. It needs neither: a file read the page can
already do, and one macro to write.

`spool_binding` is still `{}`, so no bay is bound to an entry and **no bay has a level**.
That part of the design survives, with a sharper reason: when a bay *is* bound the entry
carries remaining grams — an estimate from extruded length, by its own macro's admission —
and there is no original weight in the payload, so a percentage is not derivable either
way. A disc stays a colour.

**Two claims that were wrong and are worth remembering:**

- **`head_ace` does not answer "what feeds this head".** It reads `{0:0, 1:1, 2:2, 3:0}`
  with `device_count: 1` — heads 2 and 3 name units that do not exist. Same bug class as
  `toolhead.extruder` naming a parked head.
- **"A running dryer refuses loads" was never true.** It entered as prose in a caption,
  was carried into three files and a dialog, and `/printer/gcode/help` says nothing of the
  kind. Removed everywhere; `check_mockup.py` now asserts the panel claims no such thing.

---

## The next iteration

**One sentence:** every filament on the panel — in a bay *and* at a stock feeder — gets
**load, unload, swap and background swap**, and the work starts with a **responsive
mockup**, not with code.

### Why a responsive mockup first, and not a patch

The card that exists was designed against two fixed numbers, 830 × 456, and it is exact at
them. It is also **brittle either side**: measured, the cabinet is 310 px wide and needs a
330 px cell, which it loses below a 1010 px window, and `.ace-card` hides its overflow —
so the fourth bay would simply be gone, in silence. (The Control panel's fixed 758 px
cluster clips first, at 1100, so today this is the second thing to break rather than the
first. That is luck, not design.)

Adding four actions per filament makes that worse before it makes it better: a bay grows a
hit target, a menu, a busy state and a progress line, and every one of those competes for
the same 371 px of card. **Iterate that in a mockup, where a shape can be thrown away.**
The five studies in this directory are the precedent and the format works — a running
page, pre-rendered copies of every state so it reads with script stripped, and
`check_mockup.py` asserting the numbers. What the next one has to add is the axis nobody
has drawn yet:

- **Width as a variable, not a constant.** The rig should sweep the card's cell — 830 / 902
  / 782 / 662 and the two-column breakpoint — and every state must be measured at each.
  A design that only exists at 1920×1080 is a design that has been checked once.
- **Where the actions live.** A bay is 62 px wide. Four verbs do not fit on it, so the
  question is whether they belong in a bay *sheet* (a click opens it — the confirm dialog
  that exists now is the seed of one), in the card's `⋯`, or on a row that appears under
  the cabinet while something is in flight. The current design deliberately left the bay
  sheet unbuilt; this is where it gets designed.
- **The busy state, which the panel has never drawn.** Every one of these is minutes long.
  `swap_in_progress`, `swap_phase` and `last_swap_result` are already in the object and
  already parsed by `ace()` — nothing on screen uses them yet. A swap in flight has to be
  visible on the bay it came from, the head it is going to, and the panel header, and it
  has to survive a repaint.

### What each verb is, and what it needs

Read off `printer.gcode.help` on the machine — the whole ACE surface is in
[`data/ace-macros.json`](../data/ace-macros.json).

| verb | macro | applies to |
|---|---|---|
| **Load** | `ACE_LOAD_HEAD HEAD=n [ACE=a] [SLOT=s]` | a bay, and a **feeder** head — `ACE_SET_HEAD_FEEDER`'s own help says a feeder head "loads/unloads via its stock side feeder" |
| **Unload** | `ACE_UNLOAD_HEAD HEAD=n [RETRACT_LENGTH=mm] [KEEP_HEAT=°C]` | any loaded head, feeder included |
| **Swap** | `ACE_SWAP_HEAD HEAD=n ACE=a [SLOT=s]` | a bay only — it takes a slot |
| **BG swap** | `ACE_BG_SWAP HEAD=0-3 SLOT=0-3 [ACE=n] [TEMP=] [ANTI_OOZE=] [QUIET=1] [FORCE=1]` | a bay on a head that has been **declared capable** |
| **BG unload** | `ACE_BG_UNLOAD HEAD=0-3 [TEMP=]` | the same |

**BG swap is gated, and the gate is not in the state object.** `ACE_BG_SET_HEAD HEAD=n
ENABLE=0|1` is what declares a head background-capable — its help spells out what that
claim means physically: *its dock is OPEN below, the cold-pull purges through it* — and it
writes the `[ace_bg_swap] heads` config line. `ACE_BG_UNLOAD` restates the whole list:
**head mode, 1:1 wiring, an OPEN dock below the head (purges ~60 mm!), and the head stays
docked for the whole ~3 min sequence.**

So the panel must offer these **only for a head multiACE says is enabled** — and the gate
is reachable. It is not in the `ace` object (all 38 of its top-level keys are listed above
and there is no `bg_swap` among them), but **`ace_bg_swap` is a Klipper object of its
own**, and `sw_GetMachineState {objects:{ace_bg_swap:null}}` answers with it. Measured on
2026-08-26, and asserted in `ace-real.js`:

```json
{"version": "v0.9", "enabled_heads": [], "busy": [], "state": {}}
```

`enabled_heads` is the list `ACE_BG_SET_HEAD HEAD=n ENABLE=1` writes, and `busy` is what a
progress state would read. **No head is enabled on this machine**, so the next iteration
gets to design the disabled case first — which is the right way round: a control that
offers a ~60 mm purge on a closed dock is the one mistake on this panel that costs
filament and a bed. Draw it unavailable, say why, and point at `ACE_BG_SET_HEAD`.

### And the rest of it

- **The bay sheet, which is now only the WRITE half.** Reading what is in a bay is done —
  the override store is fetched and merged, see above. What a bay sheet adds is naming one
  *from the panel*, and the reachable route for that is `ACE_SPOOL_ASSIGN ACE=n SLOT=n
  [ID=n]` binding an entry of `ace.spools` (`ACE_SPOOL_ADD` / `_SET` maintain the table).
  multiACE's own `POST /api/slot-override` is behind the same missing CORS header that
  stops the page reading `/api/state`, so it is not an option from here.
- **Confirmations belong to the machine too.** `confirm_commands` is reported and the
  printer asks on its own screen; a panel that also asks would ask twice. Read it and
  decide once, in the mockup.
- **A feeder spool is a filament like any other.** It already draws as one, carries its own
  provenance mark and opens Materials Setting. Load and unload apply to it unchanged; swap
  and BG swap do not, because there is no second bay to swap to — and that asymmetry is
  the thing the mockup has to make obvious rather than annoying.

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
- **Subtract two numbers.** Alignment, verticality and height are all differences and none
  of them is visible in a picture. `--shots` produces real PNGs now — an unattended run
  renders into a `Gtk.OffscreenWindow` with the compositor off — and it is still the
  weaker half: the seam through a spool looked three pixels out of true and measured
  exactly right.
- **An `ok` is not a yes.** `ACE_SET_AUTO_DRY THRESHOLD=52` returns `ok` and changes
  nothing. Every macro argument on this panel that matters was settled by sending it and
  reading the object back, not by reading the help text — which for that macro says only
  "Humidity-controlled drying per ACE 2, live + persist".
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
# the ACE macro surface, off a real printer, as evidence for check_coverage.py
python3 docs/u1-webui/tools/ace_macros.py

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
