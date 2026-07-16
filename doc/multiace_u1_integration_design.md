# Snapmaker U1 multiACE / ACE Pro integration research

**Status:** Research and implementation plan  
**Repository:** `physicsG/OrcaSlicer`  
**Branch:** `Research/ace2pro-integration`  
**Prepared:** 2026-07-15

## 1. Goal

Add native multiACE-style material-source support to Snapmaker Orca for the Snapmaker U1.

The intended user experience is comparable to a tightly integrated AMS system:

1. Show every spool from all connected ACE-compatible units, rather than exposing only four logical colors.
2. Refresh RFID, material, color, remaining quantity, dryer, and source state live.
3. Map logical project filaments to physical spool sources and one of the U1's four toolheads.
4. Generate native source-change G-code without a post-processing rewrite step.
5. Include physical tool changes and source swaps in print-time and material estimates.
6. Recommend an efficient spool and toolhead placement when a project uses more than four filaments.

The U1 must remain a four-toolhead machine. Spool slots must not be represented as fake physical extruders.

## 2. Executive conclusion

Anycubic Slicer Next demonstrates that an OrcaSlicer fork can integrate an ACE-style system by reusing the existing Bambu/Orca AMS abstractions and send workflow:

- `Ams`
- `AmsTray`
- `FilamentInfo`
- `AmsMappingPopup`
- machine inventory parsing
- material/color matching
- send-time mapping and validation
- profile-based filament-change timing

Snapmaker Orca already inherits most of these foundations. The recommended approach is therefore to generalize the existing AMS model and UI rather than create an unrelated multiACE subsystem.

The critical topology difference is:

```text
Anycubic + ACE:
many material sources -> one physical nozzle

Snapmaker U1 + multiACE:
many material sources -> four physical toolheads
```

Anycubic's source-selection pattern is reusable, but the U1 also needs explicit per-source routing and physical-head assignment.

## 3. Snapmaker Orca findings

### 3.1 Existing filament-sync feature

Snapmaker Orca already contains a filament synchronization workflow under:

```text
src/slic3r/GUI/filamentsync/
```

The current workflow compares project/design filaments with machine filaments and performs color matching. The inspected implementation uses CIE76 Lab color distance and independently chooses the nearest machine filament for each design filament.

Current limitations for the U1 multiACE use case:

- no uniqueness constraint;
- no source identity such as ACE unit and slot;
- no RFID provenance;
- no route or physical-head identity;
- no transition-aware placement optimization;
- no source-swap cost;
- no inventory revision validation.

The existing dialogs and vector-based machine/design lists remain useful UI foundations.

### 3.2 Current machine filament data is too small

The current synchronized filament representation primarily carries fields such as:

```text
index
name
type
color
```

Machine connection data also exposes filament type, nozzle, color, multicolor mode, and index, but not the complete source topology needed for multiACE.

Add at least:

```text
provider/source ID
ACE unit ID
slot ID
RFID/tag UID
metadata origin
remaining quantity
source state
reachable physical heads
currently loaded physical head
inventory revision
```

### 3.3 Existing AMS model is already present

Because OrcaSlicer descends from Bambu Studio, the repository already contains AMS concepts such as:

- `AmsTray`
- `Ams`
- `MachineObject::amsList`
- RFID/read-state handling
- tray selection and refresh commands
- material and color metadata
- remaining percentage and state fields
- AMS mapping popup infrastructure

This is the preferred foundation for the multiACE integration.

### 3.4 Hard-coded four-slot assumptions

Existing AMS code contains assumptions such as four trays per AMS and flat tray identifiers built from unit and slot indices.

A four-slot unit is reasonable for ACE-compatible hardware, but code should distinguish:

```text
slots_per_unit = 4
maximum_unit_count = configurable
physical_toolhead_count = 4
```

Do not confuse four slots per source unit with four total available project filaments.

### 3.5 Current time estimator is extensible

The G-code processor already tracks move categories, estimated statistics, tool changes, purge, filament use, and additional synchronization time.

This provides a natural extension point for a separate source-change event and time category.

### 3.6 Current G-code pipeline has the required hooks

Relevant existing concepts include:

