# Function-for-function gap analysis

Seven things a user found broken on real hardware, against a page whose parity table said
"nothing on the command surface" was missing. This is what was actually wrong, why the
checks did not catch any of it, and what the fix is.

Measured against `811002511261022618B3` on 2026-08-24 with
[`tools/u1_probe.py`](../tools/u1_probe.py) — every "real" value below is a capture, not a
reading of the C++.

## Why the coverage check said 100%

`check_coverage.py` counts a command as implemented when the token `CMD.NAME` appears in
client source. That proves the command is **mentioned**. It does not prove:

- a control exists that reaches the call site,
- the call site is reachable at all,
- the response is parsed correctly,
- anything is rendered.

A panel with no button still counts every command it would have called. The parity table
then reported command coverage as though it were functional coverage — that was the
error, and it was mine. The number was true and the claim built on it was not.

The second reason is sharper. **The simulator was written from the same reading of the C++
as the client**, so it returns what the client expects rather than what the printer sends.
Every mismatch below passes the browser suite and fails on hardware. The docs named this
risk and then did not test for it.

## Root cause A — the JSON-RPC envelope is never unwrapped

> **Corrected 2026-08-25, and this correction matters.** What follows is true only of a
> `passthrough` response target. Every ordinary command takes the other arm of
> `Moonraker_Mqtt::on_response_arrived`, which **reshapes** the reply before Orca ever
> hands it over:
>
> ```cpp
> if (passthrough || id == 20252025) {
>     cb(body);                     // the raw envelope - what this section describes
> } else {
>     res["data"]   = body["result"];        // unwrapped, one level down
>     res["method"] = body.count("method") ? body["method"] : "";
>     cb(res);
> }
> ```
>
> So the page receives `{data: <result>, method: <name>}`. `unwrapRpc` only stripped
> `jsonrpc` envelopes, so against the real contract it was a **no-op**, and every reader
> that was not going through `unwrapStatus` was silently reading `undefined`:
>
> ```js
> cam.timelapses = (r && (r.instances || r.list || r.items)) || [];   // always []
> ```
>
> Measured on hardware, before and after teaching `unwrapRpc` the real shape:
>
> ```
> file panel:  "No files on this machine"  ->  config logs gcodes timelapse camera, print_task.json 4 KB, ...
> history:     keys method, data           ->  keys count, jobs
> ```
>
> The file browser was **empty against a real printer** and nothing caught it, because
> the simulator agreed with the client. It surfaced only when the shipped bundle was run
> against the same host: the bundle reads `status` off that object directly, logged
> `queryPrinterStatus error` while holding all four extruders, and fell back to the push
> stream - which is why one toolhead showed and three did not.
>
> The mechanism below is real; its scope was wrong.

This one breaks most of the list, and it is a single line.

```cpp
// SSWCP.cpp:1194  on_mqtt_msg_arrived
obj->m_res_data = response;          // the WHOLE {jsonrpc, result, id} envelope
// SSWCP.cpp:946   send_to_js
payload["data"] = m_res_data;
```

`sswcp.js` resolves a request with `payload.data`, so on hardware every printer-backed
command resolves to:

```json
{"jsonrpc": "2.0", "result": { ...the payload... }, "id": 7, "cli_time": …, "dev_time": …}
```

The simulator instead puts the **unwrapped** result there:

```js
// mockhost.js:44
function reply(header, code, message, data) { ... payload: { code, message, data } }
```

So `r.instances`, `r.files`, `r.thumbnail_path` all resolve in the simulator and are
`undefined` on a real printer. The file browser shows the symptom clearly — the code
already half-guessed at this:

```js
items = (dir && (dir.files || dir.result)) || [];
files.items = Array.isArray(items) ? items : [];   // dir.result is an OBJECT -> []
```

`dir.files` is undefined, `dir.result` is the object, `Array.isArray` rejects it, and the
list renders empty. The guess was made without ever seeing the real shape.

**Fix:** unwrap once, centrally, in `sswcp.js` — if the payload carries `jsonrpc` and a
`result`, resolve `result`. Commands answered entirely in C++ (`sw_GetLocalDevices` and
friends) have no `jsonrpc` key and pass through untouched.

## Root cause B — colours are not CSS

| Source | `filament_color` | `filament_color_rgba` |
|---|---|---|
| **Printer** | `[4294198070, 4294967260, …]` — ARGB **integers** | `["F44336FF", "FFFFDCFF", …]` — hex, **no `#`** |
| Simulator | `['#E03131FF', …]` | `['#E03131FF', …]` |

`renderFilament` does `dot.style.background = colors[i]`. Both real forms are invalid CSS,
so the assignment is silently dropped and every slot renders grey. `isDark()` has the same
assumption.

**Fix:** a normaliser that accepts ARGB int, `RRGGBBAA`, `#RRGGBBAA` and `#RRGGBB`.

## Root cause C — controls missing from specific render branches

Two panels lose their controls exactly when they are needed.

**Camera.** The live-view branch returns before the control block is reached:

```js
if (cam.streaming && cam.frameUrl) {
  ... root.appendChild(im);
  return;                    // <- Stop button lives only in the fallback below
}
```

So once a frame arrives there is no way to stop the camera. *(pointer 1)*

**Printing Task.** The idle branch renders an image and nothing else:

```js
if (!active) { illustration(root); return; }   // no text, no buttons
```

An idle printer therefore shows a bare illustration with no explanation and no way to
start anything. *(pointer 3)*

## Root cause D — `toolhead` is never subscribed

`SUBSCRIBE_OBJECTS` omits the `toolhead` object, which is where the printer keeps the two
things the control panel needs:

```json
"toolhead": { "extruder": "extruder3",          // which tool is ACTIVE
              "position": [105.58, 108.25, 10.0, 0.0],
              "homed_axes": "" }
```

Consequences, both visible: the `Tool1..4` buttons set a local variable and send nothing,
so selection is cosmetic and never reflects the machine; and the axis readouts stay at
their `------` placeholder because no position ever arrives. *(pointer 5)*

`extruder*.state` (`"PARKED"` / `"ACTIVATE"`) is a second, independent source for the
active tool, and `motion_report.live_position` for live motion.

## Root cause E — purifier mode is an integer

Real: `"purifier": {"mode": 0, "exhaust_fan": {"speed":…,"delay":…}, …}`.

The dialog offers the strings `'inner'` / `'exhaust'` and the status row prints
`purifier.mode ?? '_'`, so it shows a bare `0`. `exhaust_fan` is an **object**, not a
scalar, and `state.js` passes it through as one.

## Root cause F — print history has no bridge command

`server.history.list` works on the printer and is rich:

```json
{"count": 5, "jobs": [{"job_id":"0000F9", "filename":"XYZ Test Cube_PLA_3h58m.gcode",
  "status":"klippy_shutdown", "start_time":…, "end_time":…, "print_duration":0.0,
  "total_duration":12.74, "filament_used":0.0, "metadata":{…}}]}
```

240 jobs are on this machine. But **no `sw_*` command exposes it** — the bridge cannot
reach it, so no page-only change can add this tab. The shipped bundle does reference
`server.history.list`, and its `PrintHistory` widget builds little more than a
`"Print history"` heading, sitting next to `HomeSideMenuWidget` — i.e. it is a *home page*
surface, not a Device-tab panel, and looks unfinished there too.

**This one needs C++**, and is therefore called out rather than quietly skipped.
*(pointer 4)*

## Pointer-by-pointer

| # | Reported | Root cause | Needs |
|---|---|---|---|
| 1 | camera cannot be stopped | C — early `return` before the control block | page |
| 2 | recordings not displayed | A — `r.instances` is `r.result.instances` | page |
| 3 | task panel has no placeholder or buttons | C — idle branch renders image only | page |
| 4 | previous print tasks missing | F — no bridge command exists | **C++** |
| 5 | toolheads not selectable / movable | D — `toolhead` not subscribed; selection is local-only | page |
| 6 | filament colours missing | B — ARGB int / un-prefixed hex are not CSS | page |
| 7 | missing menus and popups | see below | page |

On (7): the dialogs and menus do exist — `openDialog`/`openMenu` back the temperature,
fan, purifier, filament-slot and device menus. What made them look absent is that the
panels they hang off render empty or disabled on real data, so there is nothing to click.
Fixing A–E restores the affordances rather than adding new ones.

## The check that should have caught this

None of the 42 conformance checks compare a **response shape** against hardware, and the
browser suite drives a simulator that agrees with the client by construction. The
durable fix is to make the simulator answer with the printer's shapes — envelope included,
ARGB colours included — so that the existing browser tests start failing when the client
assumes otherwise. A simulator that flatters the client is worse than no simulator,
because it converts an unknown into a false negative.

## What was rebuilt

| Root cause | Change |
|---|---|
| A envelope | `unwrapRpc()` in `sswcp.js` strips `{jsonrpc, result, id}` once, centrally. Guarded on `jsonrpc`, so Orca-answered payloads and bare arrays pass through, and an `error` envelope is preserved rather than emptied. |
| B colours | `cssColor()` / `isDarkColor()` in `protocol.js` accept ARGB integers, `RRGGBBAA`, `#RRGGBBAA` and `#RRGGBB`. |
| C camera | The live-view branch renders its own **Stop** and **Refresh**; it no longer returns before the control block. |
| C task | The idle panel names the state, shows the last file, and offers **Browse printer files**. |
| D tools | The active tool is the extruder reporting `state: "ACTIVATE"`; clicking a tool sends `T<n>`. Axis readouts come from `motion_report.live_position`. |
| D homing | `homed_axes` arrives from a one-shot `toolhead` query at connect and after `G28`, and an unhomed axis is marked — Klipper refuses the move, which previously looked like a dead button. |
| E purifier | `mode` is sent and rendered as an integer with a name; `exhaust_fan` / `inner_fan` are read as objects. |
| F history | **Not built** — no bridge command exists. See below. |

### The subscription list was deliberately not changed

The first attempt added `toolhead` to `SUBSCRIBE_OBJECTS`, and the conformance suite
rejected it: the shipped page does not subscribe that object, and the list is pinned to
the bundle's 24. That was the right call by the test — everything needed is already in
the subscribed set (`extruder*.state` for the active tool, `motion_report.live_position`
for coordinates). Only `homed_axes` genuinely required `toolhead`, and it is fetched
explicitly rather than by widening the stream.

### The simulator now tells the truth

The durable fix, and the reason this class of bug existed. `mockhost.js` now:

- wraps replies for the **47 printer-backed commands** in their JSON-RPC envelope, exactly
  as Orca passes them through — the list is derived from `SSWCP.cpp` by finding every
  handler that routes its reply through `on_mqtt_msg_arrived`, and the conformance suite
  re-derives it so it cannot drift;
- sends filament colour as an ARGB integer and un-prefixed hex, not as CSS;
- refuses `camera.start_monitor` with `domain: ""` and the printer's own `-32000`.

A simulator that agrees with the client converts an unknown into a false negative. These
changes make the existing tests fail when the client assumes wrongly.

### Testing, given no browser

*(Superseded in round three: WebKitGTK turns out to be drivable, so there is a browser
after all — see "Testing, in a browser at last" at the end of this document. What follows
still holds for the pure-logic checks.)*

`playwright` is absent and the vendored chromium will not start (no `libnspr4`/`libnss3`),
so the 28 browser checks cannot run here. **JavaScriptCore can** — it is what Orca's own
webview uses, and PyGObject drives it:

```bash
python3 resources/web/shared/tests/unit_jsc.py
```

39 checks: all 14 modules validated as real ES modules via `check_syntax` in module mode,
then the colour normaliser, the envelope unwrapper and the state model executed against
**captured hardware payloads** rather than invented ones. Negative-controlled — reverting
either fix turns seven of them red.

## Still open

