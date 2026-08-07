# PROGRESS — ACE MMU Support

> Durable progress log for the ACE MMU feature. Update at the end of every work
> session. Terse, append-only. See [AGENT.md](AGENT.md) §5 for the rules.
> Single source of truth for "where are we".

## Snapshot

- **Branch:** `feat/add-ace-mmu-support`
- **Current phase:** Phase 0–2 ✅. **Phase 3 (native UI) in progress:** Prepare
  "Sync from AMS" wired for the U1; a native ACE MMU page (dialog) added.
- **Overall status:** 🟢 Native path working. The U1 Device tab is a Flutter webview
  (`PrinterWebView`+SSWCP, no in-repo source) so ACE can't render there; we surface it
  in the **native** Prepare tab instead. Done this session: (a) Prepare "Sync from AMS"
  button shown for the U1 → `MachineObject::sync_ace_ams()` fetches multiACE → amsList
  → filament list; (b) native `AceMmuDialog` (unit humidity/temp/protocol/mode, four
  slot cards with RFID/override chips + hex, toolhead strip, live **Refresh**) opened
  from an "ACE" button in Prepare; (c) parser extended with `toolheads[]`/`ace_head`;
  (d) interactive HTML mockup at [device-page-mockup.html](device-page-mockup.html).
- **Next action:** validate on the printer (open Prepare → **ACE** / **Sync from AMS**
  for the connected U1). Then Phase 3b = **Option B**: promote the dialog into a proper
  native Device *page/tab* styled after Bambu's AMS UI (see 05). Later: `setting_id`
  preset auto-match; Preview per-slot labels; write actions (Dry/load) — deferred
  (untested printer commands).
- **Build/test env (verified working):** deps in `deps/build/`, toolchain installed.
  - `libslic3r_tests "[ace_mmu]"` → 8 cases / 67 assertions pass (incl. live fixture).
    Rebuild: `cmake --build build --config Release --target libslic3r_tests -j 8`.
  - Full app: `cmake --build build --config Release --target Snapmaker_Orca -j 8`.
  - **Fast iteration (mold + ccache; ~15 s incremental):** full setup + commands in
    [DEV-BUILD.md](DEV-BUILD.md). `build/` is configured with ccache + mold; keep ACE
    logic in the small `AceMmu*` files so only tiny TUs recompile before the mold link.
    Windows fast build: [`build_fast_win.bat`](../../build_fast_win.bat) (Ninja + sccache).
  - Run (WSLg): `GDK_BACKEND=x11 ./build/src/Release/snapmaker-orca`.
  - CI: a PR to this branch runs `pre-commit` (clang-format **14** + hygiene hooks).
    Run `pre-commit run --files <changed>` before committing (`sudo apt install -y pre-commit`).
- **Environment / hardware:** U1 at **192.168.2.242** (multiACE `0.99.6.1b`); plain
  HTTP `GET /multiace/api/state` + `/api/health` work **unauthenticated**. Firmware
  branch `feat/filament-rfid-write`; multiACE branch `feat/bowden-path-calibration`.
