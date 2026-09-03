---
name: u1-hardware-test
description: Run the reconstructed U1 web surfaces against a real Snapmaker U1 over the LAN, outside Orca, using run_webkit.py and u1_bridge.py. Use when asked to test the Device page or the print dialog against real hardware, to check a change on a real machine, or to run the end-to-end send-and-cancel. Covers the safety rails, the required preconditions, the ladder of read-only checks before anything that moves the machine, and the cleanup afterwards.
---

# Testing against a real U1

The reconstructed surfaces can be driven against a real printer with no Orca running:
`u1_bridge.py` is a second host speaking Orca's contract, and `run_webkit.py --real`
points the page at it. This is the only way to find the class of bug a simulator built
from the same documentation cannot — and it has found several.

## Preconditions, all three

1. **Orca must be closed.** `--real` authenticates with the same saved `clientId`, and a
   broker evicts the older holder. Check: `pgrep -af Snapmaker_Orca`.
2. **The printer must be reachable.** `7125` (Moonraker HTTP), `8883` (mqtts),
   `1884` (plain mqtt, for pairing).
   ```bash
   for p in 7125 8883 1884; do
     timeout 5 bash -c "cat < /dev/null > /dev/tcp/<ip>/$p" && echo "$p open" || echo "$p closed"
   done
   ```
3. **Pin the serial with `--sn`.** Orca's config keeps stale device records — the machine
   this was built against has two, one with a `moonraker` placeholder serial — and the
   host tries every record it is handed.
   ```bash
   python3 -c "import sys;sys.path.insert(0,'docs/u1-webui/tools');from u1_bridge import orca_devices
   [print(d['dev_name'], d['ip'], d['sn'], d['connected']) for d in orca_devices()]"
   ```

## The ladder — always in this order

Each rung is safe to run on its own; run the earlier ones first anyway, because a script
bug found on rung 3 is found with a job on a bed.

```bash
R=resources/web/shared/tests
S=<serial>                       # from the check above
G=~/models/plate.gcode           # a real Orca-sliced plate
```

### 1. Read-only — what does the machine hold, and does the page agree

```bash
python3 $R/run_webkit.py --real --sn $S --size 714x750 --settle 25 \
    --gcode $G --page web/print_processing/index.html \
    --drive $R/drive/print-dialog-machine.js
```

Dumps `print_task_config` and the extruder objects raw, then holds the toolhead refusal
rule to them — **recomputed from the raw objects inside the script**, so a bug in the page
cannot make it agree with itself. Sends nothing.

For the Device page instead: `--drive $R/drive/ace-real.js` or `storage-real.js`, both
read-only for the same reason.

### 2a. Read-only — how long does a machine command take to answer

```bash
python3 $R/run_webkit.py --real --sn $S --size 714x750 --settle 25 \
    --gcode $G --page web/print_processing/index.html \
    --drive $R/drive/cancel-latency-real.js
```

Blocks the queue with `G4` - a dwell, so nothing moves - and times a cancel behind it.
Run this whenever a command looks ignored: the answer is usually that it is queued.

### 2. Read-only — can this firmware be told to stop

```bash
python3 $R/run_webkit.py --real --sn $S --size 714x750 --settle 25 \
    --gcode $G --page web/print_processing/index.html \
    --drive $R/drive/print-cancel-real.js
```

Asks **before** anything is sent, which is the point. Refuses outright if a print is
already in progress. Proves the route; it cannot prove a running print stops, and says so.

### 3. This starts a print

```bash
python3 $R/run_webkit.py --real --sn $S --allow-print --size 714x750 --settle 25 \
    --gcode $G --page web/print_processing/index.html \
    --drive $R/drive/print-send-cancel-real.js
```

**Get the operator's explicit agreement and make sure someone is watching the machine.**
Never run this unattended, and never as part of a suite.

`--allow-print` exists because the bridge refuses `sw_StartLocalPrint` without it: a suite
that can start a print is a suite that will, on somebody's bed, at 3am.

The script's own rails: it refuses if anything is already printing, maps every filament to
a toolhead the picker **accepts** (one head where possible, so there is no toolchange to
interrupt), and sends the cancel **unconditionally** after the start returns — from a
`finally`, so a throw anywhere in the middle still stops the job.

### Afterwards — clean up

The firmware **unpacks the zip**; the archive does not survive and the unpacked `.gcode`
does. Delete that name:

```bash
curl -s -X DELETE "http://<ip>:7125/server/files/gcodes/<plate>.gcode"
curl -s "http://<ip>:7125/server/files/list?root=gcodes" | grep -c "<plate>"
```

Check the machine is idle before walking away:

```bash
curl -s "http://<ip>:7125/printer/objects/query?print_stats&virtual_sdcard" \
  | python3 -m json.tool | grep -E '"state"|is_active'
```

## Reading the result

- **`no engine attached yet (sw_mqtt_set_engine has not run)`** — nothing brought a
  transport up. The page connects itself now; if this appears, the connect failed and the
  status line says why.
- **A timeout is not a failure, and a slow reply is usually the queue.** Klipper runs
  G-code sequentially, so a command answers when the queue drains - measured at
  **the blocking time plus ~250 ms**, with `G4` holding the queue open. A cancel sent to a
  print that has just started waits for its homing move. `drive/cancel-latency-real.js`
  measures this and moves nothing; run it before concluding a command was ignored.
  Confirm against machine state, not against the ack.
- **An `ok` is not a yes.** A Klipper macro answers `ok` to an argument it does not have.
  Anything that claims to have changed the machine is checked by reading the machine.

## Writing a new hardware script

- Put it in `resources/web/shared/tests/drive/` and add a row to that README — an
  uncommitted script is one nobody runs.
- **Smoke-test it against `?mock=1` first.** The last one to skip that step would have
  discovered its own bug with a print running.
- Recompute what you are asserting from the raw objects rather than from the page's model,
  or the check agrees with the page instead of with the machine.
- Default to read-only, and say so in the header. `drive/ace-real.js` is the precedent:
  its sibling `ace-panel.js` purges nozzles against the simulator and the hardware one
  deliberately cannot.

## What this has found

Bugs no simulator run could reach, all in
[03-print-processing/05-hardware-e2e.md](../../../docs/u1-webui/03-print-processing/05-hardware-e2e.md):

- `start_local_print` wants `item.path` from the upload's reply — **without** the root
  prefix. Gluing `root` on gives `File not found`.
- The firmware unpacks the zip, and the start reply names the inner `.gcode`.
- `initialAssignment` fell back to identity, which on a real machine placed two filaments
  on toolheads the picker itself refuses, with nothing on screen saying so.
- The cancel reply arrives late rather than never - it is queued behind the machine's
  own work, which is why `sswcp.js` now waits 80 s for a printer-backed command.
