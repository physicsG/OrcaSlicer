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
import { mergeAceBays } from '../../shared/js/multiACE.js';
import { mountBuildBadge } from '../../shared/js/buildinfo.js';
import { $, el } from '../../shared/js/dom.js';
import { text, data } from '../../shared/js/render.js';
import { Pending } from '../../shared/js/pending.js';
import { installMock } from './core/mock.js';
import { buildShell } from './core/shell.js';
import { readJob, subscribeState, fileFilaments, machineToolheads,
         nozzleMismatch, initialAssignment, matchOf,
         filePlan, refreshAce, syncBays, reconcile, bayFix } from './core/session.js';
import { runSend, close as closeDialog, SEND_STATE, BUSY } from './core/send.js';
import { closePicker } from './widgets/picker.js';
import { makeTrace } from '../../shared/js/trace.js';
import { openDialog } from '../../shared/js/dialog.js';
import { percent0 } from './widgets/format.js';
import * as printerCmds from './views/printer/printer-commands.js';
import * as filamentCmds from './views/filament/filament-commands.js';
import * as prefCmds from './views/preferences/preferences-commands.js';
import * as groupCmds from './views/grouping/grouping-commands.js';
import { MAPPING_STATUS } from '../../shared/js/protocol.js';

const qs = new URLSearchParams(location.search);
const ROUTE = qs.get('mode') === 'upload' ? 'upload' : 'print';
/* Simulator only: give the mock a plate sliced onto an ACE. No Orca sends one yet. */
const MOCK_PLAN = qs.get('plan');
const WITH_PRINT_SETUP = ROUTE === 'print';
const WANT_MOCK = qs.get('mock') === '1';

const state = new MachineState();
/** Every status line this page has shown, oldest first. Read by --drive scripts. */
const said = [];
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
  /*
   * The ACE half. `plan` is null on every plate the slicer can produce on this branch,
   * and everything below it is inert while it is: the grouping panel is hidden, the four
   * cards are the panel, and the dialog is the one that already ships.
   */
  plan: null, ace: { present: false, units: [] }, aceBays: null,
  check: { rows: [], differs: 0, unsure: 0, checked: false },
  nozzleMismatch: false, errors: [], connected: false,
  send: { state: SEND_STATE.IDLE, progress: 0, detail: '' },
};

let bridge = null;
let mockHost = null;
let mounted = [];
let trace = () => {};

