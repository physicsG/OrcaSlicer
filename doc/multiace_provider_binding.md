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

## Concrete provider activation

`MultiAceProviderActivation.hpp` provides the concrete activation path for the deployed multiACE Web service:

- a configured `http://` service URL is normalized once and reused as the REST root;
- the matching `ws://` root is derived without losing ports, IPv6 literals, or nested service paths;
- authentication and custom headers are applied consistently to REST and WebSocket transports;
- the provider is constructed with the deployed `/api/version`, `/api/state`, and `/ws` profile;
- startup must complete successfully before `DeviceManager` replaces an existing machine binding;
- if attachment fails after startup, the new provider is stopped before the error is propagated.

HTTPS activation is intentionally rejected until the transport supports `wss://`; it is never silently downgraded.

## Persisted printer configuration

`MultiAcePrinterConfig.hpp` defines the versioned, GUI-independent configuration payload used to persist a printer's multiACE provider settings.

The schema stores:

- whether multiACE integration is enabled for the printer;
- the service URL;
- optional basic and bearer authentication;
- optional custom HTTP/WebSocket headers.

Parsing is deliberately fail-closed. Invalid field types, unsupported schema versions, partial basic-auth credentials, invalid custom headers, or an enabled configuration without a usable service URL are rejected before provider activation. Unknown fields in the current schema version are ignored so additive UI metadata can be introduced without breaking older readers.

Disabled configurations may retain their connection settings so toggling integration off does not discard user input. `provider_activation_config_if_enabled()` is the boundary used by automatic activation: disabled configurations produce no activation settings, while enabled configurations are fully validated before being returned.

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

The callback/lifetime machinery, `DeviceManager` ownership hook, concrete transport construction, start-before-attach activation helper, and persisted configuration model are now established. Remaining UI integration work is intentionally separate:

- store/load the versioned multiACE payload through the existing per-printer configuration surface;
- invoke activation automatically for configured machines;
- expose refresh/status actions in the existing AMS UI.
