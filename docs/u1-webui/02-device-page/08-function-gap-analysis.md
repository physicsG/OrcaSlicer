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

| | Acts on | Sends | Disabled when |
|---|---|---|---|
| **Pick extruder** | the toolhead selected in the row above | `T<n> A0` | the selection is already live |
| **Park extruder** | whatever the machine reports `ACTIVATE` | `PARK_EXTRUDER<n>` | nothing is engaged |

Selecting a toolhead sends nothing — it only points the jog and extrude controls. Both
buttons block the surface while the gantry moves and confirm against the machine rather
than the G-code ack, which only says the command was queued.

**One deliberate divergence.** The shipped UI has a single contextual button per
toolhead that reads *Park* when that head is live and *Pick* when it is not. Two separate
buttons were asked for here, and they are not the same shape: Pick follows the selection,
Park follows the machine. That difference is why each names its target in its tooltip —
with one button the target is never in doubt, with two it has to be stated.
