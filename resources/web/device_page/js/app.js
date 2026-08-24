/*
 * app.js - wiring.
 *
 * Startup sequence mirrors the shipped page's own order:
 *   1. sw_GetConnectedMachine        who are we talking to
 *   2. sw_SetSubscribeFilter         declare the 24-object field filter
 *   3. sw_GetMachineState            full snapshot
 *   4. sw_SubscribeMachineState      stream deltas (needs event_id)
 */
'use strict';

import { CMD, SUBSCRIBE_OBJECTS, NAMED, LIMITS, TASK_CONFIG, PRINT_PREFERENCES,
         asDeviceList, deviceLabel, DEVICE, hasTlsMaterial,
         CAMERA_DOMAIN, CAMERA_INTERVAL, cssColor }
  from '../../shared/js/protocol.js';
import { openMenu, openDialog, openBlockingDialog, toggleField, numberField }
  from './overlay.js';
import { connect as connectDevice, disconnect as disconnectDevice } from './connection.js';
import { Sswcp } from '../../shared/js/sswcp.js';
import { MachineState } from '../../shared/js/state.js';
import { machineActivity, isBusy } from '../../shared/js/activity.js';
import { installMock } from './mock.js';
import { mountBuildBadge } from '../../shared/js/buildinfo.js';
import * as ui from './ui.js';

const qs = new URLSearchParams(location.search);
const wantMock = qs.get('mock') === '1';

const state = new MachineState();
let bridge = null;
let device = null;      // the machine whose state we show
let devices = [];       // every machine Orca has saved, connected or not
let loginUser = {};     // { userid, nickname } - the pairing request wants both
let subscription = null;
let trace = () => {};
let engineId = null;    // the MQTT engine Orca created for us
let connecting = false;
let taskTab = 'info';
let cam = { mode: 'live', streaming: false, frameUrl: null, timelapses: [], error: '' };
let camPump = null;     // re-points the live <img>; frames are polled, not pushed
let camSub = null;
let files = { loading: false, error: '', root: '', roots: [], items: [] };
let exception = null;   // the active fault, from sw_exception_query
let heartbeat = null;   // interval handle
let findSub = null;     // discovery subscription
let found = [];         // machines discovery has turned up
const HISTORY_PAGE = 20;
// A toolchange is mechanical. 60s is what the printer's own UI allows: its handler
// raises an "Extruder N operating..." overlay with a 60 timeout before dispatching.
const TOOL_CHANGE_TIMEOUT_MS = 60000;
let history = { loading: false, error: '', items: [], hasMore: false };

function setStatus(text, kind = '') {
  const n = ui.$('#status');
  n.textContent = text;
  n.className = 'status ' + kind;
}

async function boot() {
  trace = ui.makeTrace(ui.$('#trace'));

  // Use the real host when present; fall back to the simulator otherwise.
  let mock = null;
  if (wantMock || !Sswcp.hasHost()) {
    mock = installMock({ log: trace });
    window.__devicePage.mock = mock;   // lets tests/screenshots drive the simulation
    setStatus(mock ? 'simulated printer (no Orca host)' : 'connected', mock ? 'mock' : 'ok');
  } else {
    setStatus('connected to Orca', 'ok');
  }
  ui.$('#mode').textContent = mock ? 'MOCK' : 'LIVE';
  ui.$('#mode').className = 'mode ' + (mock ? 'mock' : 'live');

  bridge = new Sswcp({
    log: (kind, packet) => {
      trace(kind, packet);
      const p = (packet && packet.payload) || {};
      // Never trace the log command itself: hostLog sends sw_FileLog, which the
      // tracer would log, which sends another sw_FileLog. That is a live loop,
      // not a theoretical one — it filled the sink in under a second.
      if (!DIAG || p.cmd === CMD.FILE_LOG) return;
      if (kind === 'tx') hostLog(`→ ${p.cmd}${p.event_id ? ' [sub]' : ''}`, 'debug');
    },
  });

  // Two different questions, and asking only the first is why a saved-but-idle
  // machine never appeared: sw_GetConnectedMachine returns a device ONLY when its
  // connected flag is set, while sw_GetLocalDevices returns everything Orca knows.
  try {
    const u = await bridge.request(CMD.GET_USER_LOGIN_STATE, {});
    if (u && u.status === 'online') loginUser = { userid: u.userid, nickname: u.nickname };
  } catch (e) { /* not signed in; pairing still works with empty identifiers */ }

  try {
    devices = asDeviceList(await bridge.request(CMD.GET_LOCAL_DEVICES, {}));
  } catch (e) {
    console.warn('[app] device list:', e.message);
  }
  try {
    const c = await bridge.request(CMD.GET_CONNECTED_MACHINE, {});
    device = (c && Object.keys(c).length) ? c : null;
  } catch (e) {
    console.warn('[app] no connected machine:', e.message);
  }
  // Fall back to a saved machine, so the page names the printer it is about even
  // while nothing is connected.
  if (!device) device = devices.find((d) => d[DEVICE.CONNECTED]) || devices[0] || null;
  if (!device) {
    setStatus('no printer configured', 'warn');
  } else if (!device[DEVICE.CONNECTED]) {
    setStatus(`${deviceLabel(device)} \u2014 not connected`, 'warn');
  }

  try {
    await bridge.subscribe(CMD.SUBSCRIBE_LOCAL_DEVICES, {}, (d) => {
      const list = asDeviceList(d);
      if (!list.length) return;
      devices = list;
      const conn = list.find((x) => x[DEVICE.CONNECTED]);
      if (conn) device = conn;
      else if (device) device = list.find((x) => x[DEVICE.SN] === device[DEVICE.SN]) || device;
      render();
    });
  } catch (e) {
    console.warn('[app] device subscription:', e.message);
  }

  // Fails harmlessly when nothing is connected yet; the connect path re-runs it.
  await startStateStream('boot');

  state.onChange(render);
  render();

  // The shipped page brings a session up by itself on load - the very first
  // harness capture caught it emitting sw_create_mqtt_client unprompted. Match
  // that, but only where it can succeed without prompting: a machine that
  // already has keys, or a signed-in account that can be issued them from the
  // cloud. Pairing needs a human reading a code off the printer, so it stays
  // a deliberate action.
  if (device && !state.lastUpdate) {
    // A LAN machine with an address can authorise itself with the fixed code, so
    // stored keys and a signed-in account are no longer preconditions.
    if (device[DEVICE.IP] && device[DEVICE.SN]) {
      setStatus(`Connecting to ${deviceLabel(device)}\u2026`);
      doConnect(device, { silent: true });
    } else {
      setStatus(`${deviceLabel(device)} \u2014 not paired`, 'warn');
    }
  }

  // Reconstruction marker: shows which surface this is and which build it
  // reports, so a rebuilt page is identifiable on sight.
  mountBuildBadge(ui.$('#build-badge'), 'Device', bridge)
    .then((info) => { window.__devicePage.build = info; })
    .catch(() => {});
}

