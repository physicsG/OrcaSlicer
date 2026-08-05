# PROGRESS — ACE MMU Support

> Durable progress log for the ACE MMU feature. Update at the end of every work
> session. Terse, append-only. See [AGENT.md](AGENT.md) §5 for the rules.
> Single source of truth for "where are we".

## Snapshot

- **Branch:** `feat/add-ace-mmu-support`
- **Current phase:** Phase 0 — not started (design validated 2026-08-05)
- **Overall status:** 🟡 Design complete + independently validated against source;
  implementation not started.
- **Next action (fresh session, read this first):** No code has been written yet.
  Decide execution scope with the user (options below), then begin. If the Cowork
  Linux sandbox is available (run a `bash` probe: `git`, `cmake`, `python3`, `curl`),
  do the real **Phase 0 spike** — `GET http://192.168.2.242/multiace/api/state`,
  parse it, log `device_count` + each slot's `material`/`color` — then Phase 1.
  If the sandbox is still unavailable, fall back to writing code via file tools and
  hand builds to the user (see Session log 2026-08-05 for why).

### Pending decision — execution scope (ask the user, then proceed)
1. **Phases 1–2 + unit test, then pause** — provider skeleton, CMake registration,
   `amsList` population, U1 capability detection, Catch2 snapshot-parse test; user
   builds/reviews the core before continuing. *(safest — recommended)*
2. **All phases 0–4 in one pass** — full draft for the user to build.
3. **Phase-by-phase, pause after each** — most controlled, most round-trips.
User leaned toward first getting a real build environment (Hyper-V) working before
committing to unverified code. Re-confirm on pickup.

### Environment notes (2026-08-05 session)
- Cowork **Linux sandbox was unavailable** ("failed to start / not supported on this
  device") for the entire session → could not `cmake` build `Snapmaker_Orca`, run
  Catch2 tests, use `git`, or `curl` the printer. File tools (Read/Write/Edit) worked
  fine on the repo. User enabled Hyper-V; a reboot + fresh session is needed for the
  VM to (maybe) come up. **First thing next session: re-probe the sandbox.**
- `web_fetch` reaches `http://192.168.2.242/multiace/api/state` but returns an **empty
  body** (service is behind nginx `auth_request`). If no sandbox `curl`, use the
  Chrome browser tools (`navigate` + `get_page_text`) to read the live JSON, or have
  the user paste a sample.
- U1 reachable at **192.168.2.242**; firmware branch `feat/filament-rfid-write`;
  multiACE on branch `feat/bowden-path-calibration`. Repos are nested one level deep,
  e.g. the Orca git root is `OrcaSlicer_multiace/OrcaSlicer/` (HEAD =
  `feat/add-ace-mmu-support`).

## Phase checklist

Phases and exit criteria are defined in
[05-implementation-plan.md](05-implementation-plan.md).

- [ ] **Phase 0** — Spike: prove the data path (fetch `/api/state`, log inventory)
- [ ] **Phase 1** — `AceMmuProvider` skeleton + REST polling → `AceSnapshot`
- [ ] **Phase 2** — Populate `amsList` (+ bits) + ACE-capable U1 detection
- [ ] **Phase 3** — GUI surfaces refresh from provider snapshots
- [ ] **Phase 4** — Slicing / send-to-printer correctness (tool indices, post-proc)
- [ ] **Phase 5** — Write actions (load/unload/switch/dry) + WebSocket + polish

## Decisions log

Record every non-obvious choice here so future sessions don't relitigate it.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-19 | Use **Option B** (slicer-side provider polling multiACE) | Matches the goal; self-contained; stock multiACE works. See [01-architecture.md](01-architecture.md) §1.3 |
| 2026-07-19 | Map ACE unit → `Ams(id)`, slot → `AmsTray(id)` | `tray_index = ams_id*4 + tray_id` == multiACE `T = ace*4 + slot` |

## Blockers / open questions

Mirror of [07-testing-risks-open-questions.md](07-testing-risks-open-questions.md)
§7.4 — update status as they're resolved.

- [ ] Can ACE state ride the existing U1 MQTT stream (would enable Option A, no HTTP)?
- [ ] Is `http://<ip>/multiace/api/state` reachable without a Moonraker token on stock firmware?
- [ ] How does Orca submit U1 prints (Moonraker upload)? Is mapping carried only in gcode tool indices?
- [ ] Does the U1 profile export `T<n>` per filament? Can we emit physical `ace*4+slot` indices (design A)?
- [ ] Capability detection: probe `/api/health` vs. printer-profile flag?
- [ ] First release: `multi` mode only, defer `head` mode?

## Session log

Newest first. One block per session: date, what changed (files), result, next.

### 2026-08-05 — Plan validation + environment triage (no code)
- Read all design docs (`README`, `01`–`07`, `AGENT.md`, this file).
- **Validated the plan against real source** (nothing fabricated):
  - `Ams` / `AmsTray` / `MachineObject` fields the design maps to all exist as
    documented in `src/slic3r/GUI/DeviceManager.hpp` — `Ams{id,left_dry_time,
    humidity,humidity_raw,current_temperature,is_exists,trayList,nozzle,type}`
    (ctor `Ams(id,nozzle_id,type_id)`); `AmsTray{id,tag_uid,setting_id,
    filament_setting_id,type,sub_brands,color,wx_color,is_exists,decode_color()}`.
  - `MachineObject`: `amsList`, `ams_exist_bits`, `tray_exist_bits`,
    `has_ams()` (= `ams_exist_bits!=0`), `is_support_ams_mapping()` (defined
    ~L849; today effectively returns true), `ams_filament_mapping()` all present.
  - `MAIN_NOZZLE_ID` and `INVALID_AMS_TEMPERATURE` are real and in use.
  - The linchpin holds: `tray_index = ams_id*4 + tray_id` in `ams_filament_mapping`
    == multiACE `T = ace*4 + slot`. Provider-only integration is sound.
  - multiACE source present locally to cross-check the API doc:
    `multiACE/multiace/web/backend/main.py`,
    `.../tools/post_process_virtual_toolheads.py`, `.../config/extended/ace.cfg`.
- **Verdict:** plan is complete, well-structured, and technically accurate. The
  listed "open questions" (Moonraker auth for HTTP path, capability detection
  approach, how/when post-processing is invoked) are correctly scoped as
  decisions-to-make, not gaps. No doc changes needed before coding.
- **Result:** design confirmed ready to implement; **no production code written**
  (blocked on build environment + scope decision — see Environment notes above).
- **Next:** re-probe sandbox in a fresh session; confirm execution scope; then
  Phase 0 spike / Phase 1.
- New blockers: Cowork Linux sandbox unavailable (VM failed to start).

### 2026-07-19 — Design & docs
- Researched multiACE, Anycubic Slicer Next, and the Orca AMS model.
- Wrote design docs `docs/ace-mmu/README.md` + `01`–`07`, plus `AGENT.md` and this file.
- **Result:** design complete; no code yet.
- **Next:** Phase 0 spike.

<!-- Template for new entries:
### YYYY-MM-DD — <short title>
- Changed: <files/functions>
- Result: <built? tests? what works>
- Next: <one concrete action>
- New decisions/blockers: <if any; also add to the tables above>
-->
