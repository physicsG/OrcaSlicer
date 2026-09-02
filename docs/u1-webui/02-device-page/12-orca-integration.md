# The Device page as the only Device page

What had to be true before `flutter_web?path=2` could stop being loaded, and the three
things that were not.

The reconstruction had been the default Device tab for a while, with an Original /
Rebuilt switcher above it. That switcher is gone and the tab is
`/web/device_page/index.html` unconditionally. Getting there was not a matter of deleting
a button: **the shipped Device page was doing work for Orca that nothing else does**, and
while both existed it was possible for that work to happen by accident.

## The load-bearing thing the shipped page was doing

`sw_UpdateMachineFilamentInfo` reads like a command that sets the filament on the printer.
It is not. It never leaves the host —
[`bridge-methods.json`](../data/bridge-methods.json) has it as *answered inside Orca* —
and what it does there is:

```cpp
// SSWCP.cpp, update_filament_info()
auto& filaments       = wxGetApp().preset_bundle->machine_filaments;
auto& machine_nozzles = wxGetApp().preset_bundle->m_connect_machine_info_list;
...
if (need_load_preset) { tmp_filaments = filaments; wxGetApp().load_current_presets(); }
```

Those two containers are what the sidebar's filament combo boxes are built from
(`PresetComboBoxes.cpp:330`, `:1396`, `:1968`). They have **exactly one writer** — that
function — and three places that clear them (`SSWCP.cpp:4186`, `:6618`,
`GUI_App.cpp:7531`). So the chain is:

```
printer  →  print_task_config  →  the Device page  →  sw_UpdateMachineFilamentInfo
         →  machine_filaments  →  the Prepare page's filament rows
```

with the Device page in the middle and nothing else able to stand there. The shipped page
also mirrored the same payload into Orca's in-memory cache under `deviceFilamentInfo`
(`sw_SetCache`), which `sw_ConnectOtherMachine` replays on reconnect — a second path to
the same one function.

**The reconstruction was not calling it.** So on a branch with only the rebuilt page, the
Prepare sidebar never learned what was loaded in the machine.

### And the two panels that thought they were calling it

Worse than not calling it: two controls *were* calling it, for something else entirely.

```js
// filament-commands.js, before
send(CMD.UPDATE_MACHINE_FILAMENT_INFO,
     { filament_type: types, filament_color: argb, filament_color_rgba: rgba },
     'set filament');
```

The host's first line is:

```cpp
if (!m_param_data.count("objects") || !m_param_data["objects"].is_array()) {
    handle_general_fail(-1, "param [objects] required or wrong type!");
```

A flat `print_task_config` patch has no `objects`, so every one of those clicks failed
before doing anything — and neither control awaits its own request, by design, so nothing
on screen ever said so. Naming a filament from the panel, and applying the print
preferences, did nothing at all. The print-processing popup had the same two calls with
the same shape.

This was invisible to every suite. `u1_bridge.py` **refuses** the command in as many words
("writes Orca's per-device filament record"), which is correct and is why `--real` never
caught it; the simulator had no handler and answered a generic ok; and
`check_coverage.py` counts a command as implemented when a panel's module references it,
which this did.

## What writes the printer

Four macros, none of which appears in `printer.gcode.help` — recovered from the shipped
bundle, where the strings survive dart2js:

```dart
// A.aPV: setPrintFilamentConfig
n = A.x(["CONFIG_EXTRUDER",c,"FILAMENT_TYPE",d,"FILAMENT_SUBTYPE",e,
         "FILAMENT_COLOR_RGBA",b,"SAVE",g,"VENDOR",a0], j, t.X)
m = J.iE(n).i1(0,new A.aPW())            // drop null values
           .dN(0,new A.aPX(),j)          // A.aPX: `KEY='value'`
           .bM(0," ")
l = "SET_PRINT_FILAMENT_CONFIG " + m

// A.a8Z: setPrePrintConfiguration
"SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=" + k.a + " MAP_EXTRUDER=" + k.b + "\n"
"SET_PRINT_USED_EXTRUDERS EXTRUDERS=" + values.join(",") + "\n"
"SET_PRINT_PREFERENCES " + prefs.map(A.aPU).join(" ")   // A.aPU: `KEY=value`, upper-cased
```

