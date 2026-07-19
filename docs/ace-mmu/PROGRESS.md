# PROGRESS — ACE MMU Support

> Durable progress log for the ACE MMU feature. Update at the end of every work
> session. Terse, append-only. See [AGENT.md](AGENT.md) §5 for the rules.
> Single source of truth for "where are we".

## Snapshot

- **Branch:** `feat/add-ace-mmu-support`
- **Current phase:** Phase 0 — not started
- **Overall status:** 🟡 Design complete; implementation not started
- **Next action:** Phase 0 spike — HTTP-GET `/multiace/api/state` and log parsed
  ACE inventory (see [05-implementation-plan.md](05-implementation-plan.md)).

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
