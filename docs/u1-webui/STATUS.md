# Status and handoff

Where this work stands, what is proven and what is not, and what to pick up next.

Last verified against hardware: **2026-08-24**, a Snapmaker U1 (`811002511261022618B3`)
on the LAN at `192.168.2.242`, through Orca 2.3.6 built from this branch.

## What exists

| | |
|---|---|
| `docs/u1-webui/` | The reverse engineering: architecture, both surfaces, bridge, printer protocol, errors |
| `docs/u1-webui/tools/` | 19 extractors and generators; `run_all.py` regenerates everything under `data/` and `reconstructed/` |
| `docs/u1-webui/tools/u1_bridge.py` | Answers the page's bridge commands by talking to a real U1, with no Orca |
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

# the page itself, driven in WebKitGTK - the engine Orca renders with
python3 resources/web/shared/tests/run_webkit.py --shots /tmp/shots

# the same page, against the REAL printer, with no Orca at all (Orca must be closed)
python3 resources/web/shared/tests/run_webkit.py --real --watch   # use it by hand
python3 resources/web/shared/tests/run_webkit.py --real           # check and exit
python3 resources/web/shared/tests/run_webkit.py --real --drive script.js   # scripted

# browser end-to-end against the simulated printer (needs playwright; see below)
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

All seven are now addressed. Print history needed a genuine addition to Orca —
`sw_GetPrintHistory` over `server.history.list`, through `PrintHost.hpp`,
`MoonRaker.{hpp,cpp}` and `SSWCP.{hpp,cpp}` — so **that one needs a rebuild**; everything
else is page-side and live on reload.

A second pass found one more of my own: tool selection stored the *request* in the
variable that mirrors the *machine*, so the click's own re-render put it straight back.
It is now a pending-until-confirmed model.

## Where this got to (session ending 2026-08-24)

The Control panel is **rebuilt and running against real hardware**, driven by a design
study that is still in the tree:
[02-device-page/panel-popover-mockup.html](02-device-page/panel-popover-mockup.html).
Open it — it is self-contained, needs no server and no JavaScript, and every option that
was weighed is still in it (sections 06–09: colour, slider style, column separation,
wheel size), so the decisions can be revisited without re-deriving them.

**Layout.** Three columns — readings, toolhead picker, motion — at 830 px with equal
gaps. Readings are icon-only using the shipped numbered `iconExtruder1..4`, with the
target temperature editing in place. Quick settings are four tiles (speed, fans,
purifier, light) opening panels anchored under the tile that owns them. The jog wheel is
four quadrants by three bands: **the ring is the step size**, so the old 10/1/0.1
selector and its hidden state are gone. Z is a separate bed row.

**Commands, recovered from the shipped bundle rather than guessed:**

| | |
|---|---|
| pick | `T<n> A0` — the `A0` is not optional; the firmware's own macro sends it |
| park | `PARK_EXTRUDER`, `PARK_EXTRUDER1..3` — numbered like Klipper's extruders |
| bed up | `Z−` — Z measures the nozzle-to-bed gap, so raising the bed is negative |

Neither pick nor park appears in `printer.gcode.help`: they register without help
strings, as `T0`–`T3` do. **Absence there is not evidence** — reading it as evidence cost
an afternoon.

**The bug class that dominated this session,** worth stating because it will recur:
*the page kept trusting a field that answers a different question than the one asked.*
Four instances, all found by measuring rather than reasoning:

- **`toolhead.extruder` does not mean "engaged".** It is Klipper's current-extruder
  pointer for G-code, and it goes on naming the last head used after that head is
  parked — measured reading `"extruder"` while all four reported `PARKED`. Using it as a
  fallback made the panel offer to park a head that was not there: `PARK_EXTRUDER`
  returned an instant `ok`, nothing moved, and the wait timed out. Engagement is now
  read **only** from `extruder*.state === 'ACTIVATE'`.
- **`toolhead` is not subscribed at all**, so anything read from it is as old as the last
  explicit query. `homed_axes` is fetched once a second during a wait for exactly this
  reason.
- **`machine_state_manager` is silent for manual work.** It reads
  `{main_state: 0, action_code: 0}` straight through a 31-second toolchange and through
  homing. So is `extruder_offset_calibration.calibration_step`, which stays `"idle"`.
  Both were trusted, and both had nothing to say.
- **`homed_axes: ""` is an answer, not an absence** — the machine saying nothing is
  homed. Reading it as *unknown* let every Z jog through to a printer that refuses them,
  so the bed buttons looked dead.

**What a toolchange actually reports** (driven and logged end to end, 2026-08-24):