| | |
|---|---|
| `SET_PRINT_FILAMENT_CONFIG` | `KEY='value'` — **single-quoted**. That is what lets a vendor with a space in it be one argument |
| `SET_PRINT_PREFERENCES` | `KEY=value` — bare, key upper-cased from a field name |
| `SET_PRINT_EXTRUDER_MAP`, `SET_PRINT_USED_EXTRUDERS` | `KEY=value` — bare too, and built by plain concatenation rather than through the quoting map. Integers and a comma list; nothing needs quoting |
| `SAVE='1'` | the bundle's own; without it the machine forgets on the next restart |
| a null argument | **dropped**, not sent empty. Absent means *leave this field alone*; empty means *clear it* |

Only `SET_PRINT_FILAMENT_CONFIG` is in `printer.gcode.help` (as a multiACE wrapper). The
other three are registered from Python without help strings, exactly as `T0`–`T3`,
`PARK_EXTRUDER` and the pick/park pair are. **Absence from the help table is not
evidence**, and reading it as evidence has now cost time twice.

### The preference whose name is not its name

```dart
m = A.x(["bed_level",!1,"flow_calibrate",!1,"time_lapse_camera",!1], n, t.y)   // checkboxes
l = A.x(["bed_level", 0,"flow_calibrate", 0,"time_lapse_camera", 0], n, p)     // the wire
```

The machine **reports** `auto_bed_leveling`; the macro **takes** `BED_LEVEL`. The bundle
keeps two parallel maps of the same three toggles — bools for the checkboxes, ints for the
line — and the int one is what the macro is built from, so the values go out as `1`/`0`
and not `true`/`false`.

`PRINT_PREFERENCES` in `protocol.js` therefore carries `key` *and* `arg`, because for one
of the three they are different words. Sending `AUTO_BED_LEVELING=1` is an argument the
macro does not have, and a G-code macro answers `ok` to those.

## What the payload to Orca has to be

`core/orcasync.js`. The key set is the shipped page's own `PrintTaskConfig.O()`, verbatim:

```dart
["filament_vendor","filament_type","filament_sub_type","filament_color",
 "filament_color_rgba","filament_official","filament_sku","extruder_map_table",
 "extruders_used","filament_edit","filament_exist","time_lapse_camera",
 "auto_bed_leveling","flow_calibrate","shaper_calibrate","auto_replenish_filament",
 "can_auto_replenish","auto_replenish_index","filament_color_multi","nozzle_diameters"]
```

Three constraints, all read out of the C++, and all three fatal to get wrong because
**`handle_web_message` had no try/catch above any of it**:

| | |
|---|---|
| `objects: [{key, value}]` | `key` is the serial; `value` is a JSON **string**. Both type-checked |
| the serial must be connected | `get_device_info(sn)` then `info.connected`, else `"sn does not exist!"` / `"The machine is not connected!"` |
| every array as long as `filament_official` | the loop runs over its size and indexes the rest with the same `i` — `nozzle_diameters[i]` and `filament_color_rgba[i]` included. A short array is an out-of-range **throw inside a wxWidgets event handler** |

That last one is now also fixed on the C++ side: `handle_web_message` catches, logs and
carries on. A page that sends a malformed command must not be able to terminate the app —
the same shape as the Paho fix, where an unreachable printer aborted Orca at launch
because a documented `return false` was a `throw`.

### `nozzle_diameters` comes from somewhere else entirely

`update_filament_info` requires the key and reads each entry with `get<std::string>()`.
`print_task_config` **has no such field** on this firmware — measured on
`811002511261022618B3`, which is why the bundle's model defaults it to `[]`.

It is published in one place:

```
GET /machine/system_info
  → system_info.product_info.nozzle_diameter = [0.4, 0.4, 0.4, 0.4]
```

which is `sw_GetMachineSystemInfo`. The page was already making that call — in
`refreshAll`, with the reply thrown away. It is kept now (`store.systemInfo`), and the
numbers are stringified on the way out, because a number there is a `nlohmann` type_error
rather than a value Orca can use.

