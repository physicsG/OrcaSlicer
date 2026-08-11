# The Snapmaker preprint page blocks a multiACE print

**Status:** analysis. No code changed. Ends in a recommendation and one decision to take.

Pressing **Print** on a multiACE plate reaches Snapmaker's *Print Preprocessing* page,
which shows four spools with red warning marks, refuses with **"Please select filament
type"**, and leaves **Send** disabled. The plate cannot be printed from Orca.

Everything below was read from the source or measured against the live U1 at
192.168.2.242; nothing is inferred from behaviour alone.

---

## 1. What that page is

`WebPreprintDialog` loads
`http://localhost:<port>/web/flutter_web/index.html?path=4` — Snapmaker's **compiled
Flutter application**, the same bundle as the Device tab. There is no Dart source in the
repo, so *the page itself cannot be modified or taught about the ACE*. That constraint
was already recorded for the Device tab (PROGRESS, 2026-08-05) and it applies here too.

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

## 3. Options

### A. Correct the payload — report per emitted extruder
Change `sw_GetFileFilamentMapping` so colour/type are indexed the same way weight already
is. The ACE head reports the filament it loads first, plus (if the page tolerates unknown
fields) a count of the colours behind it.

- **For:** smallest change; keeps Snapmaker's flow, upload, MQTT start, progress
  reporting, timelapse and defect detection; also fixes the *wrong colours* bug for every
  plate, not just ACE ones.
- **Against:** unverifiable in advance whether it satisfies the page's validation — the
  Flutter side is a black box. It also under-describes the print: four labels for seven
  colours.
- **Risk:** if the page validates "type must match the machine's loaded spool", the ACE
  head may still fail.

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

## 4. Recommendation

**D first (today), then A, with C as the fallback.**

D costs nothing and may already work. A is the right repair regardless of multiACE: the
payload is objectively wrong for any plate whose extruder count differs from its filament
count, and fixing it is a dozen lines in one function. Only if the page still refuses does
B become necessary — and B should then be scoped as an explicit alternative route, not a
silent replacement, because it drops the calibration and timelapse options the page owns.

## 5. What could not be determined from here

- **What the page validates.** Compiled Flutter, no source. Its exact rule for "filament
  type selected" is unknown; A is a hypothesis about it, not a certainty.
- **Whether `path=5` avoids the mapping step** (option D) — untested.
- **Whether a plain Moonraker `print=true` upload prints correctly on this firmware**
  (options B/E) — the endpoints answer, but I have not sent a file.

All three are cheap to settle on the real machine and would decide between the options
above rather than leaving them balanced on argument.