/* ---- the context every panel is handed ------------------------------- */
const ctx = {
  get: () => model,
  dialog: () => document.body,

  /*
   * Picking a printer is not only bookkeeping: nothing has brought a transport up to
   * THAT machine, so the machine half has to come up again against it. Without this the
   * dialog would show a chosen printer and four toolheads reading NONE - which looks
   * like a printer with nothing loaded, and is the one wrong state that is plausible
   * enough to be acted on.
   */
  chooseDevice(id) {
    const d = model.devices.find(
      (x) => String(x.dev_id || x.sn || x.ip || x.dev_name) === String(id));
    if (!d || d === model.device) return;
    model.device = d;
    model.connected = false;
    render();
    bringUpMachine().then(bringUpAce);
  },
  /**
   * Take the bays the machine actually has, without slicing anything again.
   *
   * The host re-runs the rewriter over the same logical gcode with the chosen bays, which
   * changes one argument on each swap line and nothing else, and answers with the new plan.
   * A refusal comes back as a sentence and is shown rather than swallowed.
   */
  fixBays() {
    const slots = model.bayFix;
    if (!slots || model.busy) return;
    ctx.setAcePlan({ slots }, 'The bays were re-addressed. Nothing was re-sliced.');
  },

  /**
   * Send this filament somewhere else: a bay of its own head, or another toolhead.
   *
   * A bay is free. A toolhead re-writes the gcode, and moving one onto a head that already
   * prints something is what makes the ACE swap mid-print - which is a thing to choose, not
   * a thing to be given, so it only ever happens from here.
   */
  setSource(filament, where) {
    if (model.busy || filament == null) return;
    const f = String(filament);
    /* Both at once is the interesting case: choosing a filament for an unused bay moves it
       to that toolhead AND says which bay it comes from, which is one request, not two. */
    if (where.head != null && where.slot != null)
      ctx.setAcePlan({ heads: { [f]: where.head }, slots: { [f]: where.slot } },
                     'Moved, and drawn from that bay. The G-code was written again, not re-sliced.');
    else if (where.slot != null)
      ctx.setAcePlan({ slots: { [f]: where.slot } }, 'Re-addressed. Nothing was re-sliced.');
    else if (where.head != null)
      ctx.setAcePlan({ heads: { [f]: where.head } },
                     'Moved to another toolhead. The G-code was written again, not re-sliced.');
  },

  setAcePlan(params, note) {
    model.busy = true;
    render();
    groupCmds.setAcePlan(bridge, params)
      .then((reply) => {
        const plan = reply && (reply.ace_plan || (reply.data && reply.data.ace_plan));
        if (plan) model.mapping = { ...model.mapping, ace_plan: plan };
        recomputeFile();
        say(note, 'ok');
      })
      .catch((e) => say(`could not change the plan: ${e.message}`, 'err'))
      .finally(() => { model.busy = false; render(); });
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
/*
 * The one-line host status. Every call is also kept on `__preprint.said`, because a
 * drive script needs to know WHAT the page reported and not merely what is on screen
 * now - "connecting", then "no route to host" is a different story from never trying,
 * and only the second line survives to be read off the DOM.
 */
function say(message, kind = '') {
  said.push(`${kind || '-'}: ${message}`);
  const n = $('#status');
  n.hidden = !message;
  text(n, message || '');
  data(n, 'kind', kind || null);
}

/* ---- derive ----------------------------------------------------------- */
function recomputeFile() {
  /*
   * The plan first, because it decides which filaments survive the usage filter. On a
   * real ACE plate three of seven report zero grams - the usage arrays are indexed by
   * emitted extruder while the type array is indexed by project filament - and a filament
   * the plan references is printed whatever the numbers say.
   */
  model.plan = filePlan(model.mapping);
  const planned = model.plan
    ? new Set(model.plan.heads.flatMap((h) => h.run.map((s) => s.filament)))
    : null;
  model.filaments = fileFilaments(model.mapping, planned);
  const fresh = initialAssignment(model.mapping, model.filaments);
  // Keep anything the operator has already chosen; only fill in what is new.
  model.filaments.forEach((f) => {
    if (model.assignment[f.key] == null) model.assignment[f.key] = fresh[f.key];
  });
}

function recomputeMachine() {
  model.toolheads = machineToolheads(state);
  /*
   * The ACE, merged with the override store. `state.ace()` is the same reader the Device
   * page uses; the store is where a bay's NAME lives, because the raw slots carry none.
   * With no plan this costs one object read and nothing is drawn from it.
   */
  const raw = state.ace();
  /*
   * Merged ONCE, here, so the verdict and the drawing read the same bays. `state.ace()`
   * reports the raw slots - which carry no identity at all, `{material:"", rfid:0}` - and
   * `mergeAceBays` folds in the override store, which is where a bay named by hand lives.
   * Merging at draw time instead (as the Device page does, where nothing judges) would
   * leave `reconcile` calling every named bay unnamed.
   */
  model.ace = { ...raw,
                units: (raw.units || []).map(
                  (u) => ({ ...u, bays: mergeAceBays(u, model.aceBays) })) };
  model.check = reconcile(model.plan, model.ace, model.filaments, model.toolheads);
  /* The free fix, when there is one: every spool the plate wants is in the machine and
     merely in another bay. Computed here rather than in the view, beside the verdict it
     answers. */
  model.bayFix = model.check.differs > 0
    ? bayFix(model.plan, model.ace, model.filaments) : null;
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
    // `extruder_map_table` is the machine's own map and is always fully populated - it
    // is 32 entries whether or not a plate is loaded - so it cannot be read as "Orca
    // assigned this". Only a value the operator or Orca actually chose counts; the
    // mirror is what a HELD value is confirmed against, not a source of assignments.
    const held = pending.resolve(`map:${f.key}`,
                                 table && table[f.index] != null
                                   ? Number(table[f.index]) : null);
    if (held.state === 'sent' || held.asked != null) {
      model.assignment[f.key] = held.value;
    }
  });
}