1. **Print history (pointer 4) needs C++.** `server.history.list` works on the printer and
   returns 240 jobs here, but no `sw_*` command exposes it, so the page cannot reach it.
   Adding it means a new handler in `SSWCP.cpp` plus a `Moonraker_Mqtt::async_*` — a
   deliberate change to Orca, not a page edit, which is why it is called out rather than
   quietly skipped.
2. **None of this is confirmed on hardware through Orca's bridge.** The printer side is
   measured and the C++ pass-through is read, but the fixed page has not yet been driven
   against a real U1 in the app. That is one session with the Device tab open.
3. **The purifier mode names for 1 and 2 are inferred**, not measured — confirming them
   means changing the mode on a real machine.

## Round two — what a second pass on hardware found

Reported after the first rebuild, with the fixes above in place.

### Tool selection did not stick, and that was a fresh bug of mine

The pending-vs-confirmed distinction was missing. The click did:

```js
activeTool = i;                                 // set
handlers.selectTool(i);
renderControlMain(root, toolheads, handlers);   // re-enter...
```

and `renderControlMain` opens with `if (head.activeIndex != null) activeTool = head.activeIndex;`
— so the click's own re-render put it straight back, and the next state push a second
later would have anyway. Storing a *request* in the variable that mirrors the *machine*
cannot work.

`pendingTool` now holds the request until the machine agrees (its extruder reports
`ACTIVATE`) or it ages out after 45 s, which is the timescale a mechanical toolchange
actually takes. The button distinguishes the two: a green dot for the live tool, an
italic ellipsis for one being switched to.

### Print speed

Moved to the foot of the left column and made discrete — whole 50% steps across
`LIMITS.printSpeed` (50 / 100 / 150), replacing the continuous slider under the jog pad.

### Filament dialog

Rebuilt as "Materials Setting", after Bambu Studio's. It has real data behind it now:
`filament_detect.info` is one entry per slot carrying the spool's RFID tag —
`HOTEND_MIN_TEMP` / `HOTEND_MAX_TEMP` (190–260 and 205–235 on two of this machine's
spools), `BED_TEMP`, drying figures, vendor and sub-type.

The lower half is deliberately read-only: those numbers come off the spool and from
Klipper's own calibration, so presenting them as editable would be a lie. **Klipper's
`pressure_advance` is this machine's Factor K** — the same role, already in
`EXTRUDER_FIELDS`.

One thing the capture settled: slot 4 reports `VENDOR: "NONE"` in the tag while
`print_task_config` says PETG. A hand-set filament has no tag, so the two sources are
kept separate and the dialog says which it is rather than showing a grid of zeros.

`setFilament` now writes colour back in the wire form (`RRGGBBAA` and the ARGB integer),
not CSS — writing `#RRGGBB` would put a value on the machine nothing else on it reads.

### Print history — built, and it needed the C++

`server.history.list` had no bridge command, so this is a real addition to Orca:

| Layer | |
|---|---|
| `PrintHost.hpp` / `MoonRaker.hpp` | `async_get_print_history` |
| `MoonRaker.cpp` | `server.history.list`, params passed through |
| `SSWCP.hpp` / `SSWCP.cpp` | `sw_GetPrintHistory` — handler, dispatch, registration |

**It needs a rebuild**, unlike everything else on this page.

Measured, and it changed the design: the reply's `count` is **the size of the page, not
the total** — asking for 7 returns `count: 7` on a machine with 240 jobs. The only true
total is `server.history.totals` (`job_totals.total_jobs`), which has no bridge command.
So paging stops when a short page comes back rather than counting toward a known end, and
the footer says "N shown" rather than inventing "N of M".

### A tool that destroyed itself

`map_sswcp.py` ended with `json.dump(out, open(sys.argv[-1], 'w'))`. Run with no
arguments — the obvious way — `sys.argv[-1]` is the script's own path, so it overwrote
itself with its output. It did that here, and was restored from git. It now requires both
arguments and refuses to write over itself.

## Picking and parking: the flow, and what was wrong with it

### What the printer's own UI does

Recovered from the shipped bundle, which is the authority here — neither command appears
in `printer.gcode.help`, because both register without a help string, as `T0`–`T3` also
do. Reading that absence as evidence is what sent an earlier attempt hunting for a park
macro that does not exist.

```js
r = a.w === "ACTIVATE" ? "Park Extruder" : "Pick Extruder"   // one button, per toolhead
…
A.aDM(h, "Extruder " + (j.a+1) + " operating...", 60)        // overlay, 60s
case 5:  l = h === 0 ? "PARK_EXTRUDER" : "PARK_EXTRUDER" + h // park
case 7:  k = "T" + j.a + " A0"                               // pick
```

Three things fall out of that:

| | |
|---|---|
| Park | `PARK_EXTRUDER`, `PARK_EXTRUDER1`…`3` — numbered like Klipper's own `extruder`/`extruder1` |
| Pick | `T<n> A0` — the `A0` is not optional decoration; the firmware's own `SM_PRINT_CHECK_SWITCH_EXTRUDER` passes it too |
| Wait | 60 s, with the surface blocked, and no confirmation step |

### What was wrong

Two faults, and the second is the one that made both operations *look* broken.

**1. `T-1` for park.** A guess with nothing behind it. There is no such command; it did
nothing, silently.

**2. The active toolhead was read from the wrong object.** `state.toolhead()` took
`activeKey` from `toolhead.extruder` and only fell back to the subscribed
`extruder*.state`. But `toolhead` is **not subscribed** — the shipped page does not
subscribe it, and the conformance suite holds the list to the bundle's — so it arrives
only from the one-shot query at connect and after `G28`.

The consequence is worse than a stale badge:

```
pick 1   →  T1 A0 dispatched, machine obeys, extruder1.state → ACTIVATE
         →  toolhead.extruder still says extruder3 (fetched at connect)
         →  activeIndex still 3  →  poll for ===1 never true  →  "did not report active"

park     →  PARK_EXTRUDER3 dispatched, machine obeys, all extruders → PARKED
         →  activeIndex still 3  →  poll for ==null never true  →  "did not park in time"
```

Both operations **succeeded on the machine and were reported as failures**, which is the
worst shape a bug can take: the user is told to retry something that already worked.

**Fix:** the subscribed source wins. `extruder*.state === 'ACTIVATE'` is authoritative
whenever any extruder is reporting state at all; `toolhead.extruder` survives only as a
cold-start fallback for the window before the first snapshot. Four unit tests cover it,
including the two stale-`toolhead` cases, negative-controlled by restoring the old order.

### The flow now

One button, and what it does follows the toolhead selected above it — the same shape the
shipped page uses, where each toolhead carries a button reading *Park Extruder* when that
head is `ACTIVATE` and *Pick Extruder* when it is not.

| Selected toolhead | Button reads | Sends |
|---|---|---|
| not live | **Pick extruder** | `T<n> A0` |
| live | **Park extruder** | `PARK_EXTRUDER<n>` |

Selecting a toolhead sends nothing — it only points the jog and extrude controls, and
now also decides what the button means. The button blocks the surface while the gantry
moves and confirms against the machine rather than the G-code ack, which only says the
command was queued. `parkTool` still checks the live head before acting, whatever it is
passed: only a live head can be parked.

Two buttons were tried first and were the wrong shape. Pick followed the *selection*
while Park followed the *machine*, so with a head selected that was not the live one the
pair disagreed about their subject and neither could name it without a tooltip. Collapsing
to one button removes the asymmetry rather than explaining it — the target is always the
head you have selected.

### Waiting for a toolchange, and what the original does

A pick or park sometimes triggers an XY calibration, and then it takes minutes rather
than seconds. Three things about that are worth writing down.

**The bridge gives up long before the machine does.** `sw_SendGCodes` does not return
until Klipper has finished the move, but `TIMEOUT_MS` in `sswcp.js` is **15 s**. So the
request rejects while the printer is still working, and an implementation that awaits it
reports a failure for an operation that is going fine. That was the bug.

**The machine says what it is doing.** `machine_state_manager.action_code` is on the
subscribed stream, and the bundle carries the labels:

| | |
|---|---|
| 768 | Extruder Docking Calibrating… |
| 769 | Checking Extruder Park… |
| 770 | Checking Extruder Pick… |
| 832 | Homing Calibration… |

36 codes in all, extracted by [`tools/extract_activity.py`](../tools/extract_activity.py)
into `shared/js/activity.js`. Only codes ≥ 128 are taken: below that the bundle has two
further switches over small integers whose cases collide with these — 1 is both "Working"
and "Homing" — so a merged table would be wrong wherever it is ambiguous.

**What the original does: the same thing, badly.** Its handler is
`aDM(ctx, "Extruder N operating…", 60)` — a non-dismissable barrier that auto-dismisses
after 60 s *whatever has happened* — then it fires the command and clears the barrier in
a `finally`. It does not poll state and does not read `action_code`. When its own request
times out, `oJ`'s error path says **"Request timeout, please try again later."** So the
shipped page tells you to retry a toolchange that is still running, and its 60 s is a
ceiling on the overlay rather than any kind of completion signal.

This does not copy that. The command is fired and deliberately not awaited; a rejection
mentioning a timeout is swallowed as "still working" while any other error is reported.
The wait then watches the machine: it shows the current activity label, and every time
the machine reports being busy the deadline is pushed out again. Silence for 60 s ends
it, and a hard cap of ten minutes stops it waiting forever.

### Z is the bed, and up is negative

The bed row's arrows were inverted: pressing **↑** lowered the bed.

On this machine the bed is the Z axis, and Klipper's Z measures the nozzle-to-bed gap —
so a larger Z is a *wider* gap, which on a moving bed means the bed is further *down*.
Raising the bed is therefore a **negative** Z move. The printer's own config settles that
without appealing to convention:

```
stepper_z   position_endstop 275.0, homing_positive_dir true   → Z homes to its maximum
PRINT_END   G0 Z200 F2000                                      → drives UP for clearance
```

Both only make sense if larger Z means more room between nozzle and bed.

The arrows now send `Z−` for up and `Z+` for down, and each button's tooltip names both
the physical direction and the G-code it will send — *"Move the bed up, toward the nozzle
by 1 mm (Z−1)"*. An arrow on its own is ambiguous the moment the moving part is the bed
rather than the head, and that ambiguity is what the bug was made of.

### What a toolchange actually reports

The dialog stayed blank through a toolchange because it was watching two objects that say
nothing during one. Settled by driving a real `T0 A0` on an unhomed U1 over MQTT and
logging every field that moved:

```
 0.7s  toolhead.homed_axes "z"      idle_timeout.state "Printing"
 2.7s  toolhead.homed_axes ""
 4.7s  toolhead.homed_axes "y"
14.7s  toolhead.homed_axes "xy"        <- the "XY calibration" a user sees
28.7s  extruder.activating_move true
30.7s  extruder.state "ACTIVATE"       <- done
32.7s  idle_timeout.state "Ready"
```

Silent for the entire 31 seconds: **`machine_state_manager`** (`{main_state: 0,
action_code: 0}` throughout) and **`extruder_offset_calibration.calibration_step`**
(`"idle"` throughout). Those were the two the wait consulted. `display_status.message`
never set either.

So the progress signal is **`toolhead.homed_axes`**, bracketed by `idle_timeout`. Neither
is available on the stream as the page subscribes it — `toolhead` is not subscribed at
all, and `activating_move` is not among `EXTRUDER_FIELDS` — so the wait polls both once a
second.

`idle_timeout` is now trusted as a busy signal, having been excluded earlier for reading
`"Printing"` on an apparently idle machine. That was Klipper's timeout not having elapsed,
not a false reading, and across the capture it bracketed the operation exactly. Every wait
has its own `done()` and a hard cap besides, so a lingering `Printing` costs nothing.

Measured durations, both verified live: **4 s** when the machine is already homed,
**31 s** when it is not. The second is the case that outran the bridge's 15 s request
timeout and made a working toolchange look like a failure.

