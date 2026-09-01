# Status and handoff

Where this work stands, what is proven and what is not, and what to pick up next.

Last verified against hardware: **2026-09-01**, a Snapmaker U1 (`811002511261022618B3`)
on the LAN at `192.168.2.242`, through Orca 2.3.6 built from this branch and through
`run_webkit.py --real`, which reaches the printer with no Orca at all. That day's pass
was over Moonraker HTTP: the live `head ↔ multi` mode switch, run and restored —
[02-device-page/11-multiace-handover.md](02-device-page/11-multiace-handover.md#start-here-the-panel-has-only-ever-been-right-in-one-of-the-three-modes)
has the results, [data/ace-mode-switch-20260901.json](data/ace-mode-switch-20260901.json)
the payloads, and
[02-device-page/multiace-modes.html](02-device-page/multiace-modes.html) — the seventh
study — the drawings for all three modes.

## What exists

| | |
|---|---|
| `docs/u1-webui/` | The reverse engineering: architecture, both surfaces, bridge, printer protocol, errors |
| `docs/u1-webui/tools/` | 19 extractors and generators; `run_all.py` regenerates everything under `data/` and `reconstructed/` |
| `docs/u1-webui/tools/u1_bridge.py` | Answers the page's bridge commands by talking to a real U1, with no Orca |
| `docs/u1-webui/tools/harness/` | Runs the **shipped** Flutter bundle headlessly against a simulated host |
| `resources/web/shared/` | Bridge client, protocol constants, state store, simulated host, fault catalogue |
| `resources/web/device_page/` | Reconstructed **Device tab** — see below |
| `resources/web/print_processing/` | Reconstructed **print-processing popup** |

Orca shows either implementation. `PrinterWebView` has an **Original / Rebuilt** switcher;
the choice persists in the `u1_reconstructed_ui` app-config key.

## How the Device page is put together

Read this before changing it. The page has **two destinations** in one webview — Device
control and Storage — switched by the left rail with no reload, no URL change, and the
printer session untouched.

**[`js/registry.js`](../../resources/web/device_page/js/registry.js) is the table of
contents:** the destinations, and which panels each one has. Everything inside
`.content` is built from it, so `index.html` is 42 lines of shell.

**One panel is one directory**, and everything about it is in there:

```
js/views/device-control/camera/
    camera-panel.js      what it reads, and its mount/update
    camera-view.js       its DOM: built once, then patched
    camera-commands.js   everything it can ask the machine to do
```

| destination | panels |
|---|---|
| **Device control** | Camera, Control, Printing Task, Filament |
| **Storage** | Storage |
| *neither* (`view: null`) | the fault banner — a fault is about the machine, not the view |

A panel is handed **its own commands and nothing else**, so reaching for another panel's
command is a `TypeError` rather than a quiet dependency. Three things it may read, and
they are three because they answer three different questions:

| | |
|---|---|
| `ctx.state` | what the **machine** says. A mirror, not a memory |
| `ctx.store` | what the **page** knows — which view, which tab, what it has fetched |
| `ctx.pending` | what has been **asked for** and not yet confirmed |

The third exists separately for a reason worth carrying: **a request stored in the thing
that mirrors the machine gets overwritten by the next push.** That bug was found in three
unrelated controls before it got one mechanism —
[`core/pending.js`](../../resources/web/device_page/js/core/pending.js).

Two more single-answer modules, each replacing several hand-rolled ones:
[`core/render.js`](../../resources/web/device_page/js/core/render.js) (build once, key
structural change on a signature, reconcile lists by key) and
[`core/session.js`](../../resources/web/device_page/js/core/session.js) (connect,
staleness, retry, heartbeat, the state stream — no panel reads any of it).

The whole story, pass by pass, including why Flutter was rejected and the bugs each pass
turned up, is [02-device-page/09-restructure.md](02-device-page/09-restructure.md).

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
  marker. This is fixed: the frame is fetched over HTTP by `cameraFrameUrl()` in
  `device_page/js/views/device-control/camera/camera-view.js`.
- **file thumbnails** — `server.files.thumbnails` returns
  `[{width, height, size, thumbnail_path}]`: **paths, no image data**. The base64 lives
  behind `server.files.thumbnails_base64`, as `{width, height, size, data, state, path}`.
  This is fixed: `pickThumb()` lives in `device_page/js/core/thumbs.js` and the base64
  command is asked **first**, because the path-returning one succeeds while returning no
  image — so a `.catch()` fallback never fired and a real printer showed no thumbnail.
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

# the pure logic, in JavaScriptCore, against captured hardware payloads
python3 resources/web/shared/tests/unit_jsc.py

# either surface standalone
python3 -m http.server 8099 --directory resources/web
#   /device_page/index.html?mock=1
#   /print_processing/index.html?mock=1   (&mode=upload for the ?path=5 variant)
```

### What each suite can and cannot see

Worth knowing before you trust a green run, because **all of them have been green while
the page was visibly broken**:

| | sees | blind to |
|---|---|---|
| `conformance_test.py` | that a decision is present in the source, and matches the write-up | whether it runs |
| `unit_jsc.py` | pure logic against captured payloads, on an injected clock | anything needing a DOM |
| `run_webkit.py` | the real engine: focus, selection, layout, computed style | only what its checks look at |
| `check_coverage.py` | every command implemented **and** reachable from a control | whether the control works |

Two failures make the point. A `ReferenceError` in `jogWheel` left the page with no
motion column and **all 17 browser checks passed**, because they cover the temperature
rows. Later a rename broke `boot()` and the simulator stayed green because the broken
line was on the *not-connected* branch and the mock device reports connected.

So two habits are worth keeping:

- **Dump the DOM and diff it.** A drive script that walks `.app` and prints every tag,
  id, class and `data-*` answers *what is on the page* rather than *is this one thing
  right*. It caught both failures above, and it is how every restructure pass was shown
  to change nothing. Run it before and after any move.
- **`--real --device-ip 192.0.2.1`** forces the not-connected branch with no printer
  involved. Run it on anything touching the device record, not only when testing the
  nothing-there path.
- **Start the app with the printer switched off.** An unreachable printer used to abort
  Orca at launch — `terminate called after throwing an instance of 'mqtt::exception'` —
  because Paho reports failure by throwing and `MqttClient::Connect()` had no handler
  despite being documented to return `false`. Fixed, with the same guard on `Subscribe`,
  `Unsubscribe`, `Publish` and `CheckConnected`; round eight of
  [08-function-gap-analysis.md](02-device-page/08-function-gap-analysis.md). It stays worth
  running, because it is the one startup path nothing else exercises.
- **Load the page from Orca's own server, not only from the harness.** `run_webkit.py`
  serves the tree from Python, so it cannot see anything the *app's* HTTP server does —
  and on 2026-08-26 the app's server was silently losing one module request per load,
  which left the Device tab blank in Orca while all three suites were green. With Orca
  running, point WebKitGTK at `http://127.0.0.1:13619/web/device_page/index.html` and
  read two numbers: `document.readyState` must reach **`complete`**, and no resource may
  still be pending. Round seven of
  [08-function-gap-analysis.md](02-device-page/08-function-gap-analysis.md) has the whole
  story; the short version is that the trigger was a URL 29 characters longer than it
  used to be.

`paint()` catches per panel now, so a throwing panel says so on the page and the others
still paint — but it will not tell you a panel is *missing*, only that one failed. It
will not tell you the *document* never ran, either: that shows up as a shell with an
empty `.content` and a silent console.

**`--shots` writes blank PNGs here.** EGL finds no driver under WSL, so the snapshot
surface paints nothing and the files compare byte-identical before and after any change.
The DOM assertions are the evidence; the images never were.

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

1. Add `?diag=1` to the page URL to turn on per-command tracing
   (`device_page/js/core/diag.js`).
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
It is now a pending-until-confirmed model — and that same bug turned up twice more before
it got one mechanism.

**The hole is closed at the tool, not just at the instances.** `check_coverage.py` asks
both questions now — *is it implemented*, and *can a user reach it* — and the second is
answered by reading the `CMD.` references out of the command module a panel is actually
handed, so referencing a command is the only way to claim one. It found
`sw_BedMesh_AbortProbeMesh` reachable by nothing, and rejected a `DELETE_MACHINE_FILE`
claim that no code backed. A conformance check asks the remaining half — is every handler
a panel is given actually called — which is what found `showFiles`, dead behind a
disabled button. See [09-restructure.md](02-device-page/09-restructure.md).

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

### Storage, and the finetunes that came before it (2026-08-25)

**A Storage destination.** The rail has a second entry below Device control. One picker
row — time-lapses, prints, print files, logs — over one full-height scrolling grid of
cards. The Camera's time-lapse tab and the Printing Task's Files and Print-history tabs
are gone; those cards are now just the live view and the job card.

The two views are **siblings in one document**, toggled with `hidden`, not separate
pages: a page swap would drop the MQTT session and re-run the LAN key exchange on every
switch. `#view-control` uses `display: contents` so the four panels stay direct children
of the 2×2 grid — and it must opt back into `[hidden]` explicitly, because
`display: contents` beats the UA's `[hidden] { display: none }`. Without that second
rule the control panels render *underneath* Storage and squeeze its grid to 4px.

Measured rather than assumed:

```
document nodes     360 (control) -> 823 (storage, 50 file cards)
state push         does NOT rebuild the grid - the signature guard holds
switch kind        24 ms cached, 221-472 ms with a printer round trip
view toggle        ~30-85 ms, two frame waits included
4 switches         841 -> 853 nodes; nothing accumulates
```

**Four fixes that preceded it**, each measured on the machine:

- **The toolchange label named the axes done** — "Homing — Z done", then "Y done".
  Klipper *clears* `homed_axes` as it re-homes, so Z vanished after being reported, and
  the machine looked like it was going backwards. One step now: `Homing axes…`. Two unit
  tests and a conformance check had encoded the old behaviour.
- **Lists reset their scroll.** The task panel repaints on every state push and each
  repaint emptied the node and rebuilt it. Lists now rebuild only when their *content*
  signature changes, and the scroll position is carried across when they do — which also
  fixes Load more landing you at the top.
- **Opening a recording only offered to delete it.** It plays now. The URL is on the
  instance: `http://<ip>:7125/server<video_local_url_suffix>` → `200 video/mp4`, where
  `http://<ip>/…` returns the SPA shell — the same trap the camera frame hit.
- **Files are viewable and printable, not deletable**, and the files refresh is an icon
  button rather than a chip sitting in the row of roots, where it read as a filter.

**A limitation worth knowing:** this WebKitGTK build **cannot play H.264** —
`canPlayType('video/mp4')` is empty and playback fails `MEDIA_ERR_SRC_NOT_SUPPORTED`.
The dialog shows the still plus Download and says so. Orca's Windows and macOS webviews
do not have that limitation; Linux Orca probably does.

**Left behind:** the file-browser CSS (`.files`, `.file-row`, `.chip`, …) outlived its
renderer. Dead-rule detection is unreliable here because `overlay.js` emits many classes
this scan cannot see, so it was left rather than swept on the way out.

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

**All three design changes are built.** Two are driven against the machine; the third —
multiACE — is driven against the simulator, seeded from the machine's own payload, and
has not yet had an ACE in front of it. The study is
[02-device-page/camera-layout-ace-mockup.html](02-device-page/camera-layout-ace-mockup.html)
— the versions that were weighed, with the ones not chosen still switchable in it.

| | | |
|---|---|---|
| **Layout** | L3 + H1 | **built** — two unequal columns, no C++ |
| **Camera** | S2 + view grid + M-A | **built** — 9.5 fps against 0.5, no C++ |
| **multiACE** | ~~P1~~ ~~F4~~ **I1** | **built** — the Filament panel, no C++ |

### The layout: two columns, not a 2x2 grid

The four panels were one grid of equal cells, every body locked to
`aspect-ratio: 830/548`, so a wider window bought four wider squares and the camera — the
only one whose content scales — gained nothing. Now: a main column that takes what is
left, and a side column pinned at `--col-w` (830), the width the Control cluster already
is. **Control keeps its layout and gives up only height**, and Filament grows into what it
releases.

`registry.js` gained `columns` on a destination and `column` / `grow` on a panel, so a
panel says where it goes instead of the CSS guessing from source order. `#view-control`
stopped being `display: contents` — the two columns have to distribute height
independently, which a contents box cannot do.

Measured at 1920x1080: Control **424** and Filament **496**, against 588 and 588, which
did not fit and made the destination scroll. Control's cluster is untouched at 758.

**A panel body hides its overflow, so a body too short for its card clips it in silence.**
Printing Task was pinned at 150 px on the reasoning that a job card "has a natural height
and no reason to grow" — the second half is true and the first was never measured. The
card is **304**, so the progress bar and both job buttons were cut off and nothing said
so. It sizes to its content now, and `run_webkit.py` asks every panel body at every width
whether its `scrollHeight` fits, rather than asking about this one.

**The breakpoint is the trade-off and it is one number** (`1600`, up from 1420). The main
column is `window - 304 - 20 - 830`; the old grid gave `(window - 324) / 2`. Those cross
at **1984**, so between the breakpoint and 1984 the camera is narrower than it was — 446
against 638 at 1600, 766 against 798 at 1920. The 1920 case costs 32px and buys Filament
172px. **The 1600 case costs 192px and is the weakest point of the design**; raising the
number to 1984 removes the cost entirely, at the price of most laptops never getting two
columns. `run_webkit.py --size WxH` exists so both layouts can be checked.

### The camera: four transports, four view layouts, and detection

`CAMERA_INTERVAL = 2` — the shipped page's camera is **half a frame per second**. A U1
running paxx12's Extended Firmware also runs a camera service, and the panel now finds it:

- **Detection, never configuration.** `GET :7125/server/webcams/list` answering with a
  camera *is* the detection. Nothing answers on stock firmware and the monitor file stays.
- **Two of the four entries in that list are not cameras.** The printer registers its own
  touchscreen as `gui` and the multiACE web panel as `multiACE`. An entry is a camera when
  it has a `snapshot_url`; the touchscreen is kept, labelled *Screen*, and sorted last.
- **Both streaming transports are dead in WebKitGTK** and it is not close:
  `MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E")` is `false` (VP8 is
  `true`, so MSE is fine — the codec is missing) and `typeof RTCPeerConnection` is
  `"undefined"`. Windows and macOS ship both, so `AUTO` **probes** rather than picking.
- **Named after transports, not after picture quality.** A greyed row then explains itself
  in the same words as the reason — "this engine has no H.264 decoder" beats "not on
  Linux" for someone who has to act on it. `AUTO` reports which one it landed on.
- **One to four pictures**: single, split, 2x2 and picture-in-picture. A 2x2 with three
  cameras says *No fourth camera* in the empty cell rather than reflowing the moment a
  second USB camera is plugged in.
- **The focused tile polls fast and the rest at 1 fps.** A grid is one poll per tile —
  there is no multiplexed stream — and the case camera's 226 KB frame is nearly all of the
  cost. That one rule is 4.7 MB/s down to 3.5.

Driven against the printer, in the panel rather than in a synthetic loop:

```
9.5 fps      through the panel at 15 requested   (14.0 for a bare Image chain)
1.0 fps      when 1 is asked for
9.8 / 1.0    focused tile against its neighbour
1920x1080    case      1280x720  usb      480x320  gui
38 ms        to give up and fall back with no printer there
```

**Two traps found by building it.** A `?t=` cache-buster appended to a `data:` URI
corrupts the data — base64 often survives the trailing bytes and an SVG never does, which
is exactly how the simulated cameras rendered nothing while every other check passed;
busting is scheme-aware now. And the poller schedules the next fetch from `onload` rather
than on a fixed interval, so the rate self-limits to what the link can do instead of
queueing requests into unbounded lag.

The simulator answers the camera list too (`mockWebcams()`, copied from the real payload
including both non-cameras), because frames are plain HTTP and a simulated run would
otherwise never execute the tile grid, the transport list or the focus rule at all.

### A popover drew the state it was opened with

Reported from ordinary use: the camera settings' buttons worked and none of them moved
its own tick until the panel was reopened. **A popover lives on `document.body`, outside
every panel `paint()` walks**, so it is built once and never again. Invisible for a
slider, whose thumb carries its own position — which is why the Control panel's four
never showed it — and plainly broken for anything drawing a selected state from the store.

`overlay.js` has `repaintPopover()` now, called from `paint()` and **guarded by a
signature the caller supplies**: rebuilding the body every frame is the bug `render.js`
exists to prevent, and it would take focus, hover and a slider mid-drag with it. A popover
that passes no `sig` is never rebuilt, so the existing four behave exactly as before —
which `drive/popover-live.js` checks in both directions.

### The job card is a band now, and the status is in the header

**306 px to 128.** The card was a stack in a panel 766 px wide, and it spent that height
on a 152 px thumbnail, a 40 px grey percentage, a row carrying the machine's own name —
which the rail already shows — and a row of its own for two buttons.

Three moves, all of them Bambu's:

- the thumbnail **anchors** the block (96 px) instead of sitting above the bar
- the metadata joins the filename's line
- **the buttons ride the bar's line** — a 6 px bar and a 30 px button cost 70 stacked and
  30 side by side, which is most of the saving

And the status word moved into the **panel header**, beside the title, so a panel says
what it is and what it is doing on one line. `shell.js` grew a `status` header kind for
it — a label with no click, synced through `headerSync` for the same reason a tab is: a
header has no renderer of its own.

The camera above took the height: **752 px, up from 576**. And `--task-h` is gone —
pinned at 150 it clipped a 306 px card; kept as a floor it padded a 128 px band by 22.
The card draws a 96 px thumbnail, so what stops it collapsing is the card.

`filament_used` is millimetres, so the card shows **metres**. Bambu's shows grams there;
grams need a diameter and a density this page is not told, and the guess would look like
a measurement.

**A design finding worth keeping** — [part 04 of the study](02-device-page/camera-layout-ace-mockup.html)
draws four versions and the arithmetic that argues *against* the obvious reason to do
this: **at 1920 a shorter card buys black, not picture.** The camera is width-bound there
(766 px at 16:9 is 431 tall), so every pixel the card releases becomes letterbox. Past
about 2000 it becomes height-bound and the same pixels are all frame. The band is the
better card at any width — that is the argument, and it is not the one about space.

### Drive scripts are committed now

[`resources/web/shared/tests/drive/`](../../resources/web/shared/tests/drive/) — the DOM
walker this file has been recommending for months, plus the camera panel against the
simulator (50 checks), against the printer (13), and the no-printer branch (8). They were
ad-hoc every time before, which is the same as not existing.

```bash
R=resources/web/shared/tests
python3 $R/run_webkit.py --size 1920x1080                       # 37 checks, layout included
python3 $R/run_webkit.py --size 1920x1080 --drive $R/drive/camera.js
python3 $R/run_webkit.py --real --size 1920x1080 --drive $R/drive/camera-real.js
python3 docs/u1-webui/tools/check_mockup.py <a mockup>          # per-file checks, both themes
python3 docs/u1-webui/tools/bake_mockup.py  <a mockup>          # re-render its no-script copies
```

### The multiACE panel: built, and P1 was upside down

**Start at [02-device-page/11-multiace-handover.md](02-device-page/11-multiace-handover.md)**
— the settled design in one table, what landed, what changed on the way in, and every trap
this pass turned up.
The reasoning is [02-device-page/10-multiace-filament.md](02-device-page/10-multiace-filament.md),
with the studies as the specification:
[multiace-filament-mockup.html](02-device-page/multiace-filament-mockup.html) — seven
shapes and five machine states, static — and
[multiace-f2-iterations.html](02-device-page/multiace-f2-iterations.html), which **runs**:
a subpanel per toolhead, its header choosing the source, driven by mode, unit count and
Sync — and
[multiace-toolhead-card.html](02-device-page/multiace-toolhead-card.html), which iterates
what goes *under* that header, and
[multiace-cabinet.html](02-device-page/multiace-cabinet.html), where the card is settled
and the cabinet is drawn as the badge. All three carry pre-rendered copies so they also
read with no script. **I1, bands**, is the one to build; **F4, the bus**, becomes a second view behind
the overflow.

It needs no new bridge command: `ace` is a Klipper object and
`sw_GetMachineState {objects:{ace:null}}` answers in **277 ms**, and every control is a
documented G-code macro. Naming the filament in an *unloaded* bay was written down as the
one thing that needed Orca — the raw slots carry no identity and `/multiace/api/state` is
CORS-refused — and that turned out to be wrong in the useful direction:
`ACE_SPOOL_ASSIGN ACE=n SLOT=n [ID=n]` binds one of `ace.spools`' entries to a bay, so it
needs a bay sheet and one macro rather than a piece of C++.

Three things the drawing settled that reading could not:

- **The shipped artwork says which way up the picture goes.** `extruderBackground.svg`
  draws its inlet as two stubs at the *top* edge and its nozzle pointing *down*, so the
  earlier study's **P1 — heads above, units below — draws filament climbing into a
  nozzle**. F4 is P1 turned over. This was invisible until the real 64×140 artwork
  replaced a placeholder rectangle, which is the argument for drawing mockups out of the
  page's own parts rather than out of boxes.
- **456 px is the whole argument.** That is `.filament-body` at 1920×1080, measured. A
  toolhead is 140 of it and a unit box 130, so four open units plus the bus and the head
  row is **815** — the picture holds one or two units and folds to a rack at three. F4 and
  F6 are therefore one design at two densities, not rivals.
- **A bay is drawn as a head**: the same 36 px disc and 58×19 name pill, without the
  extruder body. Not `AMSLib`'s fill-from-the-bottom tube — that assumes a level, and
  `spool_binding` is `{}`, so no bay has one.
- **A subpanel per toolhead never folds.** The follow-on measured 417 px at zero, one, two
  *and four* units — 16 bays — because a subpanel draws only its own source. F4 has to
  collapse to a rack at three. Head-major pays for *sharing*, unit-major pays for
  *counting*, and four units on a four-head machine is the common shape.
- **The duplication objection was half wrong.** Four copies of one cabinet bound to one
  state object cannot disagree; that was an objection to drawing. What survives is the
  reading risk, answered by a dashed card edge and a `⇄` in the unit's pill.
- **The toolhead stops carrying filament.** No colour, no material name, no pencil on the
  artwork — filament belongs to the source, and the head's copy was the one that could go
  stale. What the head gets instead is a **sensor marker**, and it is not a binary:
  `filament_feed` reports `in_ace` → `in_toolhead` → `at_extruder` plus `channel_error`,
  four readings already parsed in `feedChannels()` and shown nowhere until now.
- **The cabinet is two halves, and each half has a job.** Spools in the upper one, their
  materials named in the lower one, the seam running through the roll. Both greys are
  Orca's own AMS neutrals — `#EEEEEE` over `#CECECE`. The box hugs its spools with 16 px of
  shoulder, which is what makes it an object in the card rather than the card's ground.
- **Splitting the bay across the halves bought the shipped bay.** A bay is now `.slot`'s
  own 36 px disc over its 58×19 name pill, 6 px apart — the same drawing a toolhead gets,
  at the same size, which was the point of drawing a bay as a head.
- **The stock feeder is Snapmaker's own module, and it is black where the ACE is grey.**
  The Automatic Filament Feeder Module is 159 g of plastic and metal with a front carrying
  **two label strips for filament channels** — one module serves two of the four toolheads.
  Drawn in the cabinet's own two-half shape in `#FFFFFF` over `#1F1F1F`: same seam rule,
  same proportions, different palette. Its badge is that frame at badge size, so the tiny
  logo and the drawing are one idea. (From the product page's text; its photography was not
  readable.) The material chip goes **white** there — the shipped `#6E6E6E` pill vanishes
  on black, and the chip is the only thing on the card that names the filament.
- **The dryer is a dialog, and it is Bambu's shape in the page's chrome.** A droplet
  filled to the reading answers *how wet* as a quantity, which is why the original works.
  Temperature and duration are `ACE_DRY`'s own arguments, and each offers **four presets
  and one empty field in the same row** — a preset *or* a typed value, never both. Typing
  un-lights the preset (it is no longer what would be sent), clearing re-lights it, a
  preset click empties the field, and an out-of-range value is clamped rather than refused.
  The command line under the dialog updates as you type. **Automatic above a humidity**
  (`ACE_SET_AUTO_DRY`) is the one control Bambu's has not got. It paints over the panel on
  its own scrim, so it costs the 456 px body nothing.
- **The feeder's badge is square; the ACE's is wide.** A cabinet is wide and a module is
  not, so a 44×26 badge for the feeder only ever read as a squashed ACE. It is the frame at
  badge size — white over black on a 17 px rounded square — and the frame itself carries no
  cutouts, because two strips flanking a centred spool read as asymmetric on a card where
  everything else sits on one line.
- **`value` is not a reflected attribute, and neither is `selected`.** Both bit this set of
  studies: setting the property leaves nothing in the serialised markup, so a pre-rendered
  copy loses whatever the control held. `bake_mockup.py` checks for the `selected` case and
  `check_mockup.py` now checks the input's `value` too.
- **Two `...` on the panel are two different scopes, and each menu says which.** The
  panel's holds the six ACE settings a person sets once — flush length, confirmations,
  Spoolman, `ACE_CLEAR_HEADS`, unload-everything — because on the face of the panel they
  would bury the four things that change daily. A subpanel's holds that one toolhead's
  load / unload / swap, with Swap absent on a stock feeder (no other bay) and Unload greyed
  on an empty head. Drawn in `device.css`'s own `.menu`.
- **A filament shows an eye or a pencil, depending on who wrote it.** An RFID tag carries
  vendor, type, colour and temperatures and none of it is ours to overwrite — read only. A
  typed value, or an occupied bay nobody has named, is editable. The mark goes **on the
  roll, bottom-right**: `.slot`'s own placement (under the chip) is the only one of five
  that costs height, and it costs 33 px more than the panel has.
- **The dryer dialog is settled** (confirmed against the drawing, 2026-08-26): the droplet
  filled to the reading with *Idle* / *Drying* under it, Humidity and Temperature named as
  Bambu names them, and each of `ACE_DRY`'s two arguments offered as four presets plus one
  empty field in the same row. Automatic-above-a-humidity is the control Bambu's has not
  got. The macro line sits under the settings and updates as you type.
- **A bay wears nothing at rest.** Anything drawn round the roll and its chip permanently
  either hides the seam that runs through the roll or fights it, so the shape appears only
  **under the pointer**, as a 1.5 px `#0C63E2` border with no fill — the blue the rail
  already uses for the selected destination. Drawn as a backing behind the bay and inset
  negatively, so it costs no layout and moves nothing.
- **The dryer dialog is opened by the Dry chip and by nothing else.** While the layout was
  being chosen the study had a rig switch that forced it open; once settled, that switch
  went. A rig control that outlives its decision is a way to reach a state no user has, and
  the baked copies are now driven by clicking the chip rather than by setting a flag.
- **A running dryer reports elapsed of total, not just time left.** `dryer_status` carries
  target, duration and remaining, so elapsed is derivable — `1 h 19 m / 4 h` says where you
  are *and* how long it was set for, in 8 px more than `2 h 41 m left`, and it costs the
  panel nothing.
- **Pointing at a filament shows an accent edge and nothing else.** A card listing the
  tag's record was tried and taken back out: it covered the cabinet above it, appeared on a
  movement rather than a decision, and duplicated what the bay's own sheet will hold. The
  record lives in the bay's title until that sheet exists.
- **Baking copies of a live document duplicates every id in it.** The droplet's fill is a
  rect clipped to the droplet's outline; two baked states each carried a
  `clipPath id="dropclip"`, a clip id resolves *document-wide*, and the second resolved to
  the first — which sits in a `display:none` block and therefore clips nothing, so the fill
  drew as the bare rectangle it is. Clips are numbered per instance now and
  `bake_mockup.py` namespaces each copy's ids on the way in; `check_mockup.py` asserts no
  two elements share an id and every `clip-path` resolves inside its own copy. Anything
  resolved by id — `mask`, gradients, `filter`, `use href`, `aria-labelledby` — has the
  same exposure in any mockup that bakes itself.
- **The running dryer dialog is the same dialog.** Same width, same humidity-blue droplet,
  same state and button styling; the state line stays one word and one plain line below it
  reads `1 h 19 m of 4 h, at 55 °C`. An amber droplet, an amber Stop and a progress bar
  were tried and taken out — the droplet worst of all, because it made the reading you came
  for change meaning at the moment you came for it. So was a two-line state, which wrapped
  in the 158 px column and grew the block under the droplet: that, and not the droplet, was
  what made the running dialog look like a different one.
- **"A running dryer refuses loads" was never true.** It entered this record as prose in the
  first study's drying state and was carried into three files and a dialog before anyone
  checked it: `/printer/gcode/help` says nothing of the kind and it was never seen on the
  machine. Removed from all of them, and `check_mockup.py` now asserts the panel claims
  nothing of the sort. It is worth knowing how it spread — an unverified sentence in a
  caption is quoted by the next document as if the caption were the source.
- ~~**Pointing at a filament shows the record its tag carries.**~~
  `filament_detect.info[i]` holds vendor, series, nozzle range, bed temperature, drying
  schedule and SKU — six fields `state.js` has parsed for months and that appeared nowhere
  but a dialog. A hover card is where they fit; a typed spool shows the two it knows. None
  of the five hover treatments costs the body a pixel, so it is decided on what it should
  say and what it may cover.
- **The unit row carries what the header had no room for** — which ACE it is, its humidity
  and temperature, and the dryer. A card with no ACE names its module instead of holding an
  empty spacer, which alignment required anyway.
- **The humidity pill is tinted by Orca's own `hum_level1..5` buckets** (≤20, ≤35, ≤50,
  ≤65, >65) — the same thresholds `AMSinfo` uses to pick its droplet, so the pill and the
  C++ widget cannot disagree about the same number.
