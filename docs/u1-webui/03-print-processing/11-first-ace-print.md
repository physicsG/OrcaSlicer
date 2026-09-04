# ACE print run — 2026-09-04 14:36

Binary: 14:20 (purge-argument fix, prime-on-return fix, empty-toolhead fix).
Plate: ChickenPark-multicolor, printing as `ChickenPark-multicolor_PLA_8m44s.gcode`.

Plan: `T0:H3S2 T1:H3S0 T2:H0S0 T3:H1S0 swaps:1 optimal:0`

Two filaments on toolhead 4 off ACE unit 0 (bays A3 and A1), one mid-print swap.
**This is the first time a real ACE swap has run on hardware.**

Pre-send check: OK  .142418.0.gcode.ace.gcode: 14 macro argument(s), all parsable

## Macro lines in the file

```
347:ACE_SET_PURGE RESET=1
348:ACE_SWAP_HEAD HEAD=3 ACE=0 SLOT=2 INITIAL=1
7832:ACE_SET_PURGE LENGTH=32
7833:ACE_SWAP_HEAD HEAD=3 ACE=0 SLOT=0
```

## Live record

Appended by `follow.py` to `follow.log` — feed-channel changes, head_source
changes, last_swap_result, printer console errors, and the print state.

## Finding 1 — the swap works, and it costs three minutes

First ACE swap ever observed running on hardware. It did exactly what the plan
said: toolhead 4 from bay A3 (cream) to bay A1 (maroon `#6D1D32`), at 29.3%.

| time | channel_action_state | note |
|---|---|---|
| 14:42:14 | `load_finish` -> `unload_doing` | swap begins |
| 14:42:46 | | filament leaves the extruder |
| 14:43:04 | `unload_doing` -> `load_feeding` | `head_source[3]` flips to slot 0 here |
| 14:43:33 | | filament back at the extruder |
| 14:43:38 | -> `load_heating` | |
| 14:43:54 | -> `load_extruding` | |
| 14:44:54 | -> `load_flushing` | the `LENGTH=32` purge |
| 14:45:15 | -> `load_finish` | **3m01s total** |

`ACE_SET_PURGE LENGTH=32` parsed without complaint - the integer fix holds on a
real machine, where `32.179` cancelled the previous attempt at this same swap.
`purge_matrix = true`, so the stamp was honoured rather than ignored.

**To fix later: the time estimate ignores swap time.** The plate is sliced as
`ChickenPark-multicolor_PLA_8m44s` and one swap alone took 3m01s - 35% of the
whole estimate, unaccounted. A plate with several swaps would be wildly
under-estimated. The rewriter already knows the swap count before it writes the
file (`RewriteResult::swaps`), so the correction is available at the point the
filename and the estimate are produced. Measure a few more swaps first: 3m01s
is one sample, and the flush length varies per colour pair.

**`last_swap_result` does record the print's own swap, but it LAGS.** Read
mid-flush it still held the INITIAL load (`slot:2`); it wrote
`{head:3, ace:0, slot:0, status:"ok"}` at 14:45:28 - **13 s after** the channel
reached `load_finish`, and 3m14s after the swap began.

That ordering matters for the Device page. `runFilamentAction` polls two things:
`channel_state` for the step, and a *change* in `last_swap_result` as multiACE's
verdict. The verdict arrives after the channel already says finished, so the
channel is the earlier and better signal - which is how the code is written
(`sawBusy && step.done` closes the dialog). Nothing to change; the point is that
the reverse - trusting `last_swap_result` to be current when the channel settles
- would be wrong by 13 s, and a panel that waited for it would look hung.

## Finding 2 — the print paused on SpoolLink, not on anything we wrote

At 14:48:31, 3 min after the swap, at 64.4%:

```
// Success: Set action code PRINT_PREEXTRUDING
!! SpoolLink: E2 no spool found for card F11576E3
// Pausing...
// Changed main state to AUTO_LOAD with action AUTO_LOADING
AUTO_FEEDING EXTRUDER=1 LOAD=1
```

Toolhead 2 (`extruder1`) held `preload_finish` with `filament_at_extruder=false`
- filament in the path, not at the nozzle - so reaching it in the print started
a mid-print auto-load, and SpoolLink refused an RFID card it has no spool
registered for. A printer-side feature; no ACE macro and no rewritten line is
involved.

**It self-cleared.** The refusal paused the print, then the auto-load ran anyway
and `extruder1` reached `load_finish` 54 s later (14:48:31 -> 14:49:25), with a
`RESUME` issued after it. So SpoolLink costs a pause and a reload here, not a
dead stop - worth fixing at the source (register the card, or turn the check
off) but it does not strand a print.

**Almost certainly the same fault as the very first report in this session**
("something was not properly loaded" - toolhead 1 then, toolhead 2 now, both on
the auto-load path).

**To consider later: the planner has no notion of "loaded but not at the
nozzle".** `fetch_feeders` reads `print_task_config.filament_exist`, which is
true for a head at `preload_finish`, so a head that still owes an auto-load
prices identically to one that is ready. The Device page's `headOccupied()`
agrees with that reading (`preload_finish` counts as occupied), so this is not
an inconsistency to fix - it is a risk neither layer represents. A plate that
could have used an already-at-nozzle head instead will still be routed to one
that pauses mid-print if the auto-load is refused.