### `toolhead.extruder` does not mean "engaged"

Park reported "did not report a parked toolhead" with nothing having moved. The command
was fine; the panel was asking the wrong head to park.

Measured on a fully parked U1:

```
toolhead.extruder : "extruder"     <- names a head
extruder.state    : "PARKED"       <- ...that is not engaged
extruder1..3      : all PARKED     <- nothing is engaged at all
```

`toolhead.extruder` is Klipper's *current extruder for G-code purposes*. It goes on
naming the last head used after that head has been parked. It was being used as a
fallback for "which head is live", so with no `ACTIVATE` anywhere the panel still
believed head 1 was engaged: the button offered **Park**, sent `PARK_EXTRUDER`, and got
an instant `ok` for a head that was not there. Nothing moved, and the wait then sat out
its full timeout for an `activeIndex` that could never change.

The instant `ok` is the trap. Measured against a head that *is* live, `PARK_EXTRUDER2`
does not reply for over 20 s — it blocks while it works. Against one that is not, it
returns immediately and successfully. **A G-code ack cannot distinguish those**, which is
why the wait confirms against `extruder*.state` instead.

Engagement is now read only from `extruder*.state === 'ACTIVATE'`. Nothing reporting it
means nothing is engaged — an answer, not a gap to fill from elsewhere. Two unit tests
that previously asserted the fallback have been inverted; they had encoded the bug.

## Round three — setting a temperature

Two faults from ordinary use: the temperatures *did* apply — the printer heated — but the
row lied about it either side of the round trip.

### A zero is not a reading

Every idle row showed `24 / 0 °C`, and that `0` had to be selected and deleted before a
temperature could be typed. It was never information: a target of zero **is** a heater
that is off, and five rows all saying so at once is noise standing exactly where the
input goes.

The field now holds an empty string for a zero target and shows `—` through the
placeholder, and focus selects whatever is there so a set value is typed over rather than
edited. Clearing the field is no longer read as "switch it off" — that is asked for by
typing a zero, which cannot happen by walking away from a half-edited field.

`select()` on `<input type="number">` is worth a note: `selectionStart` and
`setSelectionRange` do not apply to that type and throw, but `select()` does apply. It
also needs the mousedown/mouseup guard, or the mouseup that follows a click collapses the
selection focus had just made.

### The value that vanished, and the setpoint that was never confirmed

A committed temperature would disappear a second later, or come back as `0`.

`updateTempRow` wrote the machine's target into the field on every state push. The push
that follows a commit lands roughly a second before the printer has reported the change,
so it wrote back the value from *before* the edit. The field being left alone while
focused was not enough — the commit happens **on blur**, so by the time the value is on
its way the field is no longer focused and no longer protected.

Same bug class as the tool selection one: *the request was stored in the thing that
mirrors the machine*. It is now pending-until-confirmed, the same model:

| | |
|---|---|
| sent | the asked-for value stays on screen, dashed, until the machine echoes it |
| confirmed | `extruder<n>.target` comes back equal to it, and the mark clears |
| refused | the bridge rejects the command — the row stops waiting at once |
| ignored | ten seconds with no echo: the row drops back to the machine's value and says which value did not take |

That last row is the one worth having. **A command that succeeds and changes nothing is
exactly what a silently-ignored setpoint looks like** — the same trap as the instant `ok`
from `PARK_EXTRUDER` — and it must not sit there looking applied.

### There was no sign the heater was working

A nozzle climbs about a degree a second. Watching one number tick while another sits
still reads as nothing happening, so a temperature that was accepted and one that was
dropped looked identical for the first half-minute.

The row now says which of four things it is doing, from the two numbers both heaters
already report — `power` would say it directly, but only the extruders publish it, and
`heater_bed` is subscribed for `temperature` and `target` alone:

```
heating   cur < target - 2      warm ink, and a bar under the numbers
ready     |cur - target| <= 2   the ok ink, no bar
cooling   cur > target + 2      cool ink and bar, and only while cur > 40 -
          and cur > 40          a nozzle at 120 with the heater off is not an idle one
off       target 0, cold        nothing
```

The bar runs from the temperature the ramp *started* at to the target, so it moves for as
long as the machine does. Against 0 it would jump about whenever the target changed.

The readings column is 126px and every pixel was already spoken for, so the feedback had
to cost no width: colour, and 2px under the numbers.

### The column could not hold its own numbers, and would not hold still

Found while looking at the result: at 30px the target field clipped a three-digit value,
so a nozzle at 220 read as `22`. Measured in the page rather than estimated — 9.00px per
tabular digit, so 27 + 6 padding + 2 border = 35px. The row gap goes 5px → 4px to pay for
it, which leaves the widest case the row can be asked to show (350 over 350) fitting the
126px column with 2px to spare.

The reading beside it had the opposite problem: it was auto-width, so a nozzle climbing
from 99 to 100 carried the slash, the target field and the unit one digit to the right,
and five rows at five temperatures never lined up with each other. `.cur` now reserves
three digits and right-aligns against the separator, so both numbers sit against the
`/` and nothing downstream of them can move. A browser check asserts it directly -
`.sl`, `.tgt` and `.unit` must share one x across every row, at one digit and at three.

### Testing, in a browser at last

`run_selftest.py` still cannot run — playwright is absent and the vendored chromium is
still missing `libnspr4`/`libnss3`. But **WebKitGTK is present**, because it is what Orca
renders with, and PyGObject drives it the same way it drives JavaScriptCore:

```bash
python3 resources/web/shared/tests/run_webkit.py --shots /tmp/shots
```

It serves `resources/web`, loads the Device page against the simulator, and drives the
real controls. That is a better witness than chromium would have been: the checks run in
the engine that will run the page for real. It is how the three faults above were
confirmed fixed, and how the clipped digit was found in the first place.

Screenshots come from `Gdk.pixbuf_get_from_window`, not WebKit's own snapshot API, which
returns a cairo surface there is no pycairo here to receive. It needs a display; WSLg
provides one.

### And then against the printer, still without Orca

The page reaches a machine only through `window.wx`, so everything above was checked
against the simulator. That limit turned out to be one user script wide.

[`tools/u1_bridge.py`](../tools/u1_bridge.py) answers the same SSWCP contract from
Python: `run_webkit.py --real` installs `window.wx` as a WebKit user script, and the
bridge behind it speaks MQTT to the real U1 over `mqtt_min.py`. The page then runs its
own connect path — LAN auth on `:1884`, mTLS on `:8883` — and the log reads the same as
Orca's, ending in the same `snapshot ok: 24 objects`.

`--watch` turns the same command into a window rather than a test: the checks run and
report first, then it stays open until closed, with the terminal showing what every
click sends. That is the loop the connect bugs were found in, without Orca in it.

Three kinds of command, and the split is Orca's, not a design of ours:

| | |
|---|---|
| transport | `sw_create_mqtt_client` / `connect` / `subscribe` / `publish` / `disconnect` / `set_engine`. The page drives the socket; the host only owns it |
| printer | 37 of the page's commands are one JSON-RPC method with the parameters passed nearly straight through |
| local | the device book and the login state, read from Orca's own config; eight more refused in as many words |

The mapping is **generated**, by [`extract_bridge_methods.py`](../tools/extract_bridge_methods.py),
from `SSWCP.cpp` and `MoonRaker.cpp` — two hops, `m_cmd == "sw_X"` → `sw_X()` →
`host->async_x()` → `method = "printer.control.x"`. Writing it down by hand would have
been the same mistake as the parity claim: a description that stops matching the thing
it describes.

The generator earned its keep immediately. Its first version sliced a C++ function body
at the next definition *of the same class*, which let `sw_mqtt_publish` swallow every
function defined between it and the next MqttAgent member — and come out mapped to
`machine.system_info`. A publish would have gone out as a system-info query. Bodies now
end at the first column-one `}`, and a conformance check asserts that the transport
commands map to no printer method at all.

**What this cannot do**, and it matters: it is a *second host* speaking the same
contract, so it proves the page and the printer agree. Whether **Orca** agrees is a
different question, and the open ones — whether a camera `{state, url}` arrives as the
subscribe ack or as a push, whether `sw_SetSubscribeFilter` narrowing changes what a
wait can see — are about Orca's leg specifically. Those still need the app. Orca must
also be closed while this runs: same saved `clientId`, and a broker evicts the older
holder of a duplicate id.

### What the printer said about the temperature work

Driven end to end through the page's own field, on the machine
([`--drive`](../../../resources/web/shared/tests/run_webkit.py) runs a script in the
live page):

```
sw_ControlExtruderTemp {"temp": 57, "index": 0, "map": 0}
  the row holds the asked-for value, marked unconfirmed
  the printer echoed the target back        552 ms one run, 1516 ms the next
  the wait ended; the row says heating
  nozzle 42 -> 62 °C over 10s, the bar filling
  put back to 0; the field returns to a dash
```

**The echo takes between half a second and a second and a half.** That is the whole bug
in one measurement: the render tick is about a second, so a push computed before the
echo arrived was writing the machine's old target — usually `0` — back over the value
just sent. It was never a race the user could win by typing faster.

The run also found a flaw in the new bar that the simulator could not have shown: asked
for 40, the nozzle overshot to 48, and the state flipped heating → cooling with the
target unchanged. The ramp was only restarted when the *target* changed, so the bar sat
at 100% while the temperature was falling. It now restarts when the direction does.

## Round four — the session, and what "connected" means

Three faults, found by running the page against the machine for longer than a test.

### A slow command is not a refused one, and two clocks say "timeout"

Picking a toolhead on a cold machine reported **"The printer refused the command"** while
the toolchange ran to completion. The page already knows a timeout is not a refusal - it
tests the rejection and ignores it - but it was matching one wording out of two.

| | | |
|---|---|---|
| the client's | 15s | `sswcp.js`, "sw_X timed out after 15000ms" - the page giving up on the BRIDGE |
| Orca's | **80s** | `add_response_target`'s default (`MoonRaker.hpp:344`) waiting on the PRINTER, failing as code **-2**, message **"time out"** |

Note the space. `/timed out/i` never matched Orca's own wording, and it stayed hidden
because the client's clock is the shorter of the two: Orca's `-2` arrives long after the
request has been forgotten, and is dropped for want of a pending entry.

`u1_bridge.py` brought it out by answering sooner - it had been given a 12s timeout,
guessed from the client's 15s rather than read from the C++. That put a failure in front
of the page before its own clock ran, with a message matching nothing. The bridge now
waits the 80s Orca waits and fails in Orca's exact shape; the test moved into
`sswcp.js` as `isTimeout()` and keys on the code as well as both wordings.

Measured after, on a cold machine: **31.9s**, walking
`Homing — Z done → Homing axes… → Homing — X, Y done → Engaging toolhead 1…`, no refusal.

### "Connected" was a claim about the past

A rebooting printer went on showing as connected, its last snapshot presented as current.

```js
const live = state.lastUpdate > 0 && ...     // has anything EVER arrived
```

Nothing aged it, so once a session had existed the page vouched for it for the rest of
the session. The fix needed a number, and the number was surprising: **an idle U1 pushes
about twice in 30 seconds**, gaps of 4s to 14s. Klipper only sends fields that change and
an idle machine changes almost nothing - so a staleness window has to be several times
the idle gap or a quiet printer flickers as if it had gone away. 45s is about 3x the
widest gap seen, with the 30s heartbeat - now consulted rather than discarded - covering
a machine that genuinely has nothing to say.

It also needs a clock. Every other repaint in the page is triggered by something
arriving, which is exactly what stops.

Measured: socket killed under the page, nothing told it. Before, 115s stale and still
claiming connected. After, the dot drops and the panel fades in ~32s.

### One attempt, at boot, and only if nothing had ever arrived