- **The sensor dot is centred on the artwork's body.** `extruderBackground.svg` draws that
  body `y=17.4..127.6` of its 64×140, so the middle is `(32, 72.5)` at any scale.
- **The tube layer paints behind the cabinet.** The manifold bar sits below the box, so a
  drop has to cross the box to reach it — and filament inside a machine is not drawn over
  the machine. Which bay is feeding stays legible because the coloured core starts at that
  bay's x on the bar.
- **Everything on one centred axis.** The bays, the merge and the toolhead's inlet share
  the card's centre line in every source, so the tube that matters is vertical — and the
  checks assert *vertical*, not just *lands correctly*, which is how an inherited
  `align-items: flex-start` that left-aligned every card was caught.
- **I4 is not available.** A full-scale 140 px toolhead below its box, twice over, is
  **595–611** against 456. At 0.40 it is 427–443 and fits; beside the box at full scale it
  is 417. Only the frame costs height — box, tube and marker are all free.
- **A mockup that renders itself can arrive empty.** The interactive study first shipped
  drawing everything from its state object and landed **blank** in a viewer that strips
  script tags — and `<noscript>` did not fire, because a *removed* tag is not the same as
  scripting being *disabled*. It now bakes 16 pre-rendered copies into the file with
  [`tools/bake_mockup.py`](tools/bake_mockup.py), and `check_mockup.py` fails when one goes
  stale or when a script-looking string appears outside a real script tag. That last one is
  not hypothetical: one in a CSS comment let a regex sanitiser swallow every copy.