/* ---- control handlers -------------------------------------------- */

const clampTo = (lim, v) => Math.min(lim.max, Math.max(lim.min, Math.round(v)));

async function send(cmd, params, label) {
  try {
    await bridge.request(cmd, params);
  } catch (e) {
    console.error(`[app] ${label} failed:`, e.message);
    setStatus(`${label} failed: ${e.message}`, 'err');
  }
}

/**
 * Poll the live frame.
 *
 * The printer overwrites one file in place, so the URL never changes and the browser
 * would serve its cache forever - hence the cache-buster. The <img> is re-pointed
 * rather than re-created so the visible frame is only replaced once the next one has
 * decoded, which is what keeps the panel from flickering.
 */
function startCamPump() {
  stopCamPump();
  const tick = () => {
    if (!cam.streaming || !cam.frameUrl) return stopCamPump();
    const im = ui.$('#cam-live');
    if (im) im.src = `${cam.frameUrl}?t=${Date.now()}`;
  };
  camPump = setInterval(tick, CAMERA_INTERVAL * 1000);
}

function stopCamPump() {
  if (camPump) clearInterval(camPump);
  camPump = null;
}

/**
 * Fire a toolhead command and wait for the machine, not for the request.
 *
 * Three things make the obvious `await bridge.request(...)` wrong here:
 *
 *  1. `sw_SendGCodes` does not return until Klipper has finished the move, but the
 *     bridge gives up after 15s (TIMEOUT_MS in sswcp.js). A toolchange that triggers an
 *     XY calibration runs far longer than that, so the request rejects while the printer
 *     is still working. Treating that rejection as failure told the user to retry
 *     something already in progress.
 *  2. The G-code ack only says the command was queued. The machine's own state is the
 *     only thing that says it worked.
 *  3. The machine says what it is doing: `machine_state_manager.action_code` reports
 *     "Extruder Docking Calibrating...", "Checking Extruder Pick..." and the rest. So
 *     the wait can show the real reason it is taking a while, and - more usefully - can
 *     keep waiting for as long as the machine claims to be busy.
 *
 * The shipped page does none of this. It raises an overlay with a flat 60s auto-dismiss
 * and reports "Request timeout, please try again later" when its own request gives up,
 * whether or not the printer is still moving.
 */
const TOOL_ACTION_HARD_CAP_MS = 10 * 60 * 1000;

