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
         CAMERA_DOMAIN, CAMERA_INTERVAL, cssColor, timelapseUrl }
  from '../../shared/js/protocol.js';
import { openMenu, openDialog, openBlockingDialog, toggleField, numberField }
  from './overlay.js';
import { connect as connectDevice, disconnect as disconnectDevice } from './connection.js';
import { Sswcp, isTimeout } from '../../shared/js/sswcp.js';
import { MachineState } from '../../shared/js/state.js';
import { machineActivity, isBusy } from '../../shared/js/activity.js';
import { installMock } from './mock.js';
import { Pending } from './pending.js';
import { createStore } from './store.js';
import { createSession } from './session.js';
import { DIAG, createLog } from './diag.js';
import { mountBuildBadge } from '../../shared/js/buildinfo.js';
import * as ui from './ui.js';
import { buildShell, paint } from './shell.js';

const qs = new URLSearchParams(location.search);
const wantMock = qs.get('mock') === '1';

const state = new MachineState();
// What the machine says, what the page knows, and what has been asked for but not yet
// confirmed. Three stores because they answer three different questions - see ctx below.
const store = createStore();
let bridge = null;
let trace = () => {};
let camPump = null;     // re-points the live <img>; frames are polled, not pushed
let camSub = null;
let findSub = null;     // discovery subscription
const HISTORY_PAGE = 20;
// A toolchange is mechanical. 60s is what the printer's own UI allows: its handler
// raises an "Extruder N operating..." overlay with a 60 timeout before dispatching.
const TOOL_CHANGE_TIMEOUT_MS = 60000;
// Every control that has asked the machine for something and is waiting to be told it
// happened. One store, because the request-vs-mirror bug has now been found in three
// separate controls; see pending.js.
const pending = new Pending({ onChange: () => render() });

// Diagnostics and the session both start before the bridge does, and both take it as a
// getter for that reason - the first thing worth logging is often that it never arrived.
const hostLog = createLog(() => bridge);

/**
 * Having a printer on the other end of the bridge: the connect path, whether the machine
 * is still there, reconnecting when it is not, the heartbeat, and the state stream.
 *
 * Injected rather than imported, because the dependencies run the other way - the
 * session asks this file to repaint and to say things.
 */
const session = createSession({
  bridge: () => bridge,
  state, store, setStatus, hostLog,
  render: () => render(),
  refresh: () => refresh(),
  handlers: { get queryException() { return handlers.queryException; } },
});

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
    if (u && u.status === 'online') store.loginUser = { userid: u.userid, nickname: u.nickname };
  } catch (e) { /* not signed in; pairing still works with empty identifiers */ }

  try {
    store.devices = asDeviceList(await bridge.request(CMD.GET_LOCAL_DEVICES, {}));
  } catch (e) {
    console.warn('[app] device list:', e.message);
  }
  try {
    const c = await bridge.request(CMD.GET_CONNECTED_MACHINE, {});
    store.device = (c && Object.keys(c).length) ? c : null;
  } catch (e) {
    console.warn('[app] no connected machine:', e.message);
  }
  // Fall back to a saved machine, so the page names the printer it is about even
  // while nothing is connected.
  if (!store.device) store.device = store.devices.find((d) => d[DEVICE.CONNECTED]) || store.devices[0] || null;
  if (!store.device) {
    setStatus('no printer configured', 'warn');
  } else if (!store.device[DEVICE.CONNECTED]) {
    setStatus(`${deviceLabel(store.device)} \u2014 not connected`, 'warn');
  }

  try {
    await bridge.subscribe(CMD.SUBSCRIBE_LOCAL_DEVICES, {}, (d) => {
      const list = asDeviceList(d);
      if (!list.length) return;
      store.devices = list;
      const conn = list.find((x) => x[DEVICE.CONNECTED]);
      if (conn) store.device = conn;
      else if (store.device) store.device = list.find((x) => x[DEVICE.SN] === store.device[DEVICE.SN]) || store.device;
      render();
    });
  } catch (e) {
    console.warn('[app] device subscription:', e.message);
  }

  // Fails harmlessly when nothing is connected yet; the connect path re-runs it.
  await session.startStateStream('boot');

  state.onChange(render);
  render();
  session.supervise();

  // The shipped page brings a session up by itself on load - the very first
  // harness capture caught it emitting sw_create_mqtt_client unprompted. Match
  // that, but only where it can succeed without prompting: a machine that
  // already has keys, or a signed-in account that can be issued them from the
  // cloud. Pairing needs a human reading a code off the printer, so it stays
  // a deliberate action.
  if (store.device && !state.lastUpdate) {
    // A LAN machine with an address can authorise itself with the fixed code, so
    // stored keys and a signed-in account are no longer preconditions.
    if (store.device[DEVICE.IP] && store.device[DEVICE.SN]) {
      setStatus(`Connecting to ${deviceLabel(store.device)}\u2026`);
      session.connect(store.device, { silent: true });
    } else {
      setStatus(`${deviceLabel(store.device)} \u2014 not paired`, 'warn');
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
    return true;
  } catch (e) {
    console.error(`[app] ${label} failed:`, e.message);
    setStatus(`${label} failed: ${e.message}`, 'err');
    return false;
  }
}

