# Layer model

## Four layers

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1 — the page  (Flutter web, compiled to JS)                │
│ resources/web/flutter_web/main.dart.js   (5.2 MB, dart2js)       │
│                                                                  │
│  • owns the UI for BOTH the Device tab and the print popup       │
│  • owns the JSON-RPC envelopes sent to the printer               │
│  • owns the machine-state subscription list and field filters    │
│  • owns the MQTT session (the host only relays)                  │
└───────────────┬──────────────────────────────────────────────────┘
                │  window.wx.postMessage(JSON)      ← page to Orca
                │  window.postMessage(JSON,'*')     ← Orca to page
┌───────────────┴──────────────────────────────────────────────────┐
│ Layer 2 — the WCP bridge  (C++)                                  │
│ src/slic3r/GUI/SSWCP.cpp   (7,685 lines, 129 commands)           │
│                                                                  │
│  • parses {header, payload{cmd, params, event_id}}               │
│  • routes each sw_* command to one of 8 instance classes         │
│  • owns subscriptions, caching, file I/O, dialogs, account state │
└───────────────┬──────────────────────────────────────────────────┘
                │  JSON-RPC 2.0
┌───────────────┴──────────────────────────────────────────────────┐
│ Layer 3 — the Moonraker client  (C++)                            │
│ src/slic3r/Utils/MoonRaker.cpp   (3,006 lines)                   │
│                                                                  │
│  • Moonraker       — plain HTTP/WebSocket variant                │
│  • Moonraker_Mqtt  — MQTT-over-TLS variant (the one U1 uses)     │
└───────────────┬──────────────────────────────────────────────────┘
                │  MQTT/TLS :8883, topics keyed by printer serial
┌───────────────┴──────────────────────────────────────────────────┐
│ Layer 4 — Snapmaker U1: Klipper + Snapmaker's Moonraker fork     │
└──────────────────────────────────────────────────────────────────┘
```

## Who owns what

The structural fact that makes this whole surface reverse-engineerable is that
**layer 1 owns the protocol**. The bundle constructs complete JSON-RPC envelopes,
including method names and parameter maps, and hands them down. Layers 2 and 3
transport, authenticate and apply policy; they do not define the wire format.

Two consequences:

- The full RPC surface can be read out of `main.dart.js` even though it is
  minified, because **string literals survive dart2js**. Only identifiers are
  mangled.
- `SSWCP.cpp` and `MoonRaker.cpp` are a second, independent source for the same
  contract, so each side cross-checks the other.

## The page's own internal structure

The page logs its construction to the host through `sw_FileLog`, which makes its
internal wiring directly observable. Captured from a live boot
([harness](../tools/harness/README.md)):

| Component | Role |
|---|---|
| `OrcaGateway` | Owns the WCP client, registers everything else |
| `OrcaAuthBridge` / `OrcaLoginAdapter` | Account state, token → API authorisation |
| `LavaDeviceViewModel` | Device list, connection status, display status |
| `OrcaUseViewModel` | User/session state |
| `OrcaControlViewModel` | The Device page's control surface |
| `ThemeVM` | Light/dark theme |
| `DeviceKeyIvProvider` | Key/IV material for device payload encryption |
| `ConnectionFactory` | Builds a connection per transport (LAN / WAN) |

`lava_*` is Snapmaker's internal package prefix — see
[bundle inventory](02-bundle-inventory.md).

## How each surface is mounted

Both host windows do the same three things: build a loopback URL with a `path`
query parameter, create a `wxWebView`, and forward every
`wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED` verbatim to `SSWCP::handle_web_message`.

```cpp
// PrinterWebView.cpp — the Device tab
LOCALHOST_URL + port + "/web/flutter_web/index.html?path=2"

// WebPreprintDialog.cpp — the print popup, 714x750, modal
LOCALHOST_URL + port + "/web/flutter_web/index.html?path=4"   // upload and print
LOCALHOST_URL + port + "/web/flutter_web/index.html?path=5"   // upload only
```

Three host details worth knowing:

- **DevTools are unconditionally enabled.** In `PrinterWebView::update_mode()`
  the `developer_mode` config check is commented out and replaced with a literal
  `true`. You can right-click → Inspect the live Device page in a shipping build.
  This is the single most useful RE affordance available.
- `PrinterWebView::SendAPIKey()` monkey-patches `fetch` and `XMLHttpRequest` to
  inject an `X-API-Key` header, guarded by a `window.__sm_apikey_hooked` flag.
  This serves the *legacy HTTP* printer path, not the U1 MQTT path.
- `WebPreprintDialog` is modal and drives its result through the bridge rather
  than through a button: see [dialog lifecycle](../03-print-processing/02-lifecycle.md).