- `GCode::set_extruder`
- wipe-tower tool changes;
- tool ordering;
- purge accounting;
- `simulate_st_synchronize(additional_time)`;
- per-layer and per-move estimates.

The routing plan must be resolved before final tool ordering, wipe-tower generation, and final G-code output whenever it changes the physical U1 head.

## 4. multiACE findings

The community `decay71/multiACE` project provides a useful printer-side model and currently exposes live state through a FastAPI/Moonraker-oriented backend.

Repository:

- <https://github.com/decay71/multiACE>

Observed backend capabilities include:

- REST inventory/state endpoints;
- WebSocket live updates;
- multiple ACE units;
- per-slot state;
- RFID and material metadata;
- brand, SKU, subtype, and color;
- metadata provenance;
- ACE temperature, humidity, dryer, and feed-assist state;
- toolhead and source wiring;
- macro execution;
- snapshots and configuration.

Existing documented endpoints include patterns such as:

```text
GET  /multiace/api/aces
POST /multiace/api/macro
WS   /multiace/ws
```

The existing multiACE postprocessor also contains valuable algorithmic work:

- exact and fuzzy material/color matching;
- candidate tiers;
- layer constraints;
- source mapping;
- swap-aware layout computation;
- practical brute-force optimization for modest filament counts.

That logic should be moved or adapted into native slicer planning rather than retained as a final G-code rewrite.

The current postprocessor rewrites higher logical tools to physical heads and inserts `ACE_SWAP_HEAD`. The native integration should instead generate the correct four-head G-code directly.

## 5. Anycubic Slicer Next findings

Repository:

- <https://github.com/ANYCUBIC-3D/AnycubicSlicerNext>

Inspected public revision:

- `6103ed8b511609658d00d0538cc7f0609cdb57da`

### 5.1 Public Orca-based application

Anycubic Slicer Next is an OrcaSlicer-based public repository and retains the inherited slicing core, AMS model, G-code processor, profiles, and send workflow.

### 5.2 Networking is partially separated

The public application exposes a `NetworkAgent` interface with dynamically loaded networking functions. The GUI includes code that downloads and installs `network_plugin.zip`.

Relevant files include:

```text
src/slic3r/Utils/NetworkAgent.hpp
src/slic3r/Utils/NetworkAgent.cpp
src/slic3r/GUI/WebDownPluginDlg.cpp
```

Conclusion:

- reuse the open slicer-side inventory, UI, mapping, and validation patterns;
- do not depend on or copy a downloadable proprietary networking module;
- implement an open Moonraker/HTTP/WebSocket provider for multiACE.

### 5.3 Rich inherited inventory model

`MachineObject` owns `amsList`, existence/read bitfields, current and target tray state, and mapping functions.

`AmsTray` carries or derives data such as:

- RFID/tag UID;
- profile and setting IDs;
- filament material and subtype;
- brand;
- color and multicolor information;
- weight and diameter;
- temperature limits;
- remaining percentage;
- current path/road state;
- calibration data.

The live parser updates:

- connected unit existence;
- tray existence;
- RFID-read state;
- humidity;
- drying state and remaining time;
- device temperature;
- tray material/color;
- weight, diameter, and temperature metadata.

### 5.4 Existing source mapping UI

`AmsMappingPopup` enumerates trays from all AMS units and preserves `ams_id` and `slot_id`.

It represents normal, empty, unidentified, third-party, and incompatible tray states. The selected mapping associates:

```text
project filament
-> AMS/ACE unit
-> slot
-> displayed material and color
```

Relevant files:

```text
src/slic3r/GUI/AmsMappingPopup.hpp
src/slic3r/GUI/AmsMappingPopup.cpp
```

### 5.5 Mapping serialization

The send workflow serializes both:

- a legacy flat tray index;
- a structured `{ams_id, slot_id}` result;
- mapping information with source/target color, material type, and filament ID.

`FilamentInfo` already contains fields equivalent to:

```cpp
int id;
std::string type;
std::string color;
std::string filament_id;
std::string brand;
float used_m;
float used_g;
int tray_id;
float distance;
std::string ams_id;
std::string slot_id;
```

