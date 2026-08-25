# Snapmaker cloud API

Cloud-connected devices are reached through Snapmaker's REST API rather than a LAN broker.
The Device page uses `dio` for these calls.

> **Corrected 2026-08-24.** This page used to say the cloud "only supplies credentials and
> file transfer". That is wrong, and understates it considerably. On the WAN path the cloud
> also supplies **a different MQTT broker and a different topic namespace** — the session
> does not go to the printer at all. See [The two transports](#the-two-transports) below.

## The two transports

`DeviceModel` carries two endpoint builders, and which one runs decides what the MQTT
session even connects *to*:

| | LAN (`getOrcaLanEndpoint`) | WAN (`getOrcaWanEndpoint`) |
|---|---|---|
| Broker | the printer, `<ip>:<port>` | **`certConfig.endpoint`** — AWS IoT Core |
| `link_mode` | `lan` | `wan` |
| Client id | the device's own | `certConfig.clientId` |
| CA | from the LAN handshake | **hardcoded in the bundle** (below) |
| cert / key | from the LAN handshake | from `getMqttCert` |
| Topics | `<SN>/…`, fixed suffixes | **full topic strings from the cloud** |
| Port | as saved | forced to **8883** if the cert says 1884 |

The LAN builder's topic map, recovered from the bundle, is exactly the set
[03-mqtt-transport.md](03-mqtt-transport.md) derives from the C++, plus the auth pair the
connect work found:

```
publish     request "/request"   authRequest "/config/request"   config ""
subscribe   response "/response" authResponse "/config/response"
            status "/status"     notification "/notification"
            config "/config/notification"
```

The WAN builder does not use suffixes at all. It takes `certConfig.subscribeTopics` and
`certConfig.publishTopics` — **lists of complete topic strings** — and indexes them by each
topic's *second* path segment, so a topic `a/status/b` files itself under `status`. It then
appends `"/" + certConfig.clientId` to the `config` topic. WAN also carries two topics LAN
has no equivalent for: **`data`** and **`error`**.

## It is AWS IoT Core

The function that calls `getMqttCert` is named `fetchUserAwsIoTConfig`, and before calling
it the bundle awaits a helper that returns one hardcoded PEM tagged `"aws"`. That PEM
decodes to:

```
subject = C=US, O=Amazon, CN=Amazon Root CA 1
notAfter = Jan 17 00:00:00 2038 GMT
SHA-256 = 8E:CD:E6:88:4F:3D:87:B1:12:5B:A3:1A:C3:FC:B1:3D:70:16:DE:7F:57:CC:90:4F:E1:CB:97:C6:AE:98:19:6E
```

So the **CA is not returned by the API** — only `cert`, `key`, the endpoint, the client id
and the topic lists are. The trust root ships inside the page and is pinned to Amazon's.

`certConfig` is assembled as:

```
{ ca,               <- the bundled Amazon Root CA 1, not from the response
  cert, key,
  clientId,
  endpoint,         <- read from the response's "ip" field
  port,             <- defaults to 1884, then forced to 8883
  subscribeTopics,  <- list of full topic strings
  publishTopics }
```

## Orca's C++ cannot drive a WAN session

This is the load-bearing limitation, and it is worth being blunt about.

`sw_create_mqtt_client` takes `server_address` as a free parameter, so the page **can** hand
the C++ an AWS IoT endpoint and it will connect. But the engine that then speaks the
protocol, `Moonraker_Mqtt`, builds every topic itself:

```cpp
std::string main_layer = "+";
main_layer = m_sn;                       // MoonRaker.cpp:1340, :1476, :1602, :2661
... Subscribe(main_layer + m_status_topic, ...)
... Publish(main_layer + m_request_topic, ...)
```

`publishTopics` and `subscribeTopics` appear **nowhere in `src/`**. The cloud-supplied topic
strings are ignored, and every request goes to `<SN>/request` regardless of what the cert
said. A WAN session therefore works only if AWS IoT happens to namespace that device by the
same serial — which is exactly the thing this cannot confirm without a live cert.

Two further consequences of that code:

- `m_sn`, and all four topic suffixes, are **`static` members** (`MoonRaker.hpp:389-401`,
  guarded by `m_sn_mtx`). The topic namespace is process-global, so Orca can address one
  printer's topics at a time by construction.
- `main_layer` initialises to `"+"`, the MQTT single-level wildcard. If `m_sn` were ever
  empty at that point the client would subscribe across *every* device namespace the broker
  would serve it. The code guards this on the publish paths (`if (main_layer == "+" || ...)`)
  but the subscribe path at :1340 does not re-check.

## What the printer says about its own cloud link

From the LAN topic survey ([06-mqtt-topics.md](06-mqtt-topics.md)), the printer publishes its
cloud state on two shared topics, and both read *down* throughout a healthy LAN session:

```json
mqtt_agent/notification   {"state": "disconnected", "userid": "", "username": ""}
LAVA/notification         {"server": "offline"}
```

That is the printer's own outbound agent — the one the mobile app reaches it through. It is
independent of whether Orca is talking to the printer, and it is not a signal about the LAN
session's health.

## Verification status

Everything above is recovered from the shipped bundle and from `src/`, and the CA is
confirmed by decoding it. **The `getMqttCert` response itself has not been observed.** A
direct call from this environment is refused at the CDN before it reaches the API:

```
HTTP 403  Cloudflare error 1010 "browser_signature_banned"
```

which is a user-agent rule, not an authentication result — the bearer token is never
evaluated. Reaching it legitimately means letting the page make the call from Orca's webview,
where `fetchCloudCert()` in `device_page/js/core/connection.js` already implements it. Until then,
these remain unconfirmed: the endpoint hostname, the real topic strings, and therefore
whether the SN-prefixed C++ can address a WAN device at all.

## Token shape

The persisted bearer token is an RS256 JWT. One observed instance carried:

```
iss = http://172.31.131.102:8184        <- an RFC1918 address, in a production token
aud = mall-app
scope = [openid, profile]
lifetime = 24h
```

The internal issuer is consistent with the internal dev host
`http://172.17.100.32:8100/api` already left in the shipping bundle. `SMAccountPersist`
stores this token in plaintext `app_config`; its own header says an OS keychain would be
better, and that is still true.

## Hosts

| Environment | Host |
|---|---|
| Production (global) | `https://api.snapmaker.com/api` |
| Production (China) | `https://api.snapmaker.cn/api` |
| Identity | `https://id.snapmaker.com/api` |
| Pre-production | `https://pre.api.snapmaker.com/api`, `https://pre.api.snapmaker.cn/api`, `https://pre.id.snapmaker.com/api` |
| **Internal dev (left in the shipping bundle)** | `http://172.17.100.32:8100/api` |

The `.com` / `.cn` split is region selection; `get_international_url()` on the Orca side
rewrites the loopback URL to match the user's region before the webview loads it.

## Authentication

OAuth2 against the identity host:

```
POST /oauth2/token
```

with `client_id`, `grant_type`, `scope`; the reply carries `access_token`, `token_type`
(`bearer`), and is sent onward as `Authorization: Bearer <token>`.

Token expiry surfaces to the UI as `TokenInvalidationEvent{uri, accessToken, msg, code, desc}`.
The session user is `User{nickname, userid, email, account, status, icon, token, cellphone}`.

Orca persists the login across restarts — see `SMAccountPersist.hpp` and the
`sw_GetUserLoginState` / `sw_SubscribeUserLoginState` bridge commands.

## Device binding

| Endpoint | Purpose |
|---|---|
| `POST /user/device/bind` | Bind a printer to the account |
| `POST /user/device/unbind` | Release it |
| `GET /user/device/list` | Bound devices |
| `GET /user/device/info` | One device's detail |
| `POST /user/device/checkAuth` | Check current authorisation |
| `POST /user/device/connect/auth` | Authorise a connection attempt |
| `GET /user/device/getMqttCert` | **Fetch the mTLS material** — becomes `DeviceCertConfig` |

`getMqttCert` is the cloud counterpart of the LAN handshake, but "after which the transport
is identical" is only true of the *protocol*. The broker, the client id and the whole topic
namespace differ — see [The two transports](#the-two-transports).

## File upload

A three-step create/complete/cancel flow, consistent with pre-signed object storage:

| Endpoint | Purpose |
|---|---|
| `POST /user/device/upload/create` | Begin an upload, obtain the destination |
| `POST /user/device/upload/completed` | Finalise |
| `POST /user/device/upload/cancel` | Abort |

`index.html` allows the `x-amz-checksum-sha256` request header, so the destination is
S3-compatible and the client checksums with SHA-256. `UploadTaskState` carries a
`checksum` field, and `DirectPrintParams` carries `fileChecksum`.

Once uploaded, `server.files.pull` tells the printer to fetch the object itself, with
progress reported back over `<SN>/notification` as `notify_file_pull_progress`.
`server.files.start_cloud_print` then starts the job.

## Model library

`/model/list`, `/model/detail/`, `/manage/model/list`, `/manage/model/detail/` and their
`/cn/` variants back the model-library browsing surface.

## Legacy HTTP printer path

Strings for a plain Moonraker HTTP host also survive — `/server/info`,
`/server/files/upload`, `/server/files/gcodes/`, `/status`, `/status/poll`, `/health`,
`/ping`, `/preUpload`, `/preUploadAndPrint`. These belong to the non-U1 printer path
(`?path=3`), where `PrinterWebView::SendAPIKey()` injects `X-API-Key` into `fetch` and
`XMLHttpRequest`. The U1 does not use them.