The simulator was answering that command with a flat `{firmware_version, model, sn}` that
no U1 has ever sent, which is exactly why the one field only this call carries went
unnoticed for so long. It answers the measured shape now — and two more shapes were wrong
in the same object:

| | mock said | machine says |
|---|---|---|
| `extruders_used` | `[0, 1, 2, 3]` | `[false, false, false, false]` — one flag per toolhead |
| `extruder_map_table` | `{0:0, 1:1, 2:2, 3:3}` | a flat array of **32** — one entry per possible tool |

## When it is sent, and the one that only Orca could show

On every **state change**, guarded by a comparison — `state.onChange`, not `render()`.

It was on the repaint first, which looked right: `print_task_config` only moves on a state
push, and a push is what causes the frame. Every suite agreed. **In Orca it never ran
once.**

`render()` defers its work to a `requestAnimationFrame`, and **WebKit does not fire
animation frames into a view that is not being composited** — which the Device tab is not,
at startup, while the Home tab is the selected page. Everything else carried on exactly as
it should: the session connected, the snapshot arrived with 24 objects, the log said so.
A page nobody is looking at does not need to repaint, and every other thing render() does
is drawing.

This one is not drawing. Its consequence is on **another tab**, so it may not wait for
someone to look at this one. That is the general rule the bug leaves behind:

> A side effect must not ride on the repaint. Drawing may be deferred until someone is
> looking; telling another part of the application something may not.

Nothing offline can see it. `run_webkit.py` shows the page in a real window, so its frames
fire; `--real` does too. It took starting the app and reading `[rebuilt-device]` in Orca's
own log, which said nothing at all where it should have said either "synced" or a reason.
That silence is why the decline path names itself now — `filament sync not sent: <why>` —
and why `conformance_test.py` holds the wiring: the check reads `render()`'s
`requestAnimationFrame` body and fails if the sync is inside it.

Verified in Orca, against `811002511261022618B3`, 2026-09-01:

```
[WCP] [rebuilt-device] filament inventory synced to Orca (state)
[WCP] [rebuilt-device] filament inventory synced to Orca (stream)
```

It costs one `JSON.stringify` on the two pushes a minute an idle machine makes.
`load_current_presets()` rebuilds every combo box in the sidebar, so re-sending an
unchanged inventory is not free and is not done. The one case where an unchanged inventory
*must* be re-sent is a **reconnect** — Orca clears `machine_filaments` when a machine
disconnects — so `startStateStream()` calls `resyncOrca()`, which forgets what was sent and
re-reads the nozzle sizes. Every fresh stream ('boot', 'after connect', 'refresh') goes
through it.

## What making it work switched on

Telling Orca what is in the printer had a consequence nobody had had to think about: it
made `m_connect_machine_info_list` non-empty for the first time on this firmware, and
several things are gated on exactly that. Code that has never run is code that has never
been tested, and two of the three things below had been wrong the whole time without
anyone being able to see it.

### The Prepare page's sync marks crashed the app

```
#0  0x0000000000000000
#1  Slic3r::GUI::Sidebar::refresh_filament_sync_marks()
#2  Slic3r::GUI::Sidebar::show_sync_filament_dialog()
#3  Slic3r::GUI::Sidebar::finish_printer_sync()
```

A jump to address zero. `SyncMarkOverlay` is a **child window of the filament combo** it
rides on, and `Sidebar::priv::filament_sync_marks` keeps a raw pointer to it — with the
invariant written in a comment on the member, *"One per filament combo"*, and enforced
nowhere. Both places that shrink the row list do this:

```cpp
(*p->combos_filament[last]).Destroy();   // takes the child mark with it
p->combos_filament.pop_back();           // and filament_sync_marks keeps the address
```

`refresh_filament_sync_marks()` then calls `mark->SetSynced()`, whose first statement is
`IsShown()` — `virtual` in `wxWindow`. A virtual call through a freed vtable is a call to
0, which is frame #0.

It could not fire before, because the function returns early unless
`m_ace_read || !m_connect_machine_info_list.empty()`, and that list had exactly one writer:
the sync this page now does. Fixed at both removal sites (`resize()` to match the combos)
and again in the loop itself, which now runs only as far as there are combos — the cost of
being wrong there is a null jump rather than a wrong mark, so it is worth both.

