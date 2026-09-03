# ACE MMU test fixtures

`state_live_v0.99.6.1b.json` — a real `/multiace/api/state` response captured from
a Snapmaker U1 running multiACE `0.99.6.1b+41f9b859` (1 ACE 2 Pro unit, protocol
`v2`; slots 0 and 3 loaded with Kingroon PETG, slots 1 and 2 empty; printer in
`head` mode). Fetched unauthenticated over plain HTTP during the Phase 0 spike.

Used by `tests/libslic3r/test_ace_mmu_state.cpp` to exercise the raw-`/api/state`
parser (`src/libslic3r/AceMmuState.hpp`). See `docs/ace-mmu/` for the design.
