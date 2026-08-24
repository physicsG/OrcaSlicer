# Bringing a session up

How the Device page connects to a U1. Every step is a bridge command; the page owns the
sequence and Orca owns the socket. Recovered from `SSWCP.cpp` and `MoonRaker.cpp`.

## Why `sw_Connect` is not the answer

The obvious-looking command is a stub:

```cpp
void SSWCP_MachineConnect_Instance::sw_connect() {
}
```

The real work is spread across the **MQTT agent** group — `sw_create_mqtt_client`,
`sw_mqtt_connect`, `sw_mqtt_set_engine` — with `sw_GetPincode` in front of it the first
time a machine is paired.

## Two paths

Which one applies depends on whether the saved `DeviceInfo` already carries mTLS
material (`ca`, `cert`, `key`). A machine that has never been paired has all three empty,
even though `ip`, `port` and `clientId` are already populated.

```
        already paired                      first-time LAN pairing
        ──────────────                      ──────────────────────
                                            sw_GetPincode        { ip, userid,
                                                                   nickname, port:1884 }
                                            → the printer displays a code
                                            → the user types it in

        sw_create_mqtt_client               sw_create_mqtt_client
          server_address:                     server_address:
            mqtts://<ip>:<port>                 mqtt://<ip>:1884
            + ca, cert, key                   clientId
          → { type, id }                      → { type, id }

        sw_mqtt_connect { id }              sw_mqtt_connect { id }

        sw_mqtt_set_engine                  sw_mqtt_set_engine
          { engine_id, ip, port, sn,          { engine_id, ip, port:1884, sn,
            ca, cert, key, user, password }     code: <the PIN> }
```

## What each command requires

Every handler rejects a missing or mistyped param explicitly, so the contract is exact.

| Command | Required | Optional |
|---|---|---|
| `sw_GetPincode` | `ip`, `userid`, `nickname` | `port` (default **1884**) |
| `sw_create_mqtt_client` | `server_address`, `clientId` | `ca`, `cert`, `key`, `username`, `password`, `clean_session` |
| `sw_mqtt_connect` | `id` | — |
| `sw_mqtt_subscribe` | `id`, `topic`, `qos`, **and an `event_id`** | — |
| `sw_mqtt_publish` | `id`, `topic`, `qos`, `payload` | — |
| `sw_mqtt_set_engine` | `engine_id`, `ip`, `port`, `sn` | `code`, `ca`, `cert`, `key`, `user`, `password`, `need_reload` |

`sw_create_mqtt_client` picks the scheme itself: all three of `ca`/`cert`/`key` present
gives an `mqtts` client, otherwise plain `mqtt`. It returns
`{ type, id }`, where `id` is the client pointer rendered as a decimal string — every
later command addresses the engine by it.

## What `sw_mqtt_set_engine` actually does

It is the command that finishes a connection, and it does considerably more than its
name suggests:

1. builds a `Moonraker_Mqtt` print host against `ip:port` and registers it as Orca's
   current connect host;
2. attaches the engine created above (`host->set_engine`);
3. when a `code` is supplied, runs `Moonraker_Mqtt::ask_for_tls_info()`, which
   subscribes `<code>/config/response`, publishes `server.request_key` with the client
   id, and waits up to 60s for
   `{ state, sn, clientid, ca, cert, key, port }`;
4. stores the returned material on the device record and sets `connected = true`;
5. pushes the updated device list to every `sw_SubscribeLocalDevices` subscriber.

Step 5 is how the UI learns it worked — there is nothing to poll.

### Pass `need_reload: false`

`need_reload` defaults to **true**, and on that path the host reloads the Device webview:

```cpp
if (reload_device_view) {
    wxString url = wxGetApp().get_u1_surface_url(GUI_App::U1Surface::DeviceTab);
    wxGetApp().mainframe->load_printer_url(get_international_url(url));
}
```

A page that calls `sw_mqtt_set_engine` on itself and leaves the default gets torn down
halfway through its own connect sequence. The reconstruction passes `false`.

## `DeviceInfo.connected` is not a reachability signal

Worth stating plainly, because it is a trap:

```cpp
// AppConfig.cpp:887 - on every config save
for (size_t i = 0; i < j["devices"].size(); ++i)
    j["devices"][i]["connected"] = false;
```