Start the app before the printer and it stayed dark until a reload. Reboot the printer
and it never came back. Both are the ordinary way this hardware gets used.

There is now a supervisor on the same 2s clock: not live, not already connecting, and a
device that can authorise itself → reconnect, backing off 5s / 10s / 20s / 30s and
holding. The dead engine is dropped first, because it still holds a socket at the host
and the next connect makes a new one.

The **Connect** menu item was gated on `DeviceInfo.connected`, which is force-cleared on
every config save (`AppConfig.cpp:887`) - it answers neither "is it there" nor "do we
have a session". It is gated on live evidence now, and so is **Disconnect**.

Measured both ways:

```
socket killed          noticed 37.2s, reconnected 37.9s, 26 objects back
no printer at all      attempts at 11s, 31s, 61s, 91s - gaps 20s, 30s, 30s
  (--device-ip 192.0.2.1)
  "U1 G — not connected (connect pairing client: … No route to host) — trying again in 30s"
```

`--device-ip` points the saved device somewhere unroutable, which is how the
nothing-there path gets exercised without switching the printer off.

## Round five — the two cards, compared against the original side by side

With both surfaces running on the same printer, the rebuilt cards could be put beside
the originals and measured rather than judged.

**Camera.** The rebuild showed the not-connected illustration whenever the camera was
off, which answers "there is no printer" rather than "the camera is off", and offered a
text button the original has nothing like. It is a **black viewport** with one round
control inside it, and it says `Camera not on` - the bundle's own string, against the
invented "Camera is off". The bundle also carries `Camera start failed`,
`Camera started successfully` and `Camera loading failed. Please try again`, all of which
the rebuild had been wording for itself.

**Print.** The rebuild swapped in an illustration and "No active print" when idle. The
original keeps **one card and zeroes it**: status badge, machine name, thumbnail,
filename, percentage, layers, time, bar, one round button. An idle machine and a
printing one differ in the numbers, not the furniture. Layer counts come from
`print_stats.info`, which was already subscribed and unread. Klipper says `standby`; the
shipped page shows `idle`, so the badge does too, with the machine's own word on the
tooltip.

**Tabs.** Two findings, one of each kind:

- The `|` separator carried a 20px margin each side. Measured on the shipped page -
  title at 28, separator at 99, selected pill at 117 - it is **14 before and 13 after**,
  and the 20 was pushing the Camera tabs 13px right. Only the two headers that have a
  separator were affected; Control and Filament were already landing on 117.
- The selected pill is inset **at the top only**, so its white runs into the white body.
  Centring 36px inside a 40px header leaves 2px of grey underneath, and that is the
  whole difference between reading as a tab and reading as a loose button.

The 36px tabs and the 40px full-height refresh pills are *not* an inconsistency to fix:
they are different controls. Control has no separator because its refresh pill is a
button, not a tab.

**A dead end worth recording:** the residual title-width differences (Printing Task 8px
narrow, Filament 3px wide) are font metrics, so the bundle's own font was tried -
`HarmonyOS_Sans_SC_Regular.ttf`, which it ships. Every title came out *narrower*, Camera
by 11px. Whatever Flutter renders those titles with, it is not that face at 14px. The
system stack lands "Camera" on the measured 57px exactly, so it stays.

**Refresh did nothing.** Both header pills called `refresh()`, which re-reads Orca's
device book: two commands that say nothing about the machine. Clicking the shipped
page's own pill and watching what left it settles what they should do - and both of its
pills send the identical set:

```
sw_SubscribeMachineState / sw_SetSubscribeFilter / sw_GetMachineState
sw_GetMachineSystemInfo / sw_FileGetStatus / sw_exception_query / sw_MachineFilesRoots
```

A stranded docstring had been sitting above an unrelated function the whole time -
*"Re-read everything the page shows, as the header refresh buttons do"* - describing
something nobody had written.

## Round six — Storage, and four things found by using the page

Reported from ordinary use, each settled by measuring on the machine.

**The toolchange label named the axes done** - "Homing — Z done", then "Y done", then
"X, Y done". Klipper **clears** `homed_axes` as it re-homes, so Z was reported done and
then vanished from the list: the machine appeared to go backwards. And nobody waiting on
a toolhead wants an axis-by-axis account. One step now, `Homing axes…`, confirmed on a
cold change: `Waiting for toolhead 2… -> Homing axes… -> Engaging toolhead 2…`, 36.2s.

**Lists reset their own scroll.** The task panel repaints on every state push and each
repaint emptied the node and built it again, which threw away the scroll position - so a
list scrolled itself to the top while being read, and Load more landed you at the top of
the old page. Lists rebuild only when their content signature changes now, and the
scroll is carried across when they do. Measured: 420px held across six pushes and across
a Load more that took the list from 20 cards to 40.

**Opening a recording only offered to delete it** - the sheet said playback was Orca's
job and then showed a Delete button, which made "open" mean "destroy". The URL is on the
instance, and which port answers is not a guess:

```
http://<ip>:7125/server/files/camera/<name>.mp4   200 video/mp4  23 MB
http://<ip>/files/camera/<name>.mp4               200 text/html  2.9 KB   <- the SPA
```

The second is the same trap the camera frame hit. **But this WebKitGTK build has no
H.264**: `canPlayType('video/mp4')` is empty and playback fails
`MEDIA_ERR_SRC_NOT_SUPPORTED`. Whether the engine can play a file and whether the printer
serves it are different questions and get different answers - the sheet shows the still
and says which one it is. Orca's Windows and macOS webviews are not affected.

**Storage.** Time-lapses, finished prints, print files and logs were four shapes behind
three tabs on two panels. They are all "things on the machine you might want to look at",
so they are one destination, one picker, one card - normalised in `storageCard` rather
than four renderers kept in step by hand. `renderHistory` and `renderFiles` are gone.

Two things worth carrying forward from building it:

- The two views are **siblings in one document**, toggled with `hidden`. A separate page
  would drop the MQTT session and re-run the LAN key exchange on every switch.
- `#view-control` is `display: contents`, so the four panels stay direct children of the
  2×2 grid. **That defeats `hidden`**: the UA's `[hidden] { display: none }` loses to an
  id selector, so the control panels went on rendering underneath Storage and squeezed
  its grid to 4px. It has to opt back in explicitly.

Both grids collapsed to strips of thumbnail first, twice, for the same reason: grid rows
default to `auto` and shared the bounded panel height between them. `grid-auto-rows:
max-content`.

## Round seven — the page was blank in Orca, and the page was not the problem

Reported as "make sure the Device page is properly loaded in snorca". It was not. In the
app the Device tab drew the rail and **nothing else**: `.content` empty, no panels, no
error dialog. Every suite was green — 51 browser checks, 153 conformance, 144 unit — and
the same files served by any other HTTP server rendered correctly. This is the failure
mode `STATUS.md` warns about, in its purest form: **all the evidence said the page was
fine, and the page was fine.**

### What it looked like, measured rather than guessed

Loading the very same files **from Orca's own page server** in WebKitGTK:

```
readyState        "interactive"      (never reaches "complete")
window.__devicePage undefined        (app.js never evaluated)
.content children  0
console            silent
resources         48 started, 47 finished, 1 PENDING — forever
```

Served by anything else: 73 started, 73 finished, 0 pending, `complete`. The stall is one
resource per load, and the ES module graph has no partial success — one module that never
arrives is a page that never runs.

### The defect

`session::read_next_line()` in `src/slic3r/GUI/HttpServer.cpp` read a header line with
`async_read_until(socket, buff, '\r')` and then consumed the `\n` with a **second**
`getline`. asio reads in **512-byte chunks**, so a read can stop with a `\r` as its last
buffered byte. The `\n` is not there yet, the second `getline` consumes nothing, and every
line after it arrives carrying a leading `\n`. The end of the headers is recognised by
`line.length() == 0`, which then never matches — so the session asks for one more line
forever and the request is never answered. No error, no close, no log line: the server had
already printed `request for resource:` and simply never printed `Request received:`.

Counted in one run's server log: **810 request lines read, 785 answered.**

### Why it worked until 2026-08-25

The trigger is arithmetic, not chance. WebKit's header block for a same-origin module
fetch is constant, so a request's length is decided by its **URL** length, and the hang
needs a `\r` on **byte 512**. Of the 71 requests this page makes, exactly two do:

```
GET /web/device_page/js/views/device-control/filament/filament-panel.js   <- byte 512 is CR
GET /web/device_page/icons/printPreferenceArrow.svg                       <- byte 512 is CR
```

That module was `js/panels/filament.js` until `28fdd0feae` (*one panel, one directory*)
moved it to `js/views/device-control/filament/filament-panel.js`: **534 bytes on the wire
became 563**, and put a CR on the boundary. The restructure did not break the page; it
moved a file 29 characters to the right, and a latent server bug did the rest.

The proof is reproducible in either direction — sweep every place a request can be split
and count the ones that never answer:

```
before:  515 splits tested, 2 failures  (split 1, split 513)
after:   515 splits tested, 0 failures
```

### The fix, and a second bug found on the way

Header lines are read on **`'\n'`** now — the terminator that cannot be orphaned — and a
trailing `'\r'` is stripped from the line. One read, one line, and a blank line that is
actually empty.

The second one was found with a logging proxy in front of the server: WebKit was writing
requests into sockets the server **had already closed**. Every response is HTTP/1.1 with
no `Connection` header, which means *persistent* — while `session::read_next_line()`
writes the response and then calls `server.stop(self)`, which shuts the socket down. The
client pools a connection that is already gone. Every response says `Connection: close`
now, because that is what the server does.

Both are in `HttpServer.cpp` and neither is specific to this page: any client fetching
enough URLs from Orca's page server was exposed to both. The Flutter bundle survives it
because it is one large script rather than a graph of fifty modules — a lost request there
costs an icon.

### What it looks like now

The Device tab in Orca, on `811002511261022618B3` over the LAN: camera, control with five
live temperatures, printing task, and the multiACE card reporting **1 ACE unit**, head
mode, Toolhead 4 fed from ACE A with all four bays named (`A1`–`A4`, PETG — the override
store merged), 38 % RH at 31 °C. Five consecutive loads: `complete`, 0 pending.

**Two habits this pays for.** `run_webkit.py` serves the page from Python, so it could
never have seen this — the harness proves the page agrees with the printer, not that it
agrees with *Orca's own server*. Loading the page from `http://127.0.0.1:13619` and
asking for `readyState` plus the count of unfinished resources is now the cheapest check
that the app can render it at all, and it is worth running before believing a green suite.


## Round eight — an unreachable printer took the whole application down

Found while checking the panel after a drawing change: Orca would not start. The printer
was switched off, and that was the whole of it:

```
terminate called after throwing an instance of 'mqtt::exception'
  what():  MQTT error [-1]: TCP/TLS connect failure
```

**Paho reports a failed operation by throwing.** `token::wait_for()` calls `check_ret()`,
which throws `mqtt::exception` whenever the return code is not success, and
`async_client`'s own calls check the C return the same way. `MqttClient::Connect()` is
documented *"true if connection successful, false otherwise"* and had **no handler at
all** — so the throw went straight past it, out of the thread it was on, and into
`std::terminate`.

Nothing else needed to change. Both callers in `MoonRaker.cpp` — `ask_for_tls_info()` and
the MQTTS connect — already branch on the `false`; the contract was right and simply was
not kept.

**Three more methods had the same hole**, each with the same `bool` contract and each
waiting on a token that throws: `Subscribe`, `Unsubscribe`, `Publish`. `Disconnect` was
the only one guarded, which is why the fix reads as *one* guard applied five times rather
than five separate decisions — a file-local `mqtt_failed()` logs the operation, the server
and the message, and returns false. `Publish` is worth its own line: `CheckConnected()` is
a snapshot, not a lock, so the link can drop between that answer and the call, and
`publish()` then throws `MQTTASYNC_DISCONNECTED` on a client that was connected a
microsecond earlier. `CheckConnected()` itself calls `.get()` on a future that rethrows,
and now answers false instead.