`head_ace` reads `{0:0, 1:1, 2:2, 3:0}` on a machine with `device_count: 1`, so heads 2
and 3 name units that **do not exist**: resolve a head's source as `head_manual`, then
`head_feeder`, and `head_ace` only for the remainder.

#### And then it was built, and met the machine (2026-08-26)

The panel is in `device_page/js/views/device-control/filament/`, and `ace()` — the
topology unpacked, with both traps in it — is in `shared/js/state.js`. Nine things worth
carrying:

- **The Filament panel has two shapes and the machine picks.** No `ace` object means no
  ACE to describe and no macro to send, so the printer gets the four slots the page always
  drew. That is not a fallback bolted on: it is the state every stock U1 is in, and
  `ace-panel.js` reaches it deliberately.
- **`ace` is read on its own, and re-read by anything that changes it.** It is not in
  `SUBSCRIBE_OBJECTS` — that list is pinned to the shipped bundle's and the conformance
  suite holds it there — so `session.refreshAce()` asks for it at 277 ms a time, on the
  heartbeat and after every macro. Without that last part a pending value would sit until
  it timed out and reported itself lost, because nothing pushes the object that would
  confirm it.
- **Fifteen macros, none awaited.** `ACE_BG_UNLOAD`'s own help says ~3 min, so every one
  goes through `core/pending.js` and is confirmed against machine state.
