# multiACE provider-to-machine binding

Live multiACE inventory can arrive from HTTP refresh workers or WebSocket callbacks. Those callbacks must never mutate OrcaSlicer's `MachineObject::amsList` directly because the inherited AMS model is GUI-owned and uses raw pointers.

This layer separates provider callback lifetime from machine-model lifetime.

## `FilamentSourceBinding`

`FilamentSourceBinding` is GUI-independent. It joins three things:

1. a `FilamentSourceProvider`;
2. a dispatcher that schedules work on the model owner thread;
3. an apply callback that consumes an `InventorySnapshot`.

Provider callbacks only enqueue immutable inventory snapshots. They never call the apply callback directly.

The binding guarantees:

- one scheduled drain at a time;
- provider updates remain ordered by callback sequence;
- a newer callback cannot be overwritten by an older initial inventory read;
- exceptions from dispatch or apply are contained and exposed through `last_error()`;
- queued work is discarded after `detach()`;
- callbacks retained by a provider after unsubscribe are harmless;
- `detach()` waits for an already-running apply callback before releasing the callback target.

A failed newer snapshot is still considered consumed. An older snapshot queued later is therefore never allowed to restore stale state after the newer snapshot failed validation.

## `MultiAceMachineBinding`

`MultiAceMachineBinding` combines `FilamentSourceBinding` with `MultiAceMachineModel`.

The supplied dispatcher must marshal work to the same thread on which the binding and machine model are created and destroyed. `DeviceManager` now supplies a wxWidgets `CallAfter` dispatcher by default and accepts an injected dispatcher for deterministic tests.

The binding exposes the existing model sidecar lookups:

- inventory revision;
- full source metadata by AMS unit and tray;
- stable `SourceId` to AMS slot lookup.

## Lifetime order

The required lifetime is:

```text
MachineObject created
  -> MultiAceMachineBinding created
  -> provider emits inventory on arbitrary threads
  -> dispatcher applies snapshots on GUI thread
  -> MultiAceMachineBinding detached/destroyed
  -> MachineObject legacy AMS cleanup runs
  -> MachineObject destroyed
```

The binding must be detached before legacy `MachineObject` cleanup deletes raw `AmsTray*` pointers. `DeviceManager` owns one binding per machine, detaches an old binding before provider replacement, and detaches all bindings before deleting machine objects during shutdown. User-machine removal and logout paths use the same ordering.

## Scope boundary

The callback/lifetime machinery and `DeviceManager` ownership hook are now established and tested. The remaining integration work is intentionally separate:

- construct/start the Moonraker provider from printer configuration;
- expose refresh/status actions in the existing AMS UI.

The concrete reconnecting WebSocket transport and compatibility with the deployed multiACE Web `/api/state` + `/ws` contract are available to
that activation layer.
