/*
 * app.js - wiring for the print-processing popup.
 *
 * Startup mirrors the shipped popup's own order (docs:
 * 03-print-processing/02-lifecycle.md):
 *   1. sw_GetActiveFile               which file Orca is about to send
 *   2. sw_GetConnectedMachine         which printer is attached
 *   3. sw_GetPrintLegal               does the preset match that printer
 *   4. sw_GetFileFilamentMapping      what filaments the file needs
 *   5. sw_SetSubscribeFilter + sw_SubscribeMachineState
 *                                     so print_task_config stays live
 *
 * Two modes, matching Orca's two routes:
 *   ?mode=print   -> ?path=4  preUploadAndPrint  (filament + preferences shown)
 *   ?mode=upload  -> ?path=5  preUpload          (those sections hidden)
 */
'use strict';

import { CMD, SUBSCRIBE_OBJECTS, MAPPING_STATUS, TASK_CONFIG }
  from '../../shared/js/protocol.js';
import { Sswcp } from '../../shared/js/sswcp.js';
import { MachineState } from '../../shared/js/state.js';
import { mountBuildBadge } from '../../shared/js/buildinfo.js';
import { installMock } from './mock.js';
import * as ui from './ui.js';

const qs = new URLSearchParams(location.search);
const wantMock = qs.get('mock') === '1';
/** upload-only is ?path=5 in Orca; anything else is the print flow. */
const MODE = qs.get('mode') === 'upload' ? 'upload' : 'print';
const WITH_PRINT_SETUP = MODE === 'print';

const state = new MachineState();
let bridge = null;
let device = null;
let legal = null;
let file = { filename: '', predictionTime: 0, weight: 0 };
let mapping = null;
let prefs = {};
let trace = () => {};
let uploadPct = 0;

function setStatus(text, kind = '') {
  const n = ui.$('#status');
  n.textContent = text;
  n.className = 'status ' + kind;
}

async function boot() {
  trace = ui.makeTrace(ui.$('#trace'));

  let mock = null;
  if (wantMock || !Sswcp.hasHost()) {
    mock = installMock({ log: trace, onClose: (ok) => setStatus(
      ok ? 'dialog closed: success' : 'dialog closed: canceled', ok ? 'ok' : 'warn') });
    window.__preprint.mock = mock;
    setStatus('simulated host (no Orca)', 'mock');
  } else {
    setStatus('connected to Orca', 'ok');
  }
  ui.$('#mode').textContent = (mock ? 'MOCK' : 'LIVE') + ' · '
    + (WITH_PRINT_SETUP ? 'path=4 upload+print' : 'path=5 upload only');
  ui.$('#mode').className = 'mode ' + (mock ? 'mock' : 'live');

  bridge = new Sswcp({ log: trace });

  try {
    const f = await bridge.request(CMD.GET_ACTIVE_FILE, {});
    if (f && f.filename) file.filename = f.filename;
  } catch (e) { console.warn('[preprint] active file:', e.message); }

  try {
    device = await bridge.request(CMD.GET_CONNECTED_MACHINE, {});
  } catch (e) {
    console.warn('[preprint] no connected machine:', e.message);
    setStatus('no connected machine', 'warn');
  }

  if (device) {
    try {
      legal = await bridge.request(CMD.GET_PRINT_LEGAL, {
        connected_model: device.model_name || device.machineType || '',
      });
    } catch (e) { console.warn('[preprint] legality check:', e.message); }
  }

  if (WITH_PRINT_SETUP) await loadMapping();

  // print_task_config arrives over the shared state subscription - the same
  // objects and field filter the Device tab uses.
  try {
    await bridge.request(CMD.SET_SUBSCRIBE_FILTER, { objects: SUBSCRIBE_OBJECTS });
    const snap = await bridge.request(CMD.GET_MACHINE_STATE, { objects: SUBSCRIBE_OBJECTS });
    state.applyPayload(snap);
    await bridge.subscribe(CMD.SUBSCRIBE_MACHINE_STATE, {}, (d) => state.applyPayload(d));
  } catch (e) { console.warn('[preprint] state:', e.message); }

  prefs = Object.assign({}, state.taskConfig());
  state.onChange(render);
  render();

  mountBuildBadge(ui.$('#build-badge'), 'Print processing', bridge)
    .then((info) => { window.__preprint.build = info; })
    .catch(() => {});
}