/**
 * A heater setpoint: send it, then say so.
 *
 * The row holds the asked-for value on screen until the machine echoes it back, so the
 * one thing it cannot see for itself is a command that never left. Returning whether
 * the bridge accepted it lets the row stop waiting the moment it did not, instead of
 * sitting on a value the printer never heard.
 */
async function setpoint(cmd, params, label, said) {
  const ok = await send(cmd, params, label);
  if (ok) setStatus(said);
  return ok;
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
    if (!store.cam.streaming || !store.cam.frameUrl) return stopCamPump();
    const im = ui.$('#cam-live');
    if (im) im.src = `${store.cam.frameUrl}?t=${Date.now()}`;
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
    // A timeout is not a refusal - the machine is still moving. Which clock ran out
    // is isTimeout's business; see the note on it in sswcp.js.
    if (!isTimeout(e)) refused = e;
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
      if (Date.now() - lastPoll > 1000) { lastPoll = Date.now(); await session.refreshWaitState(); }

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

  setBedTemp: (v) => {
    const t = clampTo(LIMITS.bedTemp, v);
    return setpoint(CMD.CONTROL_BED_TEMP, { temp: t }, 'set bed temp',
                    t > 0 ? `Heated bed \u2192 ${t} \u00B0C` : 'Heated bed off');
  },

  setExtruderTemp: (index, v) => {
    const t = clampTo(LIMITS.nozzleTemp, v);
    return setpoint(CMD.CONTROL_EXTRUDER_TEMP, { temp: t, index, map: index },
                    'set nozzle temp',
                    t > 0 ? `Toolhead ${index + 1} \u2192 ${t} \u00B0C`
                          : `Toolhead ${index + 1} off`);
  },

  setMainFan: (v) =>
    send(CMD.CONTROL_MAIN_FAN, { speed: clampTo(LIMITS.fanSpeed, v) }, 'set main fan'),

  setCavityFan: (v) =>
    send(CMD.CONTROL_GENERIC_FAN,
         { name: NAMED.cavityFan, speed: clampTo(LIMITS.fanSpeed, v) }, 'set assist fan'),

  // Held until the printer echoes it, like a setpoint: measured at 236ms, 2029ms and
  // 620ms across three runs, and the switch reverted under the mirror in two of them.
  setLed: (on) =>
    pending.track('led', !!on,
      send(CMD.CONTROL_LED, { name: NAMED.cavityLed, white: on ? 1 : 0 }, 'set led')),

  // mode is an integer on the wire; the page used to send 'inner'/'exhaust' strings.
  setPurifierMode: (mode) =>
    send(CMD.CONTROL_PURIFIER, { mode: Number(mode) }, 'set purifier mode'),

  /** Aim jog and extrude at a head. Selection only - it does not change the tool. */
  selectTool: (i) => { store.activeTool = Number(i) || 0; render(); },

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

  // chrome, from the registry's header declarations
  refreshAll: () => refreshAll(),
  showView: (v) => showView(v),
  openStorage: (kind) => openStorage(kind),
  refreshJobThumb: (f) => refreshJobThumb(f),

  /** The print-task options the header pill edits, straight onto print_task_config. */
  printPrefs: () => {
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
  },

  filamentHelp: () => openDialog({
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
  }),

  reloadStorage: () => openStorage(store.storageKind),
  loadMoreStorage: (n) => (store.storageKind === 'prints' ? handlers.loadHistory(n) : null),

  /** The one useful action from an idle job card: go and find something to print. */
  showFiles: () => { store.storageKind = 'gcodes'; showView('storage'); },

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

  /* ---- machine store.files ---- */
  openRoot: async (root) => {
    store.files = { loading: true, error: '', root: root || store.files.root, roots: store.files.roots, items: [] };
    render();
    try {
      if (!store.files.roots.length) {
        const r = await bridge.request(CMD.FILES_ROOTS, {});
        store.files.roots = Array.isArray(r) ? r : (r && (r.roots || r.result)) || [];
        if (!store.files.root) {
          const first = store.files.roots[0];
          store.files.root = typeof first === 'string' ? first : (first && (first.name || first.root)) || 'gcodes';
        }
      }
      // Firmware builds differ on which listing command answers; try the paged
      // one first and fall back to the directory walk.
      let items = [];
      try {
        const page = await bridge.request(CMD.FILE_LIST_PAGE,
          { root: store.files.root, page_number: 0, files_per_page: 50 });
        items = (page && (page.files || page.items || page.result)) || (Array.isArray(page) ? page : []);
      } catch {
        const dir = await bridge.request(CMD.FILES_GET_DIRECTORY,
          { path: store.files.root, extended: true });
        items = (dir && (dir.files || dir.result)) || [];
      }
      store.files.items = Array.isArray(items) ? items : [];
    } catch (e) {
      store.files.error = `could not read the machine: ${e.message}`;
    }
    store.files.loading = false;
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

  /* ---- camera ---- */
  startCamera: async () => {
    store.cam.error = '';
    store.cam.streaming = true;
    store.cam.frameUrl = null;
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
      const url = ui.cameraFrameUrl(payload, store.device);
      if (!url || url === store.cam.frameUrl) return;
      store.cam.frameUrl = url;
      render();
      startCamPump();
    };

    try {
      camSub = await bridge.subscribe(CMD.CAMERA_START,
        { domain: CAMERA_DOMAIN, interval: CAMERA_INTERVAL, expect_pw: false },
        (data, payload) => useUrl(data !== undefined ? data : payload));
      if (camSub && camSub.ack !== undefined && camSub.ack !== null) useUrl(camSub.ack);
    } catch (e) {
      store.cam.streaming = false;
      store.cam.error = `camera failed: ${e.message}`;
      render();
    }
  },

  stopCamera: async () => {
    store.cam.streaming = false;
    store.cam.frameUrl = null;
    stopCamPump();
    if (camSub && camSub.cancel) camSub.cancel();
    camSub = null;
    render();
    try {
      await bridge.request(CMD.CAMERA_STOP, { domain: CAMERA_DOMAIN });
    } catch { /* already off */ }
  },

  /**
   * Completed jobs from Moonraker's store.history store.
   *
   * `start` pages rather than replacing, so "load more" appends.
   *
   * Measured: the reply's `count` is the number of jobs IN THIS PAGE, not the total -
   * asking for 7 returns count 7 on a machine with 240 jobs. The real total only comes
   * from server.history.totals, which has no bridge command, so paging stops when a
   * short page comes back rather than counting up to a known end.
   */
  loadHistory: async (start = 0) => {
    store.history.loading = start === 0;
    store.history.error = '';
    render();
    try {
      const r = await bridge.request(CMD.PRINT_HISTORY,
                                     { start, limit: HISTORY_PAGE, order: 'desc' });
      const jobs = (r && (r.jobs || r.items)) || (Array.isArray(r) ? r : []);
      store.history.items = start === 0 ? jobs : store.history.items.concat(jobs);
      store.history.hasMore = jobs.length >= HISTORY_PAGE;
    } catch (e) {
      store.history.error = `could not read print history: ${e.message}`;
      if (start === 0) store.history.items = [];
    }
    store.history.loading = false;
    render();
  },

  loadTimelapses: async () => {
    try {
      const r = await bridge.request(CMD.TIMELAPSE_LIST,
        { page_index: 0, page_rows: 24, thumbnail_direct: true });
      // `instances` is the printer's own name for the list, and the reply is now
      // unwrapped from its JSON-RPC envelope before it gets here (see unwrapRpc).
      store.cam.timelapses = (r && (r.instances || r.list || r.items))
                    || (Array.isArray(r) ? r : []);
      store.cam.error = '';
    } catch (e) {
      store.cam.timelapses = [];
      store.cam.error = `could not list recordings: ${e.message}`;
    }
    render();
  },

  /**
   * Play a recording, rather than only offering to delete it.
   *
   * The sheet used to say playback was Orca's job and then show a Delete button, which
   * made "open" mean "destroy". The file is served by Moonraker and the URL is on the
   * instance itself; see timelapseUrl for the port that actually answers with video.
   */
  openTimelapse: (t) => {
    const url = timelapseUrl(store.device, t);
    const name = t.gcode_name || t.name || t.filename || 'Recording';
    openDialog({
      title: name,
      wide: true,
      build: (b) => {
        // Whether this engine can play the file at all is a different question from
        // whether the printer serves it, and they need different answers. Measured:
        // WebKitGTK here reports canPlayType('video/mp4') === '' and fails with
        // MEDIA_ERR_SRC_NOT_SUPPORTED - it ships without H.264. Orca's Windows and
        // macOS webviews do not have that limitation.
        const playable = !!document.createElement('video').canPlayType('video/mp4');
        if (url && playable) {
          const v = document.createElement('video');
          v.src = url;
          v.controls = true;
          v.autoplay = true;
          v.style.cssText = 'width:100%;max-height:52vh;background:#000;border-radius:6px';
          v.onerror = () => {
            v.remove();
            const p = document.createElement('p');
            p.style.cssText = 'margin:4px 0;font-size:13px;color:#9A5B12';
            p.textContent = `The printer did not serve this recording (${url}).`;
            b.prepend(p);
          };
          b.appendChild(v);
        } else if (url) {
          // Show the still it already has, and say why there is no player.
          const thumb = t.thumbnail_base64 || '';
          if (thumb) {
            const im = document.createElement('img');
            im.src = thumb.startsWith('data:') ? thumb : `data:image/jpeg;base64,${thumb}`;
            im.style.cssText = 'width:100%;max-height:40vh;object-fit:contain;'
                             + 'background:#000;border-radius:6px;display:block';
            b.appendChild(im);
          }
          const p = document.createElement('p');
          p.style.cssText = 'margin:10px 0 0;font-size:13px;line-height:1.5;color:#9A5B12';
          p.textContent = 'This browser engine has no H.264 support, so the recording '
                        + 'cannot play here. Download plays it in any video player.';
          b.appendChild(p);
        } else {
          const p = document.createElement('p');
          p.style.cssText = 'margin:4px 0 6px;font-size:13px;color:#39434F';
          p.textContent = 'This recording carries no playable URL.';
          b.appendChild(p);
        }
        const meta = [t.generate_date, t.video_duration,
                      t.video_file_size ? `${(t.video_file_size / 1048576).toFixed(1)} MB` : '']
          .filter(Boolean).join(' \u00B7 ');
        if (meta) {
          const m = document.createElement('p');
          m.style.cssText = 'margin:10px 0 0;font-size:12px;color:#666';
          m.textContent = meta;
          b.appendChild(m);
        }
        // Deleting is still reachable, but it is no longer what opening a recording
        // does. It asks again, because this one cannot be undone.
        const row = document.createElement('div');
        row.style.cssText = 'margin-top:14px;display:flex;gap:10px';
        if (url) {
          const dl = document.createElement('a');
          dl.href = url;
          dl.download = `${name}.mp4`;
          dl.className = 'btn';
          dl.textContent = 'Download';
          row.appendChild(dl);
        }
        const del = document.createElement('button');
        del.className = 'btn';
        del.textContent = 'Delete from printer\u2026';
        del.onclick = () => handlers.deleteTimelapse(t);
        row.appendChild(del);
        b.appendChild(row);
      },
      confirmLabel: 'Close',
      onConfirm: () => true,
    });
  },

  deleteTimelapse: (t) => openDialog({
    title: 'Delete this recording?',
    build: (b) => {
      const p = document.createElement('p');
      p.style.cssText = 'margin:4px 0 6px;font-size:13px;line-height:1.55;color:#39434F';
      p.textContent = `${t.gcode_name || t.name || 'This recording'} will be removed `
                    + 'from the printer. This cannot be undone.';
      b.appendChild(p);
    },
    confirmLabel: 'Delete',
    onConfirm: async () => {
      await send(CMD.TIMELAPSE_DELETE,
                 { date_index: t.date_index || t.dateIndex || '',
                   name: t.name || t.gcode_name || '' }, 'delete recording');
      handlers.loadTimelapses();
    },
  }),

  /* ---- diagnostics ---- */
  queryException: async () => {
    try {
      store.exception = await bridge.request(CMD.EXCEPTION_QUERY, {});
    } catch (e) {
      store.exception = null;
    }
    render();
  },

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
        add('Name', store.device && deviceLabel(store.device));
        add('Model', store.device && store.device[DEVICE.MODEL]);
        add('Serial', store.device && store.device[DEVICE.SN]);
        add('Address', store.device && `${store.device[DEVICE.IP]}:${store.device[DEVICE.PORT] || 8883}`);
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
    store.found = [];
    let dlg;
    const paint = () => {
      const host = document.querySelector('#found-host');
      if (!host) return;
      host.innerHTML = '';
      if (!store.found.length) {
        const p = document.createElement('div');
        p.className = 'empty';
        p.textContent = 'Searching the network…';
        host.appendChild(p);
        return;
      }
      store.found.forEach((m) => {
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
        if (list.length) { store.found = list; paint(); }
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

  /* ---- saved-store.device management ---- */
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

/**
 * What a panel is handed, and the only thing it may read.
 *
 * Three things, and they are three because they answer three different questions:
 *
 *   state    what the MACHINE says. A mirror, not a memory.
 *   store    what the PAGE knows - which view, which tab, what it has fetched.
 *   pending  what has been ASKED FOR and not yet confirmed. Neither of the above:
 *            keeping a request in the thing that mirrors the machine is the bug that
 *            has now been found in three separate controls.
 *
 * `handlers` is the fourth member and is on its way out - it is still one flat bag of
 * forty functions handed to every panel, which is why nothing but each panel's `sends`
 * declaration records who uses what.
 *
 * The store is passed rather than copied. Panels hold this object from the moment they
 * mount, and a frame's worth of values copied into a fresh object every repaint is how
 * a stale `device` reaches a renderer that has been alive longer than the copy.
 */
const ctx = { state, store, pending, handlers, storageData };

/* ---- render ------------------------------------------------------- */








/**
 * Fetch the printing file's thumbnail, once.
 *
 * Keyed on the filename, so a card repainting every second asks the printer nothing.
 * `sw_FilesThumbnailsBase64` is the only command that returns bytes - the other one
 * returns paths, which is what made thumbnails silently absent before.
 */
function refreshJobThumb(file) {
  if (store.jobThumb.file === (file || null)) return;
  store.jobThumb = { file: file || null, data: null };
  if (!file) return;
  const asked = file;
  bridge.request(CMD.FILE_THUMBS_B64, { path: file })
    .then((r) => {
      if (store.jobThumb.file !== asked) return;      // the job moved on while we asked
      store.jobThumb.data = pickThumb(r);
      if (store.jobThumb.data) render();
    })
    .catch(() => { /* no thumbnail is a normal answer; the card shows its placeholder */ });
}

/**
 * What Storage is showing, in the one shape its grid reads.
 *
 * Four different sources - recordings, store.history, and two file roots - normalised here
 * rather than in the renderer, so the store.view stays one thing.
 */
function storageData() {
  if (store.storageKind === 'timelapses') {
    return { items: store.cam.timelapses || [], loading: false, error: store.cam.error || '' };
  }
  if (store.storageKind === 'prints') {
    return { items: store.history.items || [], loading: store.history.loading,
             error: store.history.error, hasMore: store.history.hasMore };
  }
  return { items: store.files.items || [], loading: store.files.loading, error: store.files.error };
}

/** The root each file-backed kind reads from. */
const STORAGE_ROOT = { gcodes: 'gcodes', logs: 'logs' };

function openStorage(kind) {
  store.storageKind = kind;
  // No cache to bust: the rebuild guard is keyed on `kind:shape`, so changing kind
  // rebuilds by construction rather than by remembering to invalidate something.
  if (kind === 'timelapses') handlers.loadTimelapses();
  else if (kind === 'prints') handlers.loadHistory();
  else handlers.openRoot(STORAGE_ROOT[kind]);
  render();
}

function showView(next) {
  store.view = next;
  render();
  if (next === 'storage') openStorage(store.storageKind);
}

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
    store.reachable = session.isLive() && (!conn.state || conn.state === 'ready');

    ui.renderRail(store.device, conn, store.devices, store.reachable);
    paint(ctx, store.view);
  });
}

/* ---- trace pause toggle ------------------------------------------- */
/* ---- connecting ----------------------------------------------------- */





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


/* ---- chrome interactions ------------------------------------------- */




/**
 * Re-read everything the page shows. This is what the header refresh buttons do.
 *
 * Measured by clicking the shipped page's own refresh pill and watching what left it:
 * it re-subscribes, re-declares the field filter, takes a fresh snapshot, then re-reads
 * the system info, the file status, the store.exception state and the file roots. Both of its
 * pills - Control and Filament - send the identical set.
 *
 * The rebuild's buttons used to call `refresh()`, which re-reads Orca's DEVICE BOOK:
 * two commands that say nothing about the machine, so pressing refresh changed nothing
 * a user could see.
 */
async function refreshAll() {
  await refresh();                       // the device list, as it always did
  if (!state.lastUpdate && !session.engineId) return;   // nothing to re-read yet
  await session.startStateStream('refresh');     // filter + snapshot + subscription, and it
                                         // re-reads homed_axes on its own way out
  handlers.queryException();
  bridge.request(CMD.GET_MACHINE_SYSTEM_INFO, {}).catch(() => {});
  bridge.request(CMD.FILE_STATUS, {}).catch(() => {});
  bridge.request(CMD.FILES_ROOTS, {}).catch(() => {});
  render();
}

async function refresh() {
  try {
    store.devices = asDeviceList(await bridge.request(CMD.GET_LOCAL_DEVICES, {}));
    const c = await bridge.request(CMD.GET_CONNECTED_MACHINE, {});
    store.device = (c && Object.keys(c).length) ? c
           : (store.devices.find((d) => d[DEVICE.CONNECTED]) || store.devices[0] || null);
  } catch (e) {
    setStatus(`refresh failed: ${e.message}`, 'err');
  }
  render();
}


/**
 * The store.device selector's menu.
 *
 * The only chrome left in this file: it is about the *page's* relationship to Orca -
 * which machines are saved, connect, pair, rename, forget, discover - rather than about
 * any one panel, so it has no panel to belong to. Panel headers are declared in
 * js/panels/registry.js and built by js/shell.js.
 */
function wireDeviceMenu() {
  const sel = ui.$('#device-select');
  sel.setAttribute('data-menu-anchor', '');
  sel.onclick = () => {
    const items = store.devices.length
      ? store.devices.map((d) => ({
          label: deviceLabel(d) + (d[DEVICE.CONNECTED] ? '' : '  (not connected)'),
          icon: 'deviceControl',
          muted: !d[DEVICE.CONNECTED],
          onClick: () => {
            store.device = d;
            render();
            if (!d[DEVICE.CONNECTED]) session.connect(d);
          },
        }))
      : [{ label: 'No printers saved', icon: 'deviceControl', muted: true }];
    items.push(null);
    // Disconnect is only offered for a session this page created - the engine is
    // addressed by the id sw_create_mqtt_client handed back, and a session Orca
    // brought up on its own has no id we can name.
    // Gated on live evidence, not on DeviceInfo.connected: that flag is force-cleared
    // on every config save (AppConfig.cpp:887), so it read false for a machine that was
    // right there - and could read true for a session that had died. Connect was being
    // offered, and withheld, on the strength of a field that answers neither question.
    if (store.device && session.engineId && session.isLive()) {
      items.push({ label: 'Disconnect', icon: 'iconHome', onClick: () => session.disconnect() });
    } else if (store.device) {
      items.push({
        label: hasTlsMaterial(store.device) ? 'Connect now' : 'Pair and connect…',
        icon: 'deviceControl',
        onClick: () => { session.resetBackoff(); session.connect(store.device); },
      });
    }
    if (store.device) {
      items.push({ label: 'Rename…', icon: 'iconEdit',
                   onClick: () => handlers.renameDevice(store.device) });
      items.push({ label: 'Forget this printer…', icon: 'delete',
                   onClick: () => handlers.forgetDevice(store.device) });
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
}

window.addEventListener('DOMContentLoaded', () => {
  buildShell(ctx);
  wireDeviceMenu();
  boot().catch((e) => {
    console.error(e);
    setStatus(`startup failed: ${e.message}`, 'err');
  });
});

// expose for console poking during RE work, and for the screenshot harness
window.__devicePage = { get state() { return state; }, get bridge() { return bridge; },
                        get device() { return store.device; },
                        get devices() { return store.devices; },
                        store, pending, handlers, mock: null };
