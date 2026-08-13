# The Snapmaker preprint page vs. a multiACE plate

**Status:** fixed (option A), verified against the live U1.

Pressing **Print** on a multiACE plate reached Snapmaker's *Print Preprocessing* page,
which showed four spools with red warning marks, refused with **"Please select filament
type"**, and left **Send** disabled. The plate could not be printed from Orca.

Everything below was read from the source or measured against the live U1 at
192.168.2.242; nothing is inferred from behaviour alone.

> **The page is not a black box.** `main.dart.js` is dart2js output: minified, but every
> string literal survives, so the validation and matching logic can be read directly.
> Section 2a is that logic. An earlier draft of this document said the page could not be
> examined and treated option A as a hypothesis; it is now a measurement.

---

## 1. What that page is

`WebPreprintDialog` loads
`http://localhost:<port>/web/flutter_web/index.html?path=4` — Snapmaker's **compiled
Flutter application**, the same bundle as the Device tab. There is no Dart source in the
repo, so *the page cannot be modified or taught about the ACE* — the constraint recorded
for the Device tab (PROGRESS, 2026-08-05) applies here too. It can, however, be **read**:
see §2a.

It talks to Orca over **SSWCP** (`SSWCP::handle_web_message`). The relevant calls:

| Call | Direction | What it does |
|------|-----------|--------------|
| `sw_GetFileFilamentMapping` | page → Orca | asks what filaments the sliced file uses |
| `sw_UpdateMachineFilamentInfo` | page → Orca | machine-side spool info |
| `sw_UploadFiletoMachine` | page → Orca | uploads the gcode **unmodified** |
| `sw_StartLocalPrint` | page → Orca | `server.files.start_local_print` over MQTT, payload composed by the page |
| `sw_FinishFilamentMapping` | page → Orca | only closes the dialog |

Two independent routes reach this dialog:

1. **`Plater::send_gcode_legacy`**, U1 branch — constructs `WebPreprintDialog` directly.
   This is the Print button, and the one being hit here.
2. **`Moonraker::upload`** (`MoonRaker.cpp:519`) — opens the same dialog whenever
   `post_action == StartPrint`, with the comment *"依赖flutter，先放开"* (depends on
   Flutter, open it up for now). This is the classic print-host path.

**The gcode is uploaded as-is.** The page's mapping is data sent *to the printer*, not a
rewrite of the file. Whatever we settle here, the ACE macros we emit are unaffected.

---

## 2. Why it breaks — the precise defect

`SSWCP_MachineOption_Instance::sw_GetFileFilamentMapping` (`SSWCP.cpp:3223`) builds the
payload from two different index spaces and the page pairs them by position:

| Field | Source | Indexed by |
|-------|--------|-----------|
| `filament_color`, `filament_color_rgba` | `config.filament_colour` | **project filament** (7 on this plate) |
| `filament_type` | `full_config.filament_type` | **project filament** (7) |
| `filament_weight` | `result.print_statistics.total_volumes_per_extruder` | **emitted extruder** (4) |
| `filament_used_mm` | same | **emitted extruder** (4) |

For an ordinary printer those two spaces coincide — one filament per extruder — so the
bug is invisible. multiACE deliberately breaks that identity: seven filaments are remapped
onto four physical heads by `GCodeWriter`'s tool remap, precisely so `T4`–`T6` never reach
the machine.

The screenshot is that mismatch, exactly:

- four entries shown, because only extruders 0–3 have non-zero weight;
- their **colours are project filaments 0–3** (red, magenta, yellow, green);
- their **weights are physical heads 0–3** (4.71 / 7.32 / 7.31 / 29.38 g);
- the 29.38 g entry is the ACE head carrying **four** colours, shown as one green spool;
- the ACE's other three colours appear nowhere.

So the page is being handed a description of the file that is internally inconsistent,
and it cannot complete a mapping from it.

### The deeper question

The page's model is **one filament per extruder**. Is that wrong for multiACE? Not
obviously: the machine really does have four heads, and one of them is ACE-fed. Our gcode
drives the ACE itself (`ACE_SWAP_HEAD` / `ACE_SET_PURGE`), so the printer does not need to
be told which colour is in which ACE slot in order to execute the file — that is exactly
what we spent this feature encoding.

