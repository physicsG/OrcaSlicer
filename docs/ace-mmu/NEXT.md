# Where this stopped, and what to do next

**Branch:** `feat/u1-printer-panel`, cut from `origin/develop/add-multiace-support`.
**Contents:** design docs and mockups only. **No code.** Read this before touching anything.

## What was produced

| File | What it is |
|------|------------|
| [15-printer-panel.md](15-printer-panel.md) | The panel design: five measured defects, Bambu's shape for four heads, the ACE mode switch, two defects it uncovered, touch points, shipping order |
| [16-ace-visuals.md](16-ace-visuals.md) | The ACE visual standard: three forms under one rule, the spool box, the moisture pill, where a fill level comes from |
| [17-plate-template.md](17-plate-template.md) | The U1 plate template: the measured silhouette, the path the app draws, and when a plate is photographed rather than drawn |
| [printer-panel-mockup.html](printer-panel-mockup.html) | The panel, interactive: six machine states, the sync flow, the assign popover, the mode dropdown |
| [ace-visual-standard.html](ace-visual-standard.html) | The badge and its twins, the spool box, the pill — with the rejected alternates kept as the record |
| [plate-thumbnails-options.html](plate-thumbnails-options.html) | The four plates in the card, the silhouette variants that were weighed, and the advanced-mode ones noted |

## Decisions taken — do not reopen without a reason

- **Panel shape:** Bambu Studio's, from `ui-snapshots-inspiration/`. Three cards across the
  top; a bordered box per head wrapped 2×2; one `Nozzle` diameter row, not four tabs.
- **Naming:** **Toolhead N**, everywhere. Printer Settings already says it; the sidebar
  said *Nozzle N* and the assignment dialog *T1–T4*.
- **No `Flow` row.** This fork deleted the control; there is no setting behind it.
- **ACE mode** is the printer's own three-way switch, mirrored as a labelled dropdown.
- **The assign popover is a choice, not a count** — two macros, so two kinds of row and a
  tick. Units named as the printer names them (*ACE 2 Pro* / *ACE Pro*).
- **ACE visuals:** badge **A · Cabinet** (44×26 fill), glyph **O2 · Solid bays** (44×26
  line), square **S4 · Front face** (24×24 line). One rule: outlined chassis, solid bays.
- **Plate visuals:** one measured silhouette, drawn **Emphasised**; photograph Snapmaker's
  own plates, draw everything else generically. Full spec in
  [17-plate-template.md](17-plate-template.md).
- **No single-bay glyph.** Every ACE unit has exactly four slots.

## Open — the only things still undecided

**1. Licensing of the plate photographs.** Three of the four plate thumbnails are built
from Snapmaker's product photography, used here as design reference the way
`ui-snapshots-inspiration/` holds Bambu's screenshots. Shipping them inside an
**AGPL-3.0** repository needs permission. What can ship: ask Snapmaker, photograph the
plates yourself, or draw all four the way Cool Steel already is. **This blocks the plate
card, nothing else** — and it is a swap of the fill, not a redesign: the silhouette,
sampling and sizes in [17-plate-template.md](17-plate-template.md) hold either way.

**2. Whether the dev tooling comes over.** `.claude/tools/` lives on
`feat/ace-mmu-slicing` and is absent here. Every verification step below assumes it. See
*Traps*.

Everything else about the panel, the ACE visuals and the plate template is decided and
written down. Where a decision was close, the alternates are kept in the mockups as the
record rather than deleted.

## Shipping order

Each step is one branch off `develop/add-multiace-support`, one squashed PR.

| # | PR | Depends on |
|---|-----|-----------|
| 0 | **These docs** (this branch) | — |
| 1 | **Panel structure** — collapse the four identical nozzle tabs to one `Nozzle` row; move sync out of the title bar onto a labelled card | — |
| 2 | **Topology in the preset** — `ace_head_capacity` / `ace_head_unit`, the Multimaterial settings page, `sync_ace_topology` | — |
| 3 | **The panel's ACE row** — badge, assign popover, ACE mode dropdown | 1, 2 |
| 4 | **Sync info, two-step** — nozzle + topology in one press, chaining to the filament sync | 3 |
| 5 | **Per-unit capacity pool** — the shared-unit fix. Must land before a user can share a unit | 2 |
| 6 | **Combined mode** — the emitter's slot → (unit, slot) map. Until then the mode is listed and disabled | 2 |
| — | **Plate card** — assets plus a card. Independent of everything above | a decision |