```
 0.7s  toolhead.homed_axes "z"      idle_timeout "Printing"
 4.7s  toolhead.homed_axes "y"
14.7s  toolhead.homed_axes "xy"        <- the "XY calibration" a user sees
28.7s  extruder.activating_move true
30.7s  extruder.state "ACTIVATE"       <- done
32.7s  idle_timeout "Ready"
```

`state.busyReason()` is built on those: `homed_axes` drives the label and names the axes
already done, `activating_move` names the grab, `idle_timeout` brackets the whole thing
and **is** treated as busy. Measured durations: **4 s** already homed, **31 s** from cold.
The 31 s case is what outran the bridge's 15 s request timeout and made a working
toolchange look like a failure — which is why a wait never awaits its own request, and
confirms against machine state instead.

One trap worth carrying forward: **an instant `ok` is indistinguishable from success.**
`PARK_EXTRUDER2` against a live head blocks for over 20 s; against a head that is not
there it returns immediately and successfully. No G-code ack can tell those apart.

### Setting a temperature (2026-08-25)

Reported from ordinary use: the temperatures applied and the printer heated, but the row
was wrong on both sides of the round trip. Written up in
[08-function-gap-analysis.md](02-device-page/08-function-gap-analysis.md), "Round three".

- **A target of `0` sat in the field** and had to be deleted before anything could be
  typed. Zero *is* a heater that is off, so it now shows as a `—` placeholder over an
  empty field, and focus selects what is there so a set value is typed over.
- **A committed value vanished, or came back as `0`.** The state push that follows a
  commit lands about a second before the printer reports the change, and it was writing
  the pre-edit value back in. Leaving a *focused* field alone was not enough — the commit
  happens on blur, so the value is in flight exactly when the field stops being
  protected. Now pending-until-confirmed, the same model tool selection needed, with the
  same reason behind it: **the request was being stored in the thing that mirrors the
  machine.**
- **Nothing said the heater was working.** A nozzle climbs a degree a second, so an
  accepted setpoint and an ignored one looked identical. The row now shows
  heating / ready / cooling / off in ink, plus a 2px bar under the numbers running from
  the temperature the ramp started at to the target. Derived from `temperature` and
  `target` only: `power` would say it directly but `heater_bed` does not publish it.
- **Ten seconds with no echo is reported, not hidden.** A command that succeeds and
  changes nothing is what a silently-ignored setpoint looks like — the `PARK_EXTRUDER`
  trap again — so the row drops back to the machine's value and names the one that did
  not take.
- Found while looking at the result: **the target field clipped three digits**, so a
  nozzle at 220 read as `22`. 9.00px per tabular digit, measured in the page; the field
  is 35px and the row gap pays for it.
- **The row moved as its numbers did.** The reading was auto-width, so 99 → 100 carried
  the slash, the field and the unit a digit to the right, and five rows at five
  temperatures never lined up. `.cur` reserves three digits and right-aligns against the
  separator; a browser check holds `.sl`, `.tgt` and `.unit` to one x across every row.

**There is a browser after all.** WebKitGTK is present — it is what Orca renders with —
and PyGObject drives it, so the page can now be loaded, clicked and screenshotted:

```bash
python3 resources/web/shared/tests/run_webkit.py --shots /tmp/shots
```

That is how the above was confirmed, and how the clipped digit was found. It catches what
source-text checks cannot: that focus really selects, that a committed value survives the
next push, that `select()` works on a number input at all.

### And the page now runs against the printer without Orca

[`tools/u1_bridge.py`](tools/u1_bridge.py) answers the SSWCP contract from Python and
speaks MQTT to the machine; `--real` installs `window.wx` as a user script and points it
there. The page runs its own connect path and comes up on real state — the same
`snapshot ok: 24 objects` the Orca path reports.

```bash
python3 resources/web/shared/tests/run_webkit.py --real --watch
```

Without `--watch` it is a test: it checks, reports and exits. With `--watch` it is a
window - the checks still run and report first, then it stays up until you close it,
and the terminal becomes a live trace of what each click sends. `--watch 90` stays for
a fixed time instead.

- **The mapping is generated**, not written down:
  [`extract_bridge_methods.py`](tools/extract_bridge_methods.py) reads
  `m_cmd == "sw_X"` → `sw_X()` → `host->async_x()` → `method = "…"` out of `SSWCP.cpp`
  and `MoonRaker.cpp`. **37** of the page's 57 commands are one JSON-RPC method with the
  parameters passed nearly straight through; 12 are answered locally, 8 refused with a
  written reason. A conformance check fails if a new command is none of the three.
- **It found its own bug first.** The generator's first cut sliced a function body at the
  next definition *of the same class*, and `sw_mqtt_publish` came out mapped to
  `machine.system_info` — a publish would have gone out as a system-info query.