**What it looks like now**, with the printer off and the app running:

```
[MQTT_INFO] connect failed: MQTT error [-1]: TCP/TLS connect failure,
            Server: mqtt://192.168.2.242:1884
```

and on the page, at the bottom of the Device tab:

```
U1 G — not connected (connect pairing client: sw_mqtt_connect failed (code -1):
connect failed: MQTT error [-1]: TCP/TLS connect failure) — trying again in 27s
```

That second line is the reconnect supervisor from round four doing exactly what it was
written to do. It could never do it before: the application died first, so the retry it
scheduled had nothing to run in.

**The lesson generalises past MQTT.** A function whose signature says it reports failure
by returning has to be *made* to, and a library that reports by throwing will not do it
for you. The four methods here all said `bool`, all documented "false otherwise", and
three of them could not deliver on it.


## Round nine — unload a head, and it offers to unload it again

Reported from ordinary use: *"the unload functionality of a toolhead with single filament
sort of works, but after I can unload again instead of load."*

**The panel was asking the job what the hardware knows.** `filaments()[i].loaded` is built
from `print_task_config` — `filament_exist[i]` and `filament_type[i]` — which is what the
**slicer assigned to that slot**. A physical unload does not clear it, so the head went on
reading as loaded and the verb list went on offering `Unload`.

Measured on the machine after the unload, and printed by
[`drive/ace-verbs-real.js`](../../../resources/web/shared/tests/drive/ace-verbs-real.js):

```
toolhead 1 is a stock feeder · sensor says empty · print_task_config says loaded  <- they disagree
```

**The head's own sensor answers the question actually being asked.** `filament_feed
left|right` → `extruder<n>.filament_at_extruder` is what is *in* the head; it is on the
subscription, and it is already what the marker on the artwork draws. It is now the
authority, with the job record as a fallback only where a printer reports no feed channel
at all.

**The same trap was one level down, and would have bitten next.** `aceVerbs()` computed
`empty = fed == null && !loaded`, where `fed` is `head_source[n]` — multiACE's record of
the last feed. It does not stop naming a bay because the filament came out, so an emptied
ACE head was never empty however the sensor answered, and offered `Swap` where `Load` was
the truth. `loaded` is the single authority now, and `fed` only says where it came from —
which is meaningful only while something is there.

**Three places were deciding it, and one had forgotten the feeder case.** The bay sheet,
the toolhead sheet and the card menu each computed `loaded` their own way. `headLoaded()`
decides it once; deciding it once is most of the fix.

**What it cost to find, and what it should have cost.** The simulator derived the sensor
*from* `filament_exist`, so the two could never disagree and no test could have caught
this. They are separate fields on the printer and they are separate in the simulator now —
which is what let the reported bug be reproduced in a drive script before it was fixed, and
asserted after.

**Two checks moved to the truer answer while this was done**, both in `drive/ace-panel.js`,
and it is worth noting that neither was wrong when written:

- *"clicking a bay names the macro it would send"* had been `ACE_SWAP_HEAD` (the panel sent
  it for everything), then `ACE_LOAD_HEAD` (because `head_source` was empty), and is now
  `ACE_SWAP_HEAD` again — because the head still physically holds what its stock feeder
  put there, and getting the ACE's filament in means taking that out first.
- *"an empty one offers Load"* emptied the head by setting `filament_exist`, which only
  worked because the panel was reading the wrong field. It sets the sensor now.

**The bug class, stated once more.** Every round of this has had one: `toolhead.extruder`
naming a parked head, `head_ace` naming a unit that is not attached, `DeviceInfo.connected`
answering about the past, `wait_insert` not meaning empty — and now `filament_exist`
answering about the job. *The field reads plausibly and answers a different question.*


## Round ten — three faults from one load

Reported from ordinary use, and all three are the same load:

```
Toolhead 1: load failed: sw_SendGCodes timed out after 15000ms
Printer fault · code 0000000000000240 · not in the shipped catalogue
```

### An activity code is not a fault code

`0000000000000240` is `0x240` = **576**, and 576 is `action_code` for **"Auto Loading"**.
The fault banner read

```js
const code = (exception && …) || activity.actionCode;
```

on the stated belief that *"`machine_state_manager.action_code` carries the active fault"*.
It does not: it is the **fine-grained activity** code, and `shared/js/activity.js` is
generated from the same bundle with its own table for it — 576 "Auto Loading", 640
"Unloading", 832 "Homing Calibration…". `lookupFault()` padded the integer into a 16-digit
code that could never match, and the banner said so in the most alarming way available.

activity.js's own header warns about exactly this: *"their case spaces overlap, so 1 is
'Working' in one and 'Homing' in the other. Merging them would be wrong wherever it is
ambiguous."* Decoding one against the other catalogue is that mistake one level up.
**A fault comes from `server.exception.query` and from nothing else.**

### A load homes first, and homing outlives the request

`sw_SendGCodes` does not return until Klipper has finished, and the bridge gives up at
15 s. A load **homes** — measured 14.7 s to `xy` and 31 s from cold — so the request
rejects while the printer is working, and the panel reported a failure for an operation
that was running.

The Control panel solved this in round four and the filament commands never adopted it:
don't await the request, treat `isTimeout()` as *not a refusal*, and confirm against
machine state. That is what they do now.

### So it blocks, and blocking is the point

A non-background swap is about **three minutes** during which the machine can do nothing
else. Offered the choice between a cancellable queue and a blocking dialog, a blocking
dialog is the honest one: a second verb started underneath the first is not a queue, it is
a collision, and there is nothing to cancel once the filament is moving.

`runFilamentAction()` is `runToolAction()`'s shape for this domain, with one improvement
the Control panel could not have: **it names the step rather than the operation.**
`action_code` says "Auto Loading"; `channel_state` says `unload_heating`, which the step
model turns into **Heat nozzle (3/6)** on the same six-step bar the card draws. It closes
on `*_finish`, reports `*_fail` verbatim, and gives up loudly rather than silently.

**A background verb does not block** — not blocking is its entire purpose.

### One ordering bug found on the way

The sheet's verb rows ran `runVerb(v)` and *then* `closeDialog()`, which closed the
blocking dialog `runVerb` had just opened. They close first now.


## Round eleven — the same bug, and the fix that only fixed the simulator

Round nine's report was *a toolhead unloaded, and then offered `Unload` again*. The cause
was that occupancy came from `print_task_config.filament_exist` — the slicer's assignment
to the slot, which no physical unload clears. The fix read `filament_at_extruder` instead,
on the stated ground that it *"is what is IN the head"*. Every suite went green.

**It was reported again**, from the same machine, doing the same thing.

### Measuring instead of reasoning

Toolhead 1 unloaded by hand a moment before, on `811002511261022618B3`, is the one head in
a row whose true state is known. Read alongside the other three:

```
head  channel_state   channel_action_state  detected inAce inTool atExt exist  TRUTH
0     unload_finish   unload_finish         T        T     T      T     T      empty
1     wait_insert     unload_finish         F        T     F      T     T      empty
2     wait_insert     none                  F        T     F      F     F      empty
3     wait_insert     none                  T        T     F      T     T      LOADED
```

Four fields read like presence and not one of them is:

| field | why not |
|---|---|
| `filament_in_ace` | true on all four, the empty one included — **a module is there**, not filament |
| `filament_at_extruder` | true on three, **two of them empty**; tracks the path having filament available, and does not go false when a head is emptied |
| `filament_in_toolhead` | **true on the head just emptied and false on the loaded one** |
| `channel_state` | `wait_insert` on an empty head *and* on a loaded one — already recorded in round eight, and the reason this needed a second look |

`channel_action_state` separates them, and it is the only one that does, because it is not
a sensor: it is **the last operation the channel finished**. `unload_finish` on both heads
that had been unloaded; `none` on the two untouched since boot.

So `headOccupied()` asks the sticky field, then the live one, then the topology — and that
order is by **what each field is for, not by which is fresher.** `channel_state` is the
more recent value and is also the one that decays to a word carrying no occupancy at all.

### What the simulator could not have caught

The simulator was green through both bugs, and it was not carelessly written — round nine
went to the trouble of *separating* the sensor from the job record so they could disagree,
which is exactly the right instinct. It still proved nothing, because the sensor it added
was computed from the same belief the panel held. **A simulator can only be wrong in the
ways it was written to be wrong.**

Two changes follow from that, and they matter more than the one-line fix:

- `mockhost.js` now reports `filament_at_extruder` **the way the machine does** — true on
  emptied heads included — so anything reading occupancy from it fails here as it failed
  there. Toolhead 4 is `wait_insert`/`none`/`at:true`, exactly as measured: **nothing in
  its feed channel says it is loaded**, only the topology does, and that fallback was
  never exercised before. The channels also sit on the left and right objects the way the
  machine splits them, rather than all four on the left.
- `drive/ace-verbs-real.js` now asserts **on the printer** that the three fields disagree
  and that the panel follows the right one. The class of bug is *"the page and the machine
  hold different beliefs"*, and only the machine can referee it.

### And it is asked in one place

This is the third field this question has been asked of and the second that was wrong.
Round nine's own note — *"three places decided this independently, and one had forgotten
the feeder case"* — is why the second wrong answer cost one line: `headOccupied()` lives
in `multiACE.js` beside the state table, `state.headLoaded(i)` is the convenience form,
and the panel's marker now reads it too. It had been drawing *"filament at the extruder"*
on a head the same card was offering `Load`.


## Round twelve — an ACE macro at a toolhead with no ACE

Reported while testing round eleven: `Load — Toolhead 2` opened the blocking dialog and
sat on **"Asking the printer…"**, and then, plainly: *doing an ace load is weird when no
ace is connected to that toolhead*.

It is, and the macro's own help says so. A stock feeder head was sending

```
ACE_LOAD_HEAD HEAD=1
```

with no `ACE=` and no `SLOT=`, and `printer.gcode.help` describes that macro as
**"[multiACE] Load a toolhead *from ACE*"**. There is no ACE behind head 1 — `head_feeder`
says so, and the panel had drawn it as a stock feeder all along. The command was accepted
and nothing happened, which is this machine's usual way of saying no: `ACE_SET_AUTO_DRY
THRESHOLD=` answers `ok` and changes nothing either.

### Read out of the printer's own config

`docs/u1-webui/tools/ace_macros.py` keeps 92 ACE macros of the **336** on the machine, and
the answer was in the other 244. Moonraker's HTTP API serves both the help and the parsed
config — and it needs no `clientId`, so it can be read **while someone else is driving the
printer**, which the MQTT path cannot:

```bash
curl -s "http://<ip>:7125/printer/gcode/help"
curl -s "http://<ip>:7125/printer/objects/query?configfile=settings"
```

`AUTO_FEEDING EXTRUDER=n` is the U1's own wrapper: it maps the extruder to a
`(module, channel)` pair through `_FILAMENT_FEED_VARIABLE` and calls `FEED_AUTO`. And the
**unload form did not have to be guessed** — the machine runs it at the end of every
print, in `SM_PRINT_END_AUTO_UNLOAD_FILAMENT`:

```
AUTO_FEEDING EXTRUDER={i} UNLOAD=1 STAGE=prepare
AUTO_FEEDING EXTRUDER={i} UNLOAD=1 STAGE=doing
```

`STAGE` is the same vocabulary `channel_state` reports back in — `unload_prepare`,
`unload_doing` — so the step bar follows a feeder verb without being taught anything.

**The load form is inferred, and it is the only thing on this page that is.** `LOAD=1`
comes from `SM_PRINT_AUTO_FEED` (`FEED_AUTO … LOAD=1 PRINTING=1`) and the two stages from
the unload above. Every other macro argument here was settled by sending it and reading
the object back; this one has not been.

The shipped Flutter bundle turns out to contain **no feeder load command at all** — no
`AUTO_FEEDING`, no `sw_` command for it. The stock feeder auto-feeds when filament is
inserted, which is what `wait_insert` has been saying all along.

### A silent dialog is a bug of its own

The verb doing nothing was one fault; the panel spending ninety seconds not saying so was
another. Three changes, and none of them depend on the macro being right:

- **The machine's own word, when neither table has a name for the state.** A dialog
  reading `Printer says: wait_insert` says which state nothing is moving in. "Asking the
  printer…" says only that the panel has stopped talking.
- **Twenty-five seconds to start, not ninety.** A load homes first and homing is the slow
  part — but homing is *reported*: `action_code` reaches 832 within a second or two. So
  nothing busy and nothing on the channel after 25 s means nothing started, and the
  failure names both the channel state and what `sw_SendGCodes` actually replied. An `ok`
  is reported rather than trusted.
- **`EXTRUDER=` is a toolhead too.** `runVerb` read `v.args.HEAD` only, so the first verb
  addressed in the U1's vocabulary went out with no head at all: an untitled dialog with
  no channel to follow. That is exactly what a bare `Load` with a permanent "Asking the
  printer…" was.


## Round thirteen — the panel was talking to itself

An audit of every user-facing string in the Device page, and three faults found by reading
the screen rather than the code.

### Ten pieces of copy that were about the page, not the printer

| where | was | now |
|---|---|---|
| the no-start dialog | `Nothing started. The printer is wait_insert and answered {"result":"ok"}. Nothing was sent twice.` | `Nothing started. The toolhead is waiting for filament.` |
| the quiet dialog | `…it may have finished; **the panel will catch up**.` | `…It may have finished.` |
| the verb guard | `Load: not a verb this panel sends` | `Load is not available` |
| the head marker | `channel_action_state: load_finish` | `Filament loaded` |
| the step bar | `channel_state load_flushing — step 6 of 6` | `Step 6 of 6` |
| a failed step | `unload_fail` | `Unload failed` |
| the edit row | `print_task_config` | *(nothing, or `Read only — the spool carries its own record`)* |
| the job status | `print_stats.state: printing` | *(the state, in words)* |
| the humidity drop | `43 % RH — hum_level2` | `43 % RH` |
| the fault banner | `not in the shipped catalogue` | `unrecognised` |

Plus four that were reasoning rather than state: `Hand-fed — no ACE feed, retract, assist
or RFID`, `Its verbs are in the card menu.`, `Click for what can be done to it.`, and
`Printer says: wait_insert` — which was added the same afternoon, and is the same mistake
in a newer coat.

`channelWord()` is the fix that makes the rest possible: a word table for `channel_state`,
exactly as `shared/js/activity.js` is one for `action_code`. **A caller with no word for a
state says nothing** rather than falling back to the enum.

### A macro name is an implementation detail after all

The rule in CLAUDE.md said a macro name was fine, *because it says what will be sent*. That
held while a macro appeared beside one refused control. It stopped holding once every verb
on the toolhead sheet carried one under its name: a dialog for moving filament read as a
G-code console, and a muted row saying `ACE_BG_SET_HEAD` explained a refusal in a language
the reader has to already know. The gate button was the macro line itself.

So the toolhead's verbs are names, the refusals are reasons, and the gate says **Enable
for this toolhead**. The wire has not gone anywhere — the trace pane carries every packet,
and `drive/ace-verbs.js` now asserts what was sent by reading `printer.gcodeLog`, which is
a better check than reading it off the screen ever was.

### A swap is not something you do to a spool

Offered on a bay, `Swap` reads as an operation on the filament — *swap this one*. What it
does is move a **toolhead** from one bay to another, and `ACE_SWAP_HEAD HEAD=n` says which
end it addresses. The bay sheet now says what is in the bay and what state the head is in;
the toolhead's sheet brings every bay to it labelled with what each would do, which is the
same choice made where the target is named. **Load stays on the bay** — there the bay is
the whole argument and there is no other end to it.

### The mark disagreed with the click

`View this filament` sat beside the edit **pencil**, and every slot on the four-slot form
wore the pencil whether its spool carried a tag or not. A tagged spool opens read-only —
that is the whole reason the row says *View* — so it wears the **eye**, the same pair the
bay marks have carried all along. The eye branch had never been exercised: the simulator
ships four untagged spools, so the check that covers it now sets `filament_detect.info`
first.


## Round fourteen — the printer answered in one second and the page waited twenty-five

Reported with a screenshot: `Swap A4 → Toolhead 4` sat, then

> Nothing started. The toolhead is waiting for filament.

That message is true and useless. The printer had answered almost immediately, and
**Moonraker's console history had the answer all along**:

```
[com] ACE_SWAP_HEAD HEAD=3 ACE=0 SLOT=3
[res] [multiACE] === Mid-print swap: HEAD 4 -> ACE 1 / Slot 4 (temp=270) ===
[res] // multiace_event swap_imminent head=3 ace=0 slot=3 from_ace=0 from_slot=2 seq=1
[res] // park extruder1 !!!
[res] // pick extruder3 !!!
[res] // multiace_event swap_failed head=3 ace=0 slot=3 status=error seq=2
[res] !! Must home Z axis first: 229.300 250.000 277.000 [0.000]
```

`toolhead.homed_axes` was `"xy"`. **`ACE_SWAP_HEAD` parks and picks a head and does not
home first** — it is written for mid-print swaps, where the machine already is homed. The
U1's own feeder verbs home themselves, which is why round ten went looking for a homing
allowance and found the opposite problem here.

### Three sources, and the page was reading none of them

| source | said | the page |
|---|---|---|
| the `sw_SendGCodes` reply | `ok` | awaited it, then ignored it — correctly, since **an `ok` is not a yes** here |
| `ace.last_swap_result` | `{head:3, ace:0, slot:1, status:"error", ts:9893.3}` | **parsed since round eight and never read** |
| Klipper's `!!` channel | `Must home Z axis first` | not reachable, it was assumed |

The second was the embarrassing one: `swapping`, `swapPhase` and `lastSwap` have been in
`parseAce()` the whole time, listed in the handover as *"still unread — no value for them
has ever been captured"*. A value was captured the moment something went wrong.

So the wait now watches `last_swap_result` against the one that was there when it started,
and multiACE's own verdict ends it **in a second rather than in twenty-five**.

### And the reason comes from the printer, not from a guess

`GET /server/gcode_store` on Moonraker's HTTP port carries the console, and Moonraker
reflects the Origin there exactly as it does for the override store this page already
reads — checked: `Access-Control-Allow-Origin: http://127.0.0.1:13619`. So a failed verb
reports **the printer's own sentence**:

