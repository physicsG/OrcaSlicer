/*
 * app.js - the print-processing popup.
 *
 * Orca opens this modal at ?path=4 or ?path=5 and the route decides one thing: whether
 * the print half is drawn. Everything else is the same dialog.
 *
 *   ?mode=print   ?path=4  preUploadAndPrint   (default)
 *   ?mode=upload  ?path=5  preUpload
 *   ?mock=1       force the simulator
 *
 * Startup reads the two sources this surface reconciles - the FILE from Orca, the
 * MACHINE from the state stream - and then does nothing on its own until something
 * changes. See core/session.js for why neither is derived from the other.
 */
'use strict';

import { CMD, PRINT_PREFERENCES } from '../../shared/js/protocol.js';
import { Sswcp } from '../../shared/js/sswcp.js';
import { MachineState } from '../../shared/js/state.js';
import { mountBuildBadge } from '../../shared/js/buildinfo.js';
import { $, el } from '../../shared/js/dom.js';
import { text, data } from '../../shared/js/render.js';
import { Pending } from '../../shared/js/pending.js';
import { installMock } from './core/mock.js';
import { buildShell } from './core/shell.js';
import { readJob, subscribeState, fileFilaments, machineToolheads,
         nozzleMismatch, initialAssignment } from './core/session.js';
import { runSend, close as closeDialog, SEND_STATE, BUSY } from './core/send.js';
import { closePicker } from './widgets/picker.js';
import { makeTrace } from '../../shared/js/trace.js';
import { openDialog } from '../../shared/js/dialog.js';
import { percent0 } from './widgets/format.js';
import * as printerCmds from './views/printer/printer-commands.js';
import * as filamentCmds from './views/filament/filament-commands.js';
import * as prefCmds from './views/preferences/preferences-commands.js';
import { MAPPING_STATUS } from '../../shared/js/protocol.js';

const qs = new URLSearchParams(location.search);
const ROUTE = qs.get('mode') === 'upload' ? 'upload' : 'print';
const WITH_PRINT_SETUP = ROUTE === 'print';
const WANT_MOCK = qs.get('mock') === '1';

const state = new MachineState();
/*
 * A request is held until the machine reports it. `onChange` fires when one starts or is
 * refused - the two moments there is something new to show and nothing on the state
 * stream about to prompt a repaint.
 */
const pending = new Pending({ onChange: () => render() });

/** Everything the panels read. One object, so a panel cannot reach past it. */
const model = {
  file: null, mapping: null, legal: null, device: null, devices: [],
  filaments: [], toolheads: [], assignment: {}, prefs: {},
  nozzleMismatch: false, errors: [],
  send: { state: SEND_STATE.IDLE, progress: 0, detail: '' },
};

let bridge = null;
let mounted = [];
let trace = () => {};

/* ---- the context every panel is handed ------------------------------- */
const ctx = {
  get: () => model,
  dialog: () => document.body,

  chooseDevice(id) {
    const d = model.devices.find(
      (x) => String(x.dev_id || x.sn || x.ip || x.dev_name) === String(id));
    if (d) { model.device = d; render(); }
  },
  addDevice() {
    printerCmds.addDevice(bridge).catch((e) => say(`add device: ${e.message}`, 'err'));
  },

  /**
   * Assign a file filament to a toolhead.
   *
   * Held through `pending` until `print_task_config.extruder_map_table` reports it: the
   * machine echoes about a second later, and writing the click into the object that
   * mirrors the machine is how the next push puts the old value back. That bug has been
   * found three times on the Device page; this is the fourth control and it gets the
   * mechanism for free.
   */
  assign(fil, toolhead) {
    model.assignment[fil.key] = toolhead;
    // `track` records the request and wires the command's own outcome into it, so a
    // refusal stops the hold immediately rather than waiting out the timeout.
    pending.track(`map:${fil.key}`, toolhead, filamentCmds.writeAssignment(bridge, {
      fileIndex: fil.index,
      toolhead,
      allToolheads: model.filaments.map((f) => model.assignment[f.key]),
    })).catch((e) => say(`could not set the mapping: ${e.message}`, 'err'));
  },

  prefValue: (key) => !!model.prefs[key],
  togglePreference(key, value) {
    model.prefs[key] = value;
    pending.track(`pref:${key}`, value, prefCmds.writePreference(bridge, key, value))
      .catch((e) => say(`could not set ${key}: ${e.message}`, 'err'));
  },

  /**
   * The help control on Extrusion Flow Calibration opens a DIALOG, not a tooltip -
   * `A.rB(...)` with a title, a paragraph and an Ok. The sheet is the shared one the
   * Device page uses; `cancel: false` because offering both Cancel and Ok for one
   * dismissal is a choice that is not one.
   */
  explain({ title, body }) {
    openDialog({
      title,
      build: (root) => root.appendChild(el('p', null, body)),
      confirmLabel: 'Ok',
      cancel: false,
      onConfirm: () => true,
    });
  },

  async refresh(panelId) {
    if (panelId !== 'filament') return;
    try {
      const m = await filamentCmds.refreshMapping(
        bridge, (model.file && model.file.filename) || '');
      if (m) { model.mapping = m; recomputeFile(); render(); }
    } catch (e) { say(`refresh: ${e.message}`, 'err'); }
  },
};

/* ---- status line ------------------------------------------------------ */
function say(message, kind = '') {
  const n = $('#status');
  n.hidden = !message;
  text(n, message || '');
  data(n, 'kind', kind || null);
}

