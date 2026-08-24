# Status and handoff

Where this work stands, what is proven and what is not, and what to pick up next.

Last verified against hardware: **2026-08-24**, a Snapmaker U1 (`811002511261022618B3`)
on the LAN at `192.168.2.242`, through Orca 2.3.6 built from this branch.

## What exists

| | |
|---|---|
| `docs/u1-webui/` | The reverse engineering: architecture, both surfaces, bridge, printer protocol, errors |
| `docs/u1-webui/tools/` | 17 extractors and generators; `run_all.py` regenerates everything under `data/` and `reconstructed/` |
| `docs/u1-webui/tools/harness/` | Runs the **shipped** Flutter bundle headlessly against a simulated host |
| `resources/web/shared/` | Bridge client, protocol constants, state store, simulated host, fault catalogue |
| `resources/web/device_page/` | Reconstructed **Device tab** |
| `resources/web/print_processing/` | Reconstructed **print-processing popup** |

Orca shows either implementation. `PrinterWebView` has an **Original / Rebuilt** switcher;
the choice persists in the `u1_reconstructed_ui` app-config key.

## Verified against the real printer

The full connect path, end to end:

```
create plain client mqtt://<ip>:1884  →  connect
subscribe 12345678/config/response
publish  server.client_manager.request_lan_auth {clientid, app_id}
       + cli_time / dev_time            ← REQUIRED, see below
receive  {state:success, sn, ca, cert, key}
create mqtts client mqtts://<ip>:8883 with those keys  →  connect
subscribe <SN>/status, <SN>/response, <SN>/notification
sw_mqtt_set_engine  →  snapshot ok: 24 objects  →  live subscription
```

Three findings that only hardware exposed. All three are written up in
[02-device-page/06-connection.md](02-device-page/06-connection.md):

1. **`sw_mqtt_set_engine` does not connect anything.** `SSWCP.cpp:6643` hardcodes
   `bool res = true;` so `Moonraker_Mqtt::connect()` — and therefore
   `ask_for_tls_info()` — is never called. The host expects an already-connected mTLS
   engine.
2. **The auth method is `server.client_manager.request_lan_auth`**, not
   `server.request_key`. This firmware answers the latter with `-32601 Method not found`.
3. **`cli_time` and `dev_time` are mandatory** on every request. Without them the printer
   does not reply *or* error — it ignores the message. That silence is expensive to
   debug; if a request seems to vanish, check these first.

Also load-bearing, and both counter-intuitive:

- `DeviceInfo.connected` is **forced false on every config save** (`AppConfig.cpp:887`).
  It is runtime-only and says nothing about reachability. Use live machine state.
- Certificates are **never persisted**: `SSWCP.cpp` blanks them
  (`info.ca = /* auth_info["ca"] */ "";`). Every start re-runs the key exchange.

## Not verified

Everything below was built against the simulator in `shared/js/mockhost.js`, which was
written from the same reading of the C++ as the client. That proves the two agree; it
does **not** prove the printer agrees. The connect path above is exactly where that
distinction turned out to matter.

Two of the three response shapes below have since been **settled against the printer**
(2026-08-24) with [`tools/u1_probe.py`](tools/u1_probe.py) and
[`tools/u1_topics.py`](tools/u1_topics.py), which speak MQTT directly and do not need Orca
running. Both guesses were wrong, and in the camera's case wrong about the transport, not
just the field name:

- **camera frames** — *not base64 over MQTT at all*. `camera.start_monitor` needs
  `domain: "lan"` (`""` is rejected `-32000`) and returns
  `{state, url: "/files/camera/monitor.jpg"}`. The printer then rewrites that one file at
  the monitor interval — the flood of `notify_filelist_changed` for `monitor.jpg` — and
  the frame is fetched over HTTP from Moonraker's file server at
  `http://<ip>:7125/server/files/timelapse/monitor.jpg`. Verified: 96,001 bytes, JPEG SOI
  marker. `pickFrame()` in `device_page/js/ui.js` waits for a push that never comes.
- **file thumbnails** — `server.files.thumbnails` returns
  `[{width, height, size, thumbnail_path}]`: **paths, no image data**. The base64 lives
  behind `server.files.thumbnails_base64`, as `{width, height, size, data, state, path}`.
  `pickThumb()` in `device_page/js/app.js` matches neither `thumbnail_path` nor the
  directory listing's `relative_path`, so it returns null — and because the first command
  *succeeds*, the page's `.catch()` fallback to the base64 one never fires. A real printer
  therefore shows no thumbnail at all.
- **discovery results** — still open. `sw_StartMachineFind` is Orca's own LAN discovery
  (Bonjour, `SSWCP.cpp:1789`), not an MQTT pass-through, so these probes cannot reach it;
  it needs the running app.

The full topic map is [05-printer-protocol/06-mqtt-topics.md](05-printer-protocol/06-mqtt-topics.md).
Subscribing the `#` wildcard found **seven** topics on the session leg where reading the
C++ had found four — `moonraker/response`, `camera/response`, `mqtt_agent/notification`
and `LAVA/notification` are shared, carry no serial number, and Orca never subscribes to
any of them.

