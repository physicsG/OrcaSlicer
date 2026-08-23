# The U1 printer panel (Prepare / Preview)

Interactive mockup: [printer-panel-mockup.html](printer-panel-mockup.html) ·
Visual standard: [16-ace-visuals.md](16-ace-visuals.md)

> **Status: design only. No code has landed.** This branch carries the docs and mockups;
> every implementation step below is still to do. The ACE machinery referenced here —
> `ace_head_capacity` / `ace_head_unit`, `AceMmuProvider`, `sync_ace_topology`,
> `AceMmuPlan` — lives on `feat/ace-mmu-slicing` and does not exist on
> `develop/add-multiace-support` yet. Start from [NEXT.md](NEXT.md).

**Prepare and Preview share one sidebar.** The Printer section at the top of it is a
single widget seen in two tabs, so this is one change in two places — and anything
added to it is also on screen while reading a sliced preview, where vertical space is
contested.

## What is wrong today

Measured by running the app, not by reading it (`.claude/tools/start.sh headless`).

| # | Defect | Where |
|---|--------|-------|
| 1 | **Four tabs hold one control each.** `Nozzle 1..4`, each with a `Diameter` combo; changing any one writes all four and switches the whole preset, because the U1 refuses mixed diameters. Three tabs exist to be clicked and show nothing new. | `Sidebar::update_nozzle_settings`, Plater.cpp:8682 |
| 2 | **Three names for one thing.** Sidebar says *Nozzle 1–4*, Printer Settings says *Toolhead 1–4*, the assignment dialog says *T1–T4*. | Plater.cpp:8814, Tab.cpp:4808, `resources/web/aceplan` |
| 3 | **No topology.** The preset knows head 4 is fed by ACE 1 with four slots (`ace_head_capacity`, `ace_head_unit`); the panel never says so. | — |
| 4 | **No contents, and no way to ask.** The spool colours at each head are known when the printer is on the LAN — they already drive the filament sync — but never reach this panel. | `append_ace_filament_list`, Plater.cpp:773 |
| 5 | **Two half-syncs.** The sidebar glyph syncs nozzle diameters only; multiACE topology sync is a separate button buried in Printer Settings › Multimaterial. | Plater.cpp:2214, Tab.cpp:4652 |

## The shape: a mature multi-head panel, for four heads

Taken piece by piece from the reference slicer this panel is modelled on - a two-nozzle
machine's printer section, which solves most of the same problems already.

