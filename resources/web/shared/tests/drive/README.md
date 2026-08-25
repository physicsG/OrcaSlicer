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
| `task-card.js` | That the Printing Task panel is as tall as its card. It was pinned at 150 px against a 304 px card, and `.panel-body` hides its overflow — so the progress bar and both job buttons were cut off with nothing to say they had been. |

```bash
R=resources/web/shared/tests
python3 $R/run_webkit.py --size 1920x1080 --drive $R/drive/camera.js
python3 $R/run_webkit.py --size 1920x1080 --drive $R/drive/dom-dump.js > /tmp/before.txt
python3 $R/run_webkit.py --real --size 1920x1080 --drive $R/drive/camera-real.js
python3 $R/run_webkit.py --real --device-ip 192.0.2.1 --drive $R/drive/no-printer.js
```

**`--size` matters.** The Device page's two-column layout only engages at 1600 and above;
below it the page is one centred column and half of what these check does not apply.
`run_webkit.py`'s own checks branch on the same number.

**`--real` needs Orca closed** — it authenticates with the same saved `clientId`, and a
broker evicts the older holder.
