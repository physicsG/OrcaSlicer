# multiACE / ACE Pro integration testing strategy

**Repository:** `physicsG/OrcaSlicer`  
**Branch:** `Research/ace2pro-integration`  
**Scope:** Native multiACE material-source inventory, routing, optimization, G-code generation, timing, persistence, and send validation

## 1. Objectives

The test suite must provide confidence that the integration:

1. never changes the U1 from four physical toolheads;
2. preserves stable spool/source identities across refreshes;
3. rejects invalid material, nozzle, route, and inventory combinations;
4. produces deterministic source and physical-head assignments;
5. emits only valid U1 physical tool commands (`T0` through `T3`);
6. inserts source-change macros in the correct order;
7. calculates source-change, purge, and tool-change estimates consistently;
8. detects stale inventory before sending;
9. remains usable when the printer is offline or exposes only partial capabilities;
10. does not require physical hardware for normal pull-request validation.

The strategy uses a test pyramid:

```text
many fast unit tests
        ↓
fewer component and integration tests
        ↓
small number of end-to-end G-code tests
        ↓
optional hardware-in-the-loop validation
```

## 2. Existing repository test harness

Snapmaker Orca already provides a suitable C++ test framework:

- `BUILD_TESTS` enables tests from the top-level CMake configuration;
- Catch2 is exposed as `Catch2::Catch2` through `tests/CMakeLists.txt`;
- `test_common` supplies Catch2 and `TEST_DATA_DIR`;
- `tests/libslic3r` links against `libslic3r` and is suitable for domain-model, parsing, validation, persistence, timing, and optimizer tests;
- `tests/fff_print` links against `libslic3r`, uses `catch_discover_tests`, and is suitable for slicing and generated-G-code integration tests;
- CTest is already enabled by the root project.

Recommended Catch2 tags:

```text
[multiace][unit]
[multiace][parser]
[multiace][routing]
[multiace][optimizer]
[multiace][timing]
[multiace][persistence]
[multiace][integration]
[multiace][gcode]
[multiace][contract]
[multiace][slow]
```

## 3. Design for testability

The production design should expose narrow, deterministic seams rather than forcing tests through the GUI or a live printer.

### 3.1 Keep pure logic in `libslic3r`

Place these components in `libslic3r` or another GUI-independent library:

- `SourceId`;
- inventory and capability value types;
- inventory JSON parsing and normalization;
- `FilamentRoute` and `FilamentRoutingPlan`;
- candidate compatibility checks;
- candidate scoring;
- placement optimizer;
- inventory-revision validation;
- source-change timing model;
- routing-plan serialization.

This allows the majority of tests to run in `tests/libslic3r` without wxWidgets, networking, or a printer.

### 3.2 Inject the source provider

Production code should depend on an interface:

```cpp
class FilamentSourceProvider
{
public:
    virtual ~FilamentSourceProvider() = default;
    virtual ProviderCapabilities capabilities() const = 0;
    virtual InventorySnapshot get_inventory() = 0;
    virtual void subscribe(InventoryCallback callback) = 0;
    virtual void request_metadata_refresh(const SourceId& source) = 0;
};
```

Tests can supply:

```cpp
class FakeFilamentSourceProvider final : public FilamentSourceProvider
{
public:
    ProviderCapabilities capabilities_value;
    InventorySnapshot inventory_value;
    std::vector<SourceId> refresh_requests;
    InventoryCallback callback;

    ProviderCapabilities capabilities() const override
    {
        return capabilities_value;
    }

    InventorySnapshot get_inventory() override
    {
        return inventory_value;
    }

    void subscribe(InventoryCallback value) override
    {
        callback = std::move(value);
    }

    void request_metadata_refresh(const SourceId& source) override
    {
        refresh_requests.push_back(source);
    }

    void publish(const InventoryEvent& event)
    {
        REQUIRE(bool(callback));
        callback(event);
    }
};
```

No unit test should require network access.

### 3.3 Separate transport from parsing

`MultiAceClient` should handle HTTP/WebSocket transport, while a pure parser converts payload text into domain objects:

```text
HTTP/WebSocket bytes
-> MultiAceInventoryParser
-> InventorySnapshot
-> routing and UI models
```

This lets malformed, partial, old, and future payloads be tested without a server.

### 3.4 Make optimization deterministic

The optimizer should accept:

