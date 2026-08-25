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
// aliased: this file has its own render()
import * as renderPrims from './render.js';
import * as cmdPage from './commands/page.js';
import * as cmdControl from './commands/control.js';
import * as cmdTask from './commands/task.js';
import * as cmdCamera from './commands/camera.js';
import * as cmdFilament from './commands/filament.js';
import * as cmdStorage from './commands/storage.js';
import * as cmdFault from './commands/fault.js';
import * as cmdDevice from './commands/device.js';

const qs = new URLSearchParams(location.search);
const wantMock = qs.get('mock') === '1';

const state = new MachineState();
// What the machine says, what the page knows, and what has been asked for but not yet
// confirmed. Three stores because they answer three different questions - see ctx below.
const store = createStore();
let bridge = null;
let trace = () => {};
// Every control that has asked the machine for something and is waiting to be told it
// happened. One store, because the request-vs-mirror bug has now been found in three
// separate controls; see pending.js.
const pending = new Pending({ onChange: () => render() });

// Diagnostics and the session both start before the bridge does, and both take it as a
// getter for that reason - the first thing worth logging is often that it never arrived.
const hostLog = createLog(() => bridge);

// Every command, merged, and empty until the modules below fill it. Declared up here
// because the session is built before them and holds a reference: it needs the device
// list re-read on a reconnect, which is a page-level command.
const all = {};

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
  refresh: () => all.refresh(),
  handlers: all,
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


/*
 * The command modules, one per panel plus two that belong to no panel.
 *
 * Each panel is handed its own module merged with the page-level one, and nothing else -
 * so a renderer reaching for a command its panel does not own is a TypeError rather than
 * a silent cross-panel dependency. `handlers` used to be one flat bag of forty-three
 * functions given whole to every renderer, and the only record of who used what was a
 * hand-written `sends` list in the registry.
 *
 * That is the point of the split: check_coverage.py reads the CMD references out of
 * `commands/<panel>.js` and attributes them to that panel because that is the module the
 * panel is given. The attribution is a fact about the imports rather than a promise.
 *
 * `all` is how the modules reach each other - showFiles opens Storage, a reconnect
 * re-reads the device list. Those crossings are few and are meant to stay visible.
 */
const MODULES = {
  page: cmdPage, control: cmdControl, task: cmdTask, camera: cmdCamera,
  filament: cmdFilament, storage: cmdStorage, fault: cmdFault, device: cmdDevice,
};
const deps = {
  // a getter: boot() decides between the real host and the simulator, long after this
  get bridge() { return bridge; },
  state, store, pending, session, cmd: all,
  send, setpoint, setStatus, render: () => render(),
};
const byModule = {};
for (const [name, mod] of Object.entries(MODULES)) {
  byModule[name] = mod.create(deps);
  Object.assign(all, byModule[name]);
}

/** What one panel may call: its own commands, plus the page-level ones. */
const commandsFor = (id) => ({ ...byModule.page, ...(byModule[id] || {}) });

/**
 * What a panel is handed, and the only thing it may read.
 *
 * Four things, and they are four because they answer four different questions:
 *
 *   state        what the MACHINE says. A mirror, not a memory.
 *   store        what the PAGE knows - which view, which tab, what it has fetched.
 *   pending      what has been ASKED FOR and not yet confirmed. Neither of the above:
 *                keeping a request in the thing that mirrors the machine is the bug
 *                that has now been found in three separate controls.
 *   commandsFor  what THIS panel may do. Scoped, so the answer to "who calls this" is
 *                the module list rather than a search.
 *
 * The store is passed rather than copied. Panels hold this object from the moment they
 * mount, and a frame's worth of values copied into a fresh object every repaint is how
 * a stale `device` reaches a renderer that has been alive longer than the copy.
 */
const ctx = {
  state, store, pending, commandsFor,
  // the rail's device menu is not a panel, so it takes its module directly
  handlers: { ...byModule.page, ...byModule.device },
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
    store.reachable = session.isLive() && (!conn.state || conn.state === 'ready');

    ui.renderRail(store.device, conn, store.devices, store.reachable);
    paint(ctx, store.view);
  });
}

/* ---- trace pause toggle ------------------------------------------- */
/* ---- connecting ----------------------------------------------------- */


/* ---- chrome interactions ------------------------------------------- */


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
                   onClick: () => ctx.handlers.renameDevice(store.device) });
      items.push({ label: 'Forget this printer…', icon: 'delete',
                   onClick: () => ctx.handlers.forgetDevice(store.device) });
    }
    items.push(null);
    items.push({ label: 'Printer information…', icon: 'deviceControl',
                 onClick: () => ctx.handlers.showSystemInfo() });
    items.push({ label: 'Defect detection…', icon: 'exclamationMark',
                 onClick: () => ctx.handlers.showDefectSettings() });
    items.push(null);
    items.push({ label: 'Find printers…', icon: 'iconScan',
                 onClick: () => ctx.handlers.findMachines() });
    items.push({ label: 'Add Device', icon: 'iconHome',
                 onClick: () => send(CMD.ADD_DEVICE, {}, 'add device') });
    items.push({ label: 'Connect another machine…', icon: 'iconHome',
                 onClick: () => ctx.handlers.connectOther() });
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
// `render` is here for the harness rather than for console poking: keyedList is DOM
// reconciliation, so the only honest place to test it is a real DOM, and run_webkit.py's
// checks run as a classic script that cannot import a module.
window.__devicePage = { get state() { return state; }, get bridge() { return bridge; },
                        get device() { return store.device; },
                        get devices() { return store.devices; },
                        store, pending, render: renderPrims,
                        handlers: all, byModule, mock: null };
