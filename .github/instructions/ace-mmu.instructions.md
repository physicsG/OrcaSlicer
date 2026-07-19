---
description: Agent playbook for implementing ACE multi-material (MMU) support in Snapmaker Orca. Read this first before working on the feature.
applyTo: "src/slic3r/GUI/AceMmuProvider.*, src/slic3r/GUI/DeviceManager.*, docs/ace-mmu/**"
---

# AGENT PLAYBOOK — ACE MMU Support

You are implementing a **Multi-Material Source Provider** that exposes one or more
Anycubic ACE Pro / ACE 2 Pro units (on a Snapmaker U1) through Snapmaker Orca's
existing AMS machine model. **Read this file first, every session.**

- Branch: `feat/add-ace-mmu-support` (do NOT work on `main`).
- Build target: `Snapmaker_Orca`.
- Deliverable: working feature, green build, tests passing.

## 1. What you are building (in one paragraph)

A slicer-side component (`AceMmuProvider`) that reads ACE inventory + live state
from the printer-side multiACE service (`https://<printer-ip>/multiace/api/state`
REST + `/multiace/ws` WebSocket, or Moonraker directly) and writes it into the
U1 `MachineObject::amsList` as `Ams` (per ACE unit) and `AmsTray` (per slot). The
existing AMS UI, filament-mapping popup, and send-to-printer flow then work
unchanged, because Orca's `tray_index = ams_id*4 + tray_id` numbering is identical
to multiACE's `T = ace*4 + slot`.

## 2. Where the information is (read before coding)

Design docs live in `docs/ace-mmu/`. Read in this order:

| Read | File | Why |
|------|------|-----|
| 1 | `docs/ace-mmu/README.md` | Scope + the key numbering insight |
| 2 | `docs/ace-mmu/01-architecture.md` | Options; we chose **Option B** (slicer-side provider) |
| 3 | `docs/ace-mmu/02-multiace-printer-api.md` | Exact API/JSON/gcode you consume |
| 4 | `docs/ace-mmu/03-orca-ams-data-model.md` | `Ams`/`AmsTray`/`amsList`, how the U1 connects |
| 5 | `docs/ace-mmu/04-provider-design.md` | The component design + field-mapping table |
| 6 | `docs/ace-mmu/05-implementation-plan.md` | **Your task list** — phases + touch points |
| 7 | `docs/ace-mmu/06-slicing-gcode-mapping.md` | Tool indices, post-processing, send path |
| 8 | `docs/ace-mmu/07-testing-risks-open-questions.md` | Tests, edge cases, unresolved questions |

Key source files (this repo):
- `src/slic3r/GUI/DeviceManager.hpp/.cpp` — `MachineObject`, `Ams`, `AmsTray`,
  `amsList`, `parse_json` (AMS branch reads `jj["ams"]["ams"]`),
  `ams_filament_mapping`.
- `src/slic3r/Utils/MoonRaker.hpp/.cpp` — U1 transport (`Moonraker_Mqtt`).
- `src/slic3r/Utils/Http.hpp/.cpp` — HTTP client to use for REST.
- `src/slic3r/GUI/StatusPanel.cpp` (`update_ams`), `AmsMappingPopup.cpp`,
  `Widgets/AMSControl.*`, `Widgets/AMSItem.*` — AMS UI consumers.
- `src/libslic3r/ProjectTask.hpp` — `FilamentInfo { ams_id, slot_id, ... }`.

Reference repos (external, read-only): multiACE (`decay71/multiACE`,
`multiace/web/backend/main.py`, `multiace/tools/post_process_virtual_toolheads.py`),
Anycubic Slicer Next (`ANYCUBIC-3D/AnycubicSlicerNext`, reuses stock AMS model).

## 3. How to work

1. **Sync progress first.** Open `docs/ace-mmu/PROGRESS.md`; find the current
   phase and the "Next action". Continue from there.
2. **Follow the phased plan** in `docs/ace-mmu/05-implementation-plan.md`. Do one
   phase at a time; keep the build green after each.
3. **Prefer the existing patterns.** Mirror `parse_json`'s AMS loop when writing
   `amsList`; reuse the existing device-update/refresh event for the GUI; marshal
   all `amsList` writes to the GUI thread.
4. **Verify each change** with `get_errors` and by building the `Snapmaker_Orca`
   target. Add/adjust the Catch2 unit test in `tests/` for the snapshot parser.
5. **Update `docs/ace-mmu/PROGRESS.md`** at the end of every work session (see §5).
6. **Do not fabricate the multiACE API.** If a field/endpoint is not in
   `docs/ace-mmu/02-multiace-printer-api.md`, treat it as unverified — check the
   multiACE source or record it as an open question rather than guessing.
7. **When blocked on an open question** (`07 §7.4`), record it in PROGRESS.md
   under "Blockers/Questions" and continue with the parts that are unblocked; do
   not invent printer-side behaviour.

## 4. Guardrails

- Stay on `feat/add-ace-mmu-support`. Never commit to `main`.
- Additive only: do NOT regress the U1 experience when multiACE is absent
  (no provider attached → behaves exactly as today).
- Single writer for `amsList`: guard against the MQTT path and the provider
  clobbering each other (see `docs/ace-mmu/04-provider-design.md` §4.7).
- Never clear a good `amsList` on a transient fetch failure — keep last-good.
- No secrets in code/config. Reuse the U1's existing credentials/`dev_ip`.
- Match the repo style (`.clang-format`, `CamelCase` types, `snake_case`
  functions). Don't add comments/docs to code you didn't change.
- Keep commits concise and sentence-style (see `AGENTS.md`), one logical change
  each; the suggested breakdown is in `docs/ace-mmu/05-implementation-plan.md`.

## 5. How to store progress

**Two places, both required:**

### a) `docs/ace-mmu/PROGRESS.md` (the durable, in-repo log)
Update it at the end of every session. It is the single source of truth for
"where are we". Keep it terse. Record: current phase + status, what changed this
session (with file paths), the next concrete action, and any new
blockers/questions/decisions. Never delete history — append.

### b) Session memory (`/memories/session/`)
For in-flight working notes within a single conversation. At the start of a
session, reconcile session memory with `PROGRESS.md`; at the end, flush anything
durable into `PROGRESS.md`.

**Rule:** if it matters after this conversation ends, it goes in `PROGRESS.md`.

### c) Commits & PR
Each completed phase is one or more commits per the breakdown in
`docs/ace-mmu/05-implementation-plan.md`. Reference the phase in the commit
subject. Keep the PR description's checklist in sync with `PROGRESS.md`.

## 6. Definition of done (feature)

From `docs/ace-mmu/07-testing-risks-open-questions.md` §7.5: an ACE-equipped U1
shows every connected ACE unit + its 4 slots (material, colour, RFID, humidity)
in the AMS tab; the user can map project filaments to `(ACE, slot)`; a sliced
multi-colour job — after the documented post-processing — prints with correct
per-head swaps matching the UI; no regression without multiACE; unit tests cover
snapshot parsing + `amsList` population.

## 7. First action for a fresh agent

If `docs/ace-mmu/PROGRESS.md` shows Phase 0 not started: begin **Phase 0
(spike)** from `docs/ace-mmu/05-implementation-plan.md` — HTTP-GET
`/multiace/api/state` and log the parsed inventory — then record results in
`PROGRESS.md`.