> The printer stopped: Must home Z axis first: 229.300 250.000 277.000 [0.000]

`lastPrinterError()` takes the last `!!` line and nothing else: `//` is Klipper's *note*
channel, and `// multiace_event swap_failed status=error` reads like an error while being
one of those. An unreachable Moonraker returns null and the panel falls back rather than
reporting the fetch as the fault.

**No Home button in that dialog.** Homing is the Control panel's, a panel is handed its
own commands and nothing else, and the remedy is a control already on screen in the same
view. Guessing which verbs need a homed Z would also have been guessing — the unload in
the same console ran fine on `"xy"`.

> **Round fifteen overtook this.** No verb on this panel needs a homed Z. The unload ran
> fine because it does not move Z, and neither does the load; only `ACE_SWAP_HEAD` does,
> and the panel does not send it any more. The error-reading built here stays, because a
> macro that declines still answers `ok`.

### The rest of the macro lines

Round thirteen stopped at the toolhead actions and left the dryer and the settings menus
showing G-code. They do not now. The dryer's preview used to print

```
ACE_DRY ACE=0 TEMP=45 DURATION=240  ·  ACE_SET_AUTO_DRY ACE=0 ENABLE=0
```

and says **"Dries at 45 °C for 4 h, and not automatically."** The macro line was honest
while the numbers and the wire disagreed — the dialog offers HOURS and `ACE_DRY` takes
MINUTES, and one offering 4 would have dried for four minutes. That is a reason to get the
conversion right, which it is, and not a reason to make the reader check the arithmetic in
G-code. **Both of those facts are still asserted** — moved from the preview text onto
`printer.gcodeLog`, which is where they were always really about.


## Round fifteen — the swap that wanted a homed Z was the print's swap

Reported: *the Device page, on swap, tells me to home Z first — odd, since a normal
load/unload without ACE does not need it, and HelixScreen can swap too.*

Both halves of that were right, and together they were the answer. **The requirement was
never a property of swapping. It was a property of `ACE_SWAP_HEAD`**, which is the macro
a *print* uses, and the Device page was the only UI on this machine sending it from a
button.

### Read out of the plugin, not inferred from the failure

Round fourteen had the symptom and stopped at it:

```
[com] ACE_SWAP_HEAD HEAD=3 ACE=0 SLOT=3
[res] // park extruder1 !!!
[res] // pick extruder3 !!!
[res] !! Must home Z axis first: 229.300 250.000 277.000 [0.000]
```

The park and the pick are XY and they succeeded. What failed is four lines into
`cmd_ACE_SWAP_HEAD` in multiACE's `klipper/extras/ace.py`:

```python
self.gcode.run_script_from_command('G91')
self.gcode.run_script_from_command('G1 Z2 F600')
self.gcode.run_script_from_command('G90')
self.toolhead.wait_moves()
```

A 2 mm lift off the part before the unload — right for a mid-print swap, meaningless on an
idle machine, and refused outright by Klipper when Z is not homed.

| macro | Z motion | needs a homed Z |
|---|---|---|
| `ACE_SWAP_HEAD` | `G91 / G1 Z2 F600 / G90` | **yes** |
| `ACE_LOAD_HEAD` | none | no |
| `ACE_UNLOAD_HEAD` | none | no |
| `ACE_BG_SWAP`, `ACE_BG_UNLOAD` | none in `ace_bg_swap.py` | no |

So *"an unload ran fine on `"xy"` in the same console"* — round fourteen's reason for not
gating anything — was not luck. It is the whole rule, and reading the source rather than
the console is what turned one measurement into it.

**multiACE guards this exact hop everywhere else it can run idle.** `_discard_wipe()` and
`_bg_pick_flow_check()` both open with a `homed_axes` check and bail with *axes not
homed - skipped*. `cmd_ACE_SWAP_HEAD` is the one place the same three lines are unguarded,
because a print is homed by definition.

### The two neighbours had both already answered it

Neither other UI that drives this plugin sends `ACE_SWAP_HEAD` for a swap someone asked
for:

| | what it sends | in its own words |
|---|---|---|
| **multiACE's own dashboard** — `web/frontend/app.js`, `loadSlot` | `ACE_UNLOAD_HEAD HEAD=h` then `ACE_LOAD_HEAD HEAD=h ACE=a SLOT=s` | *"The print's OWN swaps (`ACE_SWAP_HEAD` from the gcode file) … do not go through these buttons"* |
| **HelixScreen** — `AmsBackendMultiAce::do_load_filament` | the same pair | *"the single-command `ACE_SWAP_HEAD` this backend does not use"* |

The unload cannot be folded into the load, and that is why it is two commands rather than
one: `ACE_LOAD_HEAD`'s own guard *refuses* a head that already holds filament rather than
swapping for it.

### What the panel does now

`aceVerbs()`'s Swap carries **two lines**, and `sw_SendGCodes` already took a
newline-separated script — the feeder verb has sent two since round twelve. `withCmd()`
generalised from *one macro, optionally repeated with a `STAGE`* to *a list of steps*, and
each verb now also carries `macros`, every name it would put on the wire, because
`VERB_MACROS` is a gate on what is sent and checking one of two is not a gate.

