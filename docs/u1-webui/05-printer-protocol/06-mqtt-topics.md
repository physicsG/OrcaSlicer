# Every topic the printer publishes on

[03-mqtt-transport.md](03-mqtt-transport.md) lists four topics, derived by reading
`MoonRaker.cpp`. Those are the four **Orca subscribes to** — which is not the same
question as what the printer *offers*. Reading a client can only ever recover the
client's own view.

This asks the printer instead. Both legs of the connection are subscribed with the `#`
wildcard, so the broker enumerates itself, and traffic is provoked in labelled phases so
each topic can be attributed to what caused it.

Captured from `811002511261022618B3` at `192.168.2.242`, firmware as shipped, using
[`tools/u1_topics.py`](../tools/u1_topics.py). **Seven topics on the session leg, four of
which no reading of the C++ would have found**, because Orca never subscribes to them.

## The connection is LAN, end to end

Worth stating up front, because the topic names invite the opposite guess. Both sockets
are to the printer's own address on the local network — `192.168.2.242:1884` and
`:8883`. Nothing in this path traverses Snapmaker's cloud, and the printer says so
itself on two of the topics below:

```json
mqtt_agent/notification   {"state": "disconnected", "userid": "", "username": ""}
LAVA/notification         {"server": "offline"}
```

That is the printer's *cloud* agent reporting itself disconnected while this LAN session
runs perfectly well. The cloud appears in this system in only two places, neither of
them a broker: `/user/device/getMqttCert` can **issue** the mTLS material a LAN handshake
would otherwise obtain ([05-cloud-api.md](05-cloud-api.md)), and timelapse download has a
`wan` mode where the device uploads and Orca fetches (`SSWCP.cpp:4928`). The MQTT
transport itself is always `mqtts://<printer-ip>:<port>`.

## Two legs, two very different topic sets

| Leg | Port | TLS | Topics visible |
|---|---|---|---|
| authorisation | 1884 | none | **1** |
| session | 8883 | mTLS | **7** |

The plain leg is authorisation-only. Subscribing `#` on it yields exactly one topic, so
the broker is restricting an unauthenticated client to the config channel rather than
serving it a filtered view of everything:

```
12345678/config/response      the mTLS material, in reply to request_lan_auth
```

`12345678` is the fixed LAN auth code, not a PIN — see
[02-device-page/06-connection.md](../02-device-page/06-connection.md). The matching
`12345678/config/request` is publish-only, so it never appears in a subscription.

## The session leg at a glance

Counts are from one 90-second survey and are only indicative; the shapes are not.

| Topic | Msgs | Bytes | Carries | Scoped to |
|---|---:|---:|---|---|
| `<SN>/status` | 33 | 5,122 | `notify_status_update` | this printer |
| `<SN>/response` | 7 | 288,679 | every JSON-RPC reply | this printer |
| `<SN>/notification` | 74 | 15,514 | `notify_filelist_changed`, `{"server":…}` | this printer |
| `<SN>/request` | — | — | requests **out**; never subscribed | this printer |
| `moonraker/response` | 39 | 5,811 | unsolicited identity/login state | **shared** |
| `camera/response` | 3 | 21,433 | camera replies, **duplicated** | **shared** |
| `mqtt_agent/notification` | 39 | 4,485 | `notify_mqtt_agent_status` | **shared** |
| `LAVA/notification` | 1 | 21 | cloud reachability | **shared** |

The four shared topics carry no serial number. They are the ones a client written from
the C++ alone will never see.

## Each topic in detail

### `<SN>/status` — subscribed object state

Klipper's own status push, one entry per changed object plus a monotonic timestamp.
Only *changes* are sent, so a field's absence means unchanged, not zero.

```json
{"jsonrpc": "2.0", "method": "notify_status_update",
 "params": [{"extruder": {"temperature": 27.0}}, 67379.22754892]}
```

`params` is a two-element array: `[objects, eventtime]`. Nothing arrives here until a
`printer.objects.subscribe` has been sent — the topic is live from connect, but silent.

### `<SN>/response` — every JSON-RPC reply

Correlated by `id`, and stamped with the same `cli_time` / `dev_time` fields the request
carries. This is where the bulk of the bytes are: a `printer.objects.list` reply alone
enumerates **228** objects.

```json
{"jsonrpc": "2.0", "result": {"objects": ["gcode", "webhooks", "exception_manager", …]},
 "id": 2, "cli_time": 1787566394, "dev_time": 1787566394}
```

Errors use the standard envelope, and an unsupported method answers `-32601`, which makes
probing a firmware cheap and safe:

```json
{"error": {"code": -32000, "message": "Start monitor failed"}, "id": 6, "jsonrpc": "2.0"}
```

### `<SN>/notification` — unsolicited events

Two distinct kinds share this topic, and they do not share a schema.

**`notify_filelist_changed`** — by volume, the busiest thing on the connection, and the
mechanism behind the camera (see below). Note `root`, which namespaces the path:

```json
{"jsonrpc": "2.0", "method": "notify_filelist_changed",
 "params": [{"action": "delete_file",
             "item": {"modified": 1787566383.19, "size": 90826,
                      "permissions": "r", "path": "monitor.jpg", "root": "timelapse"}}]}
```

**A bare payload with no envelope at all** — no `jsonrpc`, no `method`, no `id`:

```json
{"server": "online"}
```

A parser that assumes JSON-RPC on this topic will throw on it. This one refers to the
printer's *local* Moonraker; the cloud's equivalent is `LAVA/notification` below, and the
two disagree by design.

### `moonraker/response` — identity, unsolicited

Shared, and pushed about every two seconds with `id: -1` — a broadcast wearing a reply's
envelope, answering nothing:

```json
{"jsonrpc": "2.0", "result": {"state": "success", "device_name": "U1 G",
 "logging_out_userid": ""}, "id": -1, "cli_time": -1, "dev_time": 1787566384}
```

`id: -1` and `cli_time: -1` are the tell. A client correlating strictly by `id` ignores
these safely; one that treats any `result` as a reply to its last request will corrupt
its own state.

### `camera/response` — camera replies, duplicated

Every camera reply lands on `<SN>/response` **and** here. Measured directly, by issuing
one request per service family and recording which topics answered each `id`:

| Request | Answered on |
|---|---|
| `printer.objects.list` | `<SN>/response` |
| `server.info` | `<SN>/response` |
| `server.files.get_directory` | `<SN>/response` |
| `camera.get_timelapse_instance` | `<SN>/response` **+ `camera/response`** |
| `camera.start_monitor` | `<SN>/response` **+ `camera/response`** |

Two consequences. Orca's four-topic subscription misses nothing — everything is on
`<SN>/response`. But the duplicate is **not scoped to the requester**, and timelapse
listings carry embedded JPEG thumbnails, so any client authorised onto this broker sees
them:

```
result.instances[0].thumbnail_base64   3,747 chars
result.instances[1].thumbnail_base64   5,367 chars
```

### `mqtt_agent/notification` — the cloud agent

```json
{"jsonrpc": "2.0", "method": "notify_mqtt_agent_status",
 "params": [{"state": "disconnected", "userid": "", "username": ""}]}
```

`state` is the printer's link to Snapmaker's cloud, **not** to us. It reads
`disconnected` throughout a healthy LAN session. Rendering a connection indicator from
this field shows a working printer as offline — the same trap `DeviceInfo.connected`
sets, from the opposite direction.

### `LAVA/notification` — cloud reachability

```json
{"server": "offline"}
```

Bare, like the `<SN>/notification` variant, and the counterpart to it: `LAVA` is the
cloud service (the printer runs as user `lava`, and gcodes live under `/home/lava/`).
`offline` here alongside `online` on `<SN>/notification` is a consistent picture, not a
contradiction — local up, cloud down.

## What this settles about the camera

[STATUS.md](../STATUS.md) listed camera frames as an unverified pass-through, with
`pickFrame()` sniffing field names for base64 in an MQTT push. The topic survey shows why
no field name would have worked: **frames never travel over MQTT.**

```
camera.start_monitor {domain: "lan", interval: 2, expect_pw: false}
  → {"state": "success", "url": "/files/camera/monitor.jpg"}
```

The printer then rewrites a single file on its own filesystem at the monitor interval,
which is what the flood of `notify_filelist_changed` for `monitor.jpg` is. The frame is
fetched over HTTP from Moonraker's file server — verified, 96,001 bytes with a JPEG SOI
marker:

```
http://<ip>:7125/server/files/timelapse/monitor.jpg
```

Note `domain` must be `"lan"`. The reconstruction sends `""`, which the printer rejects:

```json
{"error": {"code": -32000, "message": "Start monitor failed"}}
```

Port 80 also answers, but serves the printer's own web UI and returns that SPA's HTML for
this path — a client that fetches it and finds 2,934 bytes of `text/html` has hit the
wrong port, not a broken camera.

## Reproducing

```bash
# enumerate topics on both legs, write the overview
python3 docs/u1-webui/tools/u1_topics.py --md /tmp/topics.md --json /tmp/topics.json

# response shapes for files, thumbnails and camera
python3 docs/u1-webui/tools/u1_probe.py --out /tmp/shapes.json
```

Both read the device record out of Orca's config, take `--ip` / `--sn` / `--client-id` to
override it, and speak MQTT directly — Orca does not need to be running, and should not
be: the session leg authenticates with the saved `clientId`, and a broker evicts the older
holder of a duplicate client id.

Both are read-only. Every method they send queries, lists or subscribes; none moves the
machine or touches a print job. Certificates are held in a temporary file for the life of
the socket and never reach a report.

The MQTT client underneath is [`tools/mqtt_min.py`](../tools/mqtt_min.py) — MQTT 3.1.1 in
about 200 lines of standard library, because `paho-mqtt` is not installable in this
environment. It implements only CONNECT, SUBSCRIBE, PUBLISH and PINGREQ, which is the
whole of what this protocol needs.
