# 05 · Implementation Plan

A phased plan. Each phase is independently testable and leaves the build green.
File paths are relative to the repo root.

## Phase 0 — Spike: prove the data path (no UI wiring)

**Goal:** fetch `/multiace/api/state` from a real (or mocked) U1 and print the
parsed ACE inventory to the log.

- Add a throwaway function that HTTP-GETs `http://<ip>/multiace/api/state` using
  `src/slic3r/Utils/Http.hpp` and logs `device_count` + each slot's
  `material`/`color`.
- Validate the JSON schema against a live printer or the captured sample in
  [02-multiace-printer-api.md](02-multiace-printer-api.md).

**Exit:** log shows correct units/slots. Delete or fold into Phase 1.

## Phase 1 — `AceMmuProvider` skeleton + REST polling

Files:
- **Add** `src/slic3r/GUI/AceMmuProvider.hpp` / `.cpp`.
- **Edit** `src/slic3r/CMakeLists.txt` — register the two files.

Work:
- Implement `AceSnapshot` parsing from `/api/state` (or `/api/aces`).
- Implement `start()/stop()` with a REST poll loop (2–5 s) on a worker thread;
  marshal results to the GUI thread.
- Do **not** write `amsList` yet — just cache the snapshot and expose a getter.

**Exit:** provider connects and maintains a fresh `AceSnapshot`; unit test parses
a sample JSON payload into `AceSnapshot`.

## Phase 2 — Populate `amsList` + capability detection

Files:
- **Edit** `src/slic3r/GUI/DeviceManager.hpp/.cpp` — add a
  `AceMmuProvider* m_ace_provider` (or `std::unique_ptr`) member to
  `MachineObject`; add a capability flag (e.g. `bool is_ace_mmu{false}`) and a
  helper `bool is_snapmaker_u1()` (derive from `printer_type`/series).
- **Edit** `AceMmuProvider.cpp` — implement `apply_snapshot()` per the field
  table in [04 §4.5](04-provider-design.md).

Work:
- On snapshot: find-or-create `Ams`/`AmsTray`, set fields, set `ams_exist_bits`
  / `tray_exist_bits`, prune stale entries, keep last-good on failure.
- Ensure `has_ams()` becomes true and `is_support_ams_mapping()` stays true for
  the U1.
- Attach/detach the provider from the U1 `MachineObject` lifecycle
  (`DeviceManager` where machines are created/selected).

**Capability detection options** (pick the least intrusive that works):
1. Probe `GET /multiace/api/health` on connect; if 200 → ACE-capable, attach.
2. A printer-profile flag in `resources/profiles/Snapmaker*` (a boolean like
   `support_ace_mmu`) — explicit, offline-detectable.
3. `printer_type`/series check for the U1.

**Exit:** selecting an ACE-equipped U1 fills `amsList`; `has_ams()` true;
logging shows units/slots.

## Phase 3 — GUI surfaces (mostly free)

Because the AMS widgets already read `amsList`, this phase is mainly
**verification + refresh wiring**:

- **Edit** `src/slic3r/GUI/StatusPanel.cpp` — ensure `update_ams(obj)` is invoked
  after provider snapshots (post the existing device-update event from the
  provider). Confirm ACE humidity/dryer render.
- **Verify** `src/slic3r/GUI/AmsMappingPopup.cpp` shows ACE units with correct
  `ams_id`/`slot_id` in the filament→slot picker.
- **Verify** `src/slic3r/GUI/SelectMachine.cpp`
  (`reset_and_sync_ams_list`) shows the ACE trays in the send dialog.

Adjust AMS icons/labels for ACE branding only if desired (`AMSItem`,
`AMSControl`).

**Exit:** AMS tab + mapping popup + send dialog display ACE units/slots.

## Phase 4 — Slicing / send-to-printer correctness

See [06-slicing-gcode-mapping.md](06-slicing-gcode-mapping.md) for the full
detail. Work items:

- Confirm `ams_filament_mapping()` produces `ams_id`/`slot_id` for ACE units and
  that `tray_index = ams_id*4 + slot_id` = the intended `T`.
- Ensure the exported gcode's tool indices (`T<n>`) follow `n = ace*4 + slot` so
  multiACE's post-processor rewrites them into `ACE_SWAP_HEAD`.
- Decide how post-processing is invoked (slicer post-process script vs. printer
  preflight) and document it for users.

**Exit:** a multi-ACE project slices and, after post-processing, prints with
correct swaps on a real U1.

## Phase 5 — Write actions & polish (optional)

- Wire optional buttons (Switch ACE / Load / Unload / Dry) to
  `AceMmuProvider::cmd_*` → `POST /multiace/api/macro` (or MQTT command path).
- WebSocket transport (replace/augment REST poll) for 1 Hz live updates.
- Preset resolution for `setting_id` (material+brand → filament preset id).
- Localization strings; settings (poll interval, enable/disable provider).

## Cross-cutting: build & test

- Build target: `Snapmaker_Orca` (see `CLAUDE.md` / `AGENTS.md`).
  ```
  cmake --build build --target Snapmaker_Orca --config Release --parallel
  ```
- Add a Catch2 test under `tests/` that feeds a captured `/api/state` JSON into
  the snapshot parser and asserts the resulting `Ams`/`AmsTray` values +
  `ams_exist_bits`/`tray_exist_bits`. This is the highest-value unit test and
  needs no network.

## Suggested commit breakdown (matches repo's concise style)

1. `Add AceMmuProvider skeleton with REST polling of multiACE API`
2. `Parse multiACE /api/state into AceSnapshot (+ unit test)`
3. `Populate MachineObject::amsList from ACE inventory`
4. `Detect ACE-capable Snapmaker U1 and attach provider`
5. `Refresh AMS UI from ACE provider snapshots`
6. `Map ACE units/slots through AMS filament mapping`
7. `(optional) ACE load/unload/switch actions + WebSocket transport`

## Touch-point checklist

| File | Change |
|------|--------|
| `src/slic3r/GUI/AceMmuProvider.hpp/.cpp` | **new** — provider component |
| `src/slic3r/CMakeLists.txt` | register new files |
| `src/slic3r/GUI/DeviceManager.hpp` | `MachineObject`: provider member, `is_ace_mmu`, `is_snapmaker_u1()` |
| `src/slic3r/GUI/DeviceManager.cpp` | attach/detach provider; capability detect; (maybe) reconcile with `parse_json` |
| `src/slic3r/GUI/StatusPanel.cpp` | trigger `update_ams` on provider refresh |
| `src/slic3r/GUI/AmsMappingPopup.cpp` | verify ACE `ams_id`/`slot_id` (likely no change) |
| `src/slic3r/GUI/SelectMachine.cpp` | verify send-dialog AMS list (likely no change) |
| `resources/profiles/Snapmaker*` | (optional) `support_ace_mmu` capability flag |
| `tests/…` | snapshot-parse unit test |
