# Drive scripts

Scripts for `run_webkit.py --drive`. Each runs inside the live page and reports by
setting `window.__report`; the Python side prints it and counts `PASS` / `FAIL`.

They live here because the alternative is re-writing them, and this page has twice
shipped visibly broken with every suite green — a `ReferenceError` that removed a whole
column, and a rename that broke `boot()` on a branch the simulator never takes. What
catches that is driving the running page, and a script that is not committed is one
nobody runs.

| | |
|---|---|
| `dom-dump.js` | Walks `.app` and prints every tag, id, class, `data-*` and box. **Run it before and after any structural change and diff the two** — it answers *what is on the page*, which is the question a targeted check cannot ask. |
| `camera.js` | The Camera panel against the simulator: discovery, the four view layouts, the focus rule, the transport list, the settings popover, and the monitor fallback. 50 checks. |
| `camera-real.js` | The same panel against a real printer, and the only place the frame rate is a **measurement** rather than a claim. Needs `--real`, and Orca closed. |
| `no-printer.js` | The not-connected branch, forced with `--device-ip 192.0.2.1`. Camera discovery reads the device record, so anything touching it belongs here. |
| `popover-live.js` | That an open popover follows the state it draws. The camera's settings shipped built-once: every control worked and none of them moved its own tick until the panel was reopened. Also checks the Control panel's sliders are *not* rebuilt, which is the other half. |
| `job-band.js` | The job card's shape: the thumbnail anchoring, the metadata on the name's line, the buttons riding the bar's line, and the status word living in the panel header and following the machine rather than a click. 27 checks. |
| `ace-panel.js` | The multiACE Filament card, through the states the synchronous checks cannot reach: no `ace` object at all, four units, one unit feeding every head, a source switched and held until the machine agrees, the dryer run and stopped, both menus and their two scopes, and a bay click that asks before it purges. 51 checks. |
| `ace-real.js` | The same panel against a **real printer**, and **read-only on purpose** — it dumps the raw `ace` object and checks the panel drew it, and sends nothing. `ace-panel.js` switches sources, loads bays and starts the dryer; a suite should not be able to purge a nozzle. Needs `--real`, and Orca closed. 26 checks. |
| `storage-paging.js` | Storage's three kinds, each paged. The simulator holds too few items to page, so the three reads are answered in the script: sixty rows, then a short page. Checks the cursor advances on the wire, the grid appends rather than rebuilding, and the spinner stands where the button was. |
| `homing.js` | The Homing dialog against a scripted G28. `homed_axes` reaching "xyz" is not the end of the procedure - the bed goes on moving - and the wait used to close on it. The simulator models neither `homed_axes` nor `motion_report`, so both are posed on `state`; the loop under test is the page's. |
| `storage-real.js` | Storage against a real printer, read-only. Where the paging was actually settled: the simulator holds too few items to page and none that collide, and this printer holds sixty recordings of which one file appears four times - which is what showed the grid drawing 72 cards for 60 items. Needs `--real`, and Orca closed. |
| `homing-real.js` | The same dialog against a **real G28**, and the only witness that counts - this one MOVES THE MACHINE. Two attempts at this wait passed every offline check and closed the dialog over a moving bed; what settled it was pressing the button with the printer in sight. Needs `--real`, and Orca closed. Takes a minute. |
| `orca-sync.js` | What the page sends to **Orca** rather than to the printer, and the three writes that were going to the wrong one of the two. Checks the filament inventory reaches Orca unprompted and in the exact shape `update_filament_info()` parses, that an unchanged one is not re-sent, that naming a filament and applying the print preferences send G-code macros, and that signing in opens Orca's own dialog rather than a form on this page. 22 checks. |
| `task-card.js` | That the Printing Task panel is as tall as its card. It was pinned at 150 px against a 304 px card, and `.panel-body` hides its overflow — so the progress bar and both job buttons were cut off with nothing to say they had been. |
| `print-mockups.js` | One of the three **print-dialog mockups**, in the dialog's own 714 × 750. Dumps the tree, then asserts what would be quietly wrong: the plate thumbnail visible without a click *and* decoded, a way to choose a destination per filament, Send agreeing with the scenario, and an edit reaching the model and repainting. Needs `--page`, not the Device page. It found a name column squeezed to 22 px and a lane that had fallen into the wire gutter — neither of which the screenshots showed. |
| `print-dialog.js` | The rebuilt **print dialog** against the simulator, in the 714 × 750 the host opens. Every geometry assertion is a row of the specification mockup, checked after a real layout; then the behaviour the bundle carries - a toolhead whose type or nozzle does not match is passed `enabled: false` and **cannot be picked**, which this checks by clicking one and asserting nothing moved. 43 checks. |
| `print-dialog-real.js` | The same dialog against `u1_bridge.py` with a **real sliced plate** (`--gcode`) and no printer (`--device-ip 192.0.2.1`). The filament list, the weights and the thumbnail all come out of the file Orca's own slicer wrote, so this is the Orca half on real data rather than a fixture. **Read-only on purpose**: the send path ends in `sw_StartLocalPrint`. 15 checks. |

```bash
R=resources/web/shared/tests
python3 $R/run_webkit.py --size 1920x1080 --drive $R/drive/camera.js
python3 $R/run_webkit.py --size 1920x1080 --drive $R/drive/homing.js
python3 $R/run_webkit.py --size 1920x1080 --drive $R/drive/storage-paging.js
python3 $R/run_webkit.py --real --sn <SN> --drive $R/drive/homing-real.js
python3 $R/run_webkit.py --real --sn <SN> --drive $R/drive/storage-real.js
python3 $R/run_webkit.py --size 1920x1080 --drive $R/drive/dom-dump.js > /tmp/before.txt
python3 $R/run_webkit.py --real --size 1920x1080 --drive $R/drive/camera-real.js
python3 $R/run_webkit.py --size 1920x1080 --drive $R/drive/ace-panel.js
python3 $R/run_webkit.py --size 1920x1080 --drive $R/drive/orca-sync.js
python3 $R/run_webkit.py --real --size 1920x1080 --drive $R/drive/ace-real.js
python3 $R/run_webkit.py --size 714x750 --drive $R/drive/print-mockups.js \
    --page 'web/print_processing/mockups/option-b.html?scenario=mismatch'
python3 $R/run_webkit.py --size 714x750 --drive $R/drive/print-dialog.js \
    --page 'web/print_processing/index.html?mock=1'
python3 $R/run_webkit.py --real --device-ip 192.0.2.1 --size 714x750 \
    --gcode ~/models/plate_1.gcode --page web/print_processing/index.html \
    --drive $R/drive/print-dialog-real.js
python3 $R/run_webkit.py --real --device-ip 192.0.2.1 --drive $R/drive/no-printer.js
```

**`--size` matters.** The Device page's two-column layout only engages at 1600 and above;
below it the page is one centred column and half of what these check does not apply.
`run_webkit.py`'s own checks branch on the same number.

**A drive script can pose a state for a picture.** `--shots` fires after the script
reports, so a script that ends in the state you want to look at gives you a screenshot of
it — and `--shots` produces real PNGs now, because an unattended run renders offscreen
through cairo rather than reading back a window WebKit never composited into.

**`--real` needs Orca closed** — it authenticates with the same saved `clientId`, and a
broker evicts the older holder.
