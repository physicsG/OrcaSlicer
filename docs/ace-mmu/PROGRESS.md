# PROGRESS — ACE MMU Support

> Durable progress log for the ACE MMU feature. Update at the end of every work
> session. Terse, append-only. See [AGENT.md](AGENT.md) §5 for the rules.
> Single source of truth for "where are we".

## Snapshot

- **Branch:** `feat/ace-mmu-slicing` (earlier UI work landed on `feat/add-ace-mmu-support`)
- **Where we are:** read **[13-roadmap.md](13-roadmap.md)** first — it is the front-to-back
  plan and the authority on what is done vs missing. Roadmap phases 1–5 are all **done and
  observed**: topology config, planner, gcode emission, assignment dialog (on export *and*
  print, with Apply reaching the file), and cost visibility. Persistence is done too: a
  hand layout rides in the 3MF with its plate.
- **Overall status:** 🟢 End to end on the real 7-colour cube. The U1 Device tab is a Flutter
  webview (`PrinterWebView`+SSWCP, no in-repo source) so ACE can't render there; the native
  "U1 + multiACE" tab and the Prepare/Preview tabs carry the UI instead.
- **Next action:** answer the four questions on [pinning-mockup.html](pinning-mockup.html),
  then implement E. Remaining after that: multi-plate export (G) and the deferred tray dialog
  for C.
- **Build/test env (verified working):** deps in `deps/build/`, toolchain installed.
  - `libslic3r_tests "[ace_mmu]"` → 22 cases / 162 assertions pass (parser, planner,
    reconciliation incl. two ACE units; plus a live-captured fixture).
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