- an explicit inventory snapshot;
- an explicit transition graph;
- explicit cost weights;
- an optional random seed if a stochastic algorithm is used.

For identical inputs and seed, output must be identical.

### 3.5 Isolate G-code emission

Generate source-change command blocks through a small function or class rather than concatenating commands throughout `GCode.cpp`.

Example seam:

```cpp
SourceChangeGCode emit_source_change(
    const FilamentRoute& from,
    const FilamentRoute& to,
    const SourceChangeContext& context);
```

This enables exact ordering tests before full slicing integration tests are added.

## 4. Proposed test file layout

Add the following unit-test files to `tests/libslic3r/CMakeLists.txt`:

```text
tests/libslic3r/test_filament_source_id.cpp
tests/libslic3r/test_multiace_inventory_parser.cpp
tests/libslic3r/test_filament_source_matching.cpp
tests/libslic3r/test_filament_routing_plan.cpp
tests/libslic3r/test_filament_placement_optimizer.cpp
tests/libslic3r/test_source_change_timing.cpp
tests/libslic3r/test_multiace_3mf_persistence.cpp
tests/libslic3r/test_multiace_send_validation.cpp
```

Add the following end-to-end tests to `tests/fff_print/CMakeLists.txt`:

```text
tests/fff_print/test_multiace_gcode.cpp
tests/fff_print/test_multiace_print_estimate.cpp
tests/fff_print/test_multiace_routing_pipeline.cpp
```

Add fixtures under:

```text
tests/data/multiace/inventory/
tests/data/multiace/events/
tests/data/multiace/projects/
tests/data/multiace/gcode/
tests/data/multiace/contracts/
```

Suggested fixture naming:

```text
inventory_schema_v1_one_unit.json
inventory_schema_v1_four_units.json
inventory_missing_optional_fields.json
inventory_unknown_future_fields.json
inventory_duplicate_source_id.json
inventory_invalid_route.json
inventory_source_offline.json
inventory_rfid_replaced.json

ws_initial_snapshot.jsonl
ws_slot_replaced.jsonl
ws_unit_disconnect_reconnect.jsonl
ws_out_of_order_revision.jsonl

four_color_no_swap.3mf
six_color_two_source_swaps.3mf
abrasive_filament_restricted_head.3mf
stale_inventory_mapping.3mf
```

Fixtures should be small, human-readable, and reviewed like source code.

## 5. Unit-test strategy

## 5.1 `SourceId`

Test:

- construction from provider/unit/slot;
- string formatting and parsing;
- equality, ordering, and hashing;
- rejection of missing provider, unit, or slot;
- unit IDs containing non-numeric identifiers;
- round-trip stability;
- no collision between `multiace:1:10` and `multiace:11:0`;
- legacy flat-index conversion where supported.

Example:

```cpp
TEST_CASE("SourceId round-trips without losing unit or slot", "[multiace][unit]")
{
    const SourceId original{"multiace", "unit-a", "slot-3"};
    const SourceId parsed = SourceId::parse(original.to_string());

    CHECK(parsed == original);
}
```

## 5.2 Inventory and capability parsing

Test valid payloads containing:

- one and multiple source units;
- zero to four slots per unit;
- RFID metadata;
- manually entered metadata;
- remaining percentage and weight;
- humidity and dryer state;
- loaded physical head;
- one or multiple reachable heads;
- capability flags;
- measured timing data.

Test compatibility behavior:

- missing optional fields use documented defaults;
- unknown fields are ignored and preserved where useful;
- unsupported future schema versions return a clear error;
- absent capabilities disable features rather than crashing;
- color values normalize consistently;
- numeric and string slot IDs are normalized without collision.

Test malformed payloads:

- missing `schema_version`;
- missing or empty `source_id`;
- duplicate source IDs;
- invalid color;
- remaining percentage outside 0–100;
- loaded head outside 0–3;
- reachable head outside 0–3;
- a loaded head not present in `reachable_toolheads`;
- contradictory `empty` and `loaded` state;
- invalid or decreasing inventory revision where monotonic ordering is required.

## 5.3 Inventory normalization and merging

Test that live updates:

- replace only the source referenced by the event;
- preserve unaffected sources;
- mark removed units or slots offline before deletion if that is the chosen policy;
- handle reconnects;
- reject stale events;
- apply a full snapshot after missed events;
- do not mutate project filament definitions;
- mark a routing plan stale when relevant material, color, route, or loaded state changes;
- do not mark a plan stale for irrelevant telemetry-only changes when policy permits.