### PR 1, concretely

Both changes are in `src/slic3r/GUI/Plater.cpp` and need no new config.

1. `Sidebar::update_nozzle_settings` — check whether every `nozzle_diameter` value is
   equal; build **one** page named `Nozzle` when they are, one per head named
   **Toolhead N** when they are not. Safe: every existing use of
   `m_nozzle_diameter_lists` iterates the whole list and writes the same value, so a
   single entry is fine.
2. Move `m_printerinfo_syncbtn` off `m_panel_printer_title` onto a `StaticBox` card beside
   the printer card, with a `Sync info` label and the whole card as the click target. Keep
   the handler and the U1-only show/hide — retarget the show/hide to the card.

This was written once and reverted; it is straightforward, but it was **never compiled or
run**, so treat it as a sketch, not a patch.

## Facts established here — measured, not inferred

- **The live printer** at `192.168.2.242` reports `mode: "head"`, `device_count: 1`, one
  connected **ACE 2 Pro** (`protocol: "v2"`) at 39% RH feeding **Toolhead 4**, holding four
  Kingroon/Generic PETG spools (`#83AFFF`, `#8FA7C8`, `#632C2C`, `#C47053`).
- **The mode switch is real firmware:** `SET_ACE_MODE MODE=normal|multi|head [HEAD=n]`,
  with `ACE_SET_HEAD_ACE` / `ACE_SET_HEAD_FEEDER` documented "(head mode only)". Read from
  `/printer/gcode/help`.
- **One unit may feed several heads.** `ACE_SET_HEAD_ACE` binds a head to one ACE and says
  nothing about the reverse; `head_ace` is a map from head to unit.
- **A slot has no remain field.** Quantity comes from Spoolman via `spool_binding`
  (`{"0_0":"15","0_1":"10","0_3":"16"}` → `weight_g` 500.1 / 997.7 / 843.1). One of the
  four slots is unbound. A *percentage* is not derivable — the initial weight is not in
  the payload.
- **Icon SVGs go through nanosvg** (`BitmapCache.cpp:18`): paths and gradients only, no
  filters, no `<pattern>`, no CSS. Anything photographic must ship as PNG.
- **The repo is AGPL-3.0**, so shipped assets must be licence-compatible. Snapmaker's
  product photography is not.
- **The U1 connects as a `PrintHost`** through the webview, not as a `MachineObject`, so
  the panel cannot use `MachineObject::poll_ace_ams()`. Resolve a host with
  `AceMmuProvider::resolve_connected_host()` and read on demand.
- **Two defects found in existing code**, both in `15-printer-panel.md`: a shared unit
  double-counts capacity in `AceMmuPlan.hpp`; Combined mode emits the wrong `ACE=`/`SLOT=`
  in `GCode.cpp`.

## Traps on this branch

- **`develop/add-multiace-support` has no ACE code and no `docs/ace-mmu/` tree.** It is
  upstream v2.3.6. Everything from `feat/ace-mmu-slicing` — the provider, planner,
  dialogs, docs 01–14 — is absent.
- **`.claude/tools/` is absent too.** The headless-X harness, crash catcher and page
  checker live on `feat/ace-mmu-slicing`. Bringing them over early is worth its own PR:
  every step below is verified with them, and GUI claims made without them have been wrong
  three times in this feature.
- **Switching branches invalidates the build** — the first build after a switch is a full
  622-target rebuild, not an incremental one. Budget for it.
- **Profile edits need a version bump**, or the app keeps its cached copy in
  `~/.config/Snapmaker_Orca/system/` and the change silently does nothing.

## How to verify anything in the GUI

Reproduce, don't theorise. Three crashes in this feature were misdiagnosed from reading
code; each was settled in one run with the headless harness. Once `.claude/tools/` is on
this branch:

```
./.claude/tools/start.sh headless      # Xvfb :99 + Orca, crash catcher armed
./.claude/tools/start.sh shot x.png    # screenshot the virtual display
./.claude/tools/start.sh click X Y     # click on it
./.claude/tools/start.sh trace         # resolve the last crash to file:line
```

It runs against a copy of `~/.config/Snapmaker_Orca`, so it cannot disturb real presets.