Worth deciding whether that belongs in the planner at all: the auto-load
normally succeeds, and only an unregistered spool made it fail here. Cheap
middle option - surface it in the popup as an unchecked place rather than
re-ordering the plan around it.

## Finding 3 — exceptions do reach Orca, and the page could say so

At 14:49:50 Orca received, over WCP:

```
notify_exception_notification  {code: 0, id: 522, index: 0, level: 3,
                                message: "!! Not in paused state and cannot be resumed!"}
```

That particular one is harmless - a second RESUME arriving after the print had
already resumed. What it establishes is the channel: the printer's `!!` errors
are pushed to Orca as `notify_exception_notification` with a level, not only
written to the machine's own screen.

So the SpoolLink pause (finding 2) was knowable inside the app at the moment it
happened. The Device page already has `queryException()` and a
`notify_exception_notification` path; whether it SURFACES a level-3 exception
while a print is running is worth checking - a print that pauses itself with a
reason should not require reading the printer's display to find out why.

Resumed at 14:49:52 at 64.5%.

## Finding 4 - the print took 48% longer than the plate is named

`ChickenPark-multicolor_PLA_8m44s.gcode` printed in **776 s** (12m56s) against
an estimate of **524 s** (8m44s). The overrun is 252 s, and it is accounted for
almost exactly by the two things the estimate does not model:

| | |
|---|---|
| the ACE swap | 181 s (14:42:14 -> 14:45:15) |
| the SpoolLink pause and reload | 81 s (14:48:31 -> 14:49:52) |
| | **262 s**, against 252 s of overrun |

(The small excess is the ordinary tool-change time at that layer, which the
estimate DID include and the swap replaced.)

So the swap alone is 35% of the estimate, on a plate with exactly one. The
number is in hand at the right moment - `RewriteResult::swaps` is known before
the sibling is written, and the filename and estimate are produced after - but
one measurement is not a model: the flush is per colour-pair and this swap
carried `LENGTH=32`. Measure several pairs before turning 181 s into a constant.

`total_duration` 1086 s vs `print_duration` 776 s: 310 s of that is the startup
sequence before the first extrusion, which is a separate matter and normal.

## The whole run

```
14:37:22 FOLLOW start: state=printing progress=2.4% feed={"extruder0": {"channel_action_state": "load_finish", "channel_state": "load_finish", "filament_at_extruder": true, "filament_detected": true, "filament_in_toolhead": true}, "extruder1": {"channel_action_state": "none", "channel_state": "preload_finish", "filament_at_extruder": false, "filament_detected": true, "filament_in_toolhead": true}, "extruder2": {"channel_action_state": "none", "channel_state": "wait_insert", "filament_at_extruder": false, "filament_detected": false, "filament_in_toolhead": false}, "extruder3": {"channel_action_state": "load_finish", "channel_state": "load_finish", "filament_at_extruder": true, "filament_detected": true, "filament_in_toolhead": false}}
14:42:14 FEED extruder3 @29.3%: channel_action_state='load_finish'->'unload_doing', channel_state='load_finish'->'unload_doing'
14:42:46 FEED extruder3 @29.3%: filament_at_extruder=True->False
14:43:04 FEED extruder3 @29.3%: channel_action_state='unload_doing'->'load_feeding', channel_state='unload_doing'->'load_feeding'
14:43:04 SOURCE @29.3% (change 1): {"0": null, "1": null, "2": null, "3": {"ace_index": 0, "slot": 0, "type": "PLA", "color": "6D1D32", "brand": "GST3D", "subtype": "Basic"}}
14:43:33 FEED extruder3 @29.3%: filament_at_extruder=False->True
14:43:38 FEED extruder3 @29.3%: channel_action_state='load_feeding'->'load_heating', channel_state='load_feeding'->'load_heating'
14:43:54 FEED extruder3 @29.3%: channel_action_state='load_heating'->'load_extruding', channel_state='load_heating'->'load_extruding'
14:44:54 FEED extruder3 @29.3%: channel_action_state='load_extruding'->'load_flushing', channel_state='load_extruding'->'load_flushing'
14:45:15 FEED extruder3 @29.3%: channel_action_state='load_flushing'->'load_finish', channel_state='load_flushing'->'load_finish'
14:45:28 SWAP RESULT @29.3%: {"head": 3, "ace": 0, "slot": 0, "status": "ok", "ts": 17482.832620211}
14:48:31 PRINT printing -> paused
14:48:38 FEED extruder1 @64.4%: channel_action_state='none'->'load_feeding', channel_state='preload_finish'->'load_feeding'
14:48:45 FEED extruder1 @64.4%: filament_at_extruder=False->True
14:48:47 FEED extruder1 @64.4%: channel_action_state='load_feeding'->'load_heating', channel_state='load_feeding'->'load_heating'
14:48:49 FEED extruder1 @64.4%: channel_action_state='load_heating'->'load_extruding', channel_state='load_heating'->'load_extruding'
14:49:05 FEED extruder1 @64.4%: channel_action_state='load_extruding'->'load_flushing', channel_state='load_extruding'->'load_flushing'
14:49:25 FEED extruder1 @64.4%: channel_action_state='load_flushing'->'load_finish', channel_state='load_flushing'->'load_finish'
14:49:52 PRINT paused -> printing
14:52:42 PRINT printing -> complete
14:52:42 FOLLOW end: complete at 100.0% after 776s, 1 source change(s)
```