## 5.4 Material compatibility and candidate filtering

Use table-driven tests covering:

- PLA project filament against PLA source;
- PLA against PETG rejection;
- generic material matching against an exact subtype;
- unknown third-party material;
- abrasive material restricted to a hardened nozzle/head;
- temperature-range overlap and non-overlap;
- insufficient remaining quantity;
- empty, offline, loading, and error states;
- source reserved by another route;
- source reachable by one or several heads;
- user-pinned source and head constraints.

Every hard-constraint rejection should expose a stable reason code, for example:

```text
SourceOffline
MaterialMismatch
NoReachableHead
NozzleIncompatible
InsufficientRemaining
ConflictingUserPin
```

Tests should assert reason codes rather than localized UI strings.

## 5.5 Candidate scoring

Test individual score components independently:

- exact RFID/profile match;
- exact subtype;
- material-only fallback;
- color-distance ordering;
- same-brand preference;
- already-loaded preference;
- remaining-quantity preference;
- uncertainty penalty;
- user preference.

Also test:

- score weights are configurable;
- hard constraints cannot be overcome by a high soft score;
- equal candidates use deterministic tie-breaking;
- color-distance results match existing Orca color matching within a defined tolerance.

## 5.6 Routing-plan validation

Test invariants:

- every used project filament has exactly one route;
- no route refers to a missing source;
- every physical head is in the range 0–3;
- a selected head is reachable from the source;
- a source cannot be simultaneously loaded in incompatible heads;
- user pins are preserved;
- `source_already_loaded` matches inventory state;
- `requires_source_swap` is derived correctly;
- unused project filaments may remain unmapped if allowed;
- duplicate routes are rejected;
- inventory revision is recorded.

## 5.7 Placement optimizer

Use three types of optimizer tests.

### Exact small cases

For small inputs, enumerate every legal assignment in the test and prove the optimizer returned a globally minimal cost.

Examples:

- two filaments, two heads;
- four filaments, four heads;
- five filaments with one required source swap;
- six filaments with restricted routing;
- one abrasive filament pinned to a hardened head.

### Invariant/property cases

For generated small inputs, assert:

- every output route is legal;
- every used filament is assigned;
- pins are honored;
- no physical head outside 0–3 appears;
- computed output cost is no worse than the greedy seed;
- rerunning with identical input gives identical output;
- permuting input order does not change the semantic solution except for documented tie-breaking.

### Regression cases

Every optimizer defect should add a minimal fixture that reproduces it.

Important scenarios:

- two highly alternating colors should be placed on different heads;
- a rarely used fifth color should be selected for a source swap rather than a frequently alternating color;
- already-loaded sources should win when total cost is otherwise equal;
- conflicting pins must return a structured failure, not a partial route;
- a disconnected unit must cause replanning;
- duplicate-color sources must remain distinguishable by source ID.

## 5.8 Source-change timing

Test:

- sum of unload, tip form, route, load, verification, and retry allowance;
- zero-time optional stages;
- profile defaults;
- printer-provided measured timing overriding profile defaults;
- route-specific timing;
- physical tool-change time remains separate;
- no source-change cost when the required source is already loaded;
- invalid negative values are rejected or clamped by documented policy;
- repeated changes are accumulated without double counting.

Use exact integer microseconds or a documented floating-point tolerance to avoid fragile assertions.

## 5.9 3MF persistence

Test round trips for:

- `SourceId`;
- `FilamentRoute`;
- routing-plan inventory revision;
- user pins;
- optimizer cost/configuration if persisted;
- manual/offline routes;
- unknown future extension fields;
- projects created before the feature existed.

Acceptance rule:

```text
load(save(project)) preserves the semantic routing plan
```

Do not assert archive entry order or irrelevant formatting.

## 5.10 Send validation

Test current versus saved inventory:

- exact revision match;
- revision changed but required sources unchanged;
- same-head equivalent-material substitution;
- color-only change requiring confirmation;
- material change requiring reslice;
- source removed;
- source empty;
- route changed to another physical head;
- remaining quantity dropped below estimated use;
- printer reports incomplete capabilities;
- offline printer with manual confirmation policy.

Return structured outcomes:

```text
Valid
ValidWithWarning
CanReconcileWithoutReslice
RequiresReslice
Blocked
```