That makes **"report per emitted extruder"** a plausible fix rather than a fudge: four
heads, four entries, each with the colour and type of the filament that head starts with.

---

## 2a. What the page actually does with the payload

Read out of `resources/web/flutter_web/main.dart.js`. Minified names are quoted so the
claims can be re-checked; the log strings beside them give the Dart method names.

**It sizes everything off `filament_type`.** `aog()` reads the payload, then resizes
`filament_weight` and `filament_used_mm` to `filament_type.length` (`V2(list, n, default)`
pads or truncates, positionally). *The type array is the file's filament count* — which is
why sending seven types with four heads' weights produced four sensible numbers followed by
three zeros.

**It hides unused entries.** `bCp(e)` keeps an entry when `used > 0 || usedMm > 0 ||
usedMm == -1`. The three tail filaments had weight and length 0, so four chips were drawn —
matching the screenshot, with project colours 0–3 over head weights 0–3.

**It matches by type, then by colour.** `alK(type, colour, nozzle)` walks the machine's
extruders and:

1. skips any whose nozzle diameter differs;
2. **requires `filamentType` to be equal** — no exact type match anywhere, no result;
3. returns immediately on an exact colour match, otherwise keeps the nearest colour by
   CIEDE2000.

**It refuses on a null.** `Dv()` (*"setSelectMap"*) fills a map `cx: file filament ->
machine extruder`, using `alK` — with a shortcut for index < 4 that takes the identity when
machine slot *f* matches on nozzle **and** type **and** colour. The Send handler then
refuses with **"Please select filament type"** if `cx` is empty *or any value in it is
null*. That is the whole gate.

