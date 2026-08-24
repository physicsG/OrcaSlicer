# MQTT transport

The U1 does not speak HTTP to Orca. `MoonRaker.cpp` ships two client variants and
the U1 uses the MQTT one:

| Class | Transport | Used by |
|---|---|---|
| `Moonraker` | HTTP + WebSocket | legacy / other Klipper hosts |
| `Moonraker_Mqtt` | **MQTT over TLS** | the Snapmaker U1 |

## Topics

Four topic suffixes, defined as statics in
[`MoonRaker.cpp:844`](../../../src/slic3r/Utils/MoonRaker.cpp):

```cpp
std::string Moonraker_Mqtt::m_request_topic      = "/request";
std::string Moonraker_Mqtt::m_response_topic     = "/response";
std::string Moonraker_Mqtt::m_status_topic       = "/status";
std::string Moonraker_Mqtt::m_notification_topic = "/notification";
```

Every topic is namespaced by a prefix — the printer's **serial number** — and
composed by simple concatenation:

```
<SN>/request         Orca  -> printer   JSON-RPC requests
<SN>/response        printer -> Orca    JSON-RPC responses
<SN>/status          printer -> Orca    subscribed object state
<SN>/notification    printer -> Orca    unsolicited events
```

Orca subscribes to `/notification` and `/response` when a device connects, and to
`/status` when it starts watching machine state; it publishes only to `/request`.
All four use **QoS 1**.

Inbound routing is by suffix match:

```cpp
if      (topic.find(m_response_topic)     != npos) { /* resolve a pending request */ }
else if (topic.find(m_status_topic)       != npos) { /* push into the state model */ }
else if (topic.find(m_notification_topic) != npos) { /* dispatch an event        */ }
```

The bundle contains the same four literals, plus a second `/config/...` set
(`/config/request`, `/config/response`, `/config/notification`) that the C++ does
not use — an additional configuration channel, unexercised on this path.

## TLS and credentials

Two client objects are held: `m_mqtt_client` (plain, `mqtt://`) and
`m_mqtt_client_tls`. The U1 path uses the TLS one, on port **8883**; `MoonRaker.cpp`
special-cases the `:8883` suffix when deriving an HTTP host from the MQTT one.

`MqttClient` takes CA, client certificate and private key as **in-memory strings**
rather than file paths:

```cpp
MqttClient(const std::string& server_address,
           const std::string& client_id,
           const std::string& ca_content,
           const std::string& cert_content = "",
           const std::string& key_content  = "",
           const std::string& username     = "",
           const std::string& password     = "", ...);
```

That matches the cloud endpoint `/user/device/getMqttCert` found in the bundle:
certificates are fetched per device from Snapmaker's API and handed straight to
the client. It also matches the `ca`, `cert`, `key`, `clientId`, `user`,
`password` and `port` fields on Orca's own `DeviceInfo` record
([`AppConfig.hpp:33`](../../../src/libslic3r/AppConfig.hpp)), which is what
`sw_GetConnectedMachine` returns to the page.

## Who drives the session

The page does. `SSWCP`'s `mqtt_agent` routing group exposes the whole client
lifecycle over the bridge:

| Command | |
|---|---|
| `sw_create_mqtt_client` | build a client from cert material |
| `sw_mqtt_connect` / `sw_mqtt_disconnect` | session |
| `sw_mqtt_subscribe` / `sw_mqtt_unsubscribe` | topics |
| `sw_mqtt_publish` / `sw_mqtt_unpublish` | messages |
| `sw_mqtt_set_engine` | swap the underlying client |

`sw_mqtt_subscribe` is a subscription in the bridge sense too — its push channel
is `responseCb`, so inbound MQTT messages surface to the page as bridge pushes.

This is the clearest single illustration of the [layer model](../01-architecture/01-layer-model.md):
the C++ owns an MQTT client, but the *decision* to connect, what to subscribe to,
and what to publish all come from the compiled Flutter page.

## Client library

The bundle credits `mqtt5_client` in `assets/NOTICES` — the page carries a full
MQTT 5 client of its own. On the desktop path it does not use it directly (the
C++ holds the socket), which suggests the same Dart codebase drives Snapmaker's
mobile/web clients over MQTT natively.