async function loadMapping() {
  try {
    mapping = await bridge.request(CMD.GET_FILE_FILAMENT_MAPPING,
                                   { filename: file.filename });
    if (mapping) {
      file.predictionTime = mapping.prediction_time ?? file.predictionTime;
      file.weight = mapping.weight ?? file.weight;
    }
  } catch (e) {
    console.warn('[preprint] filament mapping:', e.message);
  }
}

/* ---- handlers ------------------------------------------------------ */

const handlers = {
  pickPrinter: () => setStatus('printer picker not implemented in this reconstruction', 'warn'),

  refreshFilament: async () => { await loadMapping(); render(); },

  assignSlot: (filamentIndex, toolhead) => {
    if (!mapping || !mapping.filaments[filamentIndex]) return;
    mapping.filaments[filamentIndex].extruder = toolhead;
    const table = mapping.filaments.map((f) => Number(f.extruder) || 0);
    bridge.request(CMD.UPDATE_MACHINE_FILAMENT_INFO,
                   { [TASK_CONFIG.MAP_TABLE]: table })
          .catch((e) => console.warn('[preprint] update mapping:', e.message));
    render();
  },

  setPreference: (key, value) => {
    prefs[key] = value;
    bridge.request(CMD.UPDATE_MACHINE_FILAMENT_INFO, { [key]: value })
          .catch((e) => console.warn('[preprint] update preference:', e.message));
    render();
  },

  /**
   * Send. Mirrors the real close protocol: report the outcome, record the
   * result, then close - three separate commands, in that order.
   */
  send: async () => {
    const btn = ui.$('#send');
    btn.disabled = true;
    setStatus('uploading…');
    try {
      await bridge.request(CMD.GET_PRINT_ZIP, {});
      for (let p = 0; p <= 100; p += 10) {
        uploadPct = p;
        ui.renderSend(uploadPct, false, 'Sending…');
        await new Promise((r) => setTimeout(r, 60));
      }
      if (WITH_PRINT_SETUP) await bridge.request(CMD.START_LOCAL_PRINT, {});
      await bridge.request(CMD.FINISH_PREPRINT, { status: 'success' });
      await bridge.request(CMD.SET_FILAMENT_MAPPING_COMPLETE,
                           { status: MAPPING_STATUS.SUCCESS });
      await bridge.request(CMD.FINISH_FILAMENT_MAPPING, {});
      setStatus('sent', 'ok');
      ui.renderSend(100, false, 'Sent');
    } catch (e) {
      setStatus(`send failed: ${e.message}`, 'err');
      await bridge.request(CMD.FINISH_PREPRINT, { status: 'failed' }).catch(() => {});
      ui.renderSend(uploadPct, true, 'Send');
    }
  },
};

/* ---- render -------------------------------------------------------- */

let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const tc = Object.assign({}, state.taskConfig(), prefs);

    ui.renderModel(ui.$('#model'), file);
    ui.renderPrinter(ui.$('#printer'), device, legal, handlers);

    // path=5 (upload only) drops filament mapping and print preferences
    // entirely - that is the whole difference between the two routes.
    const filCard = ui.$('#filament');
    const prefCard = ui.$('#preferences');
    filCard.hidden = !WITH_PRINT_SETUP;
    prefCard.hidden = !WITH_PRINT_SETUP;
    if (WITH_PRINT_SETUP) {
      ui.renderFilament(filCard, mapping, tc, handlers);
      ui.renderPreferences(prefCard, tc, handlers);
    }

    // Send needs a printer, and a legal preset match when one was checked.
    const ready = !!device && (!legal || legal.legal !== false);
    ui.renderSend(uploadPct, ready, 'Send');
  });
}

window.addEventListener('DOMContentLoaded', () => {
  ui.$('#send').onclick = () => handlers.send();
  boot().catch((e) => {
    console.error(e);
    setStatus(`startup failed: ${e.message}`, 'err');
  });
});

window.__preprint = {
  get state() { return state; }, get bridge() { return bridge; },
  get mapping() { return mapping; }, get device() { return device; },
  mode: MODE, handlers, mock: null,
};