- **Three cards across the top** — printer (thumbnail over preset combo), plate
  (texture swatch + ⓘ, absorbing today's `Bed type` row), and **Sync info**.
- **A green corner tick** on any card that agrees with the connected machine. On a head
  box it means the ACE wiring matches what the printer reports — a claim we can make,
  because `sync_ace_topology` already computes exactly that diff.
- **A bordered box per head**, the reference's Left/Right Nozzle panes wrapped **2×2**: an
  `ACE` row (badge when a unit feeds it, `Stock feeder` otherwise, adjust button always)
  and a `Diameter` row. No `Flow` row — this fork deleted the control and there is no
  setting behind it.
- **One `Nozzle` row**, not four tabs. Per-head diameters return only if the U1 ever
  allows mixed sets; a machine reporting differing diameters still routes to the
  existing `NozzleDiameterSelectDialog`.
- **Sync in two steps** — *Successfully synchronized nozzle, ACE mode and ACE unit
  information* → **[Continue to sync filaments] [Cancel]**, anchored over the viewport.
  Step two opens the existing `Sidebar::show_sync_filament_dialog`.

## ACE mode — the printer's own switch

Verified against firmware (`/printer/gcode/help` on 192.168.2.242):

```
SET_ACE_MODE MODE=normal|multi|head [HEAD=n]
ACE_SET_HEAD_ACE     HEAD=0..3 ACE=0..3   "each ACE head is wired to exactly one ACE"
ACE_SET_HEAD_FEEDER  HEAD=0..3 ENABLE=0|1 "(head mode only)"
```

The panel mirrors it as a labelled dropdown — **Normal** / **Per toolhead** /
**Combined** — with the raw `SET_ACE_MODE MODE=…` in the tooltip. Only in **head** mode
does per-toolhead wiring mean anything, so the head boxes grey their ACE rows in Normal.
Sync info reads the mode back along with the wiring.

## The assign popover

A **choice**, not a count: the firmware offers exactly two macros, so the list has
exactly two kinds of row and a tick rather than a spinner.

```
Which ACE feeds Toolhead 4?
  ⬡  Stock feeder            One spool, loaded at the head          ( )
  ▤  ACE 1 · ACE 2 Pro       4 slots · connected · 39% RH           (✓)
```

Units are named as the printer names them — `protocol: "v2"` → **ACE 2 Pro**, `"v1"` →
**ACE Pro** — the same mapping `resources/web/multiace/index.html` already uses. Between
them the rows write exactly `ace_head_capacity` and `ace_head_unit`.

**One unit may feed several heads.** `ACE_SET_HEAD_ACE` binds a head to one ACE; it says
nothing about an ACE feeding one head, and `head_ace` is a map from head to unit. Ticking
the same unit on a second head is therefore legal, each row then reads *also feeds
Toolhead N*, and a warning states the real capacity.

## Two defects this uncovered

1. **A shared unit double-counts capacity.** `AceMmuPlan.hpp` sums capacity per head
   (`total_cap += cap[h]`) and enforces it per head (`if (++load[h] > cap[h])`). Two
   heads on one 4-slot unit read as **8 places** when there are 4, so the
   infeasible-plate refusal — whose whole purpose is catching this — would pass a plate
   that cannot be laid out. Needs a per-unit pool constraint beside the per-head one.
2. **Combined mode cannot be emitted.** `ace_head_capacity` already offers *6 slots* and
   *8 slots*, but `GCode.cpp`'s `unit_of_head()` returns the single `ace_head_unit[h]`
   and the plan's slot is an index *within the head*. Slot 5 of an 8-slot head emits
   `ACE=<first unit> SLOT=5` where the machine needs `ACE=<second unit> SLOT=1` — wrong
   unit, wrong slot, wrong colour. Those enum values are unsafe until the emitter maps
   slot → (unit, slot).

## Touch points

| Piece | Where | State |
|-------|-------|-------|
| The panel | `Plater.cpp:2199–2565` | Title bar, preset card, Bed type row, nozzle notebook — built once in the Sidebar constructor |
| The head boxes | `Sidebar::update_nozzle_settings`, `Plater.cpp:8682` | Rebuilds one page per `nozzle_diameter` entry; becomes a 2×2 grid |
| Sync, nozzles | `Plater.cpp:2214–2350` | Queries the machine, `NozzleDiameterSelectDialog` on mixed diameters. Keep; becomes half the press |
| Sync, topology | `TabPrinter::sync_ace_topology`, `Tab.cpp:4652` | Reads `/multiace/api/state`, diffs per head, reports. Lift out of `TabPrinter` so the sidebar can call it |
| Sync, filaments | `Sidebar::show_sync_filament_dialog`, `Plater.cpp:8467` | Already lists U1 toolheads *and* ACE slots. What *Continue to sync filaments* opens |
| Topology | `ace_head_capacity`, `ace_head_unit` | Per-head `coInts` in the printer preset — the panel works with the printer off |
| Live contents | `AceMmuProvider`, `AceSnapshot` | Units, slots, colours, humidity, per-head bindings. One `fetch_once()` |

**Before building:** the U1 connects as a `PrintHost` through the webview, not as a
`MachineObject`, so this panel cannot lean on `MachineObject::poll_ace_ams()`. It
resolves a host with `AceMmuProvider::resolve_connected_host()` and reads on demand —
the other reason press-to-sync fits the U1 better than a background poll.

## Shipping order

Each is one branch off `develop/add-multiace-support`, one squashed PR.

1. **Panel structure** — three cards, 2×2 head boxes, one Nozzle row, `Toolhead N`
   naming, plate card absorbing Bed type. No ACE; no new config. Self-contained.
2. **Topology in the preset** — `ace_head_capacity` / `ace_head_unit`, the Multimaterial
   settings page, `sync_ace_topology`.
3. **The panel's ACE row** — badge, assign popover, ACE mode dropdown, on top of 1 + 2.
4. **Sync info, two-step** — nozzle + topology in one press, chaining to the filament sync.
5. **Per-unit capacity pool** — the shared-unit fix. Before any user can share a unit.
6. **Combined mode** — the emitter's slot → (unit, slot) map. Until then the mode is
   listed and disabled, with the reason on it.