This should be extended rather than replaced.

### 5.6 Send-time validation

The existing send workflow warns or blocks on conditions including:

- unidentified trays;
- empty trays;
- prohibited or incompatible materials;
- nozzle/material mismatch;
- invalid mappings.

This validation style is reusable for U1 routing-plan verification.

### 5.7 Profile-based source-change timing

Anycubic Kobra S1 and Kobra 3 profiles model many logical filaments through one physical extruder using:

```json
"single_extruder_multi_material": "1"
```

Observed load-time constants include approximately:

```text
Kobra 3:  42 seconds
Kobra S1: 126.423 seconds
```

The relevant profiles leave `change_filament_gcode` effectively empty while still declaring timing values. This supports separating the slicer's timing model from printer-side mechanical macros.

### 5.8 Parent-level nozzle association is insufficient for U1

The inherited `Ams` object has a parent-level nozzle association. That can work when an entire AMS feeds one nozzle.

A multiACE U1 installation can instead route corresponding slots from several units to a physical head. Therefore route information must be stored per tray/source, not only per ACE unit.

Example:

```text
ACE 0 Slot 0 -> U1 Head 0
ACE 1 Slot 0 -> U1 Head 0
ACE 2 Slot 0 -> U1 Head 0
```

### 5.9 Open-code caveat

The public repository does not expose a clearly isolated `ACE2Pro` protocol implementation. Much of the public code uses inherited Bambu-style AMS naming, while transport behavior is partly delegated to the networking plugin.

Treat Anycubic as architectural evidence, not as a protocol implementation to import wholesale.

## 6. Core domain model

Keep three separate concepts:

```text
ProjectFilament  = logical material/color used by the model
FilamentSource   = physical spool in an ACE unit and slot
PhysicalHead     = one of the U1's four toolheads
```

Recommended counts:

```text
physical_toolhead_count = 4
project_filament_count  = 1..N
machine_source_count    = 0..N
```

Do not configure 8 or 16 physical extruders merely because 8 or 16 spool sources are available.

## 7. Provider abstraction

Introduce a provider boundary between transport and slicer logic:

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

Initial implementation:

```text
MultiAceMoonrakerProvider
```

Possible future providers:

```text
AnycubicAceProvider
BambuAmsProvider
ManualSourceProvider
```

## 8. Stable source identity

Use a structured, stable identity rather than only a flat tray integer:

```cpp
struct SourceId
{
    std::string provider;
    std::string unit_id;
    std::string slot_id;
};
```

Human-readable form:

```text
multiace:0:0
multiace:0:1
multiace:1:0
```

A flat index may remain for backward compatibility, but it must not be canonical.

## 9. Extend tray/source data

Suggested additions to the inherited tray model:

```cpp
enum class SourceMetadataOrigin
{
    Unknown,
    RFID,
    Manual,
    Derived,
    Profile,
};

enum class SourceState
{
    Unknown,
    Empty,
    Ready,
    Loading,
    Unloading,
    Error,
    Offline,
};
```

Per-source fields:

```cpp
std::string source_id;
int source_unit_index = -1;
int source_slot_index = -1;
std::vector<int> reachable_toolheads;
int loaded_toolhead = -1;
SourceMetadataOrigin metadata_origin;
SourceState source_state;
std::string inventory_revision;
```

## 10. Persistent routing plan

Add a first-class route representation:

```cpp
struct FilamentRoute
{
    int project_filament_id = -1;
    SourceId source;
    int physical_toolhead = -1;
    bool source_already_loaded = false;
    bool requires_source_swap = false;
    bool user_pinned = false;
};

struct FilamentRoutingPlan
{
    std::string inventory_revision;
    std::vector<FilamentRoute> routes;
};
```

Persist this plan in the 3MF so reopening a project preserves intended sources, heads, and pins.

## 11. Printer-side API contract

Prefer a versioned open contract. Suggested endpoints:

```text
GET  /api/v1/capabilities
GET  /api/v1/inventory
POST /api/v1/sources/{source_id}/refresh
GET  /api/v1/routing
WS   /api/v1/events
```

Suggested inventory fields:

