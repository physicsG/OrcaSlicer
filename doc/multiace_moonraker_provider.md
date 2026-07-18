# multiACE Moonraker provider

The multiACE inventory provider is split into three layers:

1. `RestTransport` and `EventTransport` define transport-neutral request and event contracts.
2. `MoonrakerFilamentSourceProvider` owns capabilities, inventory refresh, live-event ordering, reconnect behavior, and RFID refresh operations.
3. `HttpRestTransport` adapts OrcaSlicer's existing cross-platform `Http` utility to the REST contract.

## API profiles

The provider keeps two explicit server contracts separate.

The default versioned inventory profile uses the proposed normalized API:

```text
GET  /api/v1/capabilities
GET  /api/v1/inventory
POST /api/v1/sources/{percent-encoded-source-id}/refresh
WS   /api/v1/events
```

`MoonrakerEndpoints` allows printer-side deployments to override these paths without changing provider logic.

`MoonrakerEndpoints::multiace_web()` selects the contract deployed by the current
[`decay71/multiACE`](https://github.com/decay71/multiACE) Web service:

```text
GET  /api/version
GET  /api/state
WS   /ws
```

Configure the transports with the printer's `/multiace` base URL, for example `http://printer.local/multiace` and
`ws://printer.local/multiace`. The service is normally exposed through the printer's nginx proxy, which supplies authentication and forwards
these paths to the FastAPI process.

The compatibility parser was developed against upstream commit `7c2a5e0ee6ed0b72479211efd80cb2bceb70967c`. Representative REST and
WebSocket fixtures preserve that consumer contract in the test suite.

### Deployed state translation

The multiACE Web dashboard payload is translated into the provider-neutral inventory model:

- `aces[].idx` and `slots[].idx` form the stable `multiace:<unit>:<slot>` source ID;
- RFID, override, and derived metadata sources map to the corresponding metadata origins;
- unit connection state, slot state, humidity, temperature, and dryer state are projected onto every source in the unit;
- `toolheads[]` determines the currently loaded physical U1 head;
- multi mode routes slot `0..3` to physical head `0..3`;
- ACE-per-head mode uses `ace_heads` and `head_ace` so every slot in one ACE reaches its configured physical head;
- unknown modes and optional fields degrade to empty reachability or unknown telemetry rather than inventing state.

The deployed service does not provide an inventory revision. The parser therefore produces a deterministic FNV-1a revision from normalized
source metadata and reachability. Periodic timestamps, printer state, loaded state, and changing telemetry do not make routing plans stale.
Exact duplicate snapshots do not emit inventory notifications; changed live state and telemetry still do.

## Startup and fallback

`start()` loads capabilities first and requires the service to advertise inventory support. It then loads the first inventory snapshot. REST-only operation remains valid when no event transport is configured or when a live-event connection cannot be established.

The REST transport is synchronous. Callers integrating it into the GUI must run startup and manual refresh operations from an existing worker/job context rather than blocking the wxWidgets UI thread.

## Live events

The provider accepts either a complete inventory payload or an event envelope containing an `inventory` object. Trigger events such as `inventory_changed`, `source_changed`, `rfid_updated`, and `refresh` request a new REST snapshot.

Update sequence numbers are reserved when an event or refresh begins. This prevents an older, slow REST response from replacing a newer WebSocket snapshot.

Trigger-only event envelopes in the normalized profile require a supported `schema_version`. Complete inventory events are validated by the
inventory parser. In the deployed multiACE Web profile, `state` frames are complete snapshots, `gcode_error` frames are ignored by the
inventory provider, and Klippy-disconnected frames mark the retained inventory offline.

## Disconnect behavior

When the event connection is lost or the provider is stopped, the last valid source metadata and inventory revision are retained while source states become `Offline`. A successful reconnect performs a full inventory refresh.

Malformed responses or events update `last_error()` but do not replace the last valid inventory snapshot.

## Event transport boundary

The concrete WebSocket socket implementation is intentionally separate from the provider state machine. An implementation must guarantee that it stops invoking callbacks before `disconnect()` returns. This keeps provider destruction and reconnect behavior deterministic and allows recorded event fixtures to exercise the same logic as a real socket.