/* ---- render ----------------------------------------------------------- */
let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    recomputeMachine();
    /*
     * The FILE picks which of the two filament panels is the panel. Both are mounted, so
     * neither has to be built after the shell - and a plate with no plan hides `grouping`,
     * which is every plate the slicer can produce on this branch.
     */
    const section = (id) => document.getElementById(`panel-${id}`);
    if (section('filament')) section('filament').hidden = !!model.plan;
    if (section('grouping')) section('grouping').hidden = !model.plan;
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
  // A device RECORD is not a printer that answered. Sending to one that never did
  // would fail at the upload, after the dialog had implied the mapping was checked.
  /*
   * Every filament needs a home. This is the page's own gate, not one recovered from
   * the bundle: the picker already refuses a toolhead that cannot print a filament, so
   * the only bad state left is one still unassigned - the `!` on the card - and sending
   * a plate with one would leave the machine to discover it.
   */
  const unplaced = WITH_PRINT_SETUP && !model.plan
    && model.filaments.some((f) => model.assignment[f.key] == null);
  /*
   * On an ACE plate the gate is a different one, because the decision is. Nothing is
   * unassigned - the file assigned everything - and what can be wrong is a BAY holding
   * something other than what the plate was sliced for. `differs` blocks: a named spool
   * that is not the one wanted, or an empty bay, is a fact, and printing it wastes the
   * whole plate. `unsure` does not: nothing asserted what is in that bay, and refusing on
   * an inferred identity is crying wolf.
   *
   * There is no override here yet. The mockups offered one and it is the right shape, but
   * a tick that lifts a refusal is a decision this page cannot record anywhere the machine
   * can see, so it is left to the panel that gains the regroup route with it.
   */
  const badBay = WITH_PRINT_SETUP && !!model.plan && model.check.differs > 0;
  btn.disabled = busy || s.state === SEND_STATE.DONE || !model.device || !model.connected
              || unplaced || badBay;
}