## 6. Integration-test strategy

## 6.1 Provider component tests with a fake transport

Test `MultiAceClient` against an injected fake HTTP/WebSocket transport.

Cover:

1. capability request followed by inventory request;
2. HTTP timeout and retry policy;
3. malformed response;
4. authentication failure if applicable;
5. WebSocket connect and initial snapshot;
6. ordered incremental updates;
7. reconnect after disconnect;
8. missed-event recovery through a full snapshot;
9. metadata/RFID refresh request;
10. shutdown while callbacks are pending.

Use a deterministic scheduler or explicit callback pumping so tests do not sleep.

Avoid tests such as:

```cpp
std::this_thread::sleep_for(...);
```

Prefer explicit state transitions and bounded futures.

## 6.2 Contract tests against recorded multiACE payloads

Maintain versioned fixtures captured from the printer-side service.

For each supported schema version, verify:

- capabilities parse;
- full inventory parses;
- every event type parses;
- a recorded event sequence produces the expected final snapshot;
- unknown new fields do not break old clients;
- required removed or renamed fields fail with an actionable message.

Ideally, publish JSON Schema or OpenAPI definitions in the multiACE backend and validate the same fixtures in both repositories.

This creates a consumer-driven contract:

```text
multiACE backend guarantees the schema
OrcaSlicer guarantees it can consume the schema
```

## 6.3 Inventory-to-routing integration

Use `FakeFilamentSourceProvider` with the real matching, optimizer, and routing-plan code.

Scenarios:

- one unit and four colors: no source swaps;
- two units and six colors: two logical filaments share physical heads;
- four units and sixteen sources;
- one source offline during planning;
- RFID source replacement after planning;
- stale inventory reconciliation;
- user-pinned source plus automatically selected remaining routes;
- insufficient filament on the best color match;
- one source reachable by multiple heads;
- multiple sources reachable only by one head.

Assert the complete route, not only the selected source.

## 6.4 Slice-pipeline integration

Use small deterministic models and explicit project filament assignments.

Test the pipeline:

```text
model
-> logical filament use
-> transition graph
-> source candidates
-> physical-head assignment
-> frozen routing plan
-> tool ordering
-> purge/wipe calculation
-> G-code
-> final estimates
```

Assertions:

- routing occurs before final tool ordering;
- changing a physical-head assignment invalidates downstream G-code;
- a same-head source substitution does not invalidate geometry where documented;
- wipe/purge data uses the final routing plan;
- final statistics contain both physical tool changes and source changes.

## 6.5 G-code golden tests

Add minimal project fixtures with expected normalized G-code fragments.

Golden tests should assert semantic commands and order, not timestamps, comments, or unrelated coordinates.

Required cases:

### Four colors, four already-loaded heads

Expected:

- only `T0`–`T3`;
- zero `ACE_SWAP_HEAD` commands;
- no source-change timing.

### Fifth color sharing Head 0

Expected order:

```text
park Head 0
ACE_SWAP_HEAD for Head 0 and selected source
select or reactivate Head 0 as required
source-change purge
resume printing
```

### Incoming head needs a source swap

Verify park/swap/tool-select/purge order exactly.

### Source already loaded

Verify no redundant `ACE_SWAP_HEAD`.

### Invalid route

G-code generation must fail before output rather than emitting `T4+` or a partial file.

Global invariants for every golden test:

```text
no final tool command greater than T3
all source swaps reference a source in FilamentRoutingPlan
each source swap targets the route's physical head
estimated source-change count equals emitted source-change command count
```

Normalize generated G-code before comparison by removing:

- timestamps;
- build identifiers;
- nondeterministic comments;
- absolute temporary paths;
- unrelated floating-point formatting where semantically equivalent.

## 6.6 Print-time integration

Run the G-code processor over generated multiACE G-code and assert:

- base motion time is unchanged by adding estimate-only metadata;
- each source swap adds the configured or measured duration once;
- physical tool-change and source-change counters remain distinct;
- purge time and material are included;
- preview totals equal the sum of displayed categories within tolerance;
- postprocessed and native reference files can be compared during migration.

## 6.7 3MF end-to-end round trip

Create a routed project, save it, reload it, and slice again.

Verify:

- logical project filament IDs remain stable;
- source IDs and physical heads remain stable;
- user pins survive;
- stale inventory is detected rather than silently remapped;
- generated G-code is semantically equivalent after reload.