/* ---- derive ----------------------------------------------------------- */
function recomputeFile() {
  model.filaments = fileFilaments(model.mapping);
  const fresh = initialAssignment(model.mapping, model.filaments);
  // Keep anything the operator has already chosen; only fill in what is new.
  model.filaments.forEach((f) => {
    if (model.assignment[f.key] == null) model.assignment[f.key] = fresh[f.key];
  });
}

function recomputeMachine() {
  model.toolheads = machineToolheads(state);
  model.nozzleMismatch = WITH_PRINT_SETUP && nozzleMismatch(
    model.filaments.map((f) => f.nozzle),
    model.toolheads.map((h) => h.nozzleDiameter));

  /*
   * `resolve(key, mirror)` is the tick: hand it what the machine reports and it returns
   * what to show. It confirms a value the machine has caught up with, keeps holding one
   * still in flight, and gives up on one the machine never echoed - which is the case
   * that matters, because an instant `ok` and a silently ignored setpoint look the same.
   */
  const tc = state.objects['print_task_config'] || {};
  PRINT_PREFERENCES.forEach(({ key }) => {
    model.prefs[key] = !!pending.resolve(`pref:${key}`, !!tc[key]).value;
  });

  // `extruder_map_table` is a flat array of THIRTY-TWO - one entry per possible tool,
  // not one per slot. Measured on 811002511261022618B3.
  const table = Array.isArray(tc.extruder_map_table) ? tc.extruder_map_table : null;
  model.filaments.forEach((f) => {
    const mirror = table && table[f.index] != null
      ? Number(table[f.index])
      : model.assignment[f.key];
    model.assignment[f.key] = pending.resolve(`map:${f.key}`, mirror).value;
  });
}

/* ---- render ----------------------------------------------------------- */
let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    recomputeMachine();
    mounted.forEach(({ panel, root }) => panel.update(root, model, ctx));
    renderSendBar();
  });
}

function renderSendBar() {
  const btn = $('#send');
  const s = model.send;
  data(btn, 'state', s.state);
  $('#bar-fill').style.width = `${Math.round(s.progress * 100)}%`;
  text($('#pct'), percent0(s.progress));

  const busy = BUSY.has(s.state);
  // `A.Jb.aEL()` shows a spinner in place of the label whenever the state is in flight.
  data(btn, 'busy', busy ? '1' : null);
  text(btn, busy ? '' : (s.state === SEND_STATE.DONE ? 'Sent'
                       : ROUTE === 'upload' ? 'Send' : 'Send'));
  btn.disabled = busy || s.state === SEND_STATE.DONE || !model.device;
}

/* ---- boot ------------------------------------------------------------- */
async function boot() {
  trace = makeTrace($('#trace'));

  let mock = null;
  if (WANT_MOCK || !Sswcp.hasHost()) {
    mock = installMock({
      log: trace,
      onDialogClose: (ok) => say(ok ? 'dialog closed: success' : 'dialog closed: canceled',
                                 ok ? 'ok' : 'warn'),
    });
    say('simulated host (no Orca)', 'mock');
  }
  bridge = new Sswcp({ log: trace });

  ctx.dialog = () => document.body;
  mounted = buildShell($('#body'), ROUTE, ctx);
  data(document.body, 'route', ROUTE);

  const job = await readJob(bridge, { log: (what, e) => trace('warn', { what, e }) });
  Object.assign(model, {
    file: job.file, mapping: job.mapping, legal: job.legal, errors: job.errors,
    devices: job.devices,
  });
  // sw_GetConnectedMachine returns a device only when one is connected; the saved list
  // is what the picker offers when none is.
  model.device = job.device && Object.keys(job.device).length ? job.device
               : (job.devices || []).find((d) => d.connected) || null;
  recomputeFile();

  try {
    await subscribeState(bridge, state, { log: (w, e) => trace('warn', { w, e }) });
  } catch (e) {
    say(`no machine state: ${e.message}`, 'warn');
  }
  // On the repaint is not good enough for anything whose consequence is elsewhere, but
  // this one only repaints - see device_page/js/core/orcasync.js for the other case.
  state.onChange(render);

  if (job.errors.length) say(job.errors[0], 'warn');
  render();

  mountBuildBadge($('#build-badge'), 'Print processing', bridge)
    .then((info) => { window.__preprint.build = info; })
    .catch(() => {});

  window.__preprint.mock = mock;
  window.__preprint.ready = true;
}

/* ---- the send --------------------------------------------------------- */
async function doSend() {
  closePicker();
  say('');
  const ok = await runSend({
    bridge,
    device: model.device,
    withPrintSetup: WITH_PRINT_SETUP,
    onState: (s, detail) => {
      model.send.state = s;
      model.send.detail = detail || '';
      if (s === SEND_STATE.FAILED) say(detail || 'send failed', 'err');
      render();
    },
    onProgress: (f) => { model.send.progress = f; render(); },
  });
  if (ok) say('sent', 'ok');
}

window.addEventListener('DOMContentLoaded', () => {
  $('#send').onclick = () => doSend();
  boot().catch((e) => {
    console.error(e);
    say(`startup failed: ${e.message}`, 'err');
  });
});

/** Handed to --drive scripts. The model is live, not a copy. */
window.__preprint = {
  route: ROUTE,
  get state() { return state; },
  get bridge() { return bridge; },
  get model() { return model; },
  get pending() { return pending; },
  ctx, render, mock: null, ready: false,
  /** Cancelling takes the close protocol's other outcome. */
  cancel: () => closeDialog(bridge, MAPPING_STATUS.CANCELED),
};