The flag is **forced to false for every device whenever the config is written**. It is a
runtime-only value that never survives a save, so on disk it is false by construction and
says nothing about whether a printer is reachable.

A page that renders its connection indicator from that flag will show a perfectly healthy
printer as disconnected. The authoritative signal is **live machine state**: if subscribed
objects are arriving, there is a session. The reconstruction uses that, and treats the
flag only as a secondary hint.

## The page connects itself on load

The shipped page does not wait to be told. The first harness capture caught it emitting
`sw_create_mqtt_client` unprompted, straight after reading the device list — which is why
a printer that was never manually connected still appeared live on the original page.

The reconstruction matches this, with one deliberate limit: it auto-connects only where
that can succeed without a prompt — a machine that already holds keys, or a signed-in
account that can be issued them from the cloud. LAN pairing needs a human to read a code
off the printer, so it stays a deliberate action.

## Cloud credentials

A signed-in account can be issued mTLS material without touching the printer's screen:

```
GET /user/device/getMqttCert?sn=<serial>
Authorization: Bearer <token from sw_GetUserLoginState>
```

The reply carries the same `{ca, cert, key, port, clientId}` the LAN handshake produces,
after which the transport is identical. `connection.js` tries this first when the saved
device has no keys and a token is available, and falls back to LAN pairing when it fails.

This matters because Orca never persists cloud-issued keys onto the device record — so a
machine that connects perfectly well through the account still looks unpaired on disk.

## The key exchange the page must do itself

Verified against real hardware (U1 firmware reporting through Orca 2.3.6). Two things
that reading the source alone got wrong:

**1. `sw_mqtt_set_engine` does not connect anything.** It looks like it would —
`Moonraker_Mqtt::connect()` calls `ask_for_tls_info()`, which performs the whole
handshake — but that path is dead:

```cpp
// SSWCP.cpp:6643, inside sw_mqtt_set_engine's worker
bool res = true;          // connect() is never called
std::string ip_port = host->get_host();
if (res) { … }
```

The host expects to be handed an **already-connected mTLS engine**. Passing it a plain
:1884 engine and a `code` returns `ok` and leaves you with a session that answers
nothing — every subsequent `printer.objects.query` times out.

**2. The auth method is `server.client_manager.request_lan_auth`, not
`server.request_key`.** The C++ sends `server.request_key`; this firmware answers it
with:

```json
{"jsonrpc":"2.0","error":{"code":-32601,"message":"Method not found"},…}
```

The method that works takes `{clientid, app_id}`, where `app_id` is a freshly generated
`orca-<microseconds>` and `clientid` is the saved one:

```json
→ 12345678/config/request
  {"jsonrpc":"2.0","method":"server.client_manager.request_lan_auth",
   "params":{"clientid":"orca-9bbcbf74-…","app_id":"orca-1787558…"},
   "id":n,"cli_time":1787558371,"dev_time":-1}

← 12345678/config/response
  {"jsonrpc":"2.0","result":{"state":"success","clientid":"orca-9bbcbf74-…",
   "sn":"8110025…","ca":"-----BEGIN CERTIFICATE-----…","cert":…,"key":…}}
```

**`cli_time` and `dev_time` are required.** `TimeSyncManager::addTimeFields()` stamps
every request the C++ sends — `cli_time` in unix seconds, `dev_time` `-1` until the
clocks have synced. Without them the printer ignores the request entirely: no reply, no
error. That silence cost an entire debugging round.

The reconstruction sends `request_lan_auth` first and falls back to the other two, so a
different firmware still has a path. The printer is the oracle: an unsupported method
comes back as `-32601`, which makes probing cheap and safe.

## The LAN auth code is fixed — `12345678`

This is the single most important thing on this page, and it is the difference
between a reconstruction that reconnects on its own and one that cannot.

`12345678` is **not a user-entered PIN**. It is a literal in the shipped bundle —
18 occurrences, appearing in a device-model constructor next to port `1884` — and it
is what the real Device page uses as the auth code for a LAN machine.

A connect captured from a working Orca session proves it. The page subscribes:

```
811002511261022618B3/status              <SN>/status
12345678/config/response                 <auth code>/config/response
811002511261022618B3/notification        <SN>/notification
12345678/config/notification             <auth code>/config/notification
```