```json
{
  "schema_version": 1,
  "revision": "7c34f1",
  "sources": [
    {
      "source_id": "multiace:1:0",
      "unit_id": "1",
      "slot_id": "0",
      "material": "PLA",
      "subtype": "PLA Basic",
      "brand": "Example",
      "color": "#D52332",
      "remaining_percent": 72,
      "metadata_origin": "rfid",
      "state": "ready",
      "reachable_toolheads": [0],
      "loaded_toolhead": null
    }
  ]
}
```

Capabilities may declare:

```json
{
  "inventory": true,
  "live_events": true,
  "rfid_refresh": true,
  "remaining_percent": true,
  "dryer_state": true,
  "per_source_routing": true,
  "measured_change_timing": false
}
```

The slicer must degrade cleanly when optional capabilities are absent.

## 12. User interface

Separate project intent from live hardware inventory.

Example:

```text
Project filaments
  F1 White PLA
  F2 Red PLA
  F3 Black PETG
  F4 Blue PLA
  F5 Green PLA

Printer inventory
  ACE 1
    Slot 1 White PLA   -> Head 0
    Slot 2 Black PLA   -> Head 1
    Slot 3 Support PLA -> Head 2
    Slot 4 Blue PLA    -> Head 3

  ACE 2
    Slot 1 Red PLA     -> Head 0
    Slot 2 Green PLA   -> Head 1
    Slot 3 PETG        -> Head 2
    Slot 4 Yellow PLA  -> Head 3
```

Each source card should show, when known:

- ACE unit and slot;
- material, subtype, brand, and color;
- RFID/manual/derived metadata origin;
- remaining percentage or weight;
- ready, empty, loading, error, or offline state;
- reachable U1 head;
- currently loaded state;
- humidity and dryer state.

A live inventory refresh must not silently mutate project filament definitions.

When a mapped spool changes, mark the route stale and present reconciliation choices.

## 13. Candidate source selection

For every project filament, build compatible source candidates.

### Hard constraints

Reject a candidate when:

- the source is empty, offline, or in error;
- material type is incompatible;
- the source cannot reach a usable U1 head;
- the nozzle is unsuitable for the material;
- temperature ranges are incompatible;
- remaining filament is known to be insufficient;
- the source is reserved or disabled;
- a user pin conflicts.

### Soft preferences

Prefer:

- exact RFID/profile match;
- exact material subtype;
- lowest color distance;
- same brand;
- currently loaded source;
- sufficient remaining quantity;
- lower uncertainty;
- explicit user preference.

Reuse the existing color-distance and profile matching where appropriate.

## 14. Physical-head placement optimizer

Source matching alone is insufficient. Build a weighted transition graph:

```text
node        = logical project filament
edge weight = predicted transition count or cost
```

Frequently alternating filaments should be assigned to different physical heads when routes allow.

Suggested objective:

```text
total cost =
    source swaps * source-swap time
  + physical head changes * U1 tool-change time
  + purge volume * purge cost
  + temperature-transition time
  + physical spool relocation penalty
  + inventory uncertainty penalty
```

Priority order:

1. satisfy hardware and material constraints;
2. minimize slow source swaps;
3. minimize physical spool relocation;
4. minimize purge;
5. minimize physical tool changes;
6. preserve already loaded sources.

Practical first solver:

1. generate compatible candidates;
2. assign high-weight filament pairs to different heads;
3. greedily seed a solution;
4. improve with local search or simulated annealing;
5. use deterministic tie-breaking.

Support hard user pins for:

```text
project filament -> source
project filament -> head
source -> head
```

Explain conflicts rather than silently ignoring pins.

## 15. Routing point in the slice pipeline

Physical-head assignment must occur before final G-code whenever it affects the head identity.

Recommended flow:

```text
1. Define logical project filaments.
2. Slice far enough to determine layer usage and transitions.
3. Build the transition graph.
4. Read live or manual source inventory.
5. Select sources and assign physical U1 heads.
6. Freeze FilamentRoutingPlan.
7. Generate final tool ordering.
8. Generate wipe tower and purge paths.
9. Generate native U1 + multiACE G-code.
10. Calculate final time and material estimates.
```

