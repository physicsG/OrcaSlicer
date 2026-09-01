# The SSWCP bridge — wire protocol

SSWCP ("Slicer Studio Web Communication Protocol") is the JSON message bus between the
Flutter Device page and Orca's C++. Everything the page cannot do itself — talk to the
printer, touch the filesystem, open dialogs, read account state — goes through it.

## Transport

| Direction | Mechanism |
|---|---|
| Page → Orca | `window.wx.postMessage(<json string>)` — a `wxWebView` script-message handler named `wx`. Delivered to `SSWCP::handle_web_message` via `PrinterWebView::OnScriptMessage`. |
| Orca → Page | Orca evaluates `window.postMessage(JSON.stringify(<obj>), '*')` in the page. |

`resources/web/flutter_web/index.html` installs a `window.sendMessage` shim that forwards
to `window.wx.postMessage` and logs to the console when the host is absent — which is what
makes the bundle runnable in a plain browser for inspection.

There is a second, parallel path: `SSWCP::send_message_to_flutter` mirrors every response
over a WebSocket debug server (`WebSocketDebugServer.hpp`), and
`SSWCP::handle_webmsg_for_debug` accepts commands with no webview attached. This exists so
a Flutter debug session outside Orca can drive the same bridge.

## Envelope

Recovered from `A.be` / `A.bM` / `A.Hu` in the bundle, whose `toString()` implementations
still carry the original Dart class names.

**Request** — `WcpPacket{header, payload}` where payload is `RequestPayload`:

```json
{
  "header":  { "seqid": "1732" },
  "payload": {
    "cmd":      "sw_ControlBedTemp",
    "event_id": null,
    "params":   { "temp": 60 },
    "metadata": null
  }
}
```

**Response** — same envelope, payload is `ResponsePayload`:

```json
{
  "header":  { "seqid": "1732" },
  "payload": { "code": 200, "message": "success", "data": { } }
}
```

| Field | Meaning |
|---|---|
| `header.seqid` | Correlation id, a monotonically incrementing counter rendered as a string. Orca echoes `header` back verbatim, which is how the page matches replies. |
| `payload.cmd` | One of the 111 `sw_*` commands — see [command reference](02-command-catalogue.md). |
| `payload.event_id` | Non-null turns the call into a **subscription** (see below). |
| `payload.metadata` | Always `null` in this build. |
| `payload.code` | **`200` on success** — see below. `1` on timeout, `-1` for missing/invalid params. |
| `payload.message` | Human-readable error text, empty on success. |
| `payload.data` | Command-specific result object. |

Orca serialises responses with `json::dump(4, ' ', true)` — pretty-printed, with invalid
UTF-8 replaced rather than throwing.

### `code: 200` means success — `code: 0` is a failure

This is the single easiest thing in the bridge to get wrong, and it is worth stating
plainly because `0` is the natural guess for "no error".

Three independent confirmations:

1. **The C++ default.** `SSWCP.hpp:219` — `int m_status = 200;  // Response status code`.
   Every handler that succeeds without touching `m_status` replies `200`.
2. **The bundle's own guard.** `main.dart.js` compares `payload.code` against the literal
   `200` in **eleven** places, and against no other integer:
   ```js
   if (J.o(j.b.h(0,"code"), 200)) { /* success path */ }
   ```
3. **Observed behaviour.** Replying `0` from a simulated host makes the page raise
   `Exception: getUserLoginState failed: code=0, message=success`, retry three times, and
   then declare the user signed out. Replying `200` lets the session proceed to
   `ConnectionStatus.connectedOnline`.

The C++ is not internally consistent — a few handlers set `m_status = 0`
(`SSWCP.cpp:4439`, `:4475`, `:5620`) and others use `1` for failure — but the page's
contract is unambiguous. **A client that treats `0` as success will reject every real
response from Orca.**

## One-shot vs subscription

The distinction is `event_id`, handled in `SSWCP_*::process()`:

```cpp
if (m_event_id != "") {
    send_to_js();                       // 1. immediate ack, echoing the original header
    m_header.clear();
    m_header["event_id"] = m_event_id;  // 2. all later pushes are keyed by event_id
}
```

So a subscription produces:

1. **One ack** carrying the original `header.seqid`, sent *before* the command runs.
2. **N pushes**, each with `header = {"event_id": "<id>"}` and no `seqid`.

Lifetime differs too — `SSWCP::handle_web_message`:

```cpp
if (event_id != "") m_instance_list.add_infinite(instance.get(), instance);
else                m_instance_list.add(instance.get(), instance, DEFAULT_INSTANCE_TIMEOUT);
```

One-shot instances are garbage-collected on a timeout; subscriptions live until explicitly
cancelled (`sw_Webview_Unsubscribe`, `sw_UnsubscribeAll`, `sw_StopMachineStateSubscription`,
`sw_UnSubscribeMachineState`) or until the webview is destroyed
(`SSWCP::on_webview_delete`).

## Routing

`SSWCP::create_sswcp_instance` picks a handler class by membership in one of eight command
sets. The class determines threading, lifetime, and which subsystem the command reaches:

| Instance class | Command set | Domain |
|---|---|---|
| `SSWCP_MachineOption_Instance` | `m_machine_option_cmd_list` | Printer control, files, camera, timelapse — **the bulk of the Device page** |
| `SSWCP_MachineConnect_Instance` | `m_machine_connect_cmd_list` | Connect / disconnect / pincode |
| `SSWCP_MachineFind_Instance` | `m_machine_find_cmd_list` | LAN discovery (Bonjour) |
| `SSWCP_MachineManage_Instance` | `m_machine_manage_cmd_list` | Saved-device list |
| `SSWCP_UserLogin_Instance` | `m_login_cmd_list` | Account, downloads, timelapse upload |
| `SSWCP_SliceProject_Instance` | `m_project_cmd_list` | Projects and recent files |
| `SSWCP_PageStateChange_Instance` | `m_page_state_cmd_list` | Page visibility/state |
| `SSWCP_MqttAgent_Instance` | `m_mqtt_agent_cmd_list` | Raw MQTT passthrough |
| `SSWCP_Instance` (base) | everything else | Cache, logging, tabs, browser, exit |

Unknown commands fall through to `handle_general_fail()`.

## Command coverage

| | Count |
|---|---|
| Commands the Device page calls | 117 |
| Commands Orca dispatches | 127 |
| Both (the live contract) | **111** |
| Called by the page with no C++ handler | 6 |
| Handler exists but the page never calls it | 16 |

The 6 page-only commands are `sw_GetMachineFilamentMapping`, `sw_Query`, `sw_SendCommand`,
`sw_UnSubscribeMachineState`, `sw_UploadFile`, `sw_UploadFileResult`. Some are aliases the
page never reaches at runtime (`sw_StopMachineStateSubscription` is the name that actually
dispatches to `sw_UnSubscribeMachineState()`); the rest are dead paths or belong to a newer
bundle than this Orca build.

## Raw MQTT passthrough

`SSWCP_MqttAgent_Instance` exposes the MQTT client directly to the page:
`sw_create_mqtt_client`, `sw_mqtt_connect`, `sw_mqtt_disconnect`, `sw_mqtt_subscribe`,
`sw_mqtt_unsubscribe`, `sw_mqtt_publish`, `sw_mqtt_set_engine`.

This is a full escape hatch — with it the page can bypass every typed command and speak
to the printer itself. `sw_mqtt_set_engine` switches which side owns the connection.
