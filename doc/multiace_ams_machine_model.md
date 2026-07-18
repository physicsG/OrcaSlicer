# multiACE AMS machine-model bridge

The existing OrcaSlicer machine UI is built around `MachineObject::amsList`, `Ams`, and `AmsTray`. The multiACE bridge projects the provider inventory into those inherited objects without representing spool slots as physical extruders.

The implementation has two layers:

- `BasicMultiAceAmsModel<Traits>` owns lifecycle, pointer stability, masks, source metadata, and thread-affinity rules without including wxWidgets or GUI classes.
- `MultiAceMachineModel` is a thin GUI adapter whose traits create and populate OrcaSlicer's concrete `Ams` and `AmsTray` objects.

This split lets the full ownership engine run in the existing libslic3r unit-test target while keeping GUI field mapping close to `DeviceManager`.

## Topology rules

The first bridge version intentionally accepts the inherited topology that existing AMS UI code understands:

- ACE unit IDs are canonical non-negative decimal integers.
- Slot IDs are canonical integers from `0` through `3`.
- Each unit/slot pair must be unique.
- Unit and flat-slot indices must fit the inherited signed `long` bit masks.
- A loaded toolhead must be declared as reachable by that source.
- Projected `Ams::nozzle` is set only when every slot in a unit has exactly one identical reachable toolhead. Mixed or incomplete routing uses `-1`; per-source routing remains authoritative in the sidecar metadata.

This preserves the distinction between many spool sources and the U1's four physical toolheads.

## Existing AMS fields

Each source populates only inherited tray fields owned by live inventory:

- RFID UID;
- material and subtype;
- normalized RGBA color;
- remaining percentage;
- tray existence;
- RFID-read completion;
- filament road position;
- loading/completed step state.

Filament profile IDs, UUID, calibration values, multicolor configuration, temperature/profile fields, and other GUI-managed state are deliberately left untouched during refreshes.

Offline sources retain their metadata and remain present in the model, while explicitly empty sources clear the tray-existence bit.

Unit-level humidity, temperature, dryer time, and unambiguous nozzle routing are aggregated from the unit's sources.

## Full source metadata

The inherited tray object cannot represent every multiACE field. `BasicMultiAceAmsModel` therefore retains a sidecar record keyed by `(ams_id, tray_id)` containing the complete `FilamentSource` and inventory revision. It also provides a reverse lookup from stable `SourceId` to the projected AMS slot.

The inherited filament profile and UUID fields remain untouched. Callers that require stable source identity, routing, metadata origin, dryer state, or loaded-toolhead information must use the sidecar lookup.

Pointers returned by `source_metadata()` remain valid only until the next `apply()` or `clear()` call. Callers that need longer-lived data must copy the returned record.

## Ownership and pointer stability

The model owns only the units and trays it inserts. It:

- preserves unrelated/native `amsList` entries;
- rejects unit-ID collisions rather than replacing an existing AMS;
- updates existing owned units and trays in place when identities remain present;
- repairs a missing target-map entry by restoring the same owned pointer;
- rejects a target-map entry that was replaced with a different pointer;
- removes only owned entries that disappear from the next inventory snapshot;
- leaves an externally replaced entry untouched when its former multiACE source disappears;
- preserves bit-mask flags that were already owned by another machine-data path.

The target machine model must outlive the bridge. The bridge must be created, accessed, and destroyed on one GUI thread. Provider callbacks must be marshalled onto that thread before calling `apply()`.

The model provides the basic exception guarantee: a failed update remains memory-safe and preserves ownership, but trait field assignments may already have updated part of an existing unit or tray. Callers should keep trait updates non-throwing apart from allocation failures and retry with a complete inventory snapshot after reporting an error.

## Lifecycle boundary

This slice does not subscribe directly to `FilamentSourceProvider`. Final `DeviceManager` integration will own the provider, dispatch inventory callbacks through the wxWidgets event loop, apply them through this bridge, and clear the model before destroying the machine object.
