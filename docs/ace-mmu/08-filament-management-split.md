# 08 · Filament Management split (U1 toolheads + ACE slots) — plan

**Goal.** Prepare's "Filament Management" should show project filaments alongside
**both** filament sources — the **U1 toolheads** (directly loaded at each head) and
the **ACE slots** (spools in the ACE) — and let the user map project filaments to
them **without dropping any**. Mockup: `filament-management-mockup.html`.

## The bug we're fixing

`PresetBundle::sync_ams_list` (driven by the legacy "Sync from AMS" button,
`ams_btn`) **replaces** the whole project filament list with only the entries in
`filament_ams_list` — and we only put the ACE slots there. Result: the U1 toolhead
filaments are wiped. It's a destructive "replace-all", wrong for the U1's mixed
sources. (`Sidebar::sync_ams_list`, `Plater.cpp`; `PresetBundle.cpp`.)

## What the investigation established

- **Flat filament model.** `combos_filament[i]` ↔ `filament_presets[i]` ↔
  `project_config "filament_colour"[i]` ↔ gcode tool `T<i>` ↔ AMS `tray_index`.
  There is **no filament→tool remap layer** in this fork.
- **Count is free** (not clamped to physical extruders; the old clamp is `#if 0`'d),
  up to `MAXIMUM_FILAMENT_NUMBER = 64`. So a project can hold any number of filaments.
- **ACE already maps at send.** `apply_ace_snapshot` puts each ACE unit→`Ams`,
  slot→`AmsTray` with `tray_index = ams*4 + slot = T = ace*4 + slot`, and
  `ams_filament_mapping` consumes that unchanged. So the physical (ace,slot)
  assignment is a **send-time** concern, not part of the filament list.
- **Reusable, non-destructive UI exists.** `filamentsync/`:
  - `FilamentData {index, name, type, color}` — the neutral row model.
  - `FilamentColorMapBoxGroup(parent, designDataList, machineDataList)` — a two-column
    "project ↔ machine" mapping grid with per-row `MachineFilamentPicker`.
  - `SyncFilamentColorDialog(parent, designDataList, machineDataList)` — wraps the
    group; returns `getSyncDataList()`, `getFilamentIdRemap()`,
    `isAddUnUsedMachineFilaments()`. This is the U1's *modern* "Sync Filament
    Information" path (`Sidebar::show_sync_filament_dialog`), and it is **not**
    destructive — it maps and can add unused machine filaments.
- **Riskiest coupling:** the sidebar's flat 2-column combo grid (`filament_idx % 2`,
  3-row scroll math). Any new *in-sidebar* grouped widget fights this arithmetic.

## Decision: reuse the non-destructive path, feed it both sources

Rather than build a new grouped widget inside the fragile sidebar grid, **feed the
ACE inventory into the existing `SyncFilamentColorDialog` machine list**, alongside
the U1 toolheads, each row tagged by source. This reuses proven components, is
non-destructive by construction, and avoids the 2-column-grid coupling.

Concretely the "machine filament list" (`machineDataList`) becomes two labelled
groups:
- **U1 toolheads** — from SSWCP `m_connect_machine_info_list` (already built by
  `build_machine_filament_list`); these are the directly-loaded head filaments.
- **ACE slots** — built from a fresh `AceMmu::AceSnapshot` (via
  `AceMmuProvider::resolve_connected_host` + `fetch_once`), one `FilamentData` per
  occupied slot, name/type/colour from the slot.

The user maps each project filament to a toolhead or an ACE slot; "add unused"
brings in sources not yet in the project — so **nothing is dropped**.

### Head vs slot (resolved)
Because tool index == flat filament index and ACE↔tool mapping is applied at send
(`ams_filament_mapping`, `tray_index = ace*4+slot`), the filament list itself is
mode-agnostic: it just needs the right colour/type per project filament. Mode only
changes what the *machine list* contains and how send maps:
- **Head mode:** machine list = the 4 toolheads (each shown with its source: ACE /
  feeder / manual). Map project filaments → heads.
- **Multi mode:** machine list = the active ACE's occupied slots. Map → ACE slots
  (`T = ace*4+slot`).
- **Normal:** single direct spool.
The split UI shows both groups for context; the *mappable* set follows the mode.

## Implementation steps

1. **ACE → FilamentData.** Add a helper (e.g. in `AceMmuProvider` or a small util)
   `std::vector<FilamentData> ace_slots_as_filament_data(const AceSnapshot&)` — one
   entry per occupied slot (name "ACE A · A1", type, colour), plus a source tag.
2. **Extend the machine list.** In `Sidebar::show_sync_filament_dialog`
   (`Plater.cpp`), after `build_machine_filament_list(...)`, append the ACE-slot
   `FilamentData` to `machineDataList` (fetch snapshot via the provider). Tag/group
   entries "U1 toolhead" vs "ACE" for display.
3. **Group labels in the mapping grid.** Minimal: prefix names by source. Better:
   extend `FilamentColorMapBoxGroup` to render two labelled sections (low-risk,
   additive — it already lays out N rows). Decide during implementation.
4. **Make "Sync from AMS" non-destructive for the U1.** Either (a) hide the legacy
   `ams_btn` for the U1 and route everything through the (non-destructive) sync
   dialog, or (b) keep it but have it *add/merge* rather than replace. Prefer (a).
5. **Preserve U1 toolheads.** The sync dialog's "add unused machine filaments" +
   remap (`getFilamentIdRemap`) keeps existing project filaments; verify toolhead
   filaments survive a sync.

## Risks / open items
- `FilamentColorMapBoxGroup` grouping (step 3) — if extending it is more than
  cosmetic, fall back to name-prefixing for v1.
- A head fed *by* an ACE slot appears in both groups (head + slot). Show the head's
  source chip (ACE A · A_i) so the relationship is clear rather than looking like a
  duplicate.
- Send flow for the U1 currently goes through `WebPreprintDialog` (webview), not the
  native `AmsMappingPopup`; the *tool→(ace,slot)* assignment at send is a separate
  Phase‑4 item and out of scope for this display/mapping change.
- ACE units are assumed ≤4 slots (the `*4` tray-index scheme).

## Testing
- Connect U1 over LAN with ACE spools + toolhead filaments loaded.
- Open the (non-destructive) filament sync; confirm **both** U1 toolheads and ACE
  slots appear, project filaments are preserved, and mapping works.
- Confirm the legacy "Sync from AMS" no longer wipes U1 filaments (hidden or merged).
