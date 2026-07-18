# multiACE WebSocket event transport

`BeastWebSocketEventTransport` is the concrete live-event implementation for the multiACE `EventTransport` contract. It uses Boost.Asio and Boost.Beast from the repository's existing Boost 1.84 dependency and does not add a new networking library.

## Supported endpoint

The first implementation supports local unencrypted WebSocket origins:

```text
ws://host[:port][/optional/base/path]
```

The event path supplied by `MoonrakerFilamentSourceProvider` is appended to the configured base path. For example:

```text
base_url = ws://printer.local:7125/multiace
event    = /api/v1/events
result   = ws://printer.local:7125/multiace/api/v1/events
```

`wss://` is rejected explicitly for now. TLS support should be added with a Beast SSL stream when printer deployments require it rather than silently downgrading transport security.

## Connection lifecycle

All DNS, TCP, handshake, read, and reconnect work runs on one dedicated `boost::asio::io_context` worker thread.

The transport:

- resolves and connects asynchronously;
- applies a bounded handshake/connect timeout;
- delivers only text WebSocket messages to the event callback;
- limits the maximum accepted message size;
- reports connection state only when the reported state changes;
- reconnects after transient resolve, connect, handshake, or read failures;
- resets reconnect delay after a successful handshake;
- uses bounded exponential backoff;
- cancels resolver, timer, and socket work during shutdown;
- waits for canceled operations to drain before a normal external `disconnect()` returns;
- guarantees that no user callback is invoked after `disconnect()` returns.

If `disconnect()` is called from inside one of the transport's own callbacks, shutdown is performed synchronously on the worker before the call returns, avoiding a later callback from the same connection.

## Authentication and headers

Configuration supports:

- Basic authentication with username/password;
- Bearer authentication;
- additional HTTP upgrade headers.

Basic and bearer authentication are mutually exclusive. A custom `Authorization` header may not be combined with either authentication mode. Header names and values reject CR/LF injection.

Credentials embedded in the WebSocket URL are rejected so authentication remains explicit configuration rather than URL state.

## Reconnect semantics

The first failed connection attempt reports one disconnected state with the failure message. Repeated failures while still disconnected do not spam duplicate state callbacks. A later successful handshake reports connected, and a subsequent connection loss reports disconnected again.

The reconnect delay follows:

```text
initial, 2*initial, 4*initial, ... maximum
```

with saturation at the configured maximum.

## Tests

The transport tests cover:

- endpoint and IPv6 parsing;
- invalid schemes, credentials, and ports;
- bounded reconnect delay;
- authentication/header upgrade values;
- a real loopback TCP/WebSocket handshake and text event;
- reconnect after a server-initiated close;
- connection transition ordering;
- configuration conflicts.

The loopback server uses Boost.Beast as an actual WebSocket peer rather than mocking transport callbacks.