**`filament_extruder_map` seeds `cx` directly.** Orca already sends this (keyed by project
filament, from the sidebar's "sync with machine" choice). A seeded entry survives only when
machine slot *f* and file filament *f* report the same type.

So the refusal was not fussiness about ACE support. The page was handed an array of colours
and an array of weights that describe different things, and it could not match one of the
resulting chimeras to any spool on the machine.

---

## 3. Options

### A. Correct the payload — report per emitted extruder — **CHOSEN, IMPLEMENTED**
Change `sw_GetFileFilamentMapping` so colour/type are indexed the same way weight already
is. The ACE head reports the filament it loads first.

- **For:** smallest change; keeps Snapmaker's flow, upload, MQTT start, progress
  reporting, timelapse and defect detection; also fixes the *wrong colours* bug for every
  plate, not just ACE ones.
- **Against:** it under-describes the print — four labels for seven colours.
- **Risk (as feared):** that the page would demand a type matching the machine's loaded
  spool. It does (`alK`, §2a) — but that is a demand about the *machine*, not about the
  file, and it is the same condition the ACE reconciliation gate already enforces before
  the print gets this far. See §6.

### B. Skip the page for multiACE plates, use Orca's own uploader
The U1's Moonraker HTTP API is **fully open and unauthenticated** — verified live:
`/printer/info`, `/server/info`, `/machine/system_info`, `/server/files/roots` all 200, and
the `gcodes` root (`/userdata/gcodes`) is **rw**. Orca's own `Moonraker::upload` already
POSTs to `server/files/upload` with `form_add("print", "true")`, which is Moonraker's
upload-and-start. The Flutter dialog is a gate bolted in front of that, not the mechanism.

- **For:** removes the incompatible page from the multiACE path entirely; uses machinery
  that already exists and is already exercised.
- **Against:** loses whatever the Snapmaker page adds — flow calibration, timelapse and
  auto-levelling toggles are on that page, and the MQTT start may carry state the plain
  HTTP start does not. Diverges from stock behaviour for one printer feature.
- **Risk:** the firmware may expect `server.files.start_local_print` specifically;
  `printer.print.start` semantics on this firmware are unverified.

### C. Both — A as the default, B as an escape hatch
Fix the indexing so the page is at least given the truth, and offer a
**"Send without preprocessing"** route for ACE plates.

- **For:** honest data *and* a way through if the page still refuses.
- **Against:** two code paths to maintain and explain.

### D. Zero-code workaround, available today
In the send dialog choose **Upload** rather than **Upload and Print**. That sets
`post_action = None`, which routes to `path=5` ("Pretreat the uploaded content") instead of
`path=4`, then start the print from the printer's screen or Fluidd.

- **Unverified:** whether `path=5` also demands a filament mapping. Worth thirty seconds
  to find out, and it costs nothing.

### E. Out-of-Orca upload script
`curl -F print=true -F "file=@plate.gcode" http://192.168.2.242/server/files/upload`.
A companion to `orca.sh` would unblock printing immediately while the above is decided.

- **Unverified:** I have not POSTed to the printer. The endpoint exists and the root is
  writable, but uploading a file is a write to your machine and I did not do that without
  asking.

---

## 4. What was built

`SSWCP_MachineOption_Instance::sw_GetFileFilamentMapping` now builds one projection and
runs the whole payload through it:

```
extruder_filament[head] = the first filament that head presents in ace_sequence()
                          (or, for a head the plate never prints on, whatever is parked there)
```

Empty when there is no ACE plan, in which case the projection is the identity and every
other printer and plate gets byte-for-byte the payload it had before. With a plan:

- `filament_type`, `filament_color`, `filament_color_rgba`, `filament_color_multi` are
  indexed by emitted extruder — this is the actual repair, since the type array also sizes
  the payload (§2a);
- `filament_weight` and `filament_used_mm` keep their extruder keys but now take **density
  and diameter from the projected filament**. An ACE head's volume was being weighed with
  the density of whatever project spool happened to share its index;
- `filament_extruder_map` is emitted as the identity. Once the entries are extruders this
  is not a preference but a fact — entry 3 *is* head 3, because the gcode says `T3`. The
  app-config map is keyed by project filament and means nothing in this index space, so it
  is replaced rather than translated.

Both sides of the match are now logged at `info` (`[WCP] filament mapping payload:` and
`[WCP] machine filament info:`), because the page answers everything it dislikes with the
same sentence.

## 5. Result, measured

Headless Orca (Xvfb) against the live U1, the six-colour test cube, `Print` → `Upload and
Print`:

```
[WCP] filament mapping payload: per emitted extruder [T0<-F2,T1<-F3,T2<-F4,T3<-F1]
      type=["PLA","PLA","PLA","PLA"]
      colour=["#FEC600","#00AE42","#0056B8","#EC008C"]
      weight=[7.272,7.357,7.577,26.519]
      nozzle=["0.4","0.4","0.4","0.4"]
      extruder_map={"0":"0","1":"1","2":"2","3":"3"}

[WCP] machine filament info: type=["PLA","PLA","NONE","PETG"]
      colour=["F44336FF","FFFFDCFF","FFFFFFFF","83AFFFFF"]
      extruder_map_table=[0,1,2,3,0,0,...]  (32 entries)
      nozzle=["0.4","0.4","0.4","0.4"]
```

The projection agrees with the assignment dialog for the same plate (T1/T2/T3 feeders amber,
green, blue; T4 the ACE head starting on magenta) and the four weights are exactly Orca's
own per-extruder statistics. The page drew **four spools, all four mapped, and enabled
Send** — no red marks, no "Please select filament type".

Before the change the same plate drew four spools carrying project filaments 0–3's colours
over heads 0–3's weights, and refused.

## 6. `T3` does not mean head 3 — and the page decides what it means

This began as "the mapping is worth watching" and turned into the more serious finding of
the session. **A `T<n>` in our gcode is a *logical* tool.** The U1 resolves it through
`print_task_config.extruder_map_table`, a logical→physical table, and Snapmaker's preprint
page rewrites that table immediately before starting a print:

```
SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=<logical> MAP_EXTRUDER=<physical>   (one per filament)
SET_PRINT_USED_EXTRUDERS EXTRUDERS=<csv>
SET_PRINT_PREFERENCES <flags>
```

Evidence, all of it checkable:

- **The page emits it.** `a8s()` (*"setPrePrintConfiguration"*, `main.dart.js`) builds those
  lines from its selection map and sends them as gcode. It is the last thing Send does
  before the print starts.
- **The firmware implements it.** Not a macro in `printer.cfg` and not in
  `/printer/gcode/help`, but third-party firmware wraps it: AFC-Lite's `SET_MAP` expands to
  two `SET_PRINT_EXTRUDER_MAP` calls and reads back
  `printer.print_task_config.extruder_map_table`
  (`SnapmakerU1-Extended-Firmware/.../afc.cfg`).
- **The live machine is carrying one.** Queried on firmware `1.5.2.13`:
  `extruder_map_table = [0,1,2,3,…]` (identity, right now) but
  `reprint_info.extruder_map_table = [0,1,1,0,…]` — a real, **non-identity** map left by an
  earlier print. Logical 2 → physical 1, logical 3 → physical 0.
- **The route runs through us.** The page's gcode goes over WCP as `sw_SendGCodes`
  (`SSWCP.cpp`) → `PrintHost::async_send_gcodes` → `Moonraker_Mqtt::async_send_gcodes` →
  `printer.gcode.script`. Confirmed in the captured log, where each page-side
  `WcpConnection, sendCommand … {jsonrpc: 2.0, method: …}` is followed by
  `[Moonraker_Mqtt] 发送请求，方法: …`.

For an ordinary plate a remap is a *feature*: it lets a file authored for head 0 print from
the spool that happens to sit in head 2. **For a multiACE plate it is never right.** The
plan assigned each filament to a head and the `ACE_SWAP_HEAD HEAD=n` macros name that head
directly; remapping the tool changes without remapping the swaps desynchronises the two —
the plate prints on the wrong heads while the ACE feeds a head that stopped asking.

And it is not hypothetical. In the §5 run the page chose `2,2,1,1`, because the machine held
PLA red, PLA light-gold, *nothing* and PETG silver, so only two slots matched "PLA" at all.
Correct of the page; ruinous for the plate.

### What Orca now does

`sw_SendGCodes` parses the batch (`AceMmuToolMap.hpp`, unit-tested) and, **when the current
plate has a feasible ACE plan**, refuses any `SET_PRINT_EXTRUDER_MAP` that would move a tool
off its own head — naming the moves and pointing at the two ways out (load the planned
spools, or Upload without Print and start from the printer). Plates with no ACE plan are
untouched, so ordinary remapping keeps working.

This is the same posture as the infeasible-plate case: a hard, textual refusal.

### Fired, against the live printer

Run of 2026-08-13, six-colour cube, machine holding PLA red / PLA gold / *nothing* / PETG
silver. Three gates in sequence, each doing its job:

1. **The reconciliation gate stopped it first.** The assignment dialog read the ACE over LAN
   and marked all four slots `WRONG` (Kingroon PETG where the plan wants PLA), disabling
   *Apply to plate* until **"Print anyway — I have checked the spools"** was ticked. Worth
   noting on its own: this is the first time item G's gate has been seen refusing on
   hardware, and it is why simply cancelling the dialog aborts the print.
2. **The page mapped, and mapped wrongly.** Past the override, the preprint page enabled
   Send with badges `1, 2, 1, 1` — file filaments 0 and 1 onto their own heads, 2 and 3 both
   onto head 0.
3. **Send was refused.** Orca logged
   `[WCP] refusing a tool remap on a multiACE plate: T2->0,T3->0` — precisely the two entries
   that move, and precisely *not* the two that stay. The page received it as
   `[preUploadAndPrint] sendGcode failed, error: [-1] multiACE: refusing a tool remap …` and
   stopped.

The part that matters is what the printer looked like afterwards:

| | baseline | after Send |
|---|---|---|
| `print_task_config.extruder_map_table` | `[0,1,2,3,0,0]` | `[0,1,2,3,0,0]` — **unchanged** |
| `print_stats.state` | `standby` | `standby` |
| gcode files in `gcodes` root | 184 | 184, no `3h57m` file |

So the remap never reached the machine, nothing was uploaded, and no print began. The guard
sits before `host->async_send_gcodes`, and that is where it stopped.

### What is still not proven

The complementary run — **planned spools physically loaded, expecting an identity map, no
refusal, and a correct print** — needs someone to put the right filament in the machine, so
it is Gordian's to run. Two of its three claims already hold: entries 0 and 1 mapped to
their own heads in the run above and were correctly *not* flagged, so the identity branch
is exercised. What remains untested is a *fully* identity mapping passing through to a real
print.

## 7. Still open

- **Whether `path=5` avoids the mapping step** (option D) — untested, and no longer
  needed, but still the cheapest escape hatch if the page regresses.
- **Whether a plain Moonraker `print=true` upload prints correctly on this firmware**
  (options B/E) — the endpoints answer, but no file has been sent.
- **Seven colours behind four labels.** The page describes the ACE head with one spool.
  That is honest about what the head loads first and says nothing about the other three.