Those `12345678/config/*` topics are exactly what
`Moonraker_Mqtt::ask_for_tls_info()` derives from `<auth_code> + "/config/response"`.
No PIN prompt is ever shown, and no `getMqttCert` call is made.

So: **a machine that already trusts our client id authorises itself with the fixed
code.** A PIN is only needed when it does not. The reconstruction tries the fixed code
first and falls back to prompting.

## The observed connect, in two phases

Confirmed end to end against real hardware: keys obtained, engine attached,
`snapshot ok: 24 objects`, live subscription up.


From the same capture. Note the throwaway client for phase 1.

```
phase 1 — plain MQTT, authorisation
  sw_create_mqtt_client  mqtt://<ip>:1884
                         clientId  orca-try-<seqid>        ← fresh, throwaway
                         ca/cert/key empty
                         keepAlivePeriod 30, clean_session false, link_mode lan, sn
  sw_mqtt_connect
  sw_mqtt_subscribe      <SN>/status
  sw_mqtt_subscribe      12345678/config/response
  sw_mqtt_subscribe      <SN>/notification
  sw_mqtt_subscribe      12345678/config/notification
  → server.client_manager.confirm_lan_status { clientid: <saved clientId> }
    ⇒ { state: authorized, action: approve }

phase 2 — mTLS, the real session
  sw_create_mqtt_client  mqtts://<ip>:8883
                         clientId  <saved clientId>         ← the persistent one
                         ca/cert/key present
  sw_mqtt_connect        (isMqtts: true)
  sw_mqtt_subscribe      <SN>/status, <SN>/response, <SN>/notification
  sw_mqtt_set_engine
  sw_SubscribeMachineState, sw_GetMachineState
```

The page also sends the client id under **both** spellings, `clientId` and `clientid`.

## Why the keys are never on disk

`SSWCP.cpp` stores the device after a connect — with the certificate fields
deliberately blanked:

```cpp
info.ca   = /* auth_info["ca"]   */ "";
info.cert = /* auth_info["cert"] */ "";
info.key  = /* auth_info["key"]  */ "";
```

Combined with `AppConfig.cpp:887` clearing `connected` on every save, a saved device
always looks unpaired and disconnected at startup. Both flags are runtime-only. A client
that treats either as ground truth will refuse to connect to a perfectly healthy printer.

## Pairing in detail

`sw_GetPincode` connects a throwaway plain-MQTT client to `mqtt://<ip>:1884` as
`"Snapmaker Orca"`, subscribes `cloud/config/response`, and publishes to
`cloud/config/request`:

```json
{"jsonrpc":"2.0","method":"server.client_manager.request_pin_code",
 "params":{"userid":"…","nickname":"…"},"id":<seq>}
```

The printer shows the code on its screen; the reply's `result` comes back to the page.
The code is then handed to `sw_mqtt_set_engine`, which exchanges it for the keys.

All three params are required to be *present*, but empty strings are accepted — pairing
works with nobody signed in.

## The implementation

`resources/web/device_page/js/connection.js`. `connect(bridge, device, opts)` picks the
path, and `opts.requestPin` is an async callback so the UI decides how to collect the
code (the reconstruction opens a modal).

Errors are wrapped in a `ConnectError` naming the step that failed, because "connect
failed" on its own is useless — `set engine: … incorrect pairing code` is not.

In the UI: the device menu offers **Connect** or **Pair and connect…** for a machine
that is down, and **Disconnect** only for a session the page itself opened — the engine
is addressed by the id `sw_create_mqtt_client` returned, and a session Orca brought up
on its own has no id the page can name.

## Verification, and its limit

Both paths are exercised against the simulated host, which implements this contract:
pairing (including a wrong code), reconnect-without-PIN over `mqtts://`, disconnect, and
the resulting device-list push that re-enables the control surface.

Nine conformance checks pin the sequence, three of them by parsing the required-param
guards straight out of `SSWCP.cpp` so a param drifting from the handler fails the build.

**What this does not prove:** the simulator was written from the same reading of the C++
that the client was. The command names, parameter sets and ordering are read from the
source and are solid; the actual MQTT handshake with a real U1 — TLS negotiation, the
`server.request_key` round trip, the printer's PIN UI — is untested. That is the
outstanding step, and it needs hardware.
