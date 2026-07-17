# multiACE Moonraker provider

The multiACE inventory provider is split into three layers:

1. `RestTransport` and `EventTransport` define transport-neutral request and event contracts.
2. `MoonrakerFilamentSourceProvider` owns capabilities, inventory refresh, live-event ordering, reconnect behavior, and RFID refresh operations.
3. `HttpRestTransport` adapts OrcaSlicer's existing cross-platform `Http` utility to the REST contract.

## Endpoints

The default API paths are:

```text
GET  /api/v1/capabilities
GET  /api/v1/inventory
POST /api/v1/sources/{percent-encoded-source-id}/refresh
WS   /api/v1/events
```

`MoonrakerEndpoints` allows printer-side deployments to override these paths without changing provider logic.

## Startup and fallback

`start()` loads capabilities first and requires the service to advertise inventory support. It then loads the first inventory snapshot. REST-only operation remains valid when no event transport is configured or when a live-event connection cannot be established.

The REST transport is synchronous. Callers integrating it into the GUI must run startup and manual refresh operations from an existing worker/job context rather than blocking the wxWidgets UI thread.

## Live events

The provider accepts either a complete inventory payload or an event envelope containing an `inventory` object. Trigger events such as `inventory_changed`, `source_changed`, `rfid_updated`, and `refresh` request a new REST snapshot.

Update sequence numbers are reserved when an event or refresh begins. This prevents an older, slow REST response from replacing a newer WebSocket snapshot.

Trigger-only event envelopes require a supported `schema_version`. Complete inventory events are validated by the inventory parser.

## Disconnect behavior

When the event connection is lost or the provider is stopped, the last valid source metadata and inventory revision are retained while source states become `Offline`. A successful reconnect performs a full inventory refresh.

Malformed responses or events update `last_error()` but do not replace the last valid inventory snapshot.

## Event transport boundary

The concrete WebSocket socket implementation is intentionally separate from the provider state machine. An implementation must guarantee that it stops invoking callbacks before `disconnect()` returns. This keeps provider destruction and reconnect behavior deterministic and allows recorded event fixtures to exercise the same logic as a real socket.