### The "Machine Filament" section had never been drawn

Both places that build it filter with

```cpp
if (currentNozzleInfo != machine_nozzles) continue;
```

comparing the printer preset's `0.4` against `ConnectMachineInfo::nozzle_info`. That field
comes from `nozzle_diameters`, which **this firmware does not publish in
`print_task_config`** — so the shipped page sent `[]`, every `nozzle_info` was `""`, the
comparison never matched and the section stayed empty. Reading the real diameters out of
`machine.system_info` is what fills it.

### And a preset reload was running inside the webview's message handler

`update_filament_info()` called `load_current_presets()` directly — on the stack of a
`wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED` handler. That is `update_pages()`,
`force_print_bed_update()`, `load_current_preset()` on every tab and `rebuild_page_tree()`
on the model tabs: widgets destroyed and rebuilt while GTK is still dispatching the
webview's message. It is a `CallAfter` now, like every other GUI action in `SSWCP.cpp`.

It was also happening **twice, 5.6 ms apart**, because `resyncOrca()` ran after the
snapshot and its `forget()` landed on a push the snapshot had just made. See "When it is
sent" above.

## The login is Orca's, and stays Orca's

`sw_UserLogin` opens `SMUserLogin`: a native wxDialog that loads
`https://id.snapmaker.com?from=orca` over the network. It has nothing to do with the
Flutter bundle, and nothing about the dialog changed here.

**One thing next to it did**, reported as "it shows my name, then a popup, then I am
logged out". The account was never lost — `Snapmaker_Orca.conf` still held the token and
`login: 1`, and every start logged `sm_restore_login: restored account …`. What was lost
was the *announcement*:

```cpp
void SSWCP_UserLogin_Instance::sw_SubscribeUserLoginState()
{
    wxGetApp().m_user_login_subscribers[m_webview] = weak_ptr;   // and that was all
}
```

A subscription that answers nothing reports only **changes**, and the change a page most
needs to hear happened before the page existed: the account is restored in
`init_app_config()`, whose `notify()` reaches no subscribers. `post_init()` re-announces —
but that runs when the frame is built, and the measured gap to the Flutter bundle's first
bridge call is **4.1 seconds** (22:16:39.7 → 22:16:43.8), because 5 MB of `main.dart.js`
has to parse first. The page subscribed into the silence after the announcement and sat on
its default, which is signed out.

The subscription replies with the state as it stands now, built from the same fields
`SMUserInfo::notify()` sends. No timing can lose it after that. Same shape of bug as the
one above, from the other direction: **a push-only channel needs an initial value**, or
whoever attaches late never learns what is already true.

What changed is that the Device page can now **ask for it**. The rail's device menu ends
with `Sign in to Snapmaker…` when signed out and `Signed in as <name>` when not. That is
the whole of the account surface on this page, and deliberately so: there is no login form
here, there are no password inputs anywhere in the reconstruction, and a page that
collected a Snapmaker credential itself would be the wrong answer to a requirement that
says to use the original screen.

The reply to `sw_UserLogin` arrives **before** the modal is shown, so it says nothing about
whether anyone signed in — the state is re-read on a clock for six seconds afterwards and
then left alone. Someone who cancelled the dialog is not signed in, and a page that keeps
asking never settles.

## What is checked

`drive/orca-sync.js`, 22 checks, and it is the only thing that can see any of this:
everything here is about what *leaves* the page rather than what is drawn.

```
python3 resources/web/shared/tests/run_webkit.py --size 1920x1080 \
    --drive resources/web/shared/tests/drive/orca-sync.js
```

The simulator's `sw_UpdateMachineFilamentInfo` validates **exactly** what the C++
validates, including the array-length rule, so a payload that would throw inside a
wxWidgets event handler fails in WebKitGTK instead. Being lax there is what let a flat
patch look like a working call for as long as it did.

`check_coverage.py` has `sw_UpdateMachineFilamentInfo` in `OWNED_ELSEWHERE` rather than
attributed to a panel, because nobody presses it — the state stream does.