## 6.8 GUI model/component tests

Avoid pixel-level screenshot tests for core correctness.

Test view-model behavior where practical:

- source cards grouped by unit;
- all units and slots are represented;
- empty/offline/error states map to the expected model state;
- refresh action calls the provider with the correct `SourceId`;
- selecting a source updates the structured unit/slot/head route;
- stale-plan status is surfaced;
- incompatible sources cannot be confirmed;
- user pins are passed to the optimizer.

Keep a small manual UI checklist for layout, accessibility, and translations.

## 7. Concurrency and event-order testing

Live inventory introduces concurrency risks. Add tests for:

- callbacks arriving after a dialog or device object is destroyed;
- reconnect while a metadata refresh is pending;
- full snapshot racing with an incremental event;
- out-of-order revisions;
- duplicate events;
- rapid source replacement events;
- unit disconnect/reconnect loops;
- cancellation during application shutdown.

Recommended rule:

```text
Only one component owns mutable inventory state.
Network callbacks enqueue immutable events.
State mutation occurs on the owning thread.
```

Use ThreadSanitizer in an optional Linux CI job once the provider exists.

## 8. Robustness and fuzz testing

The inventory parser processes external data and should receive fuzz coverage.

Targets:

- inventory JSON parser;
- capability parser;
- event parser;
- `SourceId::parse`;
- routing-plan deserializer;
- 3MF multiACE metadata parser.

Properties:

- never crash;
- never allocate unbounded memory from a small input;
- reject impossible head indexes;
- reject duplicate IDs when required;
- preserve valid round trips;
- return structured errors.

Fuzzing does not need to block every pull request. Run a bounded corpus smoke test on PRs and longer campaigns nightly or manually.

## 9. Performance tests

The optimizer must remain interactive.

Benchmark representative cases:

```text
4 project filaments / 4 sources
8 project filaments / 8 sources
12 project filaments / 16 sources
16 project filaments / 16 sources
```

Measure:

- candidate generation;
- transition-graph construction;
- optimizer runtime;
- peak memory;
- route validation;
- rescore after one source changes.

Suggested initial targets on a normal desktop CI runner:

```text
candidate generation: < 20 ms
12-filament optimization: < 250 ms
16-filament optimization: < 1 s
single-source reconciliation: < 100 ms
```

Treat these as starting budgets to be adjusted with real implementations. Performance tests should report regressions before becoming hard gates.

## 10. Hardware-in-the-loop strategy

Hardware tests are valuable but must not be required for ordinary PRs.

Use three levels.

### Level 1: Macro dry run

Run generated commands against a Klipper/multiACE test configuration with motion and heaters disabled or redirected to dummy handlers.

Verify:

- macro names and arguments;
- valid head and source IDs;
- state-machine transitions;
- expected error responses;
- cancellation and recovery.

### Level 2: Bench rig

Use a dedicated U1/multiACE rig for scheduled or manually triggered tests.

Scenarios:

- load each source into its routed head;
- switch among two sources on one head;
- disconnect a unit mid-sequence;
- empty-spool detection;
- RFID refresh;
- failed load and retry;
- cancellation and resume.

Capture:

- requested versus observed source;
- sensor transitions;
- actual change duration;
- errors and retries;
- final loaded-head state.

### Level 3: Print validation

Run a small standard artifact designed to exercise:

- four physical heads;
- at least one source swap on every head;
- repeated return to a previously loaded source;
- purge transitions;
- temperature transitions where safe.

Compare predicted and measured source-change time and total print time.

## 11. CI strategy

## 11.1 Pull-request fast lane

Add a dedicated Linux test job triggered when relevant files change.

Configure with:

```bash
cmake -S . -B build \
  -DBUILD_TESTS=ON \
  -DSLIC3R_SENTRY=OFF
cmake --build build --target libslic3r_tests fff_print_tests --parallel
ctest --test-dir build --output-on-failure
```

Use the repository's dependency cache. A headless configuration may be used where supported by the final dependency graph.

Initially run:

```text
[multiace][unit]
[multiace][parser]
[multiace][routing]
[multiace][optimizer]
[multiace][gcode]
```

The fast lane should target less than ten minutes once caches are warm.

## 11.2 Cross-platform lane

At minimum, compile the new code on:

- Ubuntu;
- Windows;
- macOS.