Nothing on screen moved: the DOM walker's dump is byte-identical either side of the change
apart from the trace pane's own rolling log.

`ACE_SWAP_HEAD` is `NOT BUILT` in `check_coverage.py` with the reason written down, which
is the point of that table — the next person to notice that the macro taking a slot is not
being used will find out why before sending it.

### The same question about `ACE_BG_SWAP`, asked and answered

Reasonable next thought: if Swap is now two commands, should Background swap be
`ACE_BG_UNLOAD` + a background load? **No, twice over.**

- **There is no `ACE_BG_LOAD`.** The whole family the machine registers is five:
  `ACE_BG_SWAP`, `ACE_BG_UNLOAD`, `ACE_BG_SET_HEAD`, `ACE_BG_MOVE`, `ACE_BG_STATUS`
  (`ace_bg_swap.py`, lines 90-99, and `data/ace-macros.json` says the same). The load half
  exists only *inside* `ACE_BG_SWAP` — its help spells the sequence out: *"unload (if
  loaded), then feed+grip+prime the target slot through the OPEN dock"*. There is nothing
  to decompose it into.
- **The reason `ACE_SWAP_HEAD` had to go does not apply.** It was never "a swap should be
  two commands"; it was one specific thing, that macro moving Z. `ace_bg_swap.py` contains
  **no motion G-code whatsoever** — grepped for `G0`/`G1`/`G28`/`G91`/`G90`/`MOVE_TO`, zero
  hits, and its single `run_script_from_command` is a `SAVE_VARIABLE` persisting the
  enabled-heads list. It moves filament by appending to a **private trapq** on the parked
  head's extruder stepper (`stepper.set_trapq` / `trapq_append`), which is what "background"
  means here: it bypasses the toolhead's motion queue entirely, so it never reaches the
  kinematics that raise `Must home Z axis first`.

And its refusals are nothing like `ACE_SWAP_HEAD`'s silent `ok`: it raises on a head that
is not bg-enabled, not ACE-driven, not in head mode, already busy, already loaded from that
slot, or **is the active toolhead** — *"bg swaps are for parked heads"*. `ACE_BG_SWAP`
stays exactly as it is.

### What went with it

The mid-print machinery, all of which the pair does without: the Z hop, the XYZ/E position
restore, `_pause_for_recovery`, `last_swap_result`, and **`KEEP_HEAT` between the halves** —
so the nozzle cools and reheats where a print-time swap holds it. Neither neighbour passes
a temperature either, and picking one here would be inventing a number.

`last_swap_result` is still watched by the blocking dialog, and only `ACE_SWAP_HEAD` writes
it: what the watch now catches is the **print's** swap failing underneath a verb someone
started, which dooms that verb too. Round fourteen's console read stays for the same reason
it was built — a macro that declines still answers `ok`, and Klipper's `!!` channel is the
only place the reason exists.

### Checked

`unit_jsc.py` asserts the pair, its order, and that a load on an empty head is still one
line — pure logic, no DOM. `drive/ace-verbs.js` asserts it **on the wire**, off
`printer.gcodeLog`, because the panel puts no macro name on screen. `drive/ace-verbs-real.js`
had gone stale against round thirteen's copy pass — it was reading `.verb-cmd` off rows
that no longer carry one — and now reads the model and prints the machine's live
`homed_axes` beside it, which is the state the swap used to care about.

```
171/171  unit_jsc.py            61/61  run_webkit --size 1920x1080
 47/47  drive/ace-verbs.js      54/54  run_webkit (single column)
 75/75  drive/ace-panel.js     153/153 conformance_test.py
  8/8   drive/no-printer.js      0 unaccounted  check_coverage.py
```

**Still unrun on hardware**: a swap sent as the pair, watched. The macros are the ones the
machine has and the two neighbours send, but this page has not put them out over a real
ACE — and the handover has said since round fourteen that one real swap is a person's
decision, not a suite's.


## Round sixteen — the eye and the pencil were asking the wrong question

Reported: *the view and edit buttons are switched. Some filaments are read by RFID and
should not be changeable — they even read "From the spool tag" in the popup.*

Both halves were true, and they were the same bug seen from two sides.

### The sheet was always a form

`editSlot()` drew three editable inputs and a **Confirm** for every slot, tagged or not.
Around it, four separate pieces of copy promised the opposite on a tagged one: the mark
was an **eye**, the menu row read **View this filament**, its hover read *"Read only — the
spool carries its own record"*, and the sheet headed a block **From the spool tag**. Every
word said reading; every button said form.

### And "has a tag" is not the question

The panel decided read-only from `f.tag` — `filament_detect.info[i].MAIN_TYPE !== "NONE"`.
The machine answers a different and better question itself, in two fields that have been
on the subscription since the beginning and were never read:

| | |
|---|---|
| `print_task_config.filament_official[i]` | is the identity in use the spool's own record |
| `print_task_config.filament_edit[i]` | **may this slot be edited** |

Read off 811002511261022618B3 on 2026-08-28, over Moonraker's HTTP port:

```
head                 0          1          2          3
filament_vendor    Jayo    Forshape      NONE    Kingroon
filament_type       PLA        PLA       NONE       PETG
filament_sub_type Marble         ""      NONE      Basic
filament_exist     true       true      false       true
filament_official  true      FALSE      false      false
filament_edit     false       TRUE      false       TRUE
```

and `filament_detect`:

```
0  Jayo PLA Marble   OFFICIAL true  CARD_UID 04 7B F3 AD 7D 26 81  NTAG  tigertag
1  Forshape PLA Silk OFFICIAL true  CARD_UID 04 2C EE AE 7D 26 81  NTAG  tigertag
2  —                 3  —
```

**Head 2 is the case that settles it.** It carries a decodable physical tag and the machine
still says `filament_edit: true`, because the record in use has been overridden — the
sub-type in `print_task_config` is `""` where the tag says `Silk`. The tag rule marked it
read-only; the machine was happy to have it edited. So the mark was wrong in one direction
and the sheet in the other, on the same slot.

The rule the machine states, on this sample: **editable ⟺ loaded and not official.** The
page does not re-derive that. It reads `filament_edit`, because that is the field the
shipped UI branches on too — its editor is `FilamentUnofficialWidget` and there is no
official counterpart in the bundle.

> **Round eighteen qualified this.** Reading the permission was right; *following it
> alone* was not. `filament_edit` is a **latch** — a write clears `filament_official`, so
> one edit unlocks a tagged spool for good. The page requires the permission **and** the
> absence of a tag.

### What changed

- `filaments()` gained `official` and `editable`. `editable` is the machine's bit; the
  fallback for a firmware that does not report it is the old tag rule, named as a fallback
  rather than left as the rule.
- The mark, the menu row's label, its hover and **what the click opens** are now one
  decision. Read-only means no inputs at all and a single **Close** — not disabled fields,
  because there is nothing to type.
- The **RFID badge keeps its own question.** A chip on the spool is a fact about the spool;
  whether the record may be edited is a fact about the slot. Head 2 wears the badge and
  takes the pencil, and that is not a contradiction.
- The read-only sheet shows **the record in use** above **what the spool claims** — two
  readings, because on head 2 they differ.

### This machine is running the Extended Firmware

`filament_detect` here carries `CARD_TYPE` and `TAG_FORMAT: "tigertag"`, and **neither
string exists anywhere in the shipped Flutter bundle** — they are
[SnapmakerU1-Extended-Firmware](../../../../SnapmakerU1-Extended-Firmware/docs/design/filament_detect.md)
additions. That firmware also exposes `POST /printer/filament_detect/set`, which writes the
**tag record itself** (`VENDOR`, `MAIN_TYPE`, `SUB_TYPE`, `RGB_1`, `ALPHA`,
`HOTEND_MIN_TEMP`, `HOTEND_MAX_TEMP`, `BED_TEMP`, `CARD_UID`, `SKU`) and mirrors a full
update into `print_task_config`. HelixScreen already uses it — `AmsBackendSnapmaker::
set_slot_info` POSTs there. **Not adopted here**: it would make an official head editable,
which is a decision about what this panel is for rather than a bug in it.

### The ACE side is a different subsystem and did not move

Measured in the same session: every ACE bay reads `rfid: 0`, `head_tag_seen` is `{}`, and
all four bays are named in multiACE's override store (`0_0`…`0_3`, Kingroon/Generic PETG
Basic). So on this machine **no bay is ever read-only** — `PROV.rfid` is unreachable for a
bay — and every bay is `override`, wearing the pencil.

