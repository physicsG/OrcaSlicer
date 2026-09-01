# What the two surfaces share

The Device tab and the print-processing popup are the **same Flutter application at
two routes**. That is not a surface resemblance — it has concrete consequences for
anyone rebuilding or modifying either one, because a large majority of the model is
common and only the presentation differs.

This page is the answer to "what can we reuse?", written from the reconstructions in
`resources/web/`, where the shared parts are factored into `resources/web/shared/`.

## The short answer

| Layer | Shared? | Where |
|---|---|---|
| Bridge envelope and client | **fully** | `shared/js/sswcp.js` |
| Command names | **mostly** | `shared/js/protocol.js` — `CMD` |
| Machine-state model and field filters | **fully** | `shared/js/protocol.js` — `SUBSCRIBE_OBJECTS` |
| State store and typed accessors | **fully** | `shared/js/state.js` |
| `print_task_config` | **fully — but different verbs** | `shared/js/protocol.js` — `TASK_CONFIG` |
| Fault decoding | **fully** | `shared/js/protocol.js` — `decodeErrorCode` |
| Simulated host | **core shared, fixtures per surface** | `shared/js/mockhost.js` |
| Design tokens | **shared base, per-surface override** | `shared/css/base.css` |
| Control limits | Device only | `LIMITS` |
| Rendering | per surface | each surface's `ui.js` |

Measured over the two reconstructions: **1,067 lines shared**, against 604 lines for the
Device tab and 752 for the popup. Roughly **44% of the total is common code**, and the
shared half is the part that encodes the protocol — the risky part.

## 1. One bridge, one envelope

Both host windows forward script messages to the *same* C++ entry point:

```cpp
// PrinterWebView::OnScriptMessage  and  WebPreprintDialog::OnScriptMessage
SSWCP::handle_web_message(evt.GetString().ToUTF8().data(), m_browser);
```

So the envelope, the `seqid` correlation, the `event_id` subscription rule, the
ack-then-push ordering and the `code: 200` success contract are identical. A bridge
client written for one surface works unmodified in the other — `shared/js/sswcp.js`
is imported by both without a per-surface branch.

## 2. One state model

Both surfaces subscribe to the same 24 Klipper objects with the same per-object field
filters. The popup does not define a narrower subscription; it reuses the Device tab's,
because it needs `print_task_config`, which only arrives as part of that set.

This means `SUBSCRIBE_OBJECTS` and the whole `MachineState` store — including the typed
accessors `toolheads()`, `taskConfig()`, `bed()`, `job()` — are common.

## 3. `print_task_config` is the hinge

This is the most useful thing to know when modifying either surface.

```
                 print_task_config
                        |
        reads           |            writes
   ┌────────────────────┴────────────────────┐
   │                                         │
Device tab                          Print-processing popup
labels each toolhead with           edits the filament→toolhead
the filament loaded in it           mapping and the three toggles
```

Same object, same fields, opposite verb:

| Field | Device tab | Popup |
|---|---|---|
| `filament_type`, `filament_color` | shows per toolhead | shows per filament row |
| `extruder_map_table` | — | **writes** the mapping |
| `extruders_used` | which heads are in the job | which heads the mapping targets |
| `flow_calibrate` | — | **writes** — *Extrusion Flow Calibration* |
| `time_lapse_camera` | — | **writes** — *Time-lapse Camera* |
| `auto_bed_leveling` | — | **writes** — *Auto Leveling* |

Practical consequence: **a change to how filament is modelled affects both surfaces.**
If you add a field to the mapping, the Device tab's toolhead cards are the second place
it has to be handled. `TASK_CONFIG` and `PRINT_PREFERENCES` in `shared/js/protocol.js`
exist so those field names are written once.

## 4. Commands: a shared core and two small tails

Of the commands the reconstructions issue, the identity and state calls are common;
each surface then adds its own tail.

**Common** — `sw_GetConnectedMachine`, `sw_GetMachineSystemInfo`, `sw_GetPrinterInfo`,
`sw_GetSoftwareInfo`, `sw_SetSubscribeFilter`, `sw_GetMachineState`,
`sw_SubscribeMachineState`, `sw_StopMachineStateSubscription`, plus the logging
commands (`sw_FileLog`, `sw_Log`, `sw_UploadEvent`).

**Device tab only** — the control surface: `sw_ControlBedTemp`,
`sw_ControlExtruderTemp`, `sw_ControlMainFan`, `sw_ControlGenericFan`, `sw_ControlLed`,
`sw_ControlPrintSpeed`, `sw_ControlPurifier`, `sw_SendGCodes`, and print-job control
(`sw_MachinePrintPause` / `Resume` / `Cancel`).

**Popup only** — the send flow: `sw_GetActiveFile`, `sw_GetPrintLegal`,
`sw_GetPrintZip`, `sw_GetFileFilamentMapping`, `sw_UpdateMachineFilamentInfo`,
`sw_SetFilamentMappingComplete`, `sw_FinishFilamentMapping`, `sw_FinishPreprint`,
`sw_StartLocalPrint` / `sw_StartCloudPrint`.

## 5. One simulated host

`shared/js/mockhost.js` implements the envelope machinery, the subscription
bookkeeping and a U1 simulation. Each surface passes a `handlers` map for the commands
only it needs:

```js
// print_processing/js/mock.js
const host = installMockHost({ log, handlers: {
  sw_GetFileFilamentMapping: (_p, ctx) => { /* built FROM print_task_config */ },
  ...
}});
```

The popup's filament fixture is **derived from the same `print_task_config` the Device
tab reads**, so the two surfaces cannot drift apart in the simulation either.

## 6. Tokens, with a caveat

`shared/css/base.css` defines the palette and the build badge. Each surface layers its
own stylesheet on top.

One trap worth recording: the Device tab commits to a single dark look and overrides
`:root` wholesale. It must therefore define **every** token `base.css` styles against —
not just the ones its own rules use — or shared components render this surface's dark
panels with the base stylesheet's light-theme text. `device.css` now carries explicit
aliases (`--ink`, `--ink-2`, `--accent-in`) for exactly that reason.

## What is genuinely not shared

- **Rendering.** The two `ui.js` modules have no overlap; the layouts are unrelated.
- **Control limits.** `LIMITS` (bed 0–100 °C, speed 50–150 %) come from the Device tab's
  validation strings and mean nothing in the popup.
- **Lifecycle.** The popup is modal and closes itself over the bridge
  ([lifecycle](../03-print-processing/02-lifecycle.md)); the Device tab is a persistent
  panel with no close protocol.

## Reuse checklist

When you next modify either surface:

1. Protocol change → `shared/js/protocol.js`, then run
   `python3 resources/web/shared/tests/conformance_test.py`.
2. Bridge behaviour change → `shared/js/sswcp.js`; it is imported by both.
3. Filament or print-config change → check **both** surfaces; see §3.
4. New simulated command → shared if both use it, otherwise the surface's own `mock.js`.
5. New visual token → `shared/css/base.css`, and add the alias to `device.css`.