/* ---- boot ------------------------------------------------------------- */
async function boot() {
  trace = makeTrace($('#trace'));

  let mock = null;
  if (WANT_MOCK || !Sswcp.hasHost()) {
    mockHost = mock = installMock({
      log: trace,
      plan: MOCK_PLAN,
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

  await bringUpMachine();
  await bringUpAce();
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

/**
 * The ACE half, which is a second read and not part of the subscription.
 *
 * `ace` is NOT on `SUBSCRIBE_OBJECTS` - that list is pinned to the shipped bundle's - so
 * it is fetched on its own, and the override store is an HTTP GET against the printer
 * rather than a bridge command at all. Both fail quietly: a machine with no multiACE and
 * a machine that cannot be reached both mean "nothing to draw", and on a plate with no
 * plan nothing was going to be drawn anyway.
 *
 * READ-ONLY. The tool map is written by the SEND, not here - see doSend. Writing it on
 * open meant that merely opening the dialog changed machine state, which was noticed by
 * running it against a real printer: the shipped page emits its map as the last thing
 * before the print starts, and it is right to.
 */
async function bringUpAce() {
  if (!model.connected) return;
  await refreshAce(bridge, state);
  model.aceBays = await syncBays(model.device, mockHost);
  recomputeMachine();
  render();
}

/**
 * Bring the machine half up against whatever printer is currently chosen.
 *
 * This can legitimately fail - a printer that is off, a device that was never paired -
 * and when it does the dialog must SAY so. An unattached transport draws four toolheads
 * reading NONE with no nozzles, which is indistinguishable from a printer with nothing
 * loaded, and is the one wrong state plausible enough to be acted on.
 */
async function bringUpMachine() {
  if (!model.device) {
    model.connected = false;
    say('No printer chosen. Pick one to read what is loaded.', 'warn');
    render();
    return;
  }
  try {
    await subscribeState(bridge, state, model.device, {
      log: (w, e) => trace('warn', { w, e }),
      onStep: (m) => say(m),
    });
    model.connected = true;
    say('');
  } catch (e) {
    model.connected = false;
    say(`could not read the printer: ${e.message}`, 'warn');
  }
  render();
}

/**
 * The simulator's stand-in for the printer's HTTP upload.
 *
 * It reports progress in the same shape `XMLHttpRequest.upload.onprogress` does, at a
 * pace fast enough not to slow a suite down. It is not pretending the upload succeeded
 * on a machine - there is no machine - it is letting the sequence around it be tested.
 */
async function simulatedUpload({ blob, filename, onProgress, onReply }) {
  const total = (blob && blob.size) || 1;
  for (let i = 1; i <= 8; i++) {
    if (onProgress) onProgress(Math.round((total * i) / 8), total);
    await new Promise((r) => setTimeout(r, 40));
  }
  // Moonraker's own 201 shape, measured on 811002511261022618B3: `path` and `root` are
  // separate fields and `path` carries NO root prefix. The send reads the stored path
  // back off this rather than constructing one, so the simulator has to answer in the
  // same shape or it stops testing that.
  const body = JSON.stringify({
    action: 'create_file',
    item: { path: filename, root: 'gcodes', size: total,
            modified: Date.now() / 1000, permissions: 'rw' },
  });
  if (onReply) onReply(201, body);
  return body;
}

/* ---- the send --------------------------------------------------------- */
async function doSend() {
  closePicker();
  say('');

  /*
   * On an ACE plate, the tool map goes out as the IDENTITY, and it goes out HERE.
   *
   * `extruder_map_table` is machine state that survives a print - a real U1 has been seen
   * carrying `[0,1,1,0]` left by an earlier job - so a page that sends nothing inherits
   * whatever the last plate left, and on an ACE plate any remap prints on the wrong
   * heads: the gcode's `ACE_SWAP_HEAD HEAD=n` names the head directly.
   *
   * Before the upload rather than after the start, so a machine that refuses the map is a
   * send that never began. And on SEND rather than on open, because opening a dialog to
   * look at a plate must not change the machine - which is what it did until this was run
   * against a real printer.
   */
  if (model.plan && WITH_PRINT_SETUP) {
    try {
      await groupCmds.writeIdentityMap(bridge, { plan: model.plan,
                                                 filaments: model.filaments });
    } catch (e) {
      say(`could not set the tool map: ${e.message}`, 'err');
      return;
    }
  }

  const ok = await runSend({
    bridge,
    device: model.device,
    withPrintSetup: WITH_PRINT_SETUP,
    /*
     * The upload is a POST to the PRINTER, so against the simulator there is nothing on
     * the other end - the simulated U1 answers MQTT, not HTTP. `runSend` takes the
     * upload as a seam for exactly this: the simulator supplies one that reports the
     * same byte progress a real one would, so the whole sequence runs end to end
     * without a machine. Against a real host this is undefined and the real POST goes.
     */
    upload: mockHost ? simulatedUpload : undefined,
    onState: (s, detail) => {
      model.send.state = s;
      model.send.detail = detail || '';
      if (s === SEND_STATE.FAILED) say(detail || 'send failed', 'err');
      render();
    },
    onProgress: (f) => { model.send.progress = f; render(); },
    // The wire, kept where a --drive script can read it. This surface's send has never
    // been observed against a machine, so what each step ANSWERED is the evidence.
    onNote: (m) => { trace('send', { note: m }); said.push(`send: ${m}`); },
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
  /** What the page has reported, in order. See `say`. */
  get said() { return said; },
  /* The rules a --drive script needs to reason about the same things the page does,
     rather than reimplementing them and agreeing with itself by accident. */
  session: { matchOf },
  /* The command table, so a script names a command the way the page does. A drive
     script that spells `sw_MachinePrintCancel` itself is one rename away from testing
     nothing - and the cancel is the same command the Device page's task panel sends,
     `CMD.PRINT_CANCEL`, not a second one belonging to this surface. */
  CMD,
  /** Cancelling takes the close protocol's other outcome. */
  cancel: () => closeDialog(bridge, MAPPING_STATUS.CANCELED),
};