- **What it cannot do:** it is a second host speaking the same contract, so it proves the
  page and the printer agree. Whether *Orca* agrees is a different question, and the open
  ones (camera ack-vs-push, `sw_SetSubscribeFilter` narrowing) are about Orca's leg
  specifically. **Orca must be closed** while it runs — same saved `clientId`, and a
  broker evicts the older holder.

Driven against the machine, the temperature work behaves: the printer echoes a target
back in **552 ms one run and 1516 ms the next**, which is the whole bug in one
measurement — the render tick is about a second, so a push computed before the echo
arrived was writing the old target back over the value just sent. The run also found a
flaw the simulator could not have: asked for 40 the nozzle overshot to 48, flipping
heating → cooling with the target unchanged, and the bar — restarted only on a target
change — sat at 100% while the temperature fell. It now restarts when the direction
does.

### The session, run for longer than a test (2026-08-25)

Three faults that only showed up once the page was left running against the machine.
Written up in [08-function-gap-analysis.md](02-device-page/08-function-gap-analysis.md),
"Round four".

- **A slow command read as a refused one.** Picking a toolhead on a cold machine said
  "the printer refused the command" through a toolchange that completed. Two clocks say
  "timeout" and the page matched one: the client's own 15s ("timed out after 15000ms")
  and **Orca's 80s** wait on the printer, which fails as code **-2**, message
  **"time out"** — note the space. `/timed out/i` never matched Orca's, and it stayed
  hidden because the client's clock is the shorter and fires first. The test is
  `isTimeout()` in `sswcp.js` now and keys on the code too. Measured after: **31.9s**
  cold, no refusal.
- **`u1_bridge.py` had been given a 12s timeout**, guessed from the client's 15s instead
  of read from `MoonRaker.hpp:344`. That is what put a failure in front of the page
  before its own clock ran. It waits 80s now, and fails in Orca's exact shape.
- **"Connected" was a claim about the past.** `state.lastUpdate > 0` asks whether the
  machine ever spoke, so a rebooting printer stayed connected with a frozen snapshot.
  The window came from measuring: **an idle U1 pushes about twice in 30 seconds**, gaps
  of 4–14s, so 45s is ~3x the widest gap, with the heartbeat covering the rest. Socket
  killed under the page: 115s stale and still claiming connected before, ~32s to drop
  the dot after.
- **There was no retry.** One attempt, at boot, and only if nothing had ever arrived —
  so starting the app before the printer left it dark until a reload. A supervisor now
  reconnects on a 2s clock, backing off 5/10/20/30s and holding, dropping the dead
  engine first. Measured: socket killed → noticed 37.2s, back at 37.9s. No printer at
  all → attempts at 11s, 31s, 61s, 91s.

`run_webkit.py --device-ip 192.0.2.1` points the saved device somewhere unroutable,
which is how the nothing-there path is exercised without switching the printer off.

### The shipped bundle runs here too, and connects (2026-08-25)

```bash
python3 resources/web/shared/tests/run_webkit.py --original --sn <SN> --watch
```

The **real Flutter bundle**, in WebKitGTK, against the real printer, through
`u1_bridge.py` — with live telemetry on screen and no modification to the bundle. Not
previously possible in this environment at all: the screenshot harness needs a chromium
that will not start.

Four things had to be right, each read out of the C++:

1. **Orca posts replies as a JSON string** — `send_to_js` builds
   `window.postMessage(JSON.stringify({...}), '*')`. Posting the object, which the
   reconstruction's client parses either way, makes the bundle ignore every reply in
   silence. It presents as "the page will not pick a device", and it cost the most.
2. **TLS is decided by credentials, not the scheme.** The bundle asks for
   `mqtt://<ip>:8883` — plain scheme, TLS port — and expects a TLS client back.
3. **Orca keeps its own connection to the printer.** `get_connect_host()` answers the
   printer commands and is not the MQTT clients the page creates; the bundle never calls
   `sw_mqtt_set_engine` because in Orca a host is already attached. The bridge now
   brings up a session of its own.
4. **`sw_GetConnectedMachine` is the gate** — the first saved device flagged
   `connected`. With none the page sits at `sn=`. The bridge probes each saved device
   with a TCP connect and reports what answers.

`--sn` matters: a config holding a stale record has the bundle trying to connect it.

Also measured: **the bundle's own request timeout is 3 seconds**, against the
reconstruction's 15. And `local_devices_arrived` — which Orca posts on a separate,
non-envelope channel — appears **zero** times in `main.dart.js`.

Still rough: a "Binding rejected" dialog from the cloud stub, and toolheads 2–4 read
`_/_ °C` while toolhead 1 and the bed carry real numbers.

### The reply shape, and the two cards (2026-08-25)