Run the full multiACE test set on Linux and a representative subset on Windows/macOS. This catches path, compiler, threading, and serialization differences without multiplying every slow integration test.

## 11.3 Nightly lane

Run nightly:

- all existing repository tests;
- all multiACE integration tests;
- ASan/UBSan where supported;
- ThreadSanitizer provider tests where feasible;
- fuzz corpus smoke tests;
- optimizer benchmarks;
- recorded contract fixtures for every supported schema version.

## 11.4 Optional hardware lane

Use a protected, manually approved workflow for the physical rig. Never expose printer credentials to untrusted pull requests.

## 12. Test labels and CTest organization

Add labels to make suites selectable:

```cmake
set_tests_properties(
    multiace_inventory_tests
    PROPERTIES LABELS "multiace;unit;parser")
```

If tests remain inside the existing `libslic3r_tests` executable, Catch2 tag filters can still provide selection:

```bash
build/tests/libslic3r/libslic3r_tests "[multiace][unit]"
build/tests/fff_print/fff_print_tests "[multiace][gcode]"
```

For clearer CI reporting, consider a dedicated `multiace_tests` executable once the suite becomes substantial.

## 13. Failure diagnostics

A failing test should print enough state to reproduce the problem.

On routing or optimizer failure, include:

- project filaments;
- candidate sources and rejection reasons;
- transition graph;
- user pins;
- cost weights;
- inventory revision;
- selected routes;
- computed cost breakdown;
- random seed, if applicable.

On G-code failure, attach or print:

- normalized relevant command window;
- expected command sequence;
- route being executed;
- physical active head;
- currently loaded source per head.

Do not log authentication tokens or sensitive printer configuration.

## 14. Coverage expectations

Prioritize behavioral coverage rather than a single repository-wide percentage.

Required coverage rules:

- every parser field and validation branch has a test;
- every hard-constraint rejection reason has a test;
- every source state has a test;
- every send-validation outcome has a test;
- every G-code source-change path has a golden test;
- every optimizer constraint has at least one exact small-case test;
- every production bug adds a regression test.

For newly added pure domain modules, target at least 90% line coverage and high branch coverage. Exclude generated code and trivial accessors from coverage goals.

## 15. Phase-by-phase quality gates

### Phase 1: API and parser

Must pass:

- schema fixtures;
- malformed payload tests;
- backward/forward compatibility tests;
- event-sequence tests;
- timeout/reconnect component tests.

### Phase 2: Live inventory

Must pass:

- multiple-unit inventory tests;
- refresh and RFID replacement tests;
- disconnect/reconnect tests;
- GUI model tests;
- concurrency tests.

### Phase 3: Manual native routing

Must pass:

- routing invariants;
- 3MF round trip;
- `T0`–`T3` invariant;
- native macro golden tests;
- stale inventory send validation.

### Phase 4: Timing

Must pass:

- unit timing formulas;
- generated-command count versus estimate count;
- G-code processor integration;
- preview total reconciliation.

### Phase 5: Optimizer

Must pass:

- exhaustive optimality tests for small cases;
- deterministic output tests;
- property/invariant tests;
- performance budgets;
- user-pin conflict diagnostics.

### Phase 6: Reconciliation

Must pass:

- same-head safe substitution;
- material mismatch requiring reslice;
- physical-head change requiring reslice;
- unit removal and source replacement;
- stale and out-of-order revision handling.

## 16. Definition of done for each feature change

A multiACE implementation change is complete only when:

1. pure logic has unit tests;
2. external payload changes include contract fixtures;
3. routing or G-code changes include an integration or golden test;
4. error paths are asserted, not only success paths;
5. tests run deterministically without a live printer;
6. relevant tests run in CI;
7. any manual hardware verification is documented separately;
8. no final G-code test emits a physical tool command greater than `T3`.

## 17. Recommended implementation order for the test suite

1. Add fixture directories and Catch2 tags.
2. Add `SourceId`, inventory parser, and capability tests.
3. Add compatibility filtering and reason-code tests.
4. Add routing-plan validation and 3MF round-trip tests.
5. Add fake-provider component tests.
6. Add native G-code golden tests.
7. Add timing integration tests.
8. Add exhaustive small-case optimizer tests.
9. Add property, performance, and concurrency tests.
10. Add optional contract and hardware workflows.

This sequence keeps tests slightly ahead of each implementation phase and makes the first native routing milestone safe to merge before the automatic optimizer is complete.
