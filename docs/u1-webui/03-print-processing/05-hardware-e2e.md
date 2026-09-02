# The print dialog against a real U1

Everything else about this surface was checked against a simulator built from the same
documentation, which proves internal consistency and not that a machine agrees. This is
what a machine said. Measured on **811002511261022618B3**, firmware's Moonraker on
`192.168.2.242:7125`, Orca closed, 2026-09-02.

Four of the findings below could not have come from anywhere else, and two of them were
bugs.

## The send contract, settled

The last unmeasured stretch of this surface. `sw_StartLocalPrint` passes `m_param_data`
straight through to `server.files.start_local_print`, so what the firmware wants was not
in Orca's source at all.

### 1. The upload is the page's, and it works cross-origin

```
POST http://192.168.2.242:7125/server/files/upload      multipart, print=false
  -> HTTP 201
     {"action":"create_file",
      "item":{"path":"Test_Cube_PLA_4h15m.zip","root":"gcodes",
              "size":1566071,"modified":1788367418.5,"permissions":"rw"}}
```

1.5 MB from a page served on `127.0.0.1` to the printer on `192.168.2.242`. Moonraker
reflects the Origin, so no proxy is needed — the same thing the ACE override store
relies on.

### 2. `path` carries no root, and the reply says so

`item.path` and `item.root` are **separate fields**. Gluing them together is the obvious
guess and it is wrong:

| sent | answer |
|---|---|
| `{"type":"local","path":"gcodes/Test_Cube_PLA_4h15m.zip"}` | `{"state":"error","message":"File not found: gcodes/Test_Cube_PLA_4h15m.zip"}` |
| `{"type":"local","path":"Test_Cube_PLA_4h15m.zip"}` | `{"state":"success","message":"Print started","filename":"Test_Cube_PLA_4h15m.gcode"}` |

So the page reads the stored path back off the upload's own reply rather than
constructing one — `storedPath()` in [`core/send.js`](../../../resources/web/print_processing/js/core/send.js).
`type: "local"` is accepted.

### 3. The firmware unpacks the zip, and the zip does not survive

The start reply names `Test_Cube_PLA_4h15m.**gcode**` — the file *inside* the archive.
Afterwards `gcodes/Test_Cube_PLA_4h15m.zip` does not exist and
`gcodes/Test_Cube_PLA_4h15m.gcode` does, at 7,918,912 bytes. Anything cleaning up after
a test has to delete the **unpacked** name.

## Cancel

Asked before anything was sent, which is the order that matters.

| | |
|---|---|
| idle machine | `ok` in **109 ms** |
| running print | `print_stats` goes `printing` → `cancelled` in **~10 s** |

On the running print the request itself **timed out at the client's 15 s** while the
machine stopped. The first reading of that was *"this firmware does not answer a cancel"*
— one data point and a guess, and wrong.

### Klipper runs G-code sequentially, and the cancel queues behind it

The better explanation, and it is testable without printing anything. `G4` is a dwell: it
blocks the queue for a known time and moves nothing, heats nothing, extrudes nothing.

| queue | `sw_MachinePrintCancel` round trip |
|---|---|
| empty | **197 ms** |
| behind `G4 P3000` | **3323 ms** |
| behind `G4 P6000` | **6213 ms** |

The round trip is **the queue plus about a quarter of a second**, every time. So the
cancel on that print was never lost: it was queued behind the homing move a starting job
makes, and the client gave up while the firmware was still working through it.

`drive/cancel-latency-real.js` is the measurement, and it moves nothing.

### The consequence: two clocks, not one

`u1_bridge.py` learned this once already — its `RPC_TIMEOUT` is 80 s, set after a 31 s
toolchange came back as *"the printer refused the command"*. The page's own client was
still at 15 s for everything, which is the same lesson one layer up, unlearned.

`shared/js/sswcp.js` now waits on two clocks, split by `PRINTER_BACKED` — the set that
already classifies which replies come back through the printer's envelope:

| | |
|---|---|
| Orca answers it | 15 s. It comes back in milliseconds or not at all. |
| the printer answers it | 80 s, matching the bridge. It comes back when the queue drains. |

**Confirming against `print_stats` rather than against the ack is still the right
belt-and-braces** — `shared/js/pending.js` exists for exactly that shape — but it is no
longer the only thing standing between an operator and a cancel that reports failure
while it works.

## What the machine was holding

```
print_task_config.filament_type    ["PLA","PLA","NONE","PETG"]
print_task_config.filament_vendor  ["Jayo","Forshape","NONE","Kingroon"]
print_task_config.filament_exist   [true,true,false,true]
extruder .. extruder3              nozzle_diameter 0.4 each
```

The plate wanted PLA throughout, so the toolhead picker offered heads 1 and 2 and refused
3 and 4 — with the two distinct tooltips, `dialog_filament_type_none_tips` for the empty
head and `dialog_filament_type_not_match_tips` for the PETG one. The refusal set is
recomputed from the raw objects inside the drive script, so the page cannot agree with
itself.

## The bug hardware found

`initialAssignment` fell back to **identity** when Orca had no `filament_extruder_map` —
and outside Orca there never is one. On this machine that put filament 3 on the empty head
and filament 4 on PETG: two toolheads **the picker itself refuses**, with nothing on
screen saying so, because the warning mark means *"nothing chosen"* and something had
been.

Unassigned is the default now, which is the bundle's own answer: the card draws `!` in the
warning colour, and Send is refused until every filament has a home. **The simulator could
not have found this** — its mock always supplies a map.

## Running it

Use the `u1-hardware-test` skill, which walks the ladder and holds the rails. The short
form:

```bash
R=resources/web/shared/tests
S=811002511261022618B3

# 1. read-only: what the machine holds, and does the refusal rule agree with it
python3 $R/run_webkit.py --real --sn $S --size 714x750 --settle 25 \
    --gcode ~/models/plate.gcode --page web/print_processing/index.html \
    --drive $R/drive/print-dialog-machine.js

# 2. read-only: can this firmware be told to stop, asked while it is idle
python3 $R/run_webkit.py --real --sn $S --size 714x750 --settle 25 \
    --gcode ~/models/plate.gcode --page web/print_processing/index.html \
    --drive $R/drive/print-cancel-real.js

# 3. THIS STARTS A PRINT. A person watches the machine.
python3 $R/run_webkit.py --real --sn $S --allow-print --size 714x750 --settle 25 \
    --gcode ~/models/plate.gcode --page web/print_processing/index.html \
    --drive $R/drive/print-send-cancel-real.js
```

**Orca must be closed** for all three: `--real` authenticates with the same saved
`clientId` and a broker evicts the older holder. **Pin `--sn`** — Orca's config keeps stale
records and the host tries every one it is handed.

Step 3 leaves an unpacked `.gcode` on the printer. Remove it:

```bash
curl -X DELETE "http://<ip>:7125/server/files/gcodes/<plate>.gcode"
```

## Still not proven

- **A cancel measured against a real homing move.** The queue explanation is measured with
  `G4`; that a starting print's homing is what filled the queue is inference from the
  timing, not a separate observation.
- **A print left to run.** Everything here is cancelled within seconds; no plate has been
  taken to completion, so nothing downstream of the first layer has been seen.
- **The cloud path.** `sw_StartCloudPrint`, `server.files.pull` and the S3 upload are
  untouched — this is the LAN route only.
- **Preferences and the mapping reaching a print.** The macros are written and the machine
  acknowledges them; whether the started job honours them has not been checked.
