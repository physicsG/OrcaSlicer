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