- **`check_coverage.py` now has a second surface.** The panel's controls are not bridge
  commands at all, so the old accounting could not see them and a macro deliberately not
  offered would have been silent rather than merely unbuilt. All 21 ACE macros are now
  either issued by a command module or withheld with a written reason — the three
  `[EXPERIMENTAL]` ones because their own help requires an OPEN dock and purges ~60 mm.
- **The tool caught its own first bug.** The macro scan counted `ACE_BG_UNLOAD` as
  offered, because the sentence explaining why it is withheld mentions it. Comments are
  stripped now, the same way the bridge-command scan already did.
- **A menu that opened and shut in the same tick.** `overlay.js` closes a menu on any
  document click outside `[data-menu-anchor]`, and only the device selector had that
  attribute written on it by hand — so the click that opened either new menu closed it
  again immediately. `openMenu` sets it on whatever anchor it was handed now, which is
  what it always meant.
- **Screenshots work here again**, and it took one environment variable and one widget:
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` and a `Gtk.OffscreenWindow`, whose `get_pixbuf()`
  renders through cairo instead of reading back an X window WebKit never drew into. Every
  `--shots` PNG in this project's history was blank. They are still the weaker half — the
  seam through a spool looked three pixels out of true and measured exactly right.
- **A drive script can pose a state for a picture.** `--shots` fires after the script
  reports, so ending in the state you want to look at is how you photograph it.
- **Then it was run against the real ACE, and four guesses were wrong** — each of which
  the printer had answered `ok` to. `ACE_DRY DURATION=` is **minutes**, not hours, so the
  dialog asking for 4 hours would have dried for four minutes; `ACE_SET_AUTO_DRY` takes
  `ENABLE=0|1 RH_START=%` and accepts the guessed `THRESHOLD=` while ignoring it;
  `ACED__DRY_STOP` stops *the current* unit rather than the one whose chip was pressed
  (`ACE_STOP_DRYING ACE=n` is the right one); and `dryer_status` is
  `{status, target_temp, duration, remain_time}` in **seconds**, with `keeping` as the
  running word. Settled by sending each and reading the object back — including running
  the dryer for ten seconds, which is the only way to see any of it — and everything was
  put back. **An `ok` is not a yes.**
- **Three of the four "write-only" settings are reported.** `confirm_commands`,
  `spoolman_url`, `spoolman_auto` and `purge_matrix` are all in the object, so those
  dialogs open on the machine's own values instead of on a default. Only the flush
  *length* really is absent.
- **The macro surface is evidence now, not a table.**
  [`tools/ace_macros.py`](tools/ace_macros.py) reads `printer.gcode.help` off the printer
  into [`data/ace-macros.json`](data/ace-macros.json) — 92 ACE macros of 336 — and
  `check_coverage.py` fails if its table names one the machine does not have. Writing the
  table down by hand is exactly how it came to name an argument the machine ignores.
- **`drive/ace-real.js` is the read-only half**, and permanently so: `ace-panel.js`
  switches sources, loads bays and starts the dryer, and a suite should not be able to
  purge a nozzle. 26 checks against the printer, including a dump of the raw object.
- **The panel was reading bay identity from a source that does not carry it**, reported as
  "filament is not correctly read from multiACE" and found by the comparison the reporter
  suggested — *look at how the Prepare page syncs*. Orca's `AceMmuProvider` polls
  `/multiace/api/state` from C++ and gets four named bays; the `ace` Klipper object has
  **no per-bay identity at all** (`{material:"", brand:"", rfid:0}` on every raw slot),
  because multiACE keeps the names in an override store and merges them in its own
  `_parse_state()`. Both were reading correctly, from two different things.
- **And the store is reachable, measured.** nginx serves `/multiace/` with **no CORS
  header** — that claim holds — but **Moonraker on :7125 reflects the Origin**, and the
  store is a file under its `config` root
  (`config/extended/multiace/slot_overrides.json`). One HTTP GET, the same pattern the
  camera frames already use: no proxy, no C++, no new bridge command. multiACE's own
  precedence is kept — **rfid → override → derived** — and it fails quietly, because a
  printer without the plugin must go on drawing an unnamed bay as unnamed. Ruled out on
  the way: `save_variables` carries only the head mapping, and `spool_binding` is `{}`.
- **It is one module now.** `shared/js/multiACE.js` owns the macros, the constants, the
  state model and the merge — named for the **plugin**, not the hardware, because this
  integrates with something deployed onto a U1 rather than with Snapmaker firmware. It was
  spread over `protocol.js`, `state.js` and a view, which is how the reading gap survived.
  The precedence rule is pure logic now, so `unit_jsc.py` holds it to account with no DOM.
- **The background-swap gate IS reachable**, contrary to what was written here first:
  `ace_bg_swap` is its own Klipper object — `{version, enabled_heads, busy, state}` — and
  `sw_GetMachineState` answers with it. No head is enabled on this machine, so the next
  iteration gets to design the disabled case first.
- **What is still unproven:** what a *second* unit's payload looks like — this machine has
  one — and everything about a background swap, since no head is declared capable.

Then, in rough order of value:

1. **Drive the rebuilt page from inside Orca.** Narrower than it was: the whole page runs
   against the printer through `run_webkit.py --real`, so the page-and-machine half is
   covered. What remains is exactly the bridge leg — whether a camera `{state, url}`
   arrives as the subscribe ack or as a push (the client accepts either), and whether
   `sw_SetSubscribeFilter` narrowing `EXTRUDER_FIELDS` changes what a wait can see. One
   session with the Device tab open settles both.
2. **Fault banner against a real fault.** The decoder and the 442-code catalogue are in
   place; neither has seen a real `action_code`. The banner's own recurring-fault bug is
   fixed but was never seen on hardware either.
3. **Discovery results** — the last unmeasured pass-through shape. `sw_StartMachineFind`
   is Orca's own Bonjour sweep, so the MQTT probes cannot reach it; it needs the app.
4. **`sw_SetSubscribeFilter` fails at boot** and is fired best-effort. Worth confirming
   it is genuinely optional rather than papered over.
5. **The print-processing popup has never been driven against hardware**, and has not had
   the restructure either — it still shares `shared/` but keeps its own flat `app.js`.
   Its send path (`sw_GetPrintZip` → `sw_StartLocalPrint` → the close protocol) is
   unproven. The primitives the Device page grew (`pending`, `render`, the panel
   contract) are the obvious things to lift across, and doing so is what would prove
   they generalise.
6. **`sw_DeleteMachineFile` is implemented in Orca and unreferenced here.** Storage
   deliberately has no delete for print files — Delete sat a few pixels from a one-click
   Print and only one of them is reversible. If it is wanted, that should be a considered
   decision, not an oversight.
7. **Not built:** firmware update, calibration wizards, bed-mesh abort (nothing reports a
   mesh in progress to hang a control off), in-page time-lapse playback on Linux (no
   H.264 in WebKitGTK). `check_coverage.py` lists every one, with a reason.

### One thing that is now cheap and was not

`views/storage/storage/` is a destination folder holding a same-named panel folder,
because that destination has exactly one panel. If a second joins it, rename then — the
structure is one directory per panel and the registry is the only place that names them.

## What is open

[02-device-page/11-multiace-handover.md](02-device-page/11-multiace-handover.md) ends with
the list, and it is six things. The short form:

- **The panel has only ever been right in ONE of the three ACE modes.** Everything was
  measured in `head`; `multi` and `normal` have never been observed, and in `multi`
  multiACE ignores `head_feeder` and `head_ace` entirely — every head is ACE-driven and
  **bay *s* feeds head *s***. So the panel will draw the wrong sources and offer loads the
  hardware is not plumbed for. `ace.ace_heads` is the machine's own answer and the page
  re-derives it. **This is the next session's work** — see the handover's first section,
  which includes the reversible multi↔head measurement that settles it.
- ~~**A swap needs a homed Z**~~ — **closed 2026-08-28.** It never did. Only
  `ACE_SWAP_HEAD` moves Z (a 2 mm hop off the part, for a mid-print swap), and the panel
  sends `ACE_UNLOAD_HEAD` then `ACE_LOAD_HEAD` now — which is what multiACE's own dashboard
  and HelixScreen both send, and neither moves Z. Round fifteen.
- **`AUTO_FEEDING … LOAD=1` is inferred**, and is the only macro argument on this page that
  was not settled by sending it and reading the object back.
- **One real swap, watched.** Three minutes and a purge, so it is a person's decision.
- **`ACE_UNLOAD_ALL_CANCEL`** now has a surface to live on and still no evidence.
- **The cross-origin console read and the copy pass** have not run on hardware.
- **A bay nothing named stays unnamed.** Spoolman is the missing third source.

## Keeping it honest

```bash
python3 docs/u1-webui/tools/check_coverage.py
```

Every command the host dispatches and the bundle references must be implemented or
excluded **with a written reason**; anything else is reported `UNCLASSIFIED` and fails.
It also flags exclusions that have since been implemented. Do not silence it — if
something is not built, say so in `EXCLUDED` and it stays visible.

Two more, and between them they cover what coverage cannot:

```bash
python3 resources/web/shared/tests/conformance_test.py   # decisions match the write-up
python3 resources/web/shared/tests/run_webkit.py         # the page, in Orca's own engine
```

The parity position is [02-device-page/07-parity.md](02-device-page/07-parity.md), and
what it got wrong is above. The restructure that made the tooling honest is
[02-device-page/09-restructure.md](02-device-page/09-restructure.md).
