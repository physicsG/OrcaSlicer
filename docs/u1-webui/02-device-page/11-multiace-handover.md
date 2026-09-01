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
`ace_bg_swap v0.9`** — in `MULTIACE_VERIFIED`, and on the panel header's own title.

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

**The one to read first is now *[Start here: the panel has only ever been right in ONE of
the three modes](#start-here-the-panel-has-only-ever-been-right-in-one-of-the-three-modes)***
— everything here was measured in `head` mode, and `multi` changes what the numbers mean.
It is the next session's work.

After that, *The bay identity the panel was missing*: the panel drew three of four bays as
`?` on a machine that knew all four, because the `ace` object does not carry per-bay
identity and multiACE's override store does. Found by comparing against what Orca's own
Prepare page syncs.

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
| **The whole multiACE surface** — macros and the line builder, constants, the state model, the override merge, and the three forms an ACE is drawn in | [`shared/js/multiACE.js`](../../../resources/web/shared/js/multiACE.js) |
| `MachineState.ace()`, which is a call into it | [`shared/js/state.js`](../../../resources/web/shared/js/state.js) |
| The panel: the card, the cabinet, the feeder, the tube, the dryer dialog, both menus | [`filament-view.js`](../../../resources/web/device_page/js/views/device-control/filament/filament-view.js) |
| Fifteen macros, none awaited, each confirmed against machine state | [`filament-commands.js`](../../../resources/web/device_page/js/views/device-control/filament/filament-commands.js) |
| The one-shot read, because `ace` is not on the subscription | `refreshAce()` in [`core/session.js`](../../../resources/web/device_page/js/core/session.js) |
| The `ace` object as the machine reports it, macros included | [`shared/js/mockhost.js`](../../../resources/web/shared/js/mockhost.js) |
| 18 geometric checks, 70 driven against the simulator, 30 against the printer | `run_webkit.py` · [`drive/ace-panel.js`](../../../resources/web/shared/tests/drive/ace-panel.js) · [`drive/ace-real.js`](../../../resources/web/shared/tests/drive/ace-real.js) |
| The macro surface as the machine reports it | [`tools/ace_macros.py`](../tools/ace_macros.py) → [`data/ace-macros.json`](../data/ace-macros.json) |
| The precedence rule, held to account as pure logic | `unit_jsc.py` — 9 checks, no DOM |

```bash
R=resources/web/shared/tests
python3 $R/run_webkit.py --size 1920x1080                      # 58, incl. the card's geometry
python3 $R/run_webkit.py                                      # 51, the single-column layout
python3 $R/run_webkit.py --size 1920x1080 --drive $R/drive/ace-panel.js   # 70, simulator
python3 $R/run_webkit.py --real --size 1920x1080 --drive $R/drive/ace-real.js   # 30, printer
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

Seven interactive studies in this directory hold every decision, each one checked in
WebKitGTK.

| study | answers | checks |
|---|---|---|
| [multiace-filament-mockup.html](multiace-filament-mockup.html) | Seven shapes for the panel; five machine states | 92 |
| [multiace-f2-iterations.html](multiace-f2-iterations.html) | Four arrangements of a per-toolhead subpanel | 74 |
| [multiace-toolhead-card.html](multiace-toolhead-card.html) | What goes under the header: filament, box, tube, marker | 81 |
| [multiace-cabinet.html](multiace-cabinet.html) | **The settled card**, and its five states | 104 |
| [multiace-actions.html](multiace-actions.html) | **What can be done to a filament**, and the card at any width you drag it to | 103 |
| [multiace-modes.html](multiace-modes.html) | **The three modes** — the panel in each, multi's two drawings, and the switch's own lifecycle | 67 |
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
| **Provenance** | A **bay**: eye for an RFID tag, pencil for typed or unnamed — multiACE's `rfid → override → derived`. A **head**: the printer's own `print_task_config.filament_edit`, which is *not* the same as "has a tag" (round sixteen) |
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
| 6a | **Tier 2, reading** — what is in each bay, from multiACE's override store | built. Not the `sw_` proxy it was written down as needing; see *The bay identity the panel was missing* |
| 6b | **Tier 2, writing** — naming a bay *from the panel* | **not built.** `ACE_SPOOL_ASSIGN` is the reachable route, and it wants the bay sheet — see *The next iteration* |

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
- **UI copy says what a control is, and stops.** Explanations of what multiACE is had got
  into the help dialog, the header's title, a menu item and three settings sheets. Someone
  reading a hover has not asked for a lesson, and the explanation is already in this
  directory. A macro name is fine — it says what will be sent. A paragraph is not. The
  rule is in `CLAUDE.md`, and `openDialog` grew `cancel: false` on the way, because a
  sheet that only tells you something should offer Close alone rather than Close *and*
  Cancel.
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

> **The mockup is built and every question below is answered in it.**
> [multiace-actions.html](multiace-actions.html) — 103 checks, 19 pre-rendered copies, and
> a panel that behaves: its menus open, its sheets open, and a verb sent from one runs.
> What it settled is in *[What the mockup answered](#what-the-mockup-answered)*
> at the end of this section; what is left is putting it in the panel.

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

**BG swap is gated, and the gate is reachable.** `ACE_BG_SET_HEAD HEAD=n
ENABLE=0|1` is what declares a head background-capable — its help spells out what that
claim means physically: *its dock is OPEN below, the cold-pull purges through it* — and it
writes the `[ace_bg_swap] heads` config line. `ACE_BG_UNLOAD` restates the whole list:
**head mode, 1:1 wiring, an OPEN dock below the head (purges ~60 mm!), and the head stays
docked for the whole ~3 min sequence.**

So the panel must offer these **only for a head multiACE says is enabled**. That is not
in the `ace` object — all 38 of its top-level keys are listed above and there is no
`bg_swap` among them — but **`ace_bg_swap` is a Klipper object of its own**, and
`sw_GetMachineState {objects:{ace_bg_swap:null}}` answers with it. Measured on
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

## What the mockup answered

[multiace-actions.html](multiace-actions.html) — the fifth study, and the first with
**width** as a variable, and the first whose panel actually *behaves*: the `⋯` menus open,
**ACE mode** opens its list, **?** opens the help, the **Dry** chip opens the dryer, a bay
opens its sheet, and a verb sent from a sheet runs a swap you can watch. `check_mockup.py`
holds all 103 numbers and drives it the way a person does — pointer and key events on the
same controls; `bake_mockup.py` writes its 19 pre-rendered copies for the no-script path.
Everything below was measured in WebKitGTK, not judged.

**Two kinds of control, and the line between them is the point.** Above the panel are the
three questions still open — where a verb is chosen, where a running swap is reported, and
how wide the panel is. Everything else is on the panel, because a mockup whose menus are
pictures cannot answer the first of those: *where a verb should live* is a question about
how many clicks it takes to get to one, and you can only count those by making them.

**A switch is also the wrong instrument for a continuous axis.** The first cut of the width
question was a deck of five, and *neither* of the two widths that matter was among them.
Dragging the edge found both.

### The card has two floors, at 708 and 655, and both were found by dragging

The cabinet does not resize. A bay is `flex: 0 0` on `.slot`'s own 62 px, so four bays plus
three 10 px gaps plus 16 px of shoulder is **310 px at every width there is** — which makes
the whole question arithmetic:

| panel | card | room in it | cabinet | |
|---|---|---|---|---|
| 902 | 427 | 407 | 310 | 97 spare |
| **830** | **391** | 371 | 310 | the Device page's own `--col-w`: 61 spare |
| 782 | 367 | 347 | 310 | 37 spare |
| **708** | **330** | **310** | 310 | **the floor — exactly none** |
| 662 | 307 | 287 | 310 | 23 px past the room; nothing cut yet |
| **655** | 303 | 283 | 310 | **the second floor — below this the fourth bay is cut** |
| 560 | 256 | 236 | 310 | **the fourth bay is 14 px of 62** |

`.ace-card` is `overflow: hidden`, so past the floor a bay is not squeezed and does not
scroll — it is **gone, and nothing says so**. 560 is what the single-column layout below a
1600 px window hands the panel, so this is reachable rather than theoretical.

**655 is the one arithmetic got wrong.** It was computed as 668 — the width at which the
cabinet is wider than the card — and that is not when a bay is cut: the overflow has to eat
the 16 px shoulder *and* the card's own 10 px of padding and border first. The page measures
both boundaries itself at boot by walking its own width, and the check walks it a second
time, 1 px at a time, by a different method; they agree to the pixel. Two methods agreeing
is worth more than one method run twice.

### A verb is only offered where it is a verb

The list is **not fixed**. The first cut showed all five always and greyed whatever did
not apply; that is right for a verb the *machine* is refusing and wrong for one that does
not exist in this state:

| | |
|---|---|
| **not applicable here** | left out — there is no reason to show for a verb that is not a thing |
| **applicable, machine refuses** | listed, greyed, and naming the macro that lifts the refusal |

| where | state | what it offers |
|---|---|---|
| **Stock feeder** | empty | **Load**, alone |
| | loaded | **Unload**, alone. No second bay, so swap and both background verbs are not operations it has |
| **An ACE bay** | head empty | **Load** from that bay |
| | head loaded, another bay | **Swap** / **Background swap** — the same gesture, and the head is emptied first |
| | head loaded, *this* bay | nothing. It is already feeding, and a swap to it is a three-minute no-op |
| **A loaded ACE head** | — | **Unload and retract**, and **Background unload** behind the gate |

**An ACE unload is not a feeder unload.** The unit can pull the filament all the way back
into its bay, which is what `RETRACT_LENGTH` is for and what a stock feeder cannot do — so
the verb is `Unload and retract` on an ACE head and plain `Unload` on a feeder.

### Where a verb lives is decided by whether it takes a SLOT

Four placements are drawn, and the answer is a split along exactly the line the macros
draw:

| | |
|---|---|
| `ACE_LOAD_HEAD`, `ACE_UNLOAD_HEAD`, `ACE_BG_UNLOAD` | address a **head**. Nothing to choose, so they stay in the card's `⋯`, where two of them already are |
| `ACE_SWAP_HEAD`, `ACE_BG_SWAP` | take a **`SLOT=`**. The bay *is* the argument, so clicking the bay opens its own sheet and the sheet lists the verbs |
| **the toolhead** | every macro addresses `HEAD=n`, and the head is the one target that is the same size at every panel width where a bay is 62 px and shrinking. It works, and it is drawn: the bays come **to** the sheet, one button each, saying what clicking them would do in this state. Under the pointer the head wears the bay's own 1.5 px traced accent edge, because two things you can click on one card should not answer differently |
| a row of verbs under the cabinet | **rejected on measurement** — it puts the body at **480** against 456, and `.panel-body` is `overflow: hidden`, so it would have been clipped rather than seen |

The bay sheet is also the only placement with room for the macro line under each verb,
which is what makes an unavailable verb legible rather than merely grey.

### A swap in flight costs no height, because there is none to spend

An always-there status row under the box measured **503 against 456**. What this card has
spare is not vertical but **horizontal**: the toolhead artwork is 32 px wide in a 371 px
cell, so the head band is two wide empty gutters with a picture between them. The in-flight
line lives in the left one — free, and pointing at the head the filament is going to.

It is said in **four places at once**, because any one of them can be off screen: the bay
it is leaving (the accent ring, held rather than hovered), the head it is going to (a halo
on the sensor mark), the line beside the head (`A3 → Toolhead 4` and the phase word), and
the panel header (`swapping`). Asserted at 455 px in every busy state and at every width.

**The words are not multiACE's — they are the U1's, and HelixScreen already had them.**
The study first drew `swap_phase` with invented placeholder words, and that was the wrong
field. [HelixScreen](https://github.com/356C/HelixScreen) drives a U1 touchscreen and its
Snapmaker backend classifies the firmware's own **`channel_state`**, which has a documented
vocabulary per direction:

| direction | `channel_state` | step |
|---|---|---|
| **unload** | `unload_prepare`, `unload_homing` | Home |
| | `unload_picking` | Select |
| | `unload_heating`, `unload_heat_finish` | Heat nozzle — **live reading** |
| | `unload_doing` | Retract filament |
| **load** | `load_prepare`, `load_homing` | Home |
| | `load_picking` | Select |
| | `load_heating` | Heat nozzle — live |
| | `load_feeding`, `load_extruding` | Feed filament |
| | `load_flushing` | Purge |
| **either** | `*_finish` · `*_fail` | the end, or the state it stopped in |

**A swap on an ACE-fed head is ONE bar with two halves** — Home, Select, Heat nozzle,
Retract filament, Feed filament, Purge. The load half's own Home / Select / Heat are
deliberately absent: the head is mounted and already hot by then.

**There is no step for the ACE fetching the bay, and that is a hardware finding.** The
design assumed a long blind window between the halves. Measured on a live U1 it is a **~4 s
blip in a ~100 s operation**, because the bay is already staged at its gate — so the bar
holds on *Retract filament* across it, which is honest.

**So the bar is determinate, and this handover said the opposite.** `channel_state` names
*which of a known list* the printer is in, so **step 4 of 6** is a real quantity and one
tick per step is the right drawing. What is still not derivable is a percentage *within* a
step, and none is drawn. `swap_phase` remains a word; it is simply not the field to read.

**The heat step reads the nozzle** — `Heat nozzle 178/240 °C`, because "it is heating" and
"here is how far" are different answers. One more rule worth taking from HelixScreen: when
the temperature feed freezes, a fixed `225/230` reads as **stuck** rather than **busy**, so
it swaps the reading for `Working…` until the feed returns. Not built here; noted.

**A failure is a state, not a sentence.** `unload_fail` is what the firmware reports and
what the row shows, beside the step it stopped on. It stays until something else happens:
a failure that clears itself is a failure nobody saw.

### The background verbs are drawn unavailable first

`ace_bg_swap.enabled_heads` is `[]` on the measured machine, so both background verbs are
off and each says `ACE_BG_SET_HEAD HEAD=n ENABLE=1` — a macro name, not a paragraph about
open docks. The study asserts that neither ever renders more than eight words. The enabled
case is drawn too, and labelled invented.

### The feeder's two missing verbs are greyed, not hidden

Both were drawn. Greyed with the reason wins, because it is the rule the source selector
already follows — *disabled with the reason showing, never hidden; a control that vanishes
leaves no way to find out why it is not there* — and because a feeder card that silently
has two fewer verbs than its neighbour reads as a card that is missing something.

### It is built

| | where |
|---|---|
| `aceVerbs()` — which verbs are verbs in this state — and `channelStep()` — the U1's own `channel_state`, classified | [`shared/js/multiACE.js`](../../../resources/web/shared/js/multiACE.js), pure, so `unit_jsc.py` holds both to account with no DOM |
| The toolhead's sheet, the bay's sheet, the card menu — all three from the same list — and the step bar beside the toolhead | [`filament-view.js`](../../../resources/web/device_page/js/views/device-control/filament/filament-view.js) |
| `runVerb()`, `declareBgHead()`, and the allow-list of macros a verb may send | [`filament-commands.js`](../../../resources/web/device_page/js/views/device-control/filament/filament-commands.js) |
| `ace_bg_swap`, read as a second key in the same `sw_GetMachineState` call | `refreshAce()` in [`core/session.js`](../../../resources/web/device_page/js/core/session.js) |
| 15 driven against the simulator | [`drive/ace-verbs.js`](../../../resources/web/shared/tests/drive/ace-verbs.js) |
| 19 more as pure logic | `unit_jsc.py` |

**Three surfaces, one list, and that is why having all three costs nothing.** The study
weighed four placements and the answer is not one of them:

| | |
|---|---|
| **the toolhead** | everything that can be done to that head. Every macro addresses `HEAD=n`, and it is the only target that does not shrink with the panel — a bay is 62 px. Two of the verbs take a `SLOT=` and a head is not one, so the bays come **to** the sheet, one button each, saying what clicking them would do in this state: `A1 Swap · A2 Swap · A3 feeding (off) · A4 Swap` |
| **the bay** | the shortcut for the filament you are already pointing at. The bay *is* the argument, so clicking it is a shorter sentence than picking a verb and being asked for one |
| **the card `⋯`** | the verbs that take no slot, where two of them already were |
| ~~a row under the box~~ | lost, on measurement: 479 against a 456 budget |

Under the pointer the toolhead wears the bay's own edge — a 1.5 px traced accent, no fill,
drawn as a backing behind the artwork so nothing moves — because two things you can click
on one card should not answer differently. Tight to the drawing: the element's top ~9 px is
the two inlet hairlines, so the box is trimmed there.

**The step bar needed no new request.** `channel_state` is the U1's own field, on
`filament_feed left|right` → `extruder<n>`, already on the subscription and already parsed
by `feedChannels()` — it had simply never been drawn. `swap_phase` is multiACE's and has
never been captured on hardware; it is not what this reads.

**Whether a head is loaded is asked of the SENSOR.** `filaments()[i].loaded` is
`print_task_config` — what the slicer assigned to the slot — and a physical unload does not
clear it, so an emptied head offered `Unload` again instead of `Load`. Measured on the
machine, the two disagree: *sensor says empty · print_task_config says loaded*.
`headLoaded()` decides it once, from `filament_at_extruder`, with the job record as a
fallback only where a printer reports no feed channel. The same trap was one level down —
`head_source` does not stop naming a bay because the filament came out — so `loaded` is the
single authority and `fed` only says where it came from. Round nine of
[08-function-gap-analysis.md](08-function-gap-analysis.md).

**Three things the tools caught that reading would not have.**

- **A card does not repaint for something its signature omits.** The step bar drew
  nothing until `channelState` went into `cardSig()`. The sensor mark could not stand in
  for it: that buckets four positions into one word, so a whole swap runs with
  `filament_at_extruder` unchanged.
- **`check_coverage.py` said UNACCOUNTED for both background verbs, and was right.**
  `runVerb()` sends the line the verb carries, so the macro name appeared nowhere in the
  command module — the panel could send it and nothing claimed it. The fix is an
  allow-list `runVerb()` actually checks, which makes the claim true rather than merely
  greppable, and is a real gate on a macro that purges ~60 mm.
- **The conformance suite named three dead commands the moment their last caller went.**
  `loadBay`, `loadHead`, `unloadHead` are gone: the verb list decides which macro applies,
  so a caller that picks the function has already made that decision somewhere else.

**The simulator grew `filament_feed` and `ace_bg_swap`,** both shaped as the machine
reports them. It had neither, so the head's sensor marker was undrivable too. Which side
carries which head has never been measured and `feedChannels()` does not depend on it, so
everything is on one side rather than a split being invented.

`check_coverage.py` now classifies `ACE_BG_SWAP`, `ACE_BG_UNLOAD` and `ACE_BG_SET_HEAD` as
offered. `ACE_BG_MOVE` stays withheld: nothing on the panel needs a bare move.

### What is left

**A verb has no progress of its own until the machine gives it one.** The bar reports
`channel_state`, which is the U1's answer for the head — it says nothing about the ACE
side of a swap, and `swap_in_progress` / `swap_phase` / `last_swap_result` are still
unread. Whether they add anything is a question for a machine that is actually swapping.

### Verified against the machine, 2026-08-28

`811002511261022618B3`, one ACE 2 Pro on V1.1.26, 43 % RH at 27 °C.
[`drive/ace-verbs-real.js`](../../../resources/web/shared/tests/drive/ace-verbs-real.js) is
the companion to `ace-real.js` and is **read-only for the same reason**: every verb here is
minutes of physical work, and `ACE_BG_SWAP` purges ~60 mm through an open dock. It opens
sheets and menus, reads what they offer, prints what the machine says, and sends nothing.

```
ace-real.js        30/30      ace-verbs-real.js  20/20      the page itself  5/5
```

What hardware settled that the simulator could not:

**`ace_bg_swap` answers in the same call as `ace`** — `{"version":"v0.9",
"enabled_heads":[],"busy":[],"state":{}}` — so the second key costs nothing and the gate
is real. `enabled_heads` is empty on this machine, which makes the *refusal* the state the
panel is actually in, and therefore the one most worth drawing well. The sheet offers
`Swap` live and `Background swap` refused, naming
`ACE_BG_SET_HEAD HEAD=3 ENABLE=1` with a control that would send exactly that.

**An idle head does not say `none`, and the guess was wrong.** Read with everything
settled:

```
channel_state per head: 0=load_finish  1=load_finish  2=wait_insert  3=wait_insert
feed sensors:           ace/tube/ext   ace/tube/ext   ace/-/-       ace/-/ext
```

A **terminal state is the resting state**: the field holds the last operation's ending
rather than returning to a neutral word. Both draw nothing, so an idle panel is quiet —
but the simulator had been sitting at `none`, and now sits where the machine does.

**`wait_insert` is not a reliable "this head is empty".** Toolhead 4 reads it while being
fed from bay 2 with `filament_at_extruder` true. The step bar does not care, because
terminal states draw nothing — but nothing else should read this field for occupancy, and
the fix that came out of it is a lookup that means it: the table maps idle words to `null`
deliberately, and `||` was sending them to the prefix heuristic instead of honouring it.

### Verified again, 2026-08-28, after two reports from ordinary use

Same machine. Three fixes and one that had to be made twice.

**A non-background verb blocks, and names the step it is on.** `sw_SendGCodes` does not
return until Klipper finishes and the bridge gives up at 15 s; a load **homes** first
(14.7 s to `xy`, 31 s cold), so `Toolhead 1: load failed: sw_SendGCodes timed out after
15000ms` was reported for a load that was running. The request is no longer awaited and
`isTimeout()` is no longer a refusal — the Control panel's round-four answer, which the
filament commands had never adopted. The wait is a **blocking dialog** rather than a
cancellable queue, because a second verb started under the first is a collision and there
is nothing to cancel once filament is moving. It labels from `channel_state` through the
same six-step bar the card draws — `Heat nozzle  (3/6)` — so it says where the machine is
and not merely that it is busy.

**An activity code is not a fault code.** `Printer fault · code 0000000000000240 · not in
the shipped catalogue` was `0x240` = 576 = `action_code` **"Auto Loading"**, padded into a
16-digit fault code that could never match because it never was one. The banner now reads
`server.exception.query` and nothing else. `shared/js/activity.js`'s own header warns
about the overlap; decoding one table against the other is that warning one level up.

**And occupancy, which was wrong twice.** *A toolhead unloaded, and then offered `Unload`
again* was reported, fixed by reading `filament_at_extruder` instead of the job record,
and **reported again**. Measured with toolhead 1 unloaded by hand:

```
head  channel_state   channel_action_state  detected inAce inTool atExt exist  TRUTH
0     unload_finish   unload_finish         T        T     T      T     T      empty
1     wait_insert     unload_finish         F        T     F      T     T      empty
2     wait_insert     none                  F        T     F      F     F      empty
3     wait_insert     none                  T        T     F      T     T      LOADED
```

`filament_in_ace` is true on all four including the empty one — a **module** is there.
`filament_at_extruder` is true on three, two of them empty, and does not go false when a
head is emptied. `filament_in_toolhead` is true on the head just emptied and false on the
loaded one. `channel_state` is `wait_insert` on both an empty head and a loaded one, which
was already written down above and is what should have prompted the second look.

**`channel_action_state`** — the last operation the channel *finished* — is the only field
that separates them, and it is not a sensor. `headOccupied()` asks it, then `channel_state`
where nothing has finished since boot, then the topology. That order is **by what each
field is for, not by which is fresher.**

The simulator was green through both, and round nine had already done the right thing by
separating the sensor from the job record so they *could* disagree. It proved nothing,
because the sensor it invented was computed from the belief the panel held. **A simulator
can only be wrong in the ways it was written to be wrong** — so `mockhost.js` now reports
`filament_at_extruder` the way the machine does, toolhead 4 sits at `wait_insert`/`none`
with only the *topology* saying it is loaded, and `drive/ace-verbs-real.js` asserts **on
the printer** that the three fields disagree and the panel follows the right one.

### The stock feeder is not an ACE, and was being sent ACE macros

`ACE_LOAD_HEAD HEAD=n` at a head with no ACE is nothing — the macro's own help says it
loads a toolhead **from ACE**. The U1's own verb is `AUTO_FEEDING EXTRUDER=n`, read out of
the printer's config over **Moonraker's HTTP API**, which needs no `clientId` and so can be
read while someone else is driving the machine:

```bash
curl -s "http://<ip>:7125/printer/gcode/help"                       # all 336, not the 92
curl -s "http://<ip>:7125/printer/objects/query?configfile=settings" # macro bodies
```

The unload pair is the machine's own, out of `SM_PRINT_END_AUTO_UNLOAD_FILAMENT`. **The
load pair is inferred** and is the one macro argument on this page that was not settled by
sending it and reading the object back — `LOAD=1` from `SM_PRINT_AUTO_FEED`, the stages
from the unload. It is the first thing to confirm at a printer.

### What is left

**One real swap, watched.** Everything above is a machine at rest. What `channel_state`
does *between* the halves — and whether the ~4 s ACE-fetch blip HelixScreen measured on
firmware 20260722 holds here — needs a swap actually running, which is three minutes of
physical work and a purge. That is a deliberate act on someone's printer, not something a
suite should do: the script for it should be separate, named for what it costs, and run by
a person who means it.

**`swap_in_progress`, `swap_phase` and `last_swap_result` are read now, and a failure is
what captured them.** A swap on an unhomed machine set
`last_swap_result = {head:3, ace:0, slot:1, status:"error", ts:9893.3}` within a second
while `channel_state` never moved at all — so they say something `channel_state` does not,
and the blocking wait watches them. What they do during a swap that *succeeds* is still
unmeasured; that still needs one real swap.

---

## Start here: the panel has only ever been right in ONE of the three modes

**This is the next session's work, and it is not a polish item.** Every measurement behind
this panel was taken on a machine in **`head`** mode, and the model was written from those
readings. What follows was read out of multiACE's own source and cross-checked against
HelixScreen; **on 2026-09-01 the live half was then measured** — the machine was switched
to `multi` and back over Moonraker HTTP and both payloads captured
([`data/ace-mode-switch-20260901.json`](../data/ace-mode-switch-20260901.json)), and the
source reading held. `normal` is still unobserved (it needs a reboot each way and every
head unloaded), and the simulator is still hard-coded `mode: 'head'`. The drawings for all
three modes are settled in a seventh study,
**[multiace-modes.html](multiace-modes.html)** — 67 checks, 15 pre-rendered states — and
*[What the modes study answered](#what-the-modes-study-answered)* below holds the results.

The short version: **in `multi` mode the panel will draw the wrong sources and offer loads
the hardware cannot perform.** That second half is why this is first.

### What the three modes actually are

Off multiACE's own config comment, which is the clearest statement of it anywhere:

> `head` mode = exactly ONE head is ACE-driven (fixed to ACE 0, e.g. via a 4→1 combiner so
> that ACE's slots all feed one head); every OTHER head uses its stock side feeder. …
> **0 ACE heads = normal, 1 = head, all = multi.**

So a mode is not a display preference. It is *how many heads the ACE drives*, and it
changes the physical wiring the numbers refer to.

| | `normal` | `head` | `multi` |
|---|---|---|---|
| heads the ACE drives | none | one | all |
| what a unit's four bays are | — | four spools for **one** head, a hub | one spool for **each** head |
| `head_feeder` | ignored | **the** answer | ignored |
| `head_ace` | ignored | **the** wiring | ignored — head *N* is ACE *N* |
| `SLOT` defaults to | — | the head's armed slot | **`HEAD`** |
| switching into it | reboot | live | live |

### The three claims that break the current model

All from `ace.py`, and all one-liners:

```python
def head_uses_ace(self, head):
    if self.head_is_manual(head): return False
    if self._ace_mode == 'head':  return not self.head_is_feeder(head)
    return True                                  # multi/normal: EVERY head

def head_ace_for(self, head):
    if self._ace_mode != 'head':  return int(head)   # multi: head N is on ACE N
    return int(self.head_ace.get(int(head), int(head)))
```

and in `cmd_ACE_LOAD_HEAD`, the non-head branch:

```python
slot = gcmd.get_int('SLOT', head)                # multi: bay s feeds head s
```

1. **`head_feeder` is consulted ONLY in head mode.** `headSource()` in
   [`multiACE.js`](../../../resources/web/shared/js/multiACE.js) tests it first, in every
   mode. On the measured machine `head_feeder` is `{0,1,2 true, 3 false}` — so in `multi`
   the panel would draw three stock-feeder cards and one ACE card, the head-mode picture,
   while the machine considers all four ACE-driven.
2. **`head_ace` is not the wiring outside head mode.** In `multi`, head *N* is on ACE *N*
   regardless of what `head_ace` says. The panel reads `head_ace` unconditionally and then
   discards heads naming a unit that does not exist — which in `multi` with one ACE is
   heads 1–3.
3. **A bay is not free to feed any head.** `aceVerbs()` builds
   `ACE_LOAD_HEAD HEAD=h ACE=a SLOT=s` with an explicit `SLOT` for every bay on every
   card. In `multi` that is wrong and the machine will not refuse it: bay 2's tube goes to
   head 2, and asking for `HEAD=0 SLOT=2` asks the ACE to push filament somewhere it is
   not plumbed.

HelixScreen reached the same three independently and says so in its own words —
`bay_feeds_head_locked()`: *"Multi mode: bay s feeds head s … Head mode: the one head this
ACE is bound to"*, and *"In head mode one ACE binds to a single head and all four of its
slots feed that head — a hub, not a parallel fan. In multi mode slot s feeds head s, so
each slot has its own path."* Its comment also records the same bug being fixed there: *"the
dispatch copy only knew head mode, so in multi mode a bay's Load either named the wrong
head or refused a perfectly valid bay."*

### And the machine already answers the question the page is re-deriving

```python
ace_heads_now = [h for h in range(4) if self.head_uses_ace(h)]
```

**`ace.ace_heads` is the list of ACE-driven heads, computed live from the mode**, and it is
already in the object the page reads — `parseAce` even passes over it. This is the third
time in five rounds that the panel has re-derived something the machine states: after
`filament_edit` and `filament_official`, this one should be read rather than rebuilt.
`headSource()` should ask `ace_heads` whether a head is on the ACE, and only then work out
*which* unit and *which* bay — with the mode deciding that second part.

Careful, though, and this is the one place `ace_heads` is not sufficient on its own: it
says *whether*, not *which*. Head mode still needs `head_ace`; multi mode needs the
identity rule above. And `head_manual` is folded into it already (`head_uses_ace` returns
False for a manual head), so a manual head disappears from the list rather than being
distinguishable — the panel still needs `head_manual` separately to draw *Hand-fed*.

### The switch itself has three behaviours the panel does not handle

Read from `SET_ACE_MODE` (`ace.cfg`) and `cmd_ACE_RUN_MODE_SWITCH` (`ace.py`):

- **normal ↔ (multi|head) needs a REBOOT and reports it as an error.** It runs
  `ace_mode_switch.sh`, which swaps `filament_feed.py`, `extruder.py` and
  `filament_switch_sensor.py` for their stock or ACE variants, then raises
  `gcmd.error('[multiACE] Switched to %s mode. Please reboot the printer to activate!')`
  and a `RAISE_EXCEPTION ID=6666`. So a **successful** mode change arrives at the page as a
  rejected `sw_SendGCodes`. The pill will report a failure for something that worked and
  needs a power cycle, and `ace.mode` will keep reporting the old mode until the reboot
  happens. **This is the one to design first**, because it is the only control on the panel
  whose success looks exactly like a failure.
- **It refuses outright when any filament is loaded**, and only through
  `action_respond_info`: *"Cannot switch mode! Filament still loaded in: E0, E1"*. The RPC
  gets `ok`, nothing happens, and the pending mode sits until it times out and reports
  itself lost. Same shape as every other **an `ok` is not a yes** on this page — and the
  reason is already reachable, on Klipper's console, through `lastPrinterError()`
  (which reads `!!` lines; this one is an `//` note, so it needs the note channel too).
- **multi ↔ head is live, and entering `head` wipes every feeder head's identity.** That is
  round nineteen and it is handled — the panel falls back to the spool's tag — but the
  wipe is a *mode* behaviour and belongs in this section's picture, not only in the colour
  one. Note it also clears `filament_official`, so a mode switch quietly unlatches
  `filament_edit` on every feeder head.

### Two smaller things that fall out of the same reading

- **`ACE_SWITCH` is `NOT BUILT` for a reason that only holds in head mode.**
  `check_coverage.py` says: *"switches the ACTIVE unit, which only matters in multi mode.
  The panel is head-major: every card names its own unit, so there is no such thing as the
  active one on it."* In `multi` there **is** an active unit — `_ensure_active_ace_for_head`
  returns `self._active_device_index` outside head mode, and `active_device` is in the
  object and already parsed as `ace.activeUnit`. Revisit that entry with the mode in hand.
- **`SET_ACE_MODE MODE=head HEAD=n` is never sent.** The optional `HEAD=` picks which head
  is the ACE-driven one and writes `head_feeder[h] = (h != n)` for all four. Without it,
  head mode keeps whatever wiring was there. The panel offers the mode and not the head,
  which is fine as a default and is a gap if someone wants to move it.

### How to settle it, without breaking a printer

`normal` is the expensive one: it needs a reboot each way and it swaps Klipper extras. Do
not reach for it first.

**multi ↔ head is live and reversible**, and the machine is already in `head`. The whole of
the above can be settled by switching to `multi`, dumping the object, and switching back —
minutes, no filament movement, no purge. It does need every head unloaded only for a
`normal` transition, not for this one.

```bash
# read-only first: what head mode looks like, for the diff
curl -s 'http://<ip>:7125/printer/objects/query?ace' > /tmp/ace-head.json

# the switch is a macro like any other
curl -s http://<ip>:7125/printer/gcode/script --data-urlencode 'script=SET_ACE_MODE MODE=multi'
curl -s 'http://<ip>:7125/printer/objects/query?ace' > /tmp/ace-multi.json
curl -s http://<ip>:7125/printer/gcode/script --data-urlencode 'script=SET_ACE_MODE MODE=head'
```

**Run on 2026-09-01, and every question answered.** The machine was idle with filament in
three heads; the round trip took minutes, moved nothing, and restored the baseline
byte-identical (humidity noise aside). Both payloads, the `print_task_config` snapshots
and the console lines are in
[`data/ace-mode-switch-20260901.json`](../data/ace-mode-switch-20260901.json). The whole
`head → multi` diff is **two keys**:

| | asked | measured |
|---|---|---|
| `ace_heads` | does it become `[0,1,2,3]`? | **yes** — `[3]` ↔ `[0,1,2,3]`, exactly the mode |
| `head_feeder` | left stale, or rewritten? | **left byte-identical** — still `{0,1,2 true, 3 false}` in multi, just ignored. Which confirms claim 1: a panel reading it in multi draws three feeder cards on a machine whose every head is ACE-driven |
| `head_ace` | left stale, or rewritten to identity? | **left byte-identical** |
| `head_source` | cleared, or carried? | **carried** — head 3 still names `{ace_index:0, slot:1}` in multi: a bay feeding a head it is not lane-wired to, which multi's own rule says cannot happen. The record of fact survives the change of claim, and the panel must draw the record |
| `print_task_config` | is the wipe symmetric? | **no — entering multi *populates*.** All four heads got bay identities pushed (`filament_type` all `PETG`, `filament_exist` all true — including a head with an empty extruder and two holding feeder filament). In multi the U1's display model mirrors **the bays**. Entering head wipes it back |
| `active_device` | does it start mattering? | unchanged (`0`); it is the unit-picking half of multi (`ACE_SWITCH`), so it matters only with `device_count > 1` |
| `gate_status` / `slots` | unchanged, presumably | **unchanged**, confirmed |

Also captured verbatim, off the gcode store: the live switch's console voice — `//
Switching to MULTI mode...` then `[multiACE] Switched to MULTI mode. No reboot needed.` —
the same-mode answer `// Already in HEAD mode (re-syncing)...`, and the refusal for a
normal transition with filament loaded: `// Cannot switch mode! Filament still loaded in:
E0, E1, E3` · `// Please unload all toolheads first, then try again.` And the
`needs_unload` guard is **only** on normal transitions — it is right there in the
`SET_ACE_MODE` macro — which is what made the live round trip safe with filament in place.

Still to do from the original plan: the same states through `run_webkit.py --real
--drive`, read-only, and the payloads into `mockhost.js` so the simulator can hold two
modes rather than one.

### What to build, once it is measured

1. **`headSource()` asks `ace_heads` first**, then resolves the unit and bay per mode. One
   function, three branches, and the mode named in each.
2. **`aceVerbs()` stops offering every bay to every head in multi mode.** A card in multi
   shows the one bay that feeds it; the cabinet's other three belong to other heads and
   are drawn as theirs. HelixScreen's `PathTopology::HUB` vs `PARALLEL` is the same
   distinction and the same fix.
3. **The mode pill reports the reboot case honestly** — a success that arrives as an error,
   and a state where `ace.mode` and the saved `ace__mode` disagree until a power cycle.
4. **The loaded-filament refusal is read off the console**, not waited out.
5. **`unit_jsc.py` gets the mode rules as pure logic**, the way the verb list and the
   override precedence are held: given an `ace` object in each mode, which head is on which
   unit and which bay, and what a Load would send.

**Do not ship any of it on the source reading alone.** The last five rounds each turned on
a field meaning something other than its name — `filament_edit` was a latch, `head_ace` is
not what feeds a head, `ACE_SWAP_HEAD` is the print's — and this section is currently in
exactly the state those were in before someone asked the machine. *(The machine has now
been asked for the live half — the table above — and the reading held. `normal` remains
source-only.)*

### What the modes study answered

**[multiace-modes.html](multiace-modes.html)** — the seventh study, 67 checks, 15
pre-rendered states, and the first drawn from **two real payloads of the same machine**:
`head` and `multi`, captured minutes apart on 2026-09-01. Its rig teleports between
modes; the panel's own pill runs the real switch flow, and the machine strip below plays
the printer's side (filament loaded, the restart). Everything below is measured in
WebKitGTK, not judged.

- **Multi draws as CARDS — settled with the user, 2026-09-01.** Two honest drawings were
  weighed: **lanes** (the cabinet once, four tubes fanning to four heads — the topology
  as a picture, 271 px, and the measured cross-lane feed draws as a visible crossing) and
  **cards** (the settled 2×2 frame kept — each card holds only its own lane's bays, the
  unit row a shared band above the grid, 437 px). Lanes is the nicer picture with one
  unit; with more, cards win, and one drawing serves both — so cards. Lanes stays in the
  study as the picture that explains the mode. Both fit at 830, 708 and 560; asserted.
- **The selector names the lane SET, not one bay of it** — the user caught this on the
  two-unit card: *"Bay A1"* sat over a card drawing A1 *and* B1, and with a splitter on
  the head both are plumbed to it. The option now reads *Bay A1 · B1* (eliding past two
  units); which bay is actually feeding stays the fed ring's job.
- **A bay is drawn once, on the card of the head it is plumbed to.** In the measured
  state the cards drawing puts A2 on toolhead 2's card marked *feeding Toolhead 4*, and
  toolhead 4 carries a chip naming what is in it and where from. No bay appears twice —
  asserted.
- **The as-built exhibit is in the study, labelled `WRONG IN THIS MODE`:** today's
  `headSource()`, fed the real multi payload, resolves three feeder cards and one four-bay
  cabinet — the head-mode picture under a pill saying `multi`.
- **The selector's options are the mode's** — head: feeder / ACE / hand-fed; multi: the
  lane / hand-fed; normal: feeder / hand-fed. `ACE_SET_HEAD_MANUAL` is legal in every
  mode, so the selector never fully disables again — the verbs study's blanket disable
  outside head mode was over-broad and this corrects it. Both background verbs are simply
  absent in multi: `ace_bg_swap` refuses outside head mode in its own words (*"v0
  requires head mode (1:1 ACE per head)"*), and a mode change is not a refusal a verb
  row can lift.
- **Normal draws as the STRIP — settled with the user, 2026-09-01** — the unit band
  (badge, humidity, **Dry**) below the grid, so drying stays controllable while the
  cabinet feeds nothing; **quiet** is rejected. It fits only after normal's cards drop
  the second header line — measured 497 against 456 with it, 443 without, and the line
  had nothing to say: it exists to name which unit feeds the head, and in normal nothing
  ACE-feeds anything. Two units share one band row — stacked bands measured 475. **Head
  mode is confirmed as-is** — it was the starting point of the whole panel.
- **The switch is drawn as three outcomes, and the pending state has a mechanism:**
  live (console line as confirmation), refused (the machine's own two console sentences,
  verbatim, in the dialog), and restart-pending — drawn from the **disagreement between
  `ace.mode` and the saved `ace__mode`**, both already readable in one
  `sw_GetMachineState` call, with the banner showing exception 6666's own message and the
  panel honestly still drawing the old mode.
- **Choosing Head always asks which head** — also from head mode, because that is how the
  coupled head gets *moved*; the picker's command line carries `SET_ACE_MODE MODE=head
  HEAD=n`. That closes the `HEAD=` gap noted below at the drawing level.

---

## Open, as of 2026-08-28

Nothing below is a bug in the sense of "the page is wrong about something it knows". Each
is a thing the panel does not yet know, or a decision deliberately left to a person.

**Except the section above**, which is a thing the panel is probably wrong about in two of
the three modes it offers, and which is why it is above rather than in this list.

### 1. ~~A swap needs a homed Z~~ — closed. It never did; the wrong macro did

**Resolved 2026-08-28.** It was not a rule about swapping, it was a rule about
`ACE_SWAP_HEAD`, and that macro is the **print's** swap rather than a person's. The panel
sends **`ACE_UNLOAD_HEAD` then `ACE_LOAD_HEAD`** now, and no homing question arises. The
full record is *[Round fifteen](08-function-gap-analysis.md#round-fifteen--the-swap-that-wanted-a-homed-z-was-the-prints-swap)*
in the gap analysis; the short version:

- **Only `ACE_SWAP_HEAD` moves Z.** It opens with an unconditional
  `G91 / G1 Z2 F600 / G90` — a 2 mm lift off the part before it parks and picks the head —
  and Klipper refuses a Z move on an unhomed Z. `ACE_LOAD_HEAD` and `ACE_UNLOAD_HEAD`
  contain **no Z motion at all**, which is why the unload in the same console ran fine on
  `"xy"`. That is read out of `ace.py`, not inferred from the failure.
- **multiACE guards that same hop everywhere it can run idle** — `_discard_wipe()` and
  `_bg_pick_flow_check()` both bail with *axes not homed - skipped*. The swap path is the
  one place it does not, because a print is homed by definition.
- **Neither other UI on this machine sends it.** multiACE's own dashboard composes a swap
  as unload-then-load (`web/frontend/app.js`, `loadSlot`), and its comment calls the other
  one *"ACE_SWAP_HEAD from the gcode file"*. HelixScreen's `AmsBackendMultiAce` does the
  same and says outright that it does not use it. The Device page was the only one of the
  three sending the print's macro from an idle-time button.

So the question that was written down here — *which verbs need Z, and should Swap be
greyed until the axes are homed* — dissolved rather than being answered. **No verb on this
panel needs a homed Z.** Homing stays the Control panel's command and no filament dialog
reaches for it.

**`ACE_BG_SWAP` is not the same case and did not change.** There is no `ACE_BG_LOAD` to
split it into — the family is `ACE_BG_SWAP`, `_UNLOAD`, `_SET_HEAD`, `_MOVE`, `_STATUS`
and nothing else — and `ace_bg_swap.py` emits **no motion G-code at all**: it drives the
parked head's extruder through a private trapq, which is precisely what lets it run
underneath a print, and what puts it out of reach of the kinematics check. Asked and
answered in round fifteen.

**What went with `ACE_SWAP_HEAD`**, and is worth knowing before anyone puts it back: the Z
hop, the XYZ/E position restore, `_pause_for_recovery`, `last_swap_result`, and
**`KEEP_HEAT` between the halves** — so the nozzle cools and reheats where a print-time
swap holds it. Neither of the other two UIs passes a temperature either, and picking one
here would be inventing a number. `last_swap_result` is still watched, because only that
macro writes it: what the watch now catches is the *print's* swap failing underneath a verb
someone started, which dooms that verb too.

### 2. `AUTO_FEEDING … LOAD=1` is the one inferred macro on this page

The unload pair is the machine's own, out of `SM_PRINT_END_AUTO_UNLOAD_FILAMENT`:

```
AUTO_FEEDING EXTRUDER={i} UNLOAD=1 STAGE=prepare
AUTO_FEEDING EXTRUDER={i} UNLOAD=1 STAGE=doing
```

The load pair is assembled from two evidenced halves — `LOAD=1` from `SM_PRINT_AUTO_FEED`
(`FEED_AUTO … LOAD=1 PRINTING=1`), the two stages from the unload above. **Every other
macro argument on this page was settled by sending it and reading the object back.** This
one has not been, and the shipped Flutter bundle has no feeder-load command at all to
compare against — the stock feeder auto-feeds on insert, which is what `wait_insert` means.

Worth knowing before trusting it: `MANUAL_FEEDING EXTRUDER=n` is the same wrapper over
`FEED_MANUAL`, and there is a whole `INNER_MANUAL_FEED_STAGE_*` family
(`PREPARE`/`EXTRUDE`/`FLUSH`/`FINISH`/`CANCEL`) that nothing here has looked at.

### 3. One real swap, watched — still

Everything measured is a machine at rest or a machine refusing. What `channel_state` does
*between* the halves, whether `swap_phase` says anything `channel_state` does not, and
whether the ~4 s ACE-fetch blip HelixScreen measured on firmware 20260722 holds here, all
need a swap actually running: three minutes of physical work and a purge. That is a
deliberate act on someone's printer, not something a suite should do. The script for it
should be separate, named for what it costs, and run by a person who means it.

`swap_in_progress`, `swap_phase` and `last_swap_result` are read now, and it took a
**failure** to capture the first value any of them has ever had.

### 4. `ACE_UNLOAD_ALL_CANCEL` has a home now and no evidence

Its exclusion reason used to be that nothing on screen waits for an unload. The blocking
dialog ended that. What the macro does to a head mid-retract has never been measured, and
a cancel that leaves filament somewhere unnamed is worse than finishing — so it stays out
until someone watches one.

### 5. Not yet re-checked against hardware

The occupancy fix was verified on `811002511261022618B3` (7/7), and the blocking dialog's
new failure text was confirmed from a real swap refusal. Not yet run on the machine:

- `drive/ace-verbs-real.js`'s new read-only section — the page's own cross-origin fetch of
  Moonraker's console. The header was checked with `curl`
  (`Access-Control-Allow-Origin: http://127.0.0.1:13619`) and the fetch is exercised in
  the simulator, but the two together have not run on hardware.
- The copy pass: nothing in it changes what is sent, but nothing in it has been read on a
  real machine either.

`--real` needs Orca **and** any other harness closed — it authenticates with the same
saved `clientId` and a broker evicts the older holder.

### 6. The panel still cannot say what a bay holds when nothing named it

`PROV.unknown` draws `occupied, not named`, which is honest and is where it stops. RFID
answers it, the override store answers it, and a bay with neither has no third source.
Spoolman is the obvious candidate — `ACE_SET_SPOOLMAN URL= AUTO=0|1` exists and the
settings menu opens a dialog for it — and nothing has been built on top of a configured
Spoolman yet. The visual standard already carries the weights-driven bay levels that would
go with it.

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
