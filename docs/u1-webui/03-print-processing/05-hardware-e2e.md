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

**But the request times out first.** On a running print `sw_MachinePrintCancel` did not
answer inside the client's 15 s window:

```
-> sw_MachinePrintCancel
   FAILED sw_MachinePrintCancel timed out after 15000ms
print_stats:  0ms "printing"   10000ms "cancelled"
```

The machine stopped. The *reply* never came. **A control that reports the outcome from
the reply would tell the operator the cancel failed while the print was stopping** — and
this is `CMD.PRINT_CANCEL`, the same command the Device page's task panel sends, so the
finding is not confined to this surface.

The fix is the one this project already has for exactly this shape: confirm against
`print_stats`, not against the ack — `shared/js/pending.js`, whose whole reason for
existing is that an instant `ok` and a silently-ignored command look identical. **Not yet
applied**; it touches the Device page's task panel and is a decision of its own.

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

- **A print left to run.** Everything here is cancelled within seconds; no plate has been
  taken to completion, so nothing downstream of the first layer has been seen.
- **The cloud path.** `sw_StartCloudPrint`, `server.files.pull` and the S3 upload are
  untouched — this is the LAN route only.
- **Preferences and the mapping reaching a print.** The macros are written and the machine
  acknowledges them; whether the started job honours them has not been checked.