The send dialog should validate the frozen plan, not invent a new physical-head layout.

A same-head, equivalent-material source substitution may be possible without reslicing. A physical-head change requires reslicing.

## 16. Native G-code generation

Final physical tool commands must remain:

```text
T0
T1
T2
T3
```

Do not emit `T4` through `T15` as final spool-slot tools.

Example route:

```text
Project filament 6
-> ACE 1 Slot 2
-> physical Head 2
```

When the required source is already loaded:

```gcode
T2
```

When Head 2 needs a different source:

```gcode
PARK_TOOLHEAD TOOL=2
ACE_SWAP_HEAD HEAD=2 ACE=1 SLOT=2
PURGE_FOR_SOURCE_CHANGE FROM=3 TO=6
```

If changing both active head and source:

```gcode
PARK_ACTIVE_TOOL
ACE_SWAP_HEAD HEAD=2 ACE=1 SLOT=2
T2
PURGE_FOR_SOURCE_CHANGE FROM=3 TO=6
```

Exact mechanics remain in Klipper/multiACE macros. The slicer decides source, head, timing, temperature, purge, and estimated cost.

## 17. Time and material estimation

Track physical head changes separately from source swaps:

```cpp
unsigned physical_tool_change_count;
unsigned source_change_count;
double physical_tool_change_time;
double source_change_time;
double purge_time;
```

Add a distinct event category such as:

```cpp
EMoveType::FilamentSourceChange
```

Initial configurable source-change timing:

```cpp
struct SourceChangeTiming
{
    double unload_time;
    double tip_form_time;
    double route_change_time;
    double load_time;
    double verification_time;
    double expected_retry_time;
};
```

Estimated source-change cost:

```text
unload
+ tip forming
+ route change
+ loading
+ sensor verification
+ expected retry allowance
```

Later versions should consume measured per-route timings from the printer-side service.

Preview should show a breakdown such as:

```text
Base motion time                  2h 04m
U1 physical head changes             57
multiACE source changes                6
Estimated source-change time        13m
Purge and temperature overhead       4m
Total estimate                    2h 21m
```

Reuse existing wipe-tower, flush, and external-purge accounting. Attribute source-change purge correctly to outgoing and incoming filament.

## 18. Inventory revision and send validation

Store the inventory revision used to produce the routing plan.

Before sending:

1. fetch current inventory;
2. compare revision;
3. verify every required source still exists;
4. verify material, color, and metadata;
5. verify source-to-head route compatibility;
6. verify remaining amount where known;
7. verify each physical-head assignment remains valid.

Allow no-reslice substitution only when:

- physical head is unchanged;
- material and nozzle requirements are equivalent;
- purge assumptions remain valid;
- temperature behavior remains compatible.

Any physical-head reassignment returns to slicing.

## 19. Proposed code map

### Existing files to extend

```text
src/slic3r/GUI/DeviceManager.hpp
src/slic3r/GUI/DeviceManager.cpp
src/slic3r/GUI/AmsMappingPopup.hpp
src/slic3r/GUI/AmsMappingPopup.cpp
src/slic3r/GUI/SelectMachine.cpp
src/slic3r/GUI/filamentsync/*
src/libslic3r/ProjectTask.hpp
src/libslic3r/GCode/GCodeProcessor.cpp
src/libslic3r/PrintConfig.hpp
src/libslic3r/PrintConfig.cpp
src/libslic3r/PresetBundle.cpp
```

### Suggested new files

```text
src/slic3r/GUI/multiace/MultiAceClient.hpp
src/slic3r/GUI/multiace/MultiAceClient.cpp
src/slic3r/GUI/multiace/MultiAceSourceProvider.hpp
src/slic3r/GUI/multiace/MultiAceSourceProvider.cpp

src/libslic3r/FilamentRoutingPlan.hpp
src/libslic3r/FilamentRoutingPlan.cpp
src/libslic3r/FilamentPlacementOptimizer.hpp
src/libslic3r/FilamentPlacementOptimizer.cpp
```

Use more generic `material_sources` naming if near-term support for multiple vendors is intended.

## 20. Delivery phases

### Phase 1: Stable printer-side API