function runToolAction({ title, script, waiting, done, gaveUp, settle }) {
  const dlg = openBlockingDialog({ title, message: waiting });
  let refused = null;
  // deliberately not awaited - see (1)
  bridge.request(CMD.SEND_GCODES, { script }).catch((e) => {
    if (!/timed out/i.test(String(e && e.message))) refused = e;
  });

  const started = Date.now();
  let quietDeadline = started + TOOL_CHANGE_TIMEOUT_MS;
  let lastLabel = null;

  return (async () => {
    let sawBusy = false;
    let lastPoll = 0;
    for (;;) {
      if (done()) {
        if (settle) await settle();
        dlg.close(); render(); return;
      }
      if (refused) { dlg.fail(`The printer refused the command: ${refused.message}`); return; }

      // Every source that answers, not just machine_state_manager - which reads
      // {main_state: 0, action_code: 0} straight through a manual toolchange on this
      // firmware, so a wait that trusted it alone saw silence and gave up on work that
      // was going fine. busyReason() adds the calibration step, the macro's own message
      // and physical motion.
      const act = state.activity();
      const reason = state.busyReason();
      const label = machineActivity(act) || reason.label;
      if (label) {
        if (label !== lastLabel) { dlg.update(label); lastLabel = label; }
      } else if (lastLabel) {
        dlg.update(waiting);
        lastLabel = null;
      }
      // keep waiting for as long as anything says it is doing something
      if (isBusy(act) || reason.busy) {
        sawBusy = true;
        quietDeadline = Date.now() + TOOL_CHANGE_TIMEOUT_MS;
      } else if (sawBusy) {
        // it was working and has stopped: for an operation with nothing on the stream
        // to confirm it - homing - that transition is the completion signal.
        if (settle) await settle();
        dlg.close(); render(); return;
      }

      // re-read the unsubscribed objects roughly once a second
      if (Date.now() - lastPoll > 1000) { lastPoll = Date.now(); await refreshWaitState(); }

      if (Date.now() > quietDeadline) { dlg.fail(gaveUp); return; }
      if (Date.now() - started > TOOL_ACTION_HARD_CAP_MS) {
        dlg.fail(`${gaveUp} Giving up after ten minutes.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
}

const handlers = {
  pause:  () => send(CMD.PRINT_PAUSE, {}, 'pause'),
  resume: () => send(CMD.PRINT_RESUME, {}, 'resume'),
  cancel: () => send(CMD.PRINT_CANCEL, {}, 'cancel'),

  setSpeed: (v) =>
    send(CMD.CONTROL_PRINT_SPEED, { percentage: clampTo(LIMITS.printSpeed, v) }, 'set speed'),

  setBedTemp: (v) =>
    send(CMD.CONTROL_BED_TEMP, { temp: clampTo(LIMITS.bedTemp, v) }, 'set bed temp'),

  setExtruderTemp: (index, v) =>
    send(CMD.CONTROL_EXTRUDER_TEMP,
         { temp: clampTo(LIMITS.nozzleTemp, v), index, map: index }, 'set nozzle temp'),

  setMainFan: (v) =>
    send(CMD.CONTROL_MAIN_FAN, { speed: clampTo(LIMITS.fanSpeed, v) }, 'set main fan'),

  setCavityFan: (v) =>
    send(CMD.CONTROL_GENERIC_FAN,
         { name: NAMED.cavityFan, speed: clampTo(LIMITS.fanSpeed, v) }, 'set assist fan'),

  setLed: (on) =>
    send(CMD.CONTROL_LED, { name: NAMED.cavityLed, white: on ? 1 : 0 }, 'set led'),

  // mode is an integer on the wire; the page used to send 'inner'/'exhaust' strings.
  setPurifierMode: (mode) =>
    send(CMD.CONTROL_PURIFIER, { mode: Number(mode) }, 'set purifier mode'),

  // Motion has no dedicated bridge command - the shipped page sends G-code, so
  // this does too. G28 homes; G91/G0/G90 makes one relative step.
  /**
   * Home, then re-read what got homed.
   *
   * `homed_axes` lives only on the `toolhead` object, which the shipped page does not
   * subscribe - so nothing on the stream reports that homing finished. G28 also runs far
   * longer than the bridge's 15s timeout, so this waits on the machine the same way a
   * toolchange does, then refreshes the one field that cannot arrive on its own.
   */
  home: () => runToolAction({
    title: 'Homing',
    script: 'G28',
    waiting: 'Homing all axes\u2026',
    // The wait polls `toolhead`, so homing does have a completion signal after all:
    // the machine reporting xyz homed. Relying on a busy->idle transition instead was
    // wrong here, because machine_state_manager never reports busy on this firmware,
    // so the transition never came and a finished home was called a timeout.
    done: () => state.toolhead().allHomed === true,
    gaveUp: 'Homing did not finish in time.',
  }),

  /**
   * Change the live toolhead, or park it. See runToolAction for why this does not
   * simply await the command.
   */
  pickTool: (i) => {
    const idx = Number(i) || 0;
    return runToolAction({
      title: `Switching to toolhead ${idx + 1}`,
      // `T<n> A0` is what the printer's own UI sends, recovered from the shipped bundle.
      // The A0 is not decoration - the firmware's SM_PRINT_CHECK_SWITCH_EXTRUDER passes
      // it too. Neither this nor PARK_EXTRUDER appears in printer.gcode.help, because
      // both register without help strings, as T0..T3 do.
      script: `T${idx} A0`,
      waiting: `Waiting for toolhead ${idx + 1}\u2026`,
      done: () => state.toolhead().activeIndex === idx,
      gaveUp: `Toolhead ${idx + 1} did not report active. The printer may still be `
            + 'working, or the change may have failed.',
    });
  },

  parkTool: (i) => {
    const live = state.toolhead().activeIndex;
    const idx = i == null ? live : Number(i);
    if (live == null || idx !== live) {
      setStatus(live == null ? 'No toolhead is engaged'
                             : `Toolhead ${live + 1} is the one engaged`, 'warn');
      return Promise.resolve();
    }
    return runToolAction({
      title: `Parking toolhead ${idx + 1}`,
      script: `PARK_EXTRUDER${idx === 0 ? '' : idx}`,
      waiting: 'Waiting for the printer to park\u2026',
      done: () => state.toolhead().activeIndex == null,
      gaveUp: 'The printer did not report a parked toolhead.',
    });
  },

  /** Jump to the file browser - the idle task panel's one useful action. */
  showFiles: () => {
    const tabs = document.querySelectorAll('.panel')[2].querySelectorAll('.tab');
    if (tabs[1]) tabs[1].click();
  },

  /* ---- print job ---- */
  confirmCancel: () => openDialog({
    title: 'Cancel this print?',
    build: (b) => {
      const p = document.createElement('p');
      p.style.cssText = 'margin:4px 0 6px;font-size:13px;line-height:1.55;color:#39434F';
      p.textContent = 'The job stops immediately and cannot be resumed.';
      b.appendChild(p);
    },
    confirmLabel: 'Cancel print',
    onConfirm: () => { handlers.cancel(); },
  }),

  /* ---- machine files ---- */
  openRoot: async (root) => {
    files = { loading: true, error: '', root: root || files.root, roots: files.roots, items: [] };
    render();
    try {
      if (!files.roots.length) {
        const r = await bridge.request(CMD.FILES_ROOTS, {});
        files.roots = Array.isArray(r) ? r : (r && (r.roots || r.result)) || [];
        if (!files.root) {
          const first = files.roots[0];
          files.root = typeof first === 'string' ? first : (first && (first.name || first.root)) || 'gcodes';
        }
      }
      // Firmware builds differ on which listing command answers; try the paged
      // one first and fall back to the directory walk.
      let items = [];
      try {
        const page = await bridge.request(CMD.FILE_LIST_PAGE,
          { root: files.root, page_number: 0, files_per_page: 50 });
        items = (page && (page.files || page.items || page.result)) || (Array.isArray(page) ? page : []);
      } catch {
        const dir = await bridge.request(CMD.FILES_GET_DIRECTORY,
          { path: files.root, extended: true });
        items = (dir && (dir.files || dir.result)) || [];
      }
      files.items = Array.isArray(items) ? items : [];
    } catch (e) {
      files.error = `could not read the machine: ${e.message}`;
    }
    files.loading = false;
    render();
  },

  printFile: (path) => openDialog({
    title: 'Start this print?',
    build: (b) => {
      const p = document.createElement('p');
      p.style.cssText = 'margin:4px 0 6px;font-size:13px;line-height:1.55;color:#39434F';
      p.textContent = path;
      b.appendChild(p);
    },
    confirmLabel: 'Print',
    onConfirm: () => { send(CMD.PRINT_START, { filename: path }, 'start print'); },
  }),

  deleteFile: (path) => openDialog({
    title: 'Delete this file?',
    build: (b) => {
      const p = document.createElement('p');
      p.style.cssText = 'margin:4px 0 6px;font-size:13px;line-height:1.55;color:#39434F';
      p.textContent = `${path} will be removed from the machine.`;
      b.appendChild(p);
    },
    confirmLabel: 'Delete',
    onConfirm: async () => {
      await send(CMD.DELETE_MACHINE_FILE, { path }, 'delete file');
      handlers.openRoot(files.root);
    },
  }),

  /* ---- camera ---- */
  startCamera: async () => {
    cam.error = '';
    cam.streaming = true;
    cam.frameUrl = null;
    render();

    // Not a stream and not a frame push. The monitor answers once with a URL, then the
    // printer rewrites that one file every `interval` seconds and the frames are ours
    // to fetch. domain must be 'lan' - '' is refused -32000. See protocol.js CAMERA_*.
    //
    // That answer can arrive down either channel: SSWCP.cpp hands the printer's reply to
    // on_mqtt_msg_arrived, which is the push path, but the bridge also acks the command.
    // Only the MQTT leg has been watched directly, so take the URL from whichever
    // channel produces it first and ignore the second.
    const useUrl = (payload) => {
      const url = ui.cameraFrameUrl(payload, device);
      if (!url || url === cam.frameUrl) return;
      cam.frameUrl = url;
      render();
      startCamPump();
    };

    try {
      camSub = await bridge.subscribe(CMD.CAMERA_START,
        { domain: CAMERA_DOMAIN, interval: CAMERA_INTERVAL, expect_pw: false },
        (data, payload) => useUrl(data !== undefined ? data : payload));
      if (camSub && camSub.ack !== undefined && camSub.ack !== null) useUrl(camSub.ack);
    } catch (e) {
      cam.streaming = false;
      cam.error = `camera failed: ${e.message}`;
      render();
    }
  },

  stopCamera: async () => {
    cam.streaming = false;
    cam.frameUrl = null;
    stopCamPump();
    if (camSub && camSub.cancel) camSub.cancel();
    camSub = null;
    render();
    try {
      await bridge.request(CMD.CAMERA_STOP, { domain: CAMERA_DOMAIN });
    } catch { /* already off */ }
  },

  /**
   * Completed jobs from Moonraker's history store.
   *
   * `start` pages rather than replacing, so "load more" appends.
   *
   * Measured: the reply's `count` is the number of jobs IN THIS PAGE, not the total -
   * asking for 7 returns count 7 on a machine with 240 jobs. The real total only comes
   * from server.history.totals, which has no bridge command, so paging stops when a
   * short page comes back rather than counting up to a known end.
   */
  loadHistory: async (start = 0) => {
    history.loading = start === 0;
    history.error = '';
    render();
    try {
      const r = await bridge.request(CMD.PRINT_HISTORY,
                                     { start, limit: HISTORY_PAGE, order: 'desc' });
      const jobs = (r && (r.jobs || r.items)) || (Array.isArray(r) ? r : []);
      history.items = start === 0 ? jobs : history.items.concat(jobs);
      history.hasMore = jobs.length >= HISTORY_PAGE;
    } catch (e) {
      history.error = `could not read print history: ${e.message}`;
      if (start === 0) history.items = [];
    }
    history.loading = false;
    render();
  },

  loadTimelapses: async () => {
    try {
      const r = await bridge.request(CMD.TIMELAPSE_LIST,
        { page_index: 0, page_rows: 24, thumbnail_direct: true });
      // `instances` is the printer's own name for the list, and the reply is now
      // unwrapped from its JSON-RPC envelope before it gets here (see unwrapRpc).
      cam.timelapses = (r && (r.instances || r.list || r.items))
                    || (Array.isArray(r) ? r : []);
      cam.error = '';
    } catch (e) {
      cam.timelapses = [];
      cam.error = `could not list recordings: ${e.message}`;
    }
    render();
  },

  openTimelapse: (t) => openDialog({
    title: t.name || t.filename || 'Recording',
    build: (b) => {
      const p = document.createElement('p');
      p.style.cssText = 'margin:4px 0 6px;font-size:13px;line-height:1.55;color:#39434F';
      p.textContent = 'Playback is handled by Orca\u2019s own time-lapse window. '
                    + 'This sheet can remove the recording from the printer.';
      b.appendChild(p);
    },
    confirmLabel: 'Delete from printer',
    onConfirm: async () => {
      await send(CMD.TIMELAPSE_DELETE,
                 { date_index: t.date_index || t.dateIndex || '',
                   name: t.name || t.filename || '' }, 'delete recording');
      handlers.loadTimelapses();
    },
  }),

  /* ---- diagnostics ---- */
  queryException: async () => {
    try {
      exception = await bridge.request(CMD.EXCEPTION_QUERY, {});
    } catch (e) {
      exception = null;
    }
    render();
  },

  abortBedMesh: () => send(CMD.BEDMESH_ABORT, {}, 'abort bed mesh'),

  /** Everything the printer will tell us about itself, in one sheet. */
  showSystemInfo: async () => {
    const gather = async (cmd, params = {}) => {
      try { return await bridge.request(cmd, params); } catch (e) { return { error: e.message }; }
    };
    const [printer, sys, dev, storage, objects] = await Promise.all([
      gather(CMD.GET_PRINTER_INFO),
      gather(CMD.GET_MACHINE_SYSTEM_INFO),
      gather(CMD.SYSTEM_DEVICE_INFO),
      gather(CMD.STORAGE_SPACE),
      gather(CMD.MACHINE_OBJECTS),
    ]);
    openDialog({
      title: 'Printer information',
      wide: true,
      build: (b) => {
        const dl = document.createElement('dl');
        dl.className = 'info-grid';
        const add = (k, v) => {
          if (v == null || v === '' || typeof v === 'object') return;
          const dt = document.createElement('dt'); dt.textContent = k;
          const dd = document.createElement('dd'); dd.textContent = String(v);
          dl.appendChild(dt); dl.appendChild(dd);
        };
        add('Name', device && deviceLabel(device));
        add('Model', device && device[DEVICE.MODEL]);
        add('Serial', device && device[DEVICE.SN]);
        add('Address', device && `${device[DEVICE.IP]}:${device[DEVICE.PORT] || 8883}`);
        add('State', printer.state);
        add('Host name', printer.hostname);
        add('Firmware', printer.software_version || sys.firmware_version || dev.firmware);
        add('Klipper objects', Array.isArray(objects && objects.objects)
                               ? objects.objects.length : undefined);
        b.appendChild(dl);

        const free = Number(storage && storage.free_space);
        const total = Number(storage && storage.total_space);
        if (Number.isFinite(free) && Number.isFinite(total) && total > 0) {
          const used = total - free;
          const p = document.createElement('div');
          p.style.cssText = 'margin-top:16px;font-size:12px;color:#5F6B79';
          p.textContent = `Storage — ${used.toFixed(1)} of ${total.toFixed(1)} `
                        + `${storage.units || 'GB'} used`;
          b.appendChild(p);
          const bar = document.createElement('div');
          bar.className = 'bar-mini';
          const fill = document.createElement('div');
          fill.style.width = `${Math.round((used / total) * 100)}%`;
          bar.appendChild(fill);
          b.appendChild(bar);
        }
      },
      confirmLabel: 'Close',
      onConfirm: () => true,
    });
  },

  /** Defect detection is a pass-through to the printer; params are its own. */
  showDefectSettings: async () => {
    let cur = {};
    try { cur = (await bridge.request(CMD.DEFECT_DETECTION, {})) || {}; } catch { /* use defaults */ }
    let enable, sens;
    openDialog({
      title: 'Defect detection',
      build: (b) => {
        enable = toggleField(b, { label: 'Detect first-layer and spaghetti failures',
                                  checked: cur.enable !== false });
        sens = numberField(b, { label: 'Sensitivity', value: cur.sensitivity ?? 1,
                                min: 0, max: 2,
                                hint: 'Higher values report more possible defects.' });
      },
      confirmLabel: 'Apply',
      onConfirm: () => {
        send(CMD.DEFECT_DETECTION,
             { enable: enable.checked, sensitivity: Number(sens.value) }, 'defect detection');
      },
    });
  },

  /* ---- discovery ---- */
  findMachines: async () => {
    found = [];
    let dlg;
    const paint = () => {
      const host = document.querySelector('#found-host');
      if (!host) return;
      host.innerHTML = '';
      if (!found.length) {
        const p = document.createElement('div');
        p.className = 'empty';
        p.textContent = 'Searching the network…';
        host.appendChild(p);
        return;
      }
      found.forEach((m) => {
        const row = document.createElement('div');
        row.className = 'found-row';
        const meta = document.createElement('div');
        meta.className = 'found-meta';
        const n = document.createElement('span');
        n.className = 'found-name';
        n.textContent = m.dev_name || m.name || m.sn || m.ip || 'printer';
        const sub = document.createElement('span');
        sub.className = 'found-sub';
        sub.textContent = [m.ip, m.model_name || m.machineType].filter(Boolean).join(' · ');
        meta.appendChild(n); meta.appendChild(sub);
        row.appendChild(meta);
        host.appendChild(row);
      });
    };
    dlg = openDialog({
      title: 'Printers on this network',
      build: (b) => {
        const host = document.createElement('div');
        host.id = 'found-host';
        host.className = 'found-list';
        b.appendChild(host);
        const note = document.createElement('p');
        note.style.cssText = 'margin:12px 0 2px;font-size:12px;color:#9AA3AF';
        note.textContent = 'Adding a printer opens Orca\u2019s own dialog, which owns '
                         + 'that flow.';
        b.appendChild(note);
      },
      confirmLabel: 'Add a printer…',
      onConfirm: () => { handlers.stopFind(); send(CMD.ADD_DEVICE, {}, 'add device'); },
    });
    paint();
    try {
      findSub = await bridge.subscribe(CMD.FIND_START, { last_time: -1 }, (d) => {
        const list = Array.isArray(d) ? d : (d && (d.devices || d.machines)) || [];
        if (list.length) { found = list; paint(); }
      });
    } catch (e) {
      setStatus(`discovery failed: ${e.message}`, 'err');
    }
  },

  stopFind: async () => {
    if (findSub && findSub.cancel) findSub.cancel();
    findSub = null;
    try { await bridge.request(CMD.FIND_STOP, {}); } catch { /* already stopped */ }
  },

  connectOther: () => send(CMD.CONNECT_OTHER, {}, 'connect another machine'),

  /* ---- file extras ---- */
  fileDetails: async (path) => {
    const [meta, thumb] = await Promise.all([
      bridge.request(CMD.FILES_METADATA, { filename: path }).catch((e) => ({ error: e.message })),
      // Both thumbnail commands ship, and the order matters more than it looks.
      // sw_MachineFilesThumbnails *succeeds* and returns {width,height,size,
      // thumbnail_path} - paths, no image data - so asking it first meant the
      // catch-fallback never fired and no thumbnail was ever shown. The base64
      // command is the only one that returns bytes, so it goes first.
      bridge.request(CMD.FILE_THUMBS_B64, { path })
        .catch(() => bridge.request(CMD.FILE_THUMBNAILS, { filename: path }))
        .catch(() => null),
    ]);
    openDialog({
      title: path.split('/').pop() || path,
      build: (b) => {
        const img = pickThumb(thumb);
        if (img) {
          const im = document.createElement('img');
          im.src = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
          im.style.cssText = 'width:100%;max-height:180px;object-fit:contain;'
                           + 'border:1px solid #E6E6E6;border-radius:6px;margin-bottom:12px';
          b.appendChild(im);
        }
        const dl = document.createElement('dl');
        dl.className = 'info-grid';
        Object.entries(meta || {}).forEach(([k, v]) => {
          if (v == null || typeof v === 'object') return;
          const dt = document.createElement('dt'); dt.textContent = k;
          const dd = document.createElement('dd'); dd.textContent = String(v);
          dl.appendChild(dt); dl.appendChild(dd);
        });
        b.appendChild(dl);
      },
      confirmLabel: 'Download to this computer',
      onConfirm: () => {
        send(CMD.DOWNLOAD_MACHINE_FILE, { filename: path, url: '' }, 'download');
        pollTransfer();
      },
    });
  },

  /* ---- saved-device management ---- */
  renameDevice: (d) => {
    let input;
    openDialog({
      title: 'Rename printer',
      build: (b) => {
        const f = document.createElement('label');
        f.className = 'field';
        const lab = document.createElement('span');
        lab.className = 'field-label';
        lab.textContent = 'Name';
        f.appendChild(lab);
        const row = document.createElement('div');
        row.className = 'field-row';
        input = document.createElement('input');
        input.value = deviceLabel(d);
        row.appendChild(input);
        f.appendChild(row);
        b.appendChild(f);
      },
      confirmLabel: 'Rename',
      onConfirm: async () => {
        const name = input.value.trim();
        if (!name) return false;
        await send(CMD.RENAME_DEVICE,
                   { dev_id: d[DEVICE.ID] || d[DEVICE.SN], dev_name: name }, 'rename');
        if (d[DEVICE.CONNECTED]) await send(CMD.SET_DEVICE_NAME, { name }, 'set machine name');
        await refresh();
      },
    });
  },

  forgetDevice: (d) => openDialog({
    title: 'Forget this printer?',
    build: (b) => {
      const p = document.createElement('p');
      p.style.cssText = 'margin:4px 0 6px;font-size:13px;line-height:1.55;color:#39434F';
      p.textContent = `${deviceLabel(d)} will be removed from Orca. Pairing keys are lost, `
        + 'so it has to be paired again.';
      b.appendChild(p);
    },
    confirmLabel: 'Forget',
    onConfirm: async () => {
      await send(CMD.DELETE_DEVICES, { dev_ids: [d[DEVICE.ID] || d[DEVICE.SN]] }, 'forget device');
      await refresh();
    },
  }),

  setFilament: (index, type, color, vendor) => {
    // print_task_config carries these as parallel per-slot arrays. Colour goes back in
    // the form the printer sends: RRGGBBAA, no '#'. Writing CSS here would put a value
    // on the machine that nothing else on it can read.
    const tc = state.taskConfig();
    const types = (tc[TASK_CONFIG.TYPE] || []).slice();
    const vendors = (tc[TASK_CONFIG.VENDOR] || []).slice();
    const rgba = (tc[TASK_CONFIG.COLOR_RGBA] || []).slice();
    const argb = (tc[TASK_CONFIG.COLOR] || []).slice();

    const hex = (cssColor(color) || '#CCCCCC').slice(1).toUpperCase();
    types[index] = type;
    if (vendor !== undefined) vendors[index] = vendor;
    rgba[index] = `${hex}FF`;
    argb[index] = (0xFF000000 | parseInt(hex, 16)) >>> 0;

    const patch = { [TASK_CONFIG.TYPE]: types,
                    [TASK_CONFIG.COLOR]: argb,
                    [TASK_CONFIG.COLOR_RGBA]: rgba };
    if (vendor !== undefined) patch[TASK_CONFIG.VENDOR] = vendors;
    send(CMD.UPDATE_MACHINE_FILAMENT_INFO, patch, 'set filament');
  },

  jog: (axis, deltaMm, toolIndex) => {
    const d = Number(deltaMm);
    if (!Number.isFinite(d) || d === 0) return;
    if (axis === 'E') {
      // Extrusion is per-toolhead, so select the tool first.
      const t = Number(toolIndex) || 0;
      return send(CMD.SEND_GCODES,
                  { script: `T${t}\nG91\nG0 E${d} F300\nG90` }, 'extrude');
    }
    // Klipper refuses a move on an unhomed axis and the failure is silent from here,
    // so say so rather than letting the press look like a dead button.
    if (state.toolhead().allHomed === false) {
      setStatus('Home the axes before jogging', 'warn');
      return;
    }
    const feed = axis === 'Z' ? 600 : 3000;
    return send(CMD.SEND_GCODES,
                { script: `G91\nG0 ${axis}${d} F${feed}\nG90` }, `jog ${axis}`);
  },
};

/* ---- render ------------------------------------------------------- */

let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const conn = state.connection();

    // DeviceInfo.connected is NOT a reliable "is it reachable" signal: AppConfig
    // force-clears it for every device on each config save (AppConfig.cpp:887),
    // so it is false on disk by construction and only meaningful within a run.
    // Live machine state is the real evidence — if objects are arriving, we are
    // talking to a printer.
    const live = state.lastUpdate > 0 && Object.keys(state.objects).length > 0;
    const reachable = live && (!conn.state || conn.state === 'ready');

    ui.renderRail(device, conn, devices, reachable);
    ui.renderCamera(ui.$('#camera'), reachable, cam, handlers);

    // The shipped page renders the whole control surface and fades it while the
    // machine is unreachable, rather than hiding it. Match that.
    ui.$('#control-grid').dataset.enabled = reachable ? '1' : '0';
    ui.renderStatusCard(ui.$('#status-card'), state.toolheads(), state.bed(),
                        state.led(), state.fans(), state.purifier(),
                        state.speed(), handlers);
    ui.renderControlMain(ui.$('#control-main'), state.toolheads(), handlers,
                         state.toolhead());
    ui.renderTask(ui.$('#task'), state.job(), taskTab, files, handlers, history);
    ui.renderFilament(ui.$('#filament'), state.filaments(), handlers);
    ui.renderFault(ui.$('#fault'), state.activity(), exception, handlers);
  });
}

/* ---- trace pause toggle ------------------------------------------- */
/* ---- connecting ----------------------------------------------------- */

/** Ask the user for the code the printer is displaying. */
function askForPin() {
  return new Promise((resolve) => {
    let input;
    let settled = false;
    openDialog({
      title: 'Pairing code',
      build: (b) => {
        const p = document.createElement('p');
        p.style.cssText = 'margin:4px 0 14px;font-size:13px;line-height:1.55;color:#39434F';
        p.textContent = 'The printer is showing a code on its screen. Enter it here to '
          + 'finish pairing. Orca stores the keys it receives, so this is only needed once.';
        b.appendChild(p);
        const f = document.createElement('label');
        f.className = 'field';
        const lab = document.createElement('span');
        lab.className = 'field-label';
        lab.textContent = 'Code';
        f.appendChild(lab);
        const row = document.createElement('div');
        row.className = 'field-row';
        input = document.createElement('input');
        input.setAttribute('inputmode', 'numeric');
        input.autocomplete = 'off';
        row.appendChild(input);
        f.appendChild(row);
        b.appendChild(f);
      },
      confirmLabel: 'Pair',
      onConfirm: () => {
        const v = input.value.trim();
        if (!v) { input.focus(); return false; }
        settled = true;
        resolve(v);
        return true;
      },
    });
    // Cancelling the dialog resolves empty, which connection.js treats as a cancel.
    const scrim = document.querySelector('.scrim');
    if (scrim) {
      const obs = new MutationObserver(() => {
        if (!document.body.contains(scrim)) {
          obs.disconnect();
          if (!settled) resolve('');
        }
      });
      obs.observe(document.body, { childList: true });
    }
  });
}

/**
 * Write a diagnostic line.
 *
 * Two sinks on purpose. sw_FileLog puts it in Orca's own log, which is the right
 * place for it — but it travels over the very bridge being diagnosed, so if that
 * stalls the evidence disappears exactly when it is needed. The beacon is a
 * plain HTTP POST that shares nothing with SSWCP, and it is what makes a hang
 * visible rather than silent. Harmless when no collector is listening.
 */
const DIAG_URL = 'http://127.0.0.1:8799/';
/** Per-command tracing is opt-in (?diag=1): it is far too chatty for normal use. */
const DIAG = qs.get('diag') === '1';
function hostLog(text, level = 'warning') {
  if (DIAG) {
    try { navigator.sendBeacon(DIAG_URL, `${level}: ${text}`); } catch { /* no sink */ }
  }
  try {
    bridge.request(CMD.FILE_LOG,
                   { level, content: `[rebuilt-device] ${text}` }).catch(() => {});
  } catch { /* no bridge yet */ }
}

async function doConnect(target, opts = {}) {
  if (connecting) return;
  connecting = true;
  render();
  hostLog(`connect start: sn=${target[DEVICE.SN]} ip=${target[DEVICE.IP]} `
        + `port=${target[DEVICE.PORT]} link=${target[DEVICE.LINK_MODE]} `
        + `clientId=${target[DEVICE.CLIENT_ID] || '(none)'} `
        + `hasKeys=${hasTlsMaterial(target)} token=${!!loginUser.token} `
        + `silent=${!!opts.silent}`);
  try {
    const res = await connectDevice(bridge, target, {
      // An automatic attempt never prompts; pairing is a deliberate action.
      requestPin: opts.silent ? null : askForPin,
      user: loginUser,
      onStep: (t) => { setStatus(t); hostLog(t); },
      trace: (t) => hostLog(t, 'warning'),
    });
    engineId = res.engineId;
    hostLog(`connected to ${deviceLabel(target)} (engine ${res.engineId})`);
    setStatus(`${deviceLabel(target)} — connected`, 'ok');
    await refresh();
    // The session only exists now, so this is the first point the state
    // commands can succeed.
    await startStateStream('after connect');
    startHeartbeat();
    handlers.queryException();
  } catch (e) {
    // ConnectError names the step that failed, which is the useful half.
    if (opts.silent) {
      setStatus(`${deviceLabel(target)} — not connected (${e.message})`, 'warn');
    } else {
      setStatus(`connect failed — ${e.message}`, 'err');
    }
    hostLog(`connect failed at step "${e.step || '?'}": ${e.message}`, 'error');
    console.error('[app] connect', e);
  } finally {
    connecting = false;
    render();
  }
}

async function doDisconnect() {
  if (!engineId) {
    setStatus('this session was not opened by the page — nothing to disconnect', 'warn');
    return;
  }
  await disconnectDevice(bridge, engineId);
  engineId = null;
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  exception = null;
  await refresh();
  setStatus('disconnected', 'warn');
}

/** Thumbnail responses vary by firmware; sniff the plausible shapes. */
/**
 * Pull image bytes out of a thumbnail reply, if it has any.
 *
 * `server.files.thumbnails_base64` puts them in `data`; `thumbnail_base64` is the
 * timelapse listing's spelling. `server.files.thumbnails` and the directory listing
 * carry only `thumbnail_path` / `relative_path`, which are paths on the printer and
 * not bytes - this returns null for those rather than handing a filename to an <img>
 * that would render it as a broken image.
 */
function pickThumb(r) {
  if (!r) return null;
  const d = r.data !== undefined ? r.data : r;
  if (typeof d === 'string' && d.length > 64) return d;
  if (Array.isArray(d) && d.length) return pickThumb(d[0]);
  for (const k of ['thumbnail_base64', 'thumbnail', 'thumb', 'image', 'base64', 'data']) {
    const v = d && d[k];
    if (typeof v === 'string' && v.length > 64) return v;
    if (Array.isArray(v) && v.length) return pickThumb(v[0]);
  }
  return null;
}

/** Watch a machine-file transfer until it stops moving. */
async function pollTransfer() {
  for (let i = 0; i < 60; i++) {
    let st;
    try { st = await bridge.request(CMD.FILE_STATUS, {}); } catch { return; }
    const pct = Number(st && (st.progress ?? st.percent));
    if (Number.isFinite(pct)) {
      setStatus(`transfer ${Math.round(pct > 1 ? pct : pct * 100)}%`);
      if (pct >= 1 || pct >= 100) { setStatus('transfer complete', 'ok'); return; }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Keep the session warm while we hold one, as the shipped page does. */
function startHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = setInterval(() => {
    bridge.request(CMD.HEARTBEAT, {}).catch(() => { /* transient */ });
  }, 30000);
}

/* ---- chrome interactions ------------------------------------------- */

/** Re-read everything the page shows, as the header refresh buttons do. */
/**
 * Declare the field filter, take a snapshot, and open the live stream.
 *
 * All three must run *after* a session exists — sw_GetMachineState and
 * sw_SubscribeMachineState both need `get_connect_host`, so at boot with no
 * host they fail and the page is left with no data and no subscription. Running
 * only a snapshot after connecting is not enough either: the UI would show one
 * frozen frame and never update.
 */
/**
 * Fetch `toolhead` once, outside the subscription.
 *
 * `homed_axes` lives only on that object and the shipped page does not subscribe it, so
 * the stream never carries it. It only changes when the machine homes, which makes a
 * one-shot query at connect and after G28 sufficient - and keeps the subscription list
 * byte-identical to the bundle's, which the conformance suite enforces.
 */
async function refreshToolhead() {
  return refreshWaitState();
}

/**
 * Re-read the objects a wait depends on that the stream does not carry.
 *
 * `toolhead` holds `homed_axes`, and `extruder_offset_calibration` holds the docking
 * calibration step that makes a toolchange slow. Neither is subscribed - the shipped
 * page does not subscribe them and the object list is pinned to the bundle's - so they
 * are fetched explicitly. One query for both, because a wait needs them together.
 */
async function refreshWaitState() {
  try {
    const snap = await bridge.request(CMD.GET_MACHINE_STATE, {
      objects: {
        toolhead: ['extruder', 'position', 'homed_axes'],
        extruder_offset_calibration: null,
      },
    });
    state.applyPayload(snap);
  } catch (e) {
    /* a wait must not fail because a status read did; it just learns nothing */
  }
}

async function startStateStream(reason) {
  // The three calls are independent and must not be chained. sw_SetSubscribeFilter
  // forwards `printer.objects.setSubscribeFilter` to the printer and waits for a
  // reply; against a real U1 that reply does not always come, and awaiting it
  // starved the two calls that actually matter. It is only an optimisation —
  // query and subscribe both carry their own object map — so fire it and move on.
  bridge.request(CMD.SET_SUBSCRIBE_FILTER, { objects: SUBSCRIBE_OBJECTS })
    .then(() => hostLog(`filter accepted (${reason})`))
    .catch((e) => hostLog(`filter skipped (${reason}): ${e.message}`));

  let ok = false;
  try {
    const snap = await bridge.request(CMD.GET_MACHINE_STATE, { objects: SUBSCRIBE_OBJECTS });
    state.applyPayload(snap);
    hostLog(`snapshot ok (${reason}): ${Object.keys(state.objects).length} objects`);
    ok = Object.keys(state.objects).length > 0;
    refreshToolhead();          // homed_axes is not in the subscribed set
  } catch (e) {
    hostLog(`snapshot failed (${reason}): ${e.message}`, 'error');
  }

  try {
    if (subscription && subscription.cancel) subscription.cancel();
    subscription = await bridge.subscribe(CMD.SUBSCRIBE_MACHINE_STATE, {}, (d) => {
      state.applyPayload(d);
    });
    hostLog(`subscribed (${reason})`);
  } catch (e) {
    hostLog(`subscribe failed (${reason}): ${e.message}`, 'error');
  }

  render();
  return ok;
}

async function refresh() {
  try {
    devices = asDeviceList(await bridge.request(CMD.GET_LOCAL_DEVICES, {}));
    const c = await bridge.request(CMD.GET_CONNECTED_MACHINE, {});
    device = (c && Object.keys(c).length) ? c
           : (devices.find((d) => d[DEVICE.CONNECTED]) || devices[0] || null);
  } catch (e) {
    setStatus(`refresh failed: ${e.message}`, 'err');
  }
  render();
}

/** Only one tab in a header group can be active. */
function selectTab(btn) {
  const group = btn.parentElement;
  group.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-active'));
  btn.classList.add('is-active');
}

function wireChrome() {
  // device selector -> the menu the shipped page opens
  const sel = ui.$('#device-select');
  sel.setAttribute('data-menu-anchor', '');
  sel.onclick = () => {
    const items = devices.length
      ? devices.map((d) => ({
          label: deviceLabel(d) + (d[DEVICE.CONNECTED] ? '' : '  (not connected)'),
          icon: 'deviceControl',
          muted: !d[DEVICE.CONNECTED],
          onClick: () => {
            device = d;
            render();
            if (!d[DEVICE.CONNECTED]) doConnect(d);
          },
        }))
      : [{ label: 'No printers saved', icon: 'deviceControl', muted: true }];
    items.push(null);
    // Disconnect is only offered for a session this page created - the engine is
    // addressed by the id sw_create_mqtt_client handed back, and a session Orca
    // brought up on its own has no id we can name.
    if (device && device[DEVICE.CONNECTED] && engineId) {
      items.push({ label: 'Disconnect', icon: 'iconHome', onClick: () => doDisconnect() });
    } else if (device && !device[DEVICE.CONNECTED]) {
      items.push({
        label: hasTlsMaterial(device) ? 'Connect' : 'Pair and connect…',
        icon: 'deviceControl',
        onClick: () => doConnect(device),
      });
    }
    if (device) {
      items.push({ label: 'Rename…', icon: 'iconEdit',
                   onClick: () => handlers.renameDevice(device) });
      items.push({ label: 'Forget this printer…', icon: 'delete',
                   onClick: () => handlers.forgetDevice(device) });
    }
    items.push(null);
    items.push({ label: 'Printer information…', icon: 'deviceControl',
                 onClick: () => handlers.showSystemInfo() });
    items.push({ label: 'Defect detection…', icon: 'exclamationMark',
                 onClick: () => handlers.showDefectSettings() });
    items.push(null);
    items.push({ label: 'Find printers…', icon: 'iconScan',
                 onClick: () => handlers.findMachines() });
    items.push({ label: 'Add Device', icon: 'iconHome',
                 onClick: () => send(CMD.ADD_DEVICE, {}, 'add device') });
    items.push({ label: 'Connect another machine…', icon: 'iconHome',
                 onClick: () => handlers.connectOther() });
    openMenu(sel, items);
  };

  // camera tabs
  document.querySelectorAll('.panel')[0].querySelectorAll('.tab').forEach((t, i) => {
    t.onclick = () => {
      selectTab(t);
      cam.mode = i === 0 ? 'live' : 'timelapse';
      ui.$('#camera').dataset.state = '';   // force a repaint
      render();
      if (cam.mode === 'timelapse') handlers.loadTimelapses();
    };
  });

  // control + filament refresh
  ui.$('#refresh').onclick = () => refresh();
  ui.$('#filament-refresh').onclick = () => refresh();

  // print preferences
  ui.$('#print-prefs').onclick = () => {
    const tc = state.taskConfig();
    const boxes = [];
    openDialog({
      title: 'Print Preferences',
      build: (b) => PRINT_PREFERENCES.forEach(({ key, label }) => {
        boxes.push([key, toggleField(b, { label, checked: !!tc[key] })]);
      }),
      confirmLabel: 'Apply',
      onConfirm: () => {
        const patch = {};
        boxes.forEach(([k, input]) => { patch[k] = input.checked; });
        send(CMD.UPDATE_MACHINE_FILAMENT_INFO, patch, 'set print preferences');
      },
    });
  };

  // printing-task tabs
  document.querySelectorAll('.panel')[2].querySelectorAll('.tab').forEach((t, i) => {
    t.onclick = () => {
      selectTab(t);
      taskTab = ['info', 'files', 'history'][i] || 'info';
      render();
      if (taskTab === 'files' && !files.items.length) handlers.openRoot(files.root);
      if (taskTab === 'history' && !history.items.length) handlers.loadHistory();
    };
  });

  ui.$('#filament-help').onclick = () => openDialog({
    title: 'Filament slots',
    build: (b) => {
      const p = document.createElement('p');
      p.style.cssText = 'margin:6px 0 2px;font-size:13px;line-height:1.55;color:#39434F';
      p.textContent = 'Each slot maps to one of the U1\u2019s four toolheads. '
        + 'Type and colour come from print_task_config \u2014 the same object the '
        + 'print-processing popup edits when you assign filaments to a job.';
      b.appendChild(p);
    },
    confirmLabel: 'Close',
    onConfirm: () => true,
  });
}

window.addEventListener('DOMContentLoaded', () => {
  wireChrome();
  boot().catch((e) => {
    console.error(e);
    setStatus(`startup failed: ${e.message}`, 'err');
  });
});

// expose for console poking during RE work, and for the screenshot harness
window.__devicePage = { get state() { return state; }, get bridge() { return bridge; },
                        get device() { return device; }, get devices() { return devices; },
                        handlers, mock: null };
