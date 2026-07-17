# multiACE AMS machine-model bridge

The existing OrcaSlicer machine UI is built around `MachineObject::amsList`, `Ams`, and `AmsTray`. The multiACE bridge projects the provider inventory into those inherited objects without representing spool slots as physical extruders.

## Topology rules

The first bridge version intentionally accepts the inherited topology that existing AMS UI code understands:

- ACE unit IDs are canonical non-negative decimal integers.
- Slot IDs are canonical integers from `0` through `3`.
- Each unit/slot pair must be unique.
- Unit and flat-slot indices must fit the inherited signed `long` bit masks.
- Projected `Ams::nozzle` is set only when every slot in a unit has exactly one identical reachable toolhead. Mixed or incomplete routing uses `-1`; per-source routing remains authoritative in the sidecar metadata.

This preserves the distinction between many spool sources and the U1's four physical toolheads.

## Existing AMS fields

Each source populates inherited tray fields used by current UI components:

- RFID UID;
- material and subtype;
- normalized RGBA color;
- remaining percentage;
- tray existence;
- RFID-read completion;
- filament road position;
- loading/completed step state.

Offline sources retain their metadata and remain present in the model, while explicitly empty sources clear the tray-existence bit.

Unit-level humidity, temperature, dryer time, and unambiguous nozzle routing are aggregated from the unit's sources.

## Full source metadata

The inherited tray object cannot represent every multiACE field. `MultiAceMachineModel` therefore retains a sidecar record keyed by `(ams_id, tray_id)` containing the complete `FilamentSource` and inventory revision. It also provides a reverse lookup from stable `SourceId` to the projected AMS slot.

The inherited filament profile and UUID fields remain untouched. Callers that require stable source identity, routing, metadata origin, dryer state, or loaded-toolhead information must use the sidecar lookup.

## Ownership and pointer stability

`MultiAceMachineModel` owns only the units and trays it inserts. It:

- preserves unrelated/native `amsList` entries;
- rejects unit-ID collisions rather than replacing an existing AMS;
- updates existing owned units and trays in place when identities remain present;
- removes only owned entries that disappear from the next inventory snapshot;
- preserves bit-mask flags that were already owned by another machine-data path.

The target machine model must outlive the bridge. The bridge must be created, accessed, and destroyed on one GUI thread. Provider callbacks must be marshalled onto that thread before calling `apply()`.

## Lifecycle boundary

This slice does not subscribe directly to `FilamentSourceProvider`. Final `DeviceManager` integration will own the provider, dispatch inventory callbacks through the wxWidgets event loop, apply them through this bridge, and clear the model before destroying the machine object.
