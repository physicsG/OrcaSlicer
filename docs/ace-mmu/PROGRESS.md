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

- [x] **Phase 0** — Spike: prove the data path (fetch `/api/state`, log inventory) ✅ live
- [x] **Phase 1** — `AceMmuProvider` skeleton + REST polling → `AceSnapshot` ✅
  (parser `AceMmuState.hpp` + unit test green; GUI `AceMmuProvider` polls/caches, compiles into app)
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
| 2026-08-05 | Put `AceSnapshot` + parser in `src/libslic3r/AceMmuState.hpp` (not the GUI `AceMmuProvider.hpp` as doc 04 sketched) | Keeps the parser free of wx/`MachineObject` so it unit-tests under `tests/libslic3r` (links `libslic3r` only, not GUI). Mirrors the sibling branches' header-only pattern. GUI `AceMmuProvider::apply_snapshot` will project `AceSnapshot`→`amsList`. |
| 2026-08-05 | Live `humidity` (=49) → `Ams::humidity_raw`, not `Ams::humidity` | Real firmware reports raw **percent**, not the 1..5 bucket doc 04's table assumed. `Ams` already has a dedicated `humidity_raw` field; derive/leave the 1..5 `humidity` bucket separately. |
| 2026-08-05 | Parser tolerates `ace_status`/`status` as string **or** int; never throws | Live firmware returns `ace_status:"ready"` (string), contradicting doc 02's `int|null`. Parser degrades malformed/partial payloads to empty rather than throwing, so a bad fetch never clears good inventory. |
| 2026-08-05 | Keep plan's raw-`/api/state` architecture; borrow non-conflicting bits from sibling `MultiAce*` branches | User direction. Reused so far: header-only libslic3r placement, defensive JSON-helper style, and a captured-payload test fixture. The sibling normalized-schema parser (`MultiAceInventory`) conflicts (different schema) and is **not** used. |

## Blockers / open questions

Mirror of [07-testing-risks-open-questions.md](07-testing-risks-open-questions.md)
§7.4 — update status as they're resolved.

- [ ] Can ACE state ride the existing U1 MQTT stream (would enable Option A, no HTTP)?
- [x] ~~Is `http://<ip>/multiace/api/state` reachable without a Moonraker token on stock firmware?~~
  **RESOLVED 2026-08-05:** yes. `GET http://192.168.2.242/multiace/api/state` returns 200
  unauthenticated over plain HTTP (also `/api/health`), reachable from WSL. multiACE `0.99.6.1b`.
- [ ] How does Orca submit U1 prints (Moonraker upload)? Is mapping carried only in gcode tool indices?
- [ ] Does the U1 profile export `T<n>` per filament? Can we emit physical `ace*4+slot` indices (design A)?
- [ ] Capability detection: probe `/api/health` vs. printer-profile flag? (`/api/health` confirmed live.)
- [ ] First release: `multi` mode only, defer `head` mode? **NB:** the live printer runs in
  `mode:"head"` (with `head_feeder`/`head_ace` maps), so head mode is the real-world default —
  the "multi only" first-release assumption needs revisiting before Phase 4.
- [ ] `humidity` bucketing: live value is raw percent (49). Decide the 0–100 → 1..5 mapping for
  `Ams::humidity` (or leave the bucket unset and surface `humidity_raw` in the UI).

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

### 2026-08-05 — Phase 0 spike (live) + Phase 1 parser
- Discovered a large parallel multiACE implementation on sibling branches (PRs #28/#30/#35,
  ~250–273 commits) using a different architecture; per user direction, kept this plan and
  reused only non-conflicting pieces. Moved onto local `feat/add-ace-mmu-support` (was detached).
- **Phase 0 (done, live):** `GET http://192.168.2.242/multiace/api/state` over plain HTTP,
  unauthenticated, from WSL. Parsed inventory: 1× ACE 2 Pro (idx 0, `v2`, connected, humidity 49),
  slot 0 = PETG Kingroon Silver `#83afff` (override), slot 3 = PETG Kingroon Gray `#8fa7c8`,
  slots 1–2 empty. Printer in `head` mode. Captured payload saved as a test fixture.
- **Phase 1 (partial):**
  - Added `src/libslic3r/AceMmuState.hpp` — `AceSlot`/`AceUnit`/`AceSnapshot` + `parse_ace_state()`
    for the raw `/api/state` schema, plus `ace_color_to_rrggbbaa()`. Header-only, hardened, no GUI deps.
  - Added `tests/libslic3r/test_ace_mmu_state.cpp` (+ registered in `tests/libslic3r/CMakeLists.txt`)
    driven by `tests/data/ace_mmu/state_live_v0.99.6.1b.json` (+ provenance README) and inline cases.
- **Result:** parser + test written **and now green**. Built deps (`build_linux.sh -d`) and the
  `libslic3r_tests` target; `libslic3r_tests "[ace_mmu]"` → 5 cases / 48 assertions pass, incl. the
  live-fixture parse. (Env gotcha: `build_linux.sh -d -u` runs `apt` then `exit 0` from the sourced
  `scripts/linux.d/debian` — so `-u` and `-d` must be run as separate invocations.)
- **Next:** write the GUI `AceMmuProvider` (REST poll → cache `AceSnapshot`); then Phase 2 `amsList`.

### 2026-08-05 — Phase 1 GUI provider (compiles into app)
- Built the toolchain path end-to-end: `deps` built (`build_linux.sh -d`), configured `build/`
  with `-DBUILD_TESTS=ON`, built `libslic3r_tests` (parser test green) and the full
  `Snapmaker_Orca` app.
- Added `src/slic3r/GUI/AceMmuProvider.{hpp,cpp}` (registered in `src/slic3r/CMakeLists.txt`):
  worker-thread REST poll of `http://<host>/multiace/api/state` via `slic3r/Utils/Http.hpp`
  (`perform_sync`), parses with `AceMmu::parse_ace_state`, caches last-good `AceSnapshot` behind
  a mutex, `revision()` bump per refresh, condition-variable poll sleep, `start()/stop()` (RAII).
  Keeps last-good on transient/garbage reads (non-object body → skip). No `amsList` write yet.
- **Deviation from doc 04 sketch:** ctor takes `host` (string), not `MachineObject*` — keeps Phase 1
  decoupled/compilable; the `MachineObject` wiring + `apply_snapshot()` land in Phase 2.
- **Result:** `AceMmuProvider.cpp` compiles into `libslic3r_gui`; full app links (exit 0).
  Runtime not exercised (GUI app, no display here); data path already proven live + parser tested.
- **Next:** Phase 2 — DeviceManager attach + capability detect + `apply_snapshot()`→`amsList`.
- New decisions/blockers: see the tables above (parser placement, humidity_raw, string `ace_status`,
  reuse policy; HTTP-reachability resolved; head-mode + humidity-bucket open questions added).

<!-- Template for new entries:
### YYYY-MM-DD — <short title>
- Changed: <files/functions>
- Result: <built? tests? what works>
- Next: <one concrete action>
- New decisions/blockers: <if any; also add to the tables above>
-->