- **Sibling branches (context):** a large *parallel* multiACE implementation exists
  (`validation/pr30-fix-rest` ~273 commits, `feat/wire-multiace-printer-lifecycle`,
  `feat/integrate-multiace`; PRs #28/#30/#35) using a **different** architecture
  (self-normalized `FilamentSourceProvider`/`MultiAce*` in `libslic3r`, not the
  plan's raw-`/api/state` `AceMmuProvider`). Per user direction: follow this plan,
  reuse non-conflicting pieces only. See Decisions log.

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
| 2026-08-05 | Target the **native Prepare/Preview** tabs for MMU UI, not the Flutter Device page | The U1 Device tab is `PrinterWebView` (Snapmaker's compiled Flutter frontend + SSWCP); no Dart source in-repo, so an ACE view can't be added there. Prepare/Preview are native wx. amsList (Phase 2) still feeds native send/mapping dialogs, so it isn't wasted. |
| 2026-08-05 | Exclude legacy `DeviceManager.{cpp,hpp}` / `StatusPanel.cpp` (and later `Plater.{cpp,hpp}`) from the clang-format pre-commit hook | They predate this branch's `.clang-format`; a small functional edit otherwise forces a whole-file reformat (thousands of lines → merge hell). New ACE files stay formatted. |
| 2026-08-06 | Resolve the ACE host via `AceMmuProvider::resolve_connected_host()` (selected `MachineObject::dev_ip`, else the connected `PrintHost`), not `dev_ip` alone | Runtime test: Prepare "Sync from AMS" returned "No AMS filaments" because the webview-connected U1 has **no selected MachineObject / empty dev_ip**. The reliable connection is the `PrintHost` (`get_connect_host`). `sync_ace_ams(host)` + a snapshot-direct filament-list fallback now cover the no-MachineObject case. |

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

### 2026-08-06 (cont.) — Sync notice fixed, page styled, FM-split PLAN
- Fixed the "unknown filaments mapped to generic preset" notice
  (`AceMmuProvider::resolve_generic_filament_id` → real Generic preset id).
- Styled the "U1 + ACE" page to the mockup's dark palette.
- **Known bug:** "Sync from AMS" (legacy `sync_ams_list`) is destructive — it replaces
  the project filament list with only the ACE slots, dropping U1 toolhead filaments.
- **Investigated** the Prepare Sidebar filament model (flat 0-based list; tool index ==
  filament index, no remap; count free ≤64; ACE already maps at send via
  `ams_filament_mapping`, `tray_index=ace*4+slot`; reusable `filamentsync/`
  components: `FilamentColorMapBoxGroup`, `SyncFilamentColorDialog`, `MachineFilamentPicker`).
- **Wrote the plan** [08-filament-management-split.md](08-filament-management-split.md):
  reuse the non-destructive `SyncFilamentColorDialog` and feed it BOTH sources (U1
  toolheads + ACE slots) instead of building a new grouped widget in the fragile
  2-column sidebar grid; hide/merge the destructive legacy "Sync from AMS". Head-vs-slot
  resolved: filament list is mode-agnostic (display + mapping); mapping to (ace,slot) is
  a send-time concern.
- **Next:** user approves the plan → implement (no code written yet).

### 2026-08-06 (cont.) — "U1 + ACE" full page, sync fix, login fix, FM mockup
- **LAN-only (confirmed):** the ACE only appears when the U1 is connected over **LAN**
  — the multiACE HTTP endpoint isn't reachable via the cloud connection. Documented
  as a known limitation; cloud support would need Option A (ACE state over MQTT).
- **Sync-from-AMS error fixed:** `PresetBundle::sync_ams_list` skips entries with an
  empty `filament_id`, so ACE spools (empty id) produced "no compatible filaments".
  Now occupied ACE slots get a non-empty `filament_id`/`setting_id` (`ace:<type>`) and
  empty slots are skipped, so sync falls through to the built-in `Generic <type>`
  match. (Real preset resolution to avoid the "mapped to generic" notice = future.)
- **Login persistence — real bug fixed:** the restore call was in `restart_networking()`
  (not guaranteed at launch). Moved `sm_restore_login()` to `GUI_App::post_init()`
  (runs once at startup, after `init_app_config()` in the ctor). Persist-on-login and
  clear-on-logout unchanged.
- **"U1 + ACE" tab:** renamed from "MMU"; `AceMmuPanel` rebuilt to the mockup's
  two-column layout (left: Printer card w/ camera placeholder + state/mode/ACE-temp/
  units tiles; right: ACE unit header w/ humidity/temp/dryer tiles, four slot cards,
  toolhead strip, legend). Native wx approximation of
  [device-page-mockup.html](device-page-mockup.html) (no circular-spool/ring custom
  paint yet).
- **New mockup (future work):** [filament-management-mockup.html](filament-management-mockup.html)
  — Prepare "Filament Management" split into **U1 toolheads** and **ACE slots**. To
  build after the current page work; open question noted (map to heads vs ACE slots).
- **Result:** builds green (login + sync + rename + page). Runtime verified: ACE shows
  over LAN. Login-persist + full page not yet re-verified by user.
- **Next:** user verifies "U1 + ACE" page + login-persist; iterate on the FM split
  mockup; then implement the FM split; write actions still deferred.

### 2026-08-06 — Native MMU tab, login persistence, fast-build tooling
- **Device + MMU tab:** extracted the ACE view into a reusable `AceMmuPanel`
  (`src/slic3r/GUI/AceMmuPanel.{hpp,cpp}`) and added it as a persistent top-level
  **"MMU"** tab in `MainFrame` (appended last; selected by pointer comparison — no
  new `TabPosition` enum). `AceMmuDialog` now just wraps the same panel. Host is
  resolved via `AceMmuProvider::resolve_connected_host()` so it works with no
  MachineObject. Runtime not yet verified on the printer.
- **Host resolution fix** (earlier this session): the webview U1 has no dev_ip, so
  resolve now also reads the connect-host and the `print_host` config; logs the
  resolved host + fetch result. (Fixes the "No ACE detected" popup.)
- **Snapmaker login persistence:** account was memory-only; added `SMAccountPersist`
  (save on login, restore in `GUI_App::on_init_inner`, clear on logout) via
  `app_config` section `sm_account`. Free functions in a tiny header (not
  `GUI_App.hpp`) to avoid a full rebuild. Token stored plaintext — keychain = future.
- **Build tooling:** clang-format hook switched to an allowlist (ACE files only);
  fast-build loop documented in [DEV-BUILD.md](DEV-BUILD.md) incl. the header-fanout
  gotcha (why touching `MainFrame.hpp` triggers a big rebuild).
- **Result:** both features build green (MMU tab + login). Binaries relink in ~15 s
  for `.cpp`-only edits. **Not yet runtime-verified** (headless here).
- **Next:** user verifies the MMU tab + login-persist on the printer; then style the
  tab closer to Bambu's AMS UI; `setting_id` preset match; write actions (deferred).

### 2026-08-06 — Phase 3 native UI: Prepare sync + native ACE page + mockup
- **Prepare "Sync from AMS" for the U1:** `ams_btn` now shown for the U1
  (`Plater.cpp` visibility block); `Sidebar::sync_ams_list()` calls new
  `MachineObject::sync_ace_ams()` (synchronous multiACE fetch → `apply_ace_snapshot`
  → amsList) before `build_filament_ams_list`, so ACE spools enter the filament list.
- **Native ACE page:** added `src/slic3r/GUI/AceMmuDialog.{hpp,cpp}` — a functional
  page (unit humidity/temp/protocol/mode header, four slot cards with colour swatch +
  material + brand + RFID/override chip + hex, a toolhead strip with active head, and a
  live **Refresh** that re-fetches). Opened from a new "ACE" button in Prepare (U1 only).
  Registered in `src/slic3r/CMakeLists.txt`.
- **Parser:** `AceMmuState.hpp` gained `AceToolhead` + `ace_head` and parses
  `toolheads[]` (+ `opt_bool`); new `[ace_mmu]` toolhead test.
- **Mockup:** `docs/ace-mmu/device-page-mockup.html` — interactive Bambu-/U1-inspired
  Device-page design (published as an Artifact). Chosen future direction = Option B
  (native tab styled after Bambu AMS UI); design doc updated.
- **clang:** excluded `Plater.{cpp,hpp}` from the clang-format hook (legacy files).
- **Result:** Option-1 (Prepare sync) build green; final build (dialog + parser + button)
  in progress at time of writing. Runtime not yet verified on the printer.
- **Next:** verify on the U1; then Option B native Device tab. Write actions deferred.

### 2026-08-05 — Phase 2 landed, then UI-surface pivot
- Committed + pushed Phase 2 (`b3754ea86`, `c13827646`): `ace_*_exist_bits` helpers,
  `MachineObject::poll_ace_ams()`/`apply_ace_snapshot()`, and the
  `StatusPanel::update_ams` hook. Kept diffs **functional-only** (reverted clang-format
  whole-file reformat of the legacy files) and added a clang-format `exclude` for them
  in `.pre-commit-config.yaml`.
- **Ran the app in WSL (WSLg) against the live U1 — the ACE did NOT appear.** Root
  cause: the Device tab is `PrinterWebView` = Snapmaker's compiled **Flutter** web app
  (`resources/web/flutter_web`, served locally) driven by **SSWCP**, not the native
  `StatusPanel`/`AMSControl`. No Dart source in-repo → cannot add an ACE view to the
  Device page. Prepare/Preview tabs ARE native wx.
- **Pivot (user):** build MMU UI in the **native Prepare/Preview** tabs + native
  send/mapping dialogs. amsList projection still feeds the native mapping path.
- **Next:** investigate native Prepare *Filament Management* + `AmsMappingPopup` /
  `SelectMachine` to surface ACE units/slots; scope the Prepare/Preview MMU UI.

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
- **⚠️ SUPERSEDED the same day** — a later session (WSL) got the build env working
  and completed Phase 0 + Phase 1 with committed code + passing tests. See the two
  2026-08-05 entries below and the Snapshot at the top. This entry's "no code" /
  "sandbox unavailable" state no longer holds. (A stale copy of it briefly overwrote
  the Snapshot during a Windows merge; corrected here.)

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

### 2026-08-07 — ACE slicing: optimiser + wiring (branch feat/ace-mmu-slicing)
- Changed: `libslic3r/AceMmuPlan.hpp` (new: exact swap model + branch-and-bound
  `plan_loading` with pins/manual `evaluate_assignment`, work budget, `optimal` flag);
  `tests/libslic3r/test_ace_mmu_plan.cpp` (20 cases / 140 assertions, incl. pins,
  budget contract, 16-colour stress); design doc `docs/ace-mmu/10-slicing-plan.md`
  (+§8 verified integration recon); UX mockup `docs/ace-mmu/load-plan-mockup.html`
  (assignment dialog, Auto/Manual + pinning, live JS port of the optimiser; artifact
  3129e7ee-de72-430a-8d28-277db9bc8d8e).
- Wiring (phase A): `ace_head_capacity` (coInts, printer option, default {1}; in
  `s_Preset_printer_options`); plan computed at end of `psWipeTower`
  (Print.cpp, stored `Print::m_ace_plan`, accessor `ace_plan()`); start-gcode
  placeholders `ace_plan_head`/`ace_plan_slot`/`ace_plan_summary` (GCode.cpp, before
  `machine_start_gcode` expansion); per-change `ace_head`/`ace_slot`/`prev_ace_head`/
  `prev_ace_slot`/`ace_swap` via `GCode::set_ace_toolchange_vars` (tracks per-head
  loaded spool like `simulate_swaps`) in both `set_extruder` and
  `WipeTowerIntegration::append_tcr`; whitelist + defs in PrintConfig.cpp;
  e2e test `tests/fff_print/test_ace_mmu_gcode.cpp`.
- Result: libslic3r builds; libslic3r_tests green (ace_mmu_plan 140 asserts). Full
  app + fff_print e2e building at time of writing.
- Next: confirm firmware macro syntax (ACE_PRELOAD/ACE_SEQ args) against the live
  U1, then put `{if ace_swap}` handling into the U1 `change_filament_gcode` template;
  GUI: assignment dialog (webview, from mockup) + pins persistence + filament_map
  registration (currently dead plumbing, see §8).
- New decisions: slicing is native in Orca (no printer-side preflight for our files);
  capability-gated via `ace_head_capacity`, no printer-name checks; >4-filament
  enablement on the U1 profile still to verify in GUI.

### 2026-08-07 — Known issue: Send crashes on non-Latin filenames (NOT slicing-related)
- Symptom: clicking Print/Send on a sliced plate segfaults; a
  `gtk_widget_set_size_request: assertion 'width >= -1' failed` critical appears
  just before. Plain "Export G-code" to disk is unaffected.
- Root cause (from core-dump forensics + a live LD_PRELOAD backtrace): the send
  flow pre-fills `PrintHostSendDialog`'s filename field
  (`PrintHostDialogs.cpp:114`, `txt_filename->SetValue(recent_path)`) with the
  output filename. When that name contains characters the host font stack cannot
  render — e.g. a CJK project name, `彩虹小鸡3_PLA_10h41m.gcode` — GTK re-measures
  the entry, pango itemizes the text, finds no font covering the codepoints and
  walks the fontconfig fallback chain. `pango_fc_font_map_new_font()` returns NULL
  for a family that is *configured but not installed*, and
  `pango_fc_fontset_foreach` passes that NULL to its callback, which dereferences
  it: `libpangoft2+0xe204`, `mov 0x38(%rdi),%r8d` with `%rdi = 0`. The negative
  `set_size_request` widths are a symptom of the same failed layout, not a cause.
- Reproduces on any machine with no CJK font (`fc-list :lang=zh` empty) whenever
  the plate's output filename has non-Latin characters.
- Workarounds: install a CJK font (`fonts-noto-cjk`), or use an ASCII project name.
- Proper fixes (not done, deliberately deferred): sanitize/transliterate the
  pre-filled upload name, and/or null-guard the value before it reaches the entry.
- Dead ends ruled out by experiment, recorded so nobody re-treads them: private
  HarmonyOS fonts via `AddPrivateFont` (minimal wx repro survives), WebKit
  initialisation order (minimal GTK+WebKit repro survives), negative widget widths
  (clamping them at the GTK boundary did not prevent the crash), and the
  WebDeviceDialog raw-delete (that path is never reached — the crash happens two
  statements earlier, before any webview dialog is constructed).
- Also fixed independently while investigating: the executable exported 73 `FT_*`
  symbols from its statically linked FreeType 2.12.1, which preempted the system
  FreeType 2.14.2 that pango/fontconfig/cairo are built against. Hardening only —
  it is NOT the fix for this crash.

### 2026-08-07 — Latent GUI bugs found while debugging (unfixed, low priority)
- `TextInput::DoSetSize` (`Widgets/TextInput.cpp:173`) and `SpinInput::messureSize`
  (`Widgets/SpinInput.cpp:217`) compute `size.x - ... - labelSize.x - N` without
  clamping, pushing negative widths into GTK (12 criticals fire during startup
  alone, from `PresetComboBox::update_selection`). Cosmetic today.
- `FontConfigHelp.cpp:32` calls `FcConfigDestroy(fc)` on the `reload_fonts` path
  while the config may still be referenced. Not on the print path.