**So every bay wears the eye now.** The pencil was a promise the panel cannot keep:
**naming a bay from the panel is not built** (tier 2b — `ACE_SPOOL_ASSIGN`, since
multiACE's own `POST /api/slot-override` is behind the missing CORS header), and three of
the four bays wore one over nothing. The PROV *word* is unchanged, because multiACE's
`rfid → override → derived` is the thing worth knowing about a bay; only the glyph stopped
varying with it. When 2b lands, `override`, `derived` and `unknown` get the pencil back and
`rfid` never does.

And editing an **ACE-fed head** in Materials Setting is a trap worth knowing about: it
writes `print_task_config`, and the next `ACE_LOAD_HEAD` re-pushes the bay's identity over
it via `SET_PRINT_FILAMENT_CONFIG`. The bay is where that edit belongs — which is the other
reason not to imply the head's form is the way to name one.

### Decided, not defaulted

Three forks were put to the reporter rather than guessed:

| | |
|---|---|
| A filament the machine calls its own | **stays read-only.** Matches the shipped UI, which has no editor for official filament. `POST /printer/filament_detect/set` is reachable on this machine and was **not** adopted — writing the spool's own record is a different product decision |
| What the form may input | **type, vendor, colour** — the three `UpdateMachineFilamentInfo` is measured to accept. `filament_sub_type` is carried by the machine and shown by the panel, and is **not** writable from here: whether that key round-trips has never been measured |
| Naming an ACE bay | **not from this panel yet.** Hence the eye above |

### Checked

`unit_jsc.py` holds the model to the measured payload — that both tagged heads read a tag,
that only one is official, that the permission is the printer's, that the overridden
tagged head is editable, and that an absent `filament_edit` does not read as "edit
anything". `drive/ace-panel.js` reaches both states with the **tag held constant**, so the
only thing varying is the thing under test, and asserts the sheet each one opens.

```
177/177  unit_jsc.py            78/78  drive/ace-panel.js      61/61  run_webkit 1920
 47/47  drive/ace-verbs.js      54/54  run_webkit (1 column)  153/153 conformance_test.py
```


## Round seventeen — the tag stopped showing, and the card stopped repainting

Reported, straight after round sixteen: *the Forshape PLA is also an RFID tag, but that
does not show.*

Correct, and it had never shown on this machine. Two separate defects behind it.

### The RFID badge lives in a shape this printer never draws

The green `RFID` word is `renderSlots()`'s, in the **four-slot form** — the shape a printer
with no `ace` object gets. Measured by rendering the reported payload and walking the DOM:

```
the panel drew 4 toolhead cards (ace.present = true)
shape per card: T1=feeder T2=feeder T3=feeder T4=cabinet
the four-slot form is drawn: false   <- where the green RFID word lives
```

Heads 1–3 are on their **stock feeder** (`head_feeder {0,1,2 true}`) and are drawn as a
feeder box inside a card. That box has only ever carried the provenance mark. So a tagged
feeder spool on an ACE-equipped printer had no tag drawn anywhere.

It was *masked* until round sixteen: the eye was driven by `f.tag`, so a tagged head got
one for free. Pointing the eye at the machine's `filament_edit` is right and measured — and
on a head whose tagged record has been overridden it leaves a pencil and nothing at all
saying a tag is there. Exactly the head that motivated round sixteen.

**Two marks, two questions, mirrored about the same roll.** `.ace-tag` is the contactless
arcs in `#16A34A` — the colour `.slot .slot-tag` already uses for this fact — absolute like
`.ace-prov` so a spool with a tag and one without occupy the same box. A bay is 62 px and
its chip is already an ellipsis away from truncating a material name; nothing there may
move when a tag appears. Asserted: mirrored to 0.5 px, same height, no overlap, and the
body still 456.

```
marks per card (edit-mark/tag-mark): T1=eye/tag  T2=pencil/tag  T3=pencil/-  T4=eye/-
```

An ACE **bay** gets the same mark from multiACE's own `source: "rfid"`. No bay on this
machine has one (`rfid: 0` on every raw slot), so that arm is drawn from the model rather
than from a sighting.

### And the card would not have repainted for it anyway

The check failed first for a better reason than the missing mark: `cardSig()` — the
signature `keyedList` reconciles on — carried `[material, subType, vendor, color]` and
**neither the tag nor the edit permission**. Neither of those moves any of the four, so:

- a tag arriving repaints nothing. The reader is asynchronous; it lands seconds after the
  filament does.
- the machine flipping a slot between its own record and an overridden one repaints
  nothing either — so round sixteen's eye/pencil would have been correct only from the
  first paint.

The card kept whatever pair it was built with. This is the failure mode the panel has hit
before, in this same function, and the comment above `channel_state` in it says so: *a card
whose signature omits something it draws simply never repaints for it.* Two more fields
are in it now.

What caught it: a check that applied a tag to an **already-drawn** panel and found the
menu had it (rebuilt on every click) while the card did not. A check that set the state up
front and then looked would have passed on a broken panel.

```
177/177 unit_jsc.py     87/87 drive/ace-panel.js    61/61 run_webkit 1920
 47/47 drive/ace-verbs  54/54 run_webkit 1-column  153/153 conformance   8/8 no-printer
```


## Round eighteen — the permission was real, and it was a latch

Reported against the real machine: *the Forshape PLA has an RFID icon and is still
editable, which it should not be.*

Round sixteen read `print_task_config.filament_edit` and followed it. The field means what
its name says — that much was verified, not assumed, and the verification is worth keeping
because it also found the thing that was wrong.

### What the field actually is

Not a guess from a name and a four-point correlation this time. The U1's own
`print_task_config.py`, as carried in the Extended Firmware's `13-patch-rfid` overlay:

```python
allowed_edit = False
if self.print_task_config['filament_exist'][ch]:
    if self.print_task_config['filament_official'][ch] == False:
        allowed_edit = True
tmp_filament_edit[ch] = allowed_edit
```

and the other half of the same gate, enforced in `SET_PRINT_FILAMENT_CONFIG`:

```python
if tmp_print_task_config['filament_official'][config_extruder] and bool(force) == False:
    raise gcmd.error("[print_task_config] filament_config, official filament, not configurable!")
```

So `filament_edit` **is** `allowed_edit`, and the refusal behind it is real rather than
advisory. Reading it was correct.

### And why following it alone was not

Eleven lines further down the same function:

```python
tmp_print_task_config['filament_official'][config_extruder] = False
```

**Every write clears `official`.** So the permission is a *latch*, not a statement about
the spool: edit a tagged slot once and `filament_edit` stays `true` until the tag is read
again — which happens on the next load. Head 2 has been sitting in that state, which is
why it reads `official: false, edit: true` with an NTAG physically present and
`filament_sub_type` `""` where the tag says `Silk`.

Following the latch means offering to type over a spool whose record will revert on its
next load, and drift further from the tag every time someone does.

### The rule

**The page requires the machine's permission AND the absence of a tag.** Stricter than the
permission, never looser — `allowedEdit` is still required, so an official slot and an
empty one stay closed for the machine's own reason, and the panel never offers an edit
`SET_PRINT_FILAMENT_CONFIG` would refuse.

| head | tag | `allowedEdit` | panel |
|---|---|---|---|
| 1 Jayo | yes | false — the machine's own record | **reads** |
| 2 Forshape | yes | **true** — latch left open by an old write | **reads** |
| 3 empty | — | false | nothing to edit |
| 4 Kingroon (ACE-fed) | no | true | **edits** |

`filaments()` carries both: `allowedEdit` is the machine's, verbatim; `editable` is this
page's, and the comment on it says which is which. Splitting them is the point — a single
field would have hidden that the panel is making a choice the machine did not.

### What that leaves the tag mark doing

Both tagged heads read now, for two different reasons, and the marks say which: the eye is
the refusal, the tag mark is *why this one* — the spool's own record, rather than the
machine having nothing to edit. On an untagged head the eye can only mean the latter.

```
marks per card (edit-mark/tag-mark): T1=eye/tag  T2=eye/tag  T3=pencil/-  T4=eye/-
```

```
180/180 unit_jsc.py    89/89 drive/ace-panel.js   61/61 + 54/54 layout
153/153 conformance    47/47 drive/ace-verbs       8/8 no-printer
```

### Worth keeping

The three rounds ran: mark → machine's field → machine's field, qualified. The middle step
was not wasted — it is what produced the `official`/`edit` reading and the read-only sheet,
and both survive. What it got wrong was treating a permission as a description. **A gate
that a write can open is not a fact about the thing behind it**, and this page had no way
to notice that from the four values it had measured. The firmware source did.


## Round nineteen — the mode switch blacked the spools, and the machine meant to

Reported: *switching between ACE modes on `--real` switches filaments, blacks them.*

Both halves are real, and only one of them is a bug here.

### The machine wipes the feeder heads on purpose

`SET_ACE_MODE` calls `ACE_RUN_MODE_SWITCH`, and entering **head** mode runs, for every
head on its stock feeder:

```python
for h in range(4):
    if self.head_is_feeder(h) and not self.head_is_manual(h):
        self._clear_filament_display(h)
```

which is

```
SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER=n FILAMENT_TYPE="" \
    FILAMENT_COLOR_RGBA=00000000 VENDOR="" FILAMENT_SUBTYPE=""
```

So the identities really do go away — that is multiACE's decision, not the panel's, and
the filament stays physically in the head while it happens. (It also clears
`filament_official`, since every `SET_PRINT_FILAMENT_CONFIG` write does; round eighteen.)

**"Switches filaments" is also partly real**: the mode decides `head_feeder`, so which
card is a cabinet and which is a feeder box genuinely changes.

### The blacking was ours, in one line

`00000000` is **RRGGBBAA with alpha 00** — the machine saying *no colour*. `cssColor` threw
the alpha away:

```js
if (/^[0-9a-f]{8}$/i.test(t) || /^[0-9a-f]{6}$/i.test(t)) return '#' + t.slice(0, 6)…
```

so it came back `#000000` and got painted — on the spool disc **and** on the tube, which
takes its core colour from the same value. Four black spools.

The alpha is read now, in both forms, and only alpha **zero** is an absence: opaque black
is `000000FF` / `0xFF000000` and still returns `#000000`, because black filament is the
commonest there is. A six-digit value has no alpha to read and is taken as written.

### And then it would have gone wrong the other way

With the colour correctly absent, `feeder()` fell through to the checkerboard — which is
this page's word for **empty**, and the filament is still in the head. That box had only
two states where a **bay** has always had three:

| | disc | chip |
|---|---|---|
| named | its colour | the material |
| occupied, not named | `#B7BDC6` | `?` |
| empty | checkerboard | `/` |

It has the same three now, drawn with the same two values a bay uses. `card()` asks
`headLoaded()` once and hands the answer to both the box and the toolhead marker — the
occupancy question cannot be answered from the identity that was just wiped, which is the
whole reason this state exists.

Same shape as round seventeen: a guard the four-slot form has (`if (f.loaded)` before
painting the dot) that the ACE card's box never had.

### The simulator could not show this state

`filament_vendor`, `filament_type` and `filament_color_rgba` were three hard-coded literals
in `snapshot()`, so no drive script could put a head in the wiped state at all. They are
`printer` state now, with `clearFilamentDisplay(head)` doing exactly what multiACE does,
and `filament_color` is **derived** from the rgba rather than being a second literal —
which is a stronger guarantee than two literals agreeing, because they cannot drift.
`conformance_test.py` still holds the shape: bare `RRGGBBAA` with no `#`, and an ARGB
integer with the alpha in the top byte.

### Checked

`unit_jsc.py` holds `cssColor` to the alpha rule in both forms, including that opaque and
partly-transparent colours survive. `drive/ace-panel.js` wipes a feeder head the way the
machine does and asserts the drawing is neither black nor empty, that the card **repaints
at all** (which needs the colour in `cardSig`), and that it comes back when the machine
names it again. It finds the feeder head rather than assuming one — an earlier block in
that script switches Toolhead 1 onto ACE A.

```
185/185 unit_jsc.py   153/153 conformance   97/97 drive/ace-panel.js
 61/61 + 54/54 layout  47/47 drive/ace-verbs  8/8 no-printer   0 unaccounted
```

### It was still wrong, and the identity was never gone

Round nineteen drew the wipe honestly and stopped there. The reporter cycled
normal → multi → head and sent a screenshot: two toolheads that had shown their filament
were a grey `?` and a checkerboard. *"The issue is not mitigated yet."*

Right, because **`_clear_filament_display` wipes `print_task_config` and does not touch
`filament_detect`**. Read off the machine in that exact state:

```
head 0: ptc vendor='' type='' rgba='00000000' exist=True | TAG Jayo PLA Marble    OFFICIAL
head 1: ptc vendor='' type='' rgba='00000000' exist=True | TAG Forshape PLA Silk  OFFICIAL
head 2: ptc vendor='' type='' rgba='00000000' exist=False| TAG none
head 3: ptc Kingroon PETG Basic               exist=True | TAG none
```

The identity was sitting in the other object the whole time. So `filaments()` falls back to
the spool's own record when the working copy has none — which is **multiACE's own
precedence one level up** (`rfid → override → derived`), applied where it had not been. The
tag is only a fallback, so a record someone set deliberately still wins while it exists,
and `fromTag` says which was used.

`loaded` went with it: it read `!!type`, so a head the wipe had blanked reported itself
unloaded even with `filament_exist: true`. Whether a slot HAS filament and whether anything
NAMES it are two questions, and only the first is `filament_exist`'s.

**Run against the machine, not reasoned about.** `--real`, read-only, nothing sent:

```
head 0: type="PLA" vendor="Jayo"     fromTag=true  loaded=true tag=true editable=false
head 1: type="PLA" vendor="Forshape" fromTag=true  loaded=true tag=true editable=false
head 2: type=null                    fromTag=false loaded=false
head 3: type="PETG" vendor="Kingroon" fromTag=false loaded=true editable=true
T1: feeder chips=[PLA] disc=rgb(244,67,54)   prov=eye tagmark=yes  "Stock feeder: PLA · Jayo"
T2: feeder chips=[PLA] disc=rgb(255,255,220) prov=eye tagmark=yes  "Stock feeder: PLA · Forshape"
T3: feeder chips=[/]   disc=checkerboard     prov=-   tagmark=-    "nothing detected"
T4: cabinet chips=[PETG,PETG,PETG,PETG]      prov=eye
```

The occupied-and-unnamed drawing from the section above is still right and still reachable —
it is what a wiped head with **no** tag gets, which is every machine whose feeder spools
carry none. Both branches are asserted now, the second by taking the tag away as well.

### Two notes for next time

- **A duplicate `const` in a drive script is silent.** The new block re-declared `before`,
  which is a `SyntaxError`, so `evaluate_javascript` never ran the file and the harness
  reported only *"the driving script never reported"* after its full 300 s. Worth knowing
  before debugging the wrong thing.
- **A failed assert in an edit script rolls back the whole file.** The `card()` and
  `feeder()` changes were one write; the second pattern did not match, so neither landed —
  and `feeder()` then took an argument nothing passed, which reads exactly like a logic
  bug. The debug script that dumped the state, not the check that failed, is what found it.