### 2026-08-10 (cont.) — Pinning: the feature is invisible, and a mockup
- Roadmap item E, scoped down: **drying is out of scope for this page** (user's call).
- Two findings, both from reading the shipped behaviour rather than guessing:
  - **Every spool arrives pinned.** C++ seeds the page with the computed plan expressed as
    one pin per filament, so the board opens on *"Auto plan honours 7 pin(s)"* with an
    orange badge on all seven. A badge everything carries distinguishes nothing, and a
    deliberate pin cannot be told from the optimiser's own choice. The seeding is not
    gratuitous — it guarantees the board shows the layout the gcode holds rather than an
    equal-cost rearrangement from the page's own optimiser — so the fix is to send the
    layout *as a layout* and keep `pins` for pins.
  - **Pins do not persist**, unlike an applied layout.
- **Bug found alongside:** `pinTo()` records the slot only when the head index is literally
  `3` (`state.slotPins[c] = head===3 ? slot : -1`). With two ACE-fed heads - now a tested
  configuration - pinning into the other ACE head keeps the head and loses the slot.
- Mockup: [pinning-mockup.html](pinning-mockup.html), three states (today, only-what-you-pin,
  pins restored with one dropped). Four questions open; no code written yet.

### 2026-08-10 (cont.) — Two ACE units: tested, and a hole found by testing
- Roadmap item F was "built, untested". The reconciliation I had just shipped keys each
  slot to the head's ACE **unit**, and that code had only ever run against a single unit -
  exactly where a bug would hide. Added six cases: two-unit planning (10 places take ten
  colours, refuse eleven, four on each ACE), per-unit slot attribution, mismatch
  attribution, and a spare spool in the other unit. The logic was correct, but it is now
  proven rather than assumed. `[ace_mmu]` is 22 cases / 162 assertions.
- Drove a fabricated two-unit topology through the GUI (`ace_head_capacity 1,1,4,4`,
  `ace_head_unit -1,-1,0,1`): the board renders `ACE 1 → T3` and `ACE 2 → T4` as separate
  boxes with wires to the right heads, and the gcode carries both `ACE=0` and `ACE=1`.
- **Hole found by measuring:** with two units configured and only one connected, the
  contents strip judged the unit that answered and said *nothing* about the spool bound
  for the missing one - it was not even listed. Had the connected unit matched, the plate
  would have passed the gate with a filament assigned to an ACE that is not there.
  `reconcile()` now sweeps the plan for placements whose unit the snapshot never reported
  and marks them `Differs` with `unit_missing`; the strip shows *ACE 2 · S1 — not
  connected* and the count went 4 → 5. Verified live.
- Still unverified: **real two-ACE hardware**. One physical unit plus a fabricated
  topology cannot test wiring or swap behaviour on a second physical ACE.

### 2026-08-10 (cont.) — Infeasible plates: measured, and a mockup
- Roadmap item 6 / gap C. Before designing anything I **sliced an over-capacity plate** (the
  7-colour cube with the ACE set to 2 slots = 5 places) and read the file. It is worse than
  the roadmap assumed:
  - slicing **succeeded** with no error, warning or notification;
  - the plan header came out **empty**, not "infeasible";
  - the file contains **300 tool changes to `T4`/`T5`/`T6`** on a four-head machine, plus
    `M109 S220 T5` and `SM_PRINT_PREEXTRUDE_FILAMENT INDEX=5`. When the plan is infeasible
    `set_tool_remap` gets an empty map, so the "physical heads only" contract breaks silently;
  - **zero** `ACE_SWAP_HEAD`.
- The dialog also **misdiagnoses** it: "These pins cannot all be satisfied. Unpin something to
  get a plan." There are no pins — C++ sends none when the plan is infeasible. The board
  silently omits the filaments that did not fit and the load plan lists `ACE 1 · S0` twice.
- Mockup: [infeasible-plate-mockup.html](infeasible-plate-mockup.html). Decisions taken:
  refuse at **slicing**, **hard** with no override, **two** ways out (drop/merge filaments or
  give the ACE head more slots — "fit a second ACE" was cut as not an action anyone takes at
  the point of refusal), and a **tray** for the unplaced spools.
- **Refusal built and verified.** `Print::process` throws a `SlicingError` at the end of
  `psWipeTower`; the plate does not slice and **no gcode is written**. The message names the
  shortfall and the least-used filaments with their colours. Checked the planner's rule first:
  only filaments the plate actually prints need a place (`occ[c] > 0`), so a project with
  spare filaments is never falsely refused — and a feasible plate still slices to
  `swaps:300 optimal:1`, T0–T3 only.
- **Still open:** the tray. Refusing at slicing means the assignment dialog never opens for an
  over-capacity plate, so the tray has no home there. It needs its own small refusal dialog,
  raised by throwing a type derived from `SlicingError` and catching it in
  `on_process_completed` — clean, no string matching.
- **Testing gotcha, cost a cycle:** a project 3MF embeds its own printer config, which
  overrides the user preset. To test a different `ace_head_capacity`, edit
  `Metadata/project_settings.config` inside the 3MF, not the preset in the datadir.

### 2026-08-10 — Reconciliation lands: the plate is checked against the machine
- Roadmap item 5 / gap B, finished to the decisions taken on the mockup: the check lives
  **inside the assignment dialog** as an *ACE contents* strip; it **blocks** with an explicit
  *Print anyway* tick; matching is colour + material; **unverified counts as unresolved**;
  and *Use what is loaded* was **dropped** — it rewrote the user's own assignment, which is
  what Manual mode already does deliberately.
- `AcePlanDialog` reads `/multiace/api/state` as it opens (2 s connect / 4 s total, so a
  printer that is configured but off costs a moment rather than the poller's eight seconds)
  and hands the slot contents to the page, which judges them against whatever layout is on
  the board — move a spool and the verdicts update. `Plater::review_ace_assignment` now
  returns `AceReview::{Proceed,Replanned,Abort}` and re-checks the **committed** layout in
  C++, so the gate cannot be skipped by closing the dialog.
- **Verified against the live printer**, not a fixture. The ACE really held one PETG spool
  named by hand in S1 and three empty slots; against the 7-colour PLA plate the strip read
  **4 wrong**, *Apply to plate* was disabled, ticking the override enabled it, and pressing
  Escape cancelled the export — where the same key previously led straight to the save
  dialog. The "not checked" state was confirmed first, before a host was configured.
- Fixed while verifying: the strip pushed the load plan and the primary button past the
  bottom of the dialog. Height is now `min(880 DIP, 92% of the screen)`.
- **Testing tip for future sessions:** the headless datadir has no connected device, so the
  check reports "not checked". Setting `print_host` on the printer preset in
  `/tmp/orca-headless-datadir` makes `resolve_connected_host()` fall through to it (path 4)
  and the real ACE is read.

### 2026-08-09 (cont.) — Reconciliation: the comparison, and a mockup for the UI
- Roadmap item 5 / gap B, started. Added `src/libslic3r/AceMmuReconcile.hpp` (header-only,
  no GUI): `reconcile()` judges each ACE slot against the plan, `spool_matches()` compares
  **colour + material** with brand ignored. 8 cases in
  `tests/libslic3r/test_ace_mmu_reconcile.cpp`; `[ace_mmu]` now 16 cases / 107 assertions,
  all green.
- **The verdict is three-valued.** `AceSlot::identity_trusted()` already distinguishes an
  RFID/override spool from an inferred one, so a slot can *agree*, *differ*, or be
  *unverifiable*. Calling an inferred spool wrong is a false accusation, and a check that
  cries wolf gets ignored — worse than no check. An empty slot is always a mismatch (the
  machine is not guessing about emptiness), and `checked=false` when there is no snapshot,
  because the endpoint is LAN-only and a tick meaning "could not check" is a lie.
- Mockup [reconciliation-mockup.html](reconciliation-mockup.html) drawn against the real
  contents this printer last reported (PETG in S1, two empty, one inferred). **Five
  decisions are open** and the UI is deliberately not built yet: where it lives, blocking
  vs advisory, the match predicate, how unverified slots count, and whether "Use what is
  loaded" should re-plan around reality.
- Next: those five answers, then the strip in the assignment dialog.

### 2026-08-09 (cont.) — An applied layout is remembered with its plate
- Roadmap item 4 / gap D. A **hand** layout is stored on the plate as `ace_plan_layout`
  (one toolhead index per filament, no slots — `evaluate_assignment` derives those) and
  rides in the 3MF as plate metadata. `Print::process` prefers this session's Apply, else
  the stored one, and **re-prices** either against the plate's current sequence rather
  than trusting a saved swap count; `optimal` is set only when the layout agrees with
  what the planner chose.
- Applying in **Auto** clears the stored layout — "yes, use the computed plan" must not
  freeze today's answer onto a plate whose colours may change.
- **Dialog contract changed** (mockup first, agreed with the user:
  [assignment-persistence-mockup.html](assignment-persistence-mockup.html)): a remembered
  layout is sent as `manual`, **never as pins**, so the page's own optimiser stays free
  and "Auto would need N" is a real comparison. Banners: *Saved with this plate* (with
  the extra cost and *Use auto instead*) and *Layout dropped* when it was saved for a
  different filament count. Remembered spools get a blue ring, distinct from the orange
  pin — remembered is not pinned.
- **Trap avoided:** clearing writes an *empty* option instead of erasing the key.
  `Print::apply` diffs the config it is handed against the one it holds, and a key that
  is simply absent is never diffed — erasing would have left the Print holding the layout
  the user just told it to forget.
- Verified end to end, in a **new process**: apply by hand → save project → reopen →
  slices straight to `swaps:349 optimal:0`; the 3MF carries
  `ace_plan_layout value="3 0 3 1 2 3 3"`; *Use auto instead* → 300 swaps, banner gone;
  applying in Auto → key absent from the re-saved 3MF; a 7-filament layout on a
  6-filament plate → *Layout dropped* banner and `swaps:200 optimal:1`.
- Corrected in the mockup rather than shipped: I had claimed the old contract reported
  "Auto would need 349". It does not — that chip is computed from a free optimum. The
  real fault is narrower: in Auto mode the chip is *hidden*, so the 300 is never shown,
  and every spool wears a pin it did not earn.
- **Known wart, pre-existing:** waste = swaps × (this slice's flush ÷ this slice's
  swaps), so the same layout is quoted ~47.0 g from an auto slice and ~40.4 g from its
  own. Swap counts are exact; the gram estimate drifts.
- Next: roadmap item 5, **reconciliation** (B) — nothing checks that the ACE actually
  holds what the plan assumes.

### 2026-08-09 — Apply to plate reaches the gcode, on export *and* print
- **The previous diagnosis was wrong.** Building the committed `m_ace_plan_user` fix
  and re-running the manual test still wrote `swaps:300 optimal:1`. The override was
  never being discarded by recomputation: `Plater::export_gcode_3mf` **packages the
  gcode the last slice left in the plate's temp file** (`store_to_3mf_structure` reads
  `m_gcode_result->filename`) and never regenerates it. Proved by exercising the other
  route — File › Export › Export G-code, which re-exports through the background
  process, wrote `swaps:349 optimal:0` with 350 `ACE_SWAP_HEAD` from the very same
  `Print`. The committed fix is still needed; it just was not sufficient.
- Changed (`Plater.cpp`): new one-shot `priv::ace_after_reslice`, set before
  `restart_background_process(FORCE_RESTART)` and run from `on_process_completed`
  (taken unconditionally so a cancelled rewrite cannot leave it armed; run only on
  success). `export_gcode_3mf`'s tail became a `package` closure that runs now, or
  after the rewrite. `send_gcode_legacy`'s U1 branch got the same treatment plus the
  review call it never had.
- **Print path (roadmap gap A) closed:** the assignment dialog now opens on Print,
  and the file staged for upload carried `swaps:349 optimal:0` / 350 `ACE_SWAP_HEAD`.
- **Notification settled:** it *does* fire — a 2 s screenshot loop caught it in exactly
  one frame, which is what "never observed" was. Raised to
  `ImportantNotificationLevel` (20 s instead of 10 s); confirmed legible for ~14 s and
  correctly reading 349 after an applied layout.
- Result: build green, all three verified headlessly on `Test_Cube_U1_multiACE.3mf`.
  Exports checked by unzipping the `.gcode.3mf` and counting macros, not by reading code.
- Next: roadmap item 4, **persistence** (D) — an applied layout still lives on one
  `Print` and is lost on re-slice or reopen.
- New rule worth keeping: any route that uploads or packages `get_tmp_gcode_path()`
  needs rewrite-then-resume. Multi-plate export (G) still lacks it.

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

### 2026-08-07 — ACE slicing reaches the gcode (config UI + U1 template)
- Changed: `ace_head_capacity` added to `m_extruder_option_keys` (PrintConfig.cpp) so
  it resizes with the extruder count, and exposed per-head in Printer Settings ->
  Extruder N -> Size (Tab.cpp). Set it to e.g. `1,1,1,4` for a head-mode U1 (three
  stock feeders + a 4-slot ACE on head 4); the default of 1 everywhere keeps every
  other printer a plain toolchanger with the planner inert.
- `set_num_extruders` now seeds a missing per-extruder option from its default
  instead of asserting, so projects saved before this option exists still load.
- U1 profiles (0.2/0.4/0.6/0.8) now emit, inside `change_filament_gcode` right after
  the `T<n>` tool change and guarded by `{if ace_swap}`:
  `ACE_SET_PURGE LENGTH=<flush_length>` + `ACE_SWAP_HEAD HEAD=<ace_head> SLOT=<ace_slot>`.
  Inert unless the plan says this change needs a spool swap on the target head.
- **Unverified against firmware:** the exact `ACE_SWAP_HEAD` / `ACE_SET_PURGE`
  argument spelling still has to be confirmed on a live U1 (`/printer/gcode/help`),
  as does whether an explicit `ACE_PRELOAD` is needed at start (currently the plan is
  only published as `ace_plan_head`/`ace_plan_slot`/`ace_plan_summary` placeholders,
  not emitted, precisely because the syntax is unconfirmed).
- Next: the filament assignment dialog (mockup: `docs/ace-mmu/load-plan-mockup.html`)
  as a real webview dialog + pins persisted per plate.

### 2026-08-07 — ACE macro syntax VERIFIED against live firmware
- Queried `http://192.168.2.242/printer/gcode/help` (333 macros, 83 ACE-related).
  Two corrections to what was committed an hour earlier:
  1. **`ACE_SWAP_HEAD HEAD=0 ACE=1 [SLOT=0]` — `ACE=` is REQUIRED.** The emitted
     macro was missing it and would have failed on the printer.
  2. **The ACE unit is not the head index.** `ACE_SET_HEAD_ACE HEAD=0..3 ACE=0..3`:
     "each ACE head is wired to exactly one ACE and can only load/swap that unit's
     slots". The live mapping here is head_ace={0:0,1:1,2:2,3:0}, so head 3 is fed by
     ACE 0 — the old `ace_unit = head index` assumption was wrong.
  Fixed by adding a per-head `ace_head_unit` printer setting (Printer Settings ->
  Extruder N -> Size), feeding it into `PlanHead::ace_unit`, publishing `ace_unit` /
  `prev_ace_unit` placeholders, and emitting `ACE=` in the template.
- Confirmed correct as already written: `ACE_SET_PURGE LENGTH=<mm>` (LENGTH=0 = stock
  80mm default, RESET=1 = config value).
- `ACE_PRELOAD` takes an `ACE_SEQ`-style `PLAN=head:ace` list, which does NOT carry a
  slot. So instead of guessing, Orca publishes `ace_plan_preload` — ready-to-emit
  `ACE_LOAD_HEAD HEAD=n ACE=u SLOT=0` lines (documented syntax, slot-precise, one per
  ACE-fed head, using the slot the head presents first). It is NOT yet inserted into
  `machine_start_gcode`: where in that template the initial load belongs (relative to
  preheat and the start line) is unverified, and the firmware may already load heads
  on tool select. Add `{ace_plan_preload}` to the start gcode to switch it on.
- Also confirmed relevant to the design: `ACE_SET_HEAD_MANUAL` (TPU/manual bypass per
  head — do not plan ACE spools onto such a head) and
  `ACE_SET_HEAD_FEEDER HEAD=n ENABLE=0|1` (stock-feeder heads), which map directly
  onto `ace_head_capacity = 1`.

### 2026-08-07 — Pre-existing flake found: second Print in one process
- Slicing a SECOND `Print` in the same process intermittently (~20%) throws
  `"Coordinate outside allowed range"` from `TreeSupport3D::validate_range`
  (Support/TreeSupport3D.cpp:73). Support-necessity detection runs even with
  `enable_support = false` and is TBB-parallel, so the throw is nondeterministic.
- Attribution (measured, not assumed): each of the two ACE e2e scenarios passes
  12/12 **in isolation**; only the sequence flakes. Nothing in the ACE path touches
  geometry or supports - the plan is computed after tool ordering.
- Handling: the second scenario tolerates that one exact message and SUCCEEDs with a
  note; any other exception still fails the test. 15/15 green afterwards. The
  underlying fork bug is untouched and still worth fixing separately.

### 2026-08-08 — Native ACE export works end-to-end (verified in a real slice)
- First real ACE-enabled slice (7 colours, `ace_head_capacity = 1,1,1,4`,
  `ace_head_unit = 0,0,0,0`) produced correct native gcode:
  - tool numbers are **physical heads only** (T0-T3; no T4-T6 leaking through) —
    the central remap in `GCodeWriter` (`m_tool_remap`/`emit_tool`) works, and the
    `custom_gcode_changes_tool` probes were fixed to look for the *emitted* tool so
    Orca does not append a second tool change;
  - `ACE_SWAP_HEAD HEAD=3 ACE=0 SLOT=0..3` — correct head and correct **unit 0**
    (the value the firmware requires and that the head-index guess got wrong);
  - 301 head-3 uses -> **300 swaps**: first load free, every revisit swaps, i.e. the
    dedupe rule holds;
  - `ACE_SET_PURGE` lengths vary per colour pair from the flush matrix;
  - `SM_PRINT_PREEXTRUDE_FILAMENT` emitted for the three feeder heads and **never**
    for the ACE head, per multiACE's hardware-learned rule.
- Added the missing **initial auto-load**, in multiACE's own format and position
  (`inject_auto_load_to_file`): marker comments + one `ACE_SWAP_HEAD` per ACE-fed head
  at its first-used slot, injected before the `画起始线` prime-line section so the load
  completes before the runout sensor fires. It emits `ACE_SWAP_HEAD`, not
  `ACE_LOAD_HEAD` — the guess I had staged was wrong; reading their implementation
  corrected it.
- UI: the two settings moved off the per-extruder Size groups onto a dedicated
  **multiACE** page grouped per toolhead. On the extruder pages a "unit feeding this
  head" field appeared even for heads with no ACE, which is what led to setting the
  unit instead of the capacity.
- Profile/vendor versions bumped again (vendor 02.02.55.04, U1 leaves 2.2.0.6) —
  **required**, or the app keeps using its cached copy in
  `~/.config/Snapmaker_Orca/system/` and profile edits silently never apply.
- Caveat worth stating: this cube prices at **300 swaps ~ 15-20 m of purge**. That is
  inherent to 7 colours all used every layer on 3 feeders + one 4-slot ACE head, not a
  planner failure — but it is exactly the number the assignment dialog must surface
  before the user commits.

## Multimaterial tab crash — root cause

Opening Printer settings › Multimaterial segfaulted as soon as the multiACE groups were
added. Two rounds of reasoning blamed the wrong thing (`i_enum_open` on a vector option,
then an option-less optgroup); both were reverted or disproved without fixing anything.
A backtrace settled it — `.claude/tools/start.sh run`, then `trace`:

    #3 Slic3r::GUI::OptionsGroup::activate_line(Line&)
    #4 OptionsGroup::activate(...)  #5 Page::activate(...)  #7 TabPrinter::activate_selected_page

`OptionsGroup.cpp:277` reads `line.get_options().front()` **unguarded**. The early return
above it — the one path that tolerates a line with no options — is entered only when
`line.full_width` is set:

    if (line.full_width && (line.widget != nullptr || !line.get_extra_widgets().empty())) { ... return; }

The Sync line carried a widget but no `full_width`, so it fell through to `.front()` on an
empty vector: null deref at offset `0x30` (`ConfigOptionDef::gui_type`), matching `RAX=0x0`.

**Rule: a line carrying only a widget must set `full_width = 1`.** It is not cosmetic;
without it the page cannot be opened. The existing precedent (`build_preset_description_line`)
sets it. `full_width` lines draw no label column, so a label must live inside the widget.

Worth knowing: the same unguarded `.front()` is upstream OrcaSlicer/PrusaSlicer code, so any
future widget-only line hits it. It is left as-is rather than patched — a guard there would
silently skip lines instead of crashing, which trades a loud bug for a quiet one.

## State at handover (2026-08-09)

Branch `feat/ace-mmu-slicing`, tree clean at `156f571f4`. The plan for what remains
is **[13-roadmap.md](13-roadmap.md)** — read that first; this section is only
"where the last session stopped".

### Verified working, end to end, on the real 7-colour cube

Slicing `Test_Cube_U1_multiACE.3mf` on `Snapmaker U1 (0.4 nozzle) - multiACE`
(capacity `[1,1,1,4]`, unit `[-1,-1,-1,0]`) produces:

- `; multiACE plan: … swaps:300 optimal:1` in the gcode header
- `T0–T3` only — no virtual tool reaches the file
- 301 `ACE_SWAP_HEAD` (300 swaps + auto-load), all `ACE=0`
- 300 `ACE_SET_PURGE`, every one adjacent to its swap
- pre-extrude on heads 0/1/2 only, never on the ACE head
- settings page shows named values with `None` on stock feeders
- assignment dialog opens on export with live topology, and Manual mode re-prices
  (300 → 349 swaps, 40.4 → 47.0 g) against "Auto would need 300"

### The one open defect — **resolved 2026-08-09**, see the session log below.