## How to work on this

**UI changes need no rebuild.** `build/resources` is a symlink to `resources/`, the HTTP
server reads files per request, and it sends no cache headers. Edit and reload the page.
Only C++ changes need `ninja -C build -f build-Release.ninja snapmaker-orca` — and Orca
must be closed first or the link fails with `ETXTBSY`.

```bash
# regenerate every data file and generated doc
python3 docs/u1-webui/tools/run_all.py

# constants vs evidence, and command coverage
python3 resources/web/shared/tests/conformance_test.py

# browser end-to-end against the simulated printer
python3 resources/web/shared/tests/run_selftest.py

# either surface standalone
python3 -m http.server 8099 --directory resources/web
#   /device_page/index.html?mock=1
#   /print_processing/index.html?mock=1   (&mode=upload for the ?path=5 variant)
```

### Debugging against real hardware

Two ways in. The **direct** one needs no GUI at all and is usually what you want:

```bash
python3 docs/u1-webui/tools/u1_probe.py  --out /tmp/shapes.json   # response shapes
python3 docs/u1-webui/tools/u1_topics.py --md /tmp/topics.md      # every topic
```

They read the device from Orca's config, run the documented connect path over a
200-line standard-library MQTT client, and are read-only. Orca must **not** be running:
they authenticate with the saved `clientId`, and a broker evicts the older holder of a
duplicate id.

The **in-app** loop below is still the only way to reach anything Orca itself provides —
discovery, the native dialogs, the bridge envelope. It is the loop that found the connect
bugs, and it is worth reusing.

1. Add `?diag=1` to the page URL, or set `DIAG` in `device_page/js/app.js`, to turn on
   per-command tracing.
2. Run a collector on `127.0.0.1:8799` that appends POST bodies to a file. The page
   beacons every diagnostic line there.
3. Start Orca and read the file.

The beacon matters: `sw_FileLog` travels over the very bridge being diagnosed, so when
that stalls the evidence disappears exactly when it is needed. Diagnostics land in
Orca's own log too, tagged `[rebuilt-device]`:

```bash
grep 'rebuilt-device' ~/.config/Snapmaker_Orca/log/*.log.0
```

Two traps worth knowing: never log the logging command (`sw_FileLog` tracing its own
traffic is a live feedback loop), and clean up orphaned `WebKitWebProcess` after a
`kill -9` — otherwise the next run's webview has no `window.wx` and the page silently
falls back to the simulator, which looks like real data and is not.

## The parity claim was wrong, and why

`07-parity.md` reported "nothing on the command surface" as missing. That was command
coverage presented as functional coverage, and the two are not the same: `check_coverage`
counts a command as implemented when `CMD.NAME` appears in client source, which proves it
is *mentioned* — not that a control exists, that the call site is reachable, or that the
response renders. A panel with no button still counted every command it would have called.

Seven user-visible faults were found on real hardware against that "complete" page. The
full write-up, root cause by root cause, is
[02-device-page/08-function-gap-analysis.md](02-device-page/08-function-gap-analysis.md).
The dominant cause was a single line: Orca hands a printer's reply to the page still
wrapped in its JSON-RPC envelope, and the simulator unwrapped it — so every field read
worked in the browser suite and returned `undefined` on a printer.

Six of the seven are fixed; print history needs a new bridge command in `SSWCP.cpp`.

## What to pick up next

In rough order of value:

1. **Confirm the rebuilt camera and thumbnail paths on hardware.** The client now acts on
   what the printer does — `cameraFrameUrl()` fetches the frame over HTTP, `startCamera`
   sends `domain: "lan"`, and `fileDetails` asks the base64 command first — and eleven
   conformance checks pin those to `data/hardware-shapes.json`. What has **not** been
   done is watching it run in Orca: the MQTT leg was measured directly, so which bridge
   channel delivers `{state, url}` (the ack or the push) is still assumption, and the
   client deliberately accepts either. One session with the Device tab open settles it.
   Discovery is the one shape still unmeasured.
2. **Fault banner against a real fault.** The decoder and the 442-code catalogue are in
   place (`shared/js/errors.js`, generated); it has never seen a real `action_code`.
3. **`sw_SetSubscribeFilter` fails at boot** and is fired best-effort. It succeeds once a
   session exists. Worth confirming it is genuinely optional rather than papered over.
4. **Not built:** firmware update, calibration wizards, time-lapse playback. Each is a
   surface of its own; `check_coverage.py` lists every command not implemented, with a
   reason.
5. **The print-processing popup has never been driven against hardware** — only the
   Device tab has. Its send path (`sw_GetPrintZip` → `sw_StartLocalPrint` → the close
   protocol) is unproven.

## Keeping it honest

```bash
python3 docs/u1-webui/tools/check_coverage.py
```

Every command the host dispatches and the bundle references must be implemented or
excluded **with a written reason**; anything else is reported `UNCLASSIFIED` and fails.
It also flags exclusions that have since been implemented. Do not silence it — if
something is not built, say so in `EXCLUDED` and it stays visible.

The parity position is [02-device-page/07-parity.md](02-device-page/07-parity.md).