Running the shipped bundle against the same host corrected a **load-bearing finding**.
`08-function-gap-analysis.md` led with "the JSON-RPC envelope is never unwrapped"; that
is true only of a `passthrough` response target. Every ordinary command takes the other
arm of `on_response_arrived`, which reshapes the reply to
**`{data: <result>, method: <name>}`**. `unwrapRpc` only stripped `jsonrpc` envelopes,
so against the real contract it was a no-op and every reader outside `unwrapStatus` was
silently reading `undefined` — the file browser was **empty against a real printer**.
Fixed in `sswcp.js`, guarded on the `{data, method}` pair; one unit test had encoded the
old belief and is inverted.

With both surfaces live on one machine, the rebuilt cards were measured against the
originals rather than judged:

- **Camera** is a black viewport with one round control in it, saying the bundle's own
  `Camera not on` — it had been showing the not-connected illustration, which answers a
  different question.
- **Print** is one card at every state, zeroed rather than replaced. Layer counts come
  from `print_stats.info`, subscribed all along and unread.
- **Tabs**: the `|` separator margin is 14/13, not 20/20 (title 28, separator 99, pill
  117), and a selected pill is inset at the TOP only so it runs into the body. The 36px
  tabs and 40px refresh pills are different controls, not an inconsistency.
- **Refresh did nothing** — both pills re-read Orca's device book. Driving the shipped
  page's own pill settles the set they should send, and both of its pills send the same
  one.

Dead end, recorded so it is not retried: the bundle ships
`HarmonyOS_Sans_SC_Regular.ttf`, and adopting it made every title *narrower* than the
shipped page's. Those titles are not that face at 14px.

### Tooling worth knowing about

```bash
python3 docs/u1-webui/tools/u1_probe.py      # response shapes, straight over MQTT
python3 docs/u1-webui/tools/u1_topics.py     # every topic, both legs
python3 resources/web/shared/tests/unit_jsc.py   # 60 checks, real JS engine
python3 resources/web/shared/tests/conformance_test.py   # 106 checks
```

`mqtt_min.py` is MQTT 3.1.1 in ~200 lines of standard library, because paho is not
installable here. The probes need **Orca closed** — they authenticate with the saved
`clientId` and a broker evicts the older holder.

`unit_jsc.py` drives **JavaScriptCore via PyGObject**. `run_webkit.py` goes further and
drives the whole page in **WebKitGTK**, which is the engine Orca's webview uses — so its
checks run where the page will actually run. Both come from the same place: playwright is
absent and the vendored chromium still will not start (no `libnspr4`/`libnss3`), so
`run_selftest.py` and its 28 checks remain unrunnable. Installing those two libraries
would restore them; it is worth less now than it was, because WebKitGTK covers the part
that mattered — driving real controls in a real engine.

`run_webkit.py` needs a display (WSLg provides one) and screenshots through
`Gdk.pixbuf_get_from_window`, because WebKit's own snapshot API returns a cairo surface
and there is no pycairo here.

## What to pick up next

In rough order of value:

1. **Drive the rebuilt Control panel from inside Orca.** Narrower than it was: the whole
   page now runs against the printer through `run_webkit.py --real`, so the page-and-
   machine half is covered. What remains is exactly the bridge leg:
   whether a camera `{state, url}` arrives as the subscribe ack or as a push (the client
   accepts either), and whether `sw_SetSubscribeFilter` narrowing `EXTRUDER_FIELDS`
   changes what the wait can see. One session with the Device tab open settles both.
2. **Confirm the camera and thumbnail paths.** `cameraFrameUrl()` fetches the frame over
   HTTP, `startCamera` sends `domain: "lan"`, `fileDetails` asks the base64 command
   first. Pinned to `data/hardware-shapes.json`, never watched end to end in Orca.
3. **Fault banner against a real fault.** The decoder and the 442-code catalogue are in
   place; neither has seen a real `action_code`.
4. **Discovery results** — the last unmeasured pass-through shape. `sw_StartMachineFind`
   is Orca's own Bonjour sweep, so the MQTT probes cannot reach it; it needs the app.
5. **`sw_SetSubscribeFilter` fails at boot** and is fired best-effort. Worth confirming
   it is genuinely optional rather than papered over.
6. **Not built:** firmware update, calibration wizards, time-lapse playback.
   `check_coverage.py` lists every command not implemented, with a reason.
7. **The print-processing popup has never been driven against hardware.** Its send path
   (`sw_GetPrintZip` → `sw_StartLocalPrint` → the close protocol) is unproven.

## Keeping it honest

```bash
python3 docs/u1-webui/tools/check_coverage.py
```

Every command the host dispatches and the bundle references must be implemented or
excluded **with a written reason**; anything else is reported `UNCLASSIFIED` and fails.
It also flags exclusions that have since been implemented. Do not silence it — if
something is not built, say so in `EXCLUDED` and it stays visible.

The parity position is [02-device-page/07-parity.md](02-device-page/07-parity.md).