Deliver:

- versioned inventory schema;
- stable source IDs;
- RFID/metadata refresh;
- inventory revision;
- source-to-head routing;
- loaded-source state;
- optional measured timing;
- WebSocket events;
- contract tests.

### Phase 2: Live inventory in the existing AMS model

Deliver:

- multiACE source provider;
- all connected spools visible;
- manual and live refresh;
- empty/error/offline states;
- metadata origin;
- per-source physical-head route.

Do not alter the U1's four physical extruders.

### Phase 3: Manual native routing

Deliver:

```text
project filament -> ACE source -> U1 head
```

Also deliver:

- routing persistence in 3MF;
- native `ACE_SWAP_HEAD` generation;
- send-time validation;
- no external G-code rewrite requirement.

This is the first useful end-to-end milestone.

### Phase 4: Timing and statistics

Deliver:

- source-change event and count;
- configurable timing values;
- purge overhead;
- preview breakdown.

### Phase 5: Placement optimizer

Deliver:

- transition graph;
- source candidate scoring;
- physical-head assignment;
- user pins;
- suggested spool moves;
- current-versus-optimized comparison;
- estimated savings.

### Phase 6: Robust stale-plan handling

Deliver:

- inventory revision checks;
- reconciliation UI;
- safe same-head substitutions;
- forced reslice for physical-head changes.

## 21. Recommended first release

```text
[+] All connected ACE spools visible
[+] Live and manual inventory refresh
[+] Manual project-filament -> source -> U1-head mapping
[+] Mapping stored in the 3MF
[+] Native ACE_SWAP_HEAD generation
[+] Basic profile-driven source-change time estimate
[-] Automatic optimal placement deferred to the next release
```

## 22. Test plan

### Unit tests

- inventory JSON parsing;
- missing optional capabilities;
- stable source IDs;
- flat-to-structured mapping;
- material compatibility;
- color-distance ordering;
- routing validation;
- inventory revision handling;
- timing calculation;
- optimizer determinism;
- user-pin conflicts.

### Integration fixtures

- no ACE connected;
- one ACE unit;
- multiple ACE units;
- empty slot;
- unknown third-party spool;
- RFID refresh;
- spool replacement;
- loading and unloading;
- source error;
- disconnected unit;
- stale routing plan.

### G-code golden tests

Verify:

- final physical tools remain `T0` through `T3`;
- source changes emit the intended macros;
- no accidental `T4+` commands;
- correct park/swap/select/purge order;
- correct source-change counts;
- correct purge accounting;
- no source swap when already loaded.

### Optimizer scenarios

- two highly alternating colors;
- more than four logical filaments;
- abrasive material restricted to one head;
- insufficient remaining quantity;
- conflicting user pins;
- material temperature conflict;
- duplicate spools with the same color;
- one source reachable by multiple heads;
- multiple sources routed to one head.

## 23. Risks and unresolved decisions

### API ownership

A stable printer-side contract is required. Scraping an existing web UI or undocumented state will be fragile.

### Macro semantics

Standardize:

- parking;
- unloading/loading;
- verification;
- failure recovery;
- purge;
- cancellation;
- resume behavior.

### State authority

Define ownership of:

- spool metadata;
- manual overrides;
- remaining quantity;
- loaded-source state;
- source-to-head wiring;
- calibration values.

Recommended authority:

- printer-side service owns live hardware state;
- 3MF owns intended routing snapshot and user pins.

### Offline slicing

Support manual/offline inventory. Projects must remain sliceable without a connected printer, while routes requiring live validation are clearly marked.

### Licensing

Only adapt code available under compatible open-source terms. Do not depend on or redistribute proprietary downloadable networking components.

## 24. Final recommendation

Implement the integration as:

```text
existing AMS inventory and UI
+ open multiACE Moonraker provider
+ per-source physical-head routing
+ persistent FilamentRoutingPlan
+ native source-change G-code
+ separate source-change timing
+ transition-aware four-head optimizer
```

This minimizes duplicated GUI work, remains aligned with Orca concepts, avoids treating spool slots as fake extruders, and directly addresses the U1's unique four-toolhead topology.
