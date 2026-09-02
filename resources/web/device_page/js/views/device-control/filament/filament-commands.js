/*
 * filament-commands.js - what the Filament panel can ask the machine to do.
 *
 * Two families, and they reach the printer by two different roads:
 *
 *   the head's own filament   `print_task_config`, over sw_UpdateMachineFilamentInfo -
 *                             the same object the print-processing popup edits when
 *                             filaments are assigned to a job
 *   everything about an ACE   a plain G-code macro over sw_SendGCodes. Every control on
 *                             the panel is one, read out of `printer.gcode.help` on the
 *                             machine, so none of it needed a new bridge command
 *
 * Two rules apply to every macro below without exception, and both were learned the
 * expensive way:
 *
 *   Nothing is awaited. An instant `ok` is indistinguishable from success -
 *   ACE_BG_UNLOAD's own help says ~3 min - so what was asked for is held by
 *   shared/pending.js and confirmed against machine state, never against the ack.
 *
 *   `ace` is not on the subscription, so the mirror does not move on its own. Anything
 *   that changes the ACE re-reads it: confirmAce() below is the whole of that, and
 *   without it a pending value would sit until it timed out and reported itself lost.
 *
 * check_coverage.py reads the CMD references out of this file to answer "can a user
 * reach this command", and attributes them to the filament panel because this is the
 * module that panel is handed. That makes the attribution a fact about the imports
 * rather than a promise in a declaration.
 */
'use strict';

import { CMD, cssColor, quotedLine, PRINT_TASK }
  from '../../../../../shared/js/protocol.js';
import { isTimeout } from '../../../../../shared/js/sswcp.js';
import { machineActivity, isBusy } from '../../../../../shared/js/activity.js';
// Everything about the ACE comes from one module - see shared/js/multiACE.js for why.
import { ACE, FEEDER, DRY_MINUTES_PER_HOUR, aceUnitId, aceLine, aceOverridesUrl,
         parseAceOverrides, aceGlyph, channelStep, channelWord,
         gcodeStoreUrl, lastPrinterError, aceModeChange, aceModeRefusal }
  from '../../../../../shared/js/multiACE.js';
import { openDialog, openBlockingDialog, numberField, toggleField } from '../../../../../shared/js/dialog.js';
import { el } from '../../../../../shared/js/dom.js';


/**
 * When to look again after asking the ACE for something.
 *
 * A source switch lands in well under a second; a load is minutes. These are re-reads,
 * not a poll: they stop at the last one whether or not anything was confirmed, and the
 * heartbeat keeps the panel fresh after that.
 */
const CONFIRM_AT = [400, 1200, 3000, 6000, 12000];

export function create(deps) {
  // `bridge` is deliberately NOT destructured: it does not exist yet when these are
  // built - boot() decides between the real host and the simulator - so it is reached
  // through deps each time rather than captured as null once.
  const { state, store, pending, session, send, setStatus, render } = deps;

  const line = aceLine;

  /** Look at the ACE again, a few times, because nothing pushes it. */
  function confirmAce() {
    CONFIRM_AT.forEach((ms) => setTimeout(() => { session.refreshAce().then(render); }, ms));
  }

  /**
   * Send one macro and hold what it asked for until the machine agrees.
   *
   * `key`/`value` are optional: a setting the ACE object does not report back - a flush
   * length, a Spoolman URL - has nothing to confirm against, and saying so by leaving
   * them out is better than inventing a mirror for it.
   */
  function macro(script, label, key, value) {
    const sent = send(CMD.SEND_GCODES, { script }, label);
    if (key !== undefined) pending.track(key, value, sent);
    else sent.then((ok) => { if (ok) setStatus(label); });
    confirmAce();
    return sent;
  }

  /* ---- what is IN each bay ----------------------------------------- */

  /**
   * Read multiACE's own record of what is in each bay.
   *
   * The `ace` Klipper object does not carry it. Every raw slot on the measured machine
   * reads `{material:"", brand:"", rfid:0}` — these spools have no tags — while
   * multiACE's web UI names all four, because it keeps them in an override store and
   * merges them into `/multiace/api/state`. Orca's own AceMmuProvider polls that
   * endpoint from C++ and therefore sees filament this panel drew as `?`.
   *
   * `/multiace/api/state` is not reachable from a browser: nginx serves `/multiace/`
   * with no CORS header. The STORE is: it is a file under Moonraker's `config` root, and
   * Moonraker on :7125 reflects the Origin — the same server this page already fetches
   * camera frames and job thumbnails from.
   *
   * Fails quietly on purpose. No file, no multiACE, no route to the printer, or a
   * Moonraker with auth turned on all mean the same thing to the panel: nothing to merge,
   * and a bay nobody has named goes on being drawn as a bay nobody has named.
   */
  async function syncBays() {
    // With no printer there is nothing to answer an HTTP GET, so the simulator does -
    // the same seam the camera's frames use.
    if (deps.mock && deps.mock.aceOverrides) {
      store.aceBays = deps.mock.aceOverrides();
      render();
      return store.aceBays;
    }
    const url = aceOverridesUrl(store.device);
    if (!url) return null;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      store.aceBays = parseAceOverrides(await r.json());
    } catch (e) {
      store.aceBays = null;
    }
    render();
    return store.aceBays;
  }

  /* ---- what feeds a head ------------------------------------------- */

  /**
   * Three macros, one control.
   *
   * ACE_SET_HEAD_ACE is the one that has to clear the others: the machine resolves a
   * head as manual, then feeder, then ACE, so binding a head to a unit while
   * `head_feeder` is still true changes nothing anyone can see.
   */
  function setSource(i, source) {
    const t = `Toolhead ${i + 1}`;
    if (source === 'manual') {
      return macro(line(ACE.SET_HEAD_MANUAL, { HEAD: i, ENABLE: 1 }),
                   `${t}: hand-fed`, `ace-src-${i}`, 'manual');
    }
    if (source === 'feeder') {
      return macro(`${line(ACE.SET_HEAD_MANUAL, { HEAD: i, ENABLE: 0 })}\n`
                 + `${line(ACE.SET_HEAD_FEEDER, { HEAD: i, ENABLE: 1 })}`,
                   `${t}: stock feeder`, `ace-src-${i}`, 'feeder');
    }
    const unit = Number(String(source).slice(4));
    return macro(`${line(ACE.SET_HEAD_MANUAL, { HEAD: i, ENABLE: 0 })}\n`
               + `${line(ACE.SET_HEAD_FEEDER, { HEAD: i, ENABLE: 0 })}\n`
               + `${line(ACE.SET_HEAD_ACE, { HEAD: i, ACE: unit })}`,
                 `${t}: ACE ${aceUnitId(unit)}`, `ace-src-${i}`, source);
  }

  /**
   * The mode, and the three different things sending it can do.
   *
   * This is the one control on the panel whose SUCCESS arrives as a FAILURE, so it is the
   * one that cannot go through `macro()`.
   *
   *   multi <-> head     live, and ordinary. Held pending against `ace.mode`, which moves
   *                      within a read - measured 2026-09-01 on a machine with filament in
   *                      three heads, because that transition has no unload guard.
   *   normal <-> either  swaps three Klipper extras on disk and then RAISES on purpose:
   *                      `gcmd.error('... Please reboot the printer to activate!')`. The
   *                      request is therefore NOT sent through send(), which would report
   *                      the raise as a failed command. And it is not tracked pending
   *                      against `ace.mode` either: that field will not move until the
   *                      machine is restarted, so a pending value would sit out its clock
   *                      and report itself lost on a switch that worked. What reports it
   *                      instead is the saved `ace__mode` disagreeing with `ace.mode`,
   *                      which the pill draws.
   *   refused            with filament in any head the macro's guard prints two `//` notes
   *                      and returns, so the RPC answers `ok` for a switch that did not
   *                      happen. The reason exists only on the console.
   *
   * `HEAD=` is passed for head mode, which the panel never used to send: it writes
   * `head_feeder[h] = (h != n)` for all four, and without it the mode keeps whatever
   * wiring was there.
   */
  async function setAceMode(mode, head) {
    const from = state.ace().mode;
    const args = { MODE: mode };
    if (mode === 'head' && head != null) args.HEAD = head;
    const script = line(ACE.SET_MODE, args);
    const label = `ACE mode: ${mode}`;
    if (aceModeChange(from, mode).live) {
      macro(script, label, 'ace-mode', mode);
      return true;
    }

    let raised = null;
    try {
      await deps.bridge.request(CMD.SEND_GCODES, { script });
    } catch (e) {
      raised = (e && e.message) ? String(e.message) : 'refused';
    }
    confirmAce();

    // An `ok` here is not a yes: the guard prints and returns. Only the console knows.
    const said = raised ? null : aceModeRefusal(await gcodeStore(20));
    if (said) {
      openDialog({
        title: 'The printer refused',
        build: (bd) => {
          const box = el('div', 'verb-cmd');
          said.forEach((s) => box.appendChild(el('div', null, s)));
          bd.appendChild(box);
        },
        confirmLabel: 'Close',
        cancel: false,
        onConfirm: () => true,
      });
      return false;
    }
    // A raise that says `reboot` is the success. Anything else really is a failure.
    if (raised && !/reboot/i.test(raised)) {
      setStatus(`${label} failed: ${raised}`, 'err');
      return false;
    }
    setStatus(raised || `Switched to ${mode} mode. Restart the printer to activate.`);
    await session.refreshAce();
    render();
    return true;
  }

  /* ---- loading, unloading, swapping -------------------------------- */
  /*
   * There were three functions here - loadBay, loadHead, unloadHead - one per control that
   * could send one. They are gone, and runVerb() below is what replaced them: the verb
   * list decides WHICH macro applies in the state the head is in, so a caller that picks
   * the function has already made that decision somewhere else. Two places deciding the
   * same thing is how a Load ends up offered on a head that is already loaded.
   *
   * The conformance suite is what said so, and it said it the moment the last caller went:
   * "nothing calls filament.loadBay, loadHead, unloadHead - either wire a control to it or
   * delete it."
   */

  const unloadAllHeads = () =>
    macro(ACE.UNLOAD_ALL, 'Unloading every toolhead');

  /**
   * Send one verb from `aceVerbs()`, whichever surface it was chosen on.
   *
   * The list already carries the line - the sheet and the menu both show it before it is
   * sent - so this sends THAT rather than rebuilding it from the verb's name. A control
   * that displays one command and sends another is the bug this shape makes impossible.
   *
   * The pending key is the head's own load state, because what confirms any of these is
   * `head_source[n]` changing - and none of them is awaited: ACE_BG_UNLOAD's own help
   * says ~3 min, and an instant `ok` is indistinguishable from success.
   */
  /*
   * Every macro a verb is allowed to send, named here rather than trusted from the verb.
   *
   * `aceVerbs()` builds the line and this sends it, which is what stops a control showing
   * one command and sending another - but it also means the macro name appears nowhere in
   * this module, and check_coverage.py reads exactly that to answer "can a user reach
   * this command". It said UNACCOUNTED for both background verbs and it was right: the
   * panel could send them and nothing here claimed them.
   *
   * So the claim is made by being true. A verb whose macro is not in this set is not sent,
   * which is a real gate on a surface where one of the macros purges ~60 mm onto the bed.
   */
  const VERB_MACROS = new Set([
    // ACE_SWAP_HEAD is NOT here and Swap is still offered: a swap someone asks for is an
    // ACE_UNLOAD_HEAD then an ACE_LOAD_HEAD, both of which are. The reason is in
    // aceVerbs() - that macro is the print's, and it opens with a Z hop.
    ACE.LOAD_HEAD, ACE.UNLOAD_HEAD,
    ACE.BG_SWAP, ACE.BG_UNLOAD, ACE.BG_SET_HEAD,
    // The U1's own, for a head with no ACE behind it to send an ACE macro to.
    FEEDER.FEED,
  ]);

  /*
   * A verb that moves filament takes the machine over, so the panel says so and waits.
   *
   * Three things this has to get right, and the Control panel's runToolAction learned all
   * three the expensive way:
   *
   *  1. `sw_SendGCodes` does not return until Klipper has finished, and the bridge gives
   *     up after 15s. A load HOMES first - measured 14.7s to `xy` and 31s from cold - so
   *     the request rejects while the printer is working, and the panel reported
   *     `Toolhead 1: load failed: sw_SendGCodes timed out after 15000ms` for a load that
   *     was running. A timeout is not a refusal. The request is not awaited.
   *  2. The ack only says the command was queued; machine state is what says it worked.
   *  3. The machine says what it is DOING, and here it says it twice: `channel_state`
   *     names the step (`unload_heating` -> "Heat nozzle") and `action_code` names the
   *     operation ("Auto Loading"). The wait shows the finer of the two.
   *
   * It BLOCKS, and that is the point rather than a side effect: a non-background swap is
   * about three minutes during which the machine can do nothing else, so a second verb
   * started underneath it is not a queue, it is a collision. A background verb does not
   * block - not blocking is its whole purpose.
   */
  const FILAMENT_HARD_CAP_MS = 10 * 60 * 1000;
  const QUIET_MS = 90 * 1000;
  /*
   * How long the machine gets to START, which is a different question from how long it
   * gets to keep going, and a much shorter one.
   *
   * A load HOMES first and that is the slow part - 31s from cold - but homing is reported:
   * `action_code` goes to 832 within a second or two, so `sawBusy` is set long before the
   * homing ends. Nothing busy and nothing on the channel after this means nothing started,
   * and the 90s quiet window was spending 90 seconds on a stuck dialog to say so.
   */
  const NO_START_MS = 25 * 1000;

  /*
   * What the printer said, when it said no.
   *
   * `sw_SendGCodes` answered `ok` for a swap that never ran: multiACE printed
   * `!! Must home Z axis first` and set `last_swap_result.status` to `error`, and the RPC
   * reply carried neither. Moonraker's console history has the line, on the same host and
   * port this page already reads the override store from.
   *
   * That particular sentence is history - the panel does not send the macro that raised
   * it any more (see the Swap verb in aceVerbs) - but the shape of the failure is not: a
   * macro that declines is an `ok` here, and the console is the only place the reason
   * exists.
   */
  async function gcodeStore(n) {
    // With no printer there is nothing to answer an HTTP GET, so the simulator does - the
    // same seam the override store and the camera's frames use.
    if (deps.mock && deps.mock.gcodeStore) return deps.mock.gcodeStore(n);
    try {
      const url = gcodeStoreUrl(store.device, n);
      if (!url) return null;
      const r = await fetch(url, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }        // an unreachable Moonraker is not the fault here
  }

  async function printerSaid() { return lastPrinterError(await gcodeStore(30)); }

  function runFilamentAction({ title, script, head, waiting, kind }) {
    const dlg = openBlockingDialog({ title, message: waiting });
    let refused = null;
    // The reply is not read: an `ok` is not a yes on this machine, machine state is what
    // says it worked, and the trace pane already carries the packet for anyone debugging.
    deps.bridge.request(CMD.SEND_GCODES, { script })
      .catch((e) => { if (!isTimeout(e)) refused = e; });

    const started = Date.now();
    let quiet = started + QUIET_MS;
    let last = null;
    let sawBusy = false;
    // multiACE stamps every attempt into `last_swap_result`. Holding the one that was
    // there BEFORE is what makes a new one mean this attempt rather than a previous one.
    const wasSwap = JSON.stringify((state.ace().lastSwap) || null);

    const giveUp = async (fallback) => {
      const said = await printerSaid();
      dlg.fail(said ? `The printer stopped: ${said}` : fallback);
      render();
    };

    return (async () => {
      for (;;) {
        if (refused) { dlg.fail(`The printer refused the command: ${refused.message}`); return; }

        const feed = (state.filaments()[head] || {}).feed;
        const step = channelStep(feed && feed.channelState, kind);
        if (step && step.failed) {
          // A failure is a firmware state and is reported as one - translating it would
          // be this panel's opinion of what happened.
          dlg.fail(`${channelWord(step.state) || 'The printer stopped'}.`);
          render();
          return;
        }
        if (sawBusy && step && step.done) { dlg.close(); render(); return; }

        // multiACE's own verdict, which arrives in a second rather than in twenty-five.
        //
        // Only `ACE_SWAP_HEAD` writes `last_swap_result`, and the panel stopped sending
        // it - so what this now catches is the PRINT's own swap failing underneath a verb
        // someone started, which dooms that verb too. Kept for that, not for ours.
        const ls = state.ace().lastSwap;
        if (ls && JSON.stringify(ls) !== wasSwap && ls.status && ls.status !== 'ok') {
          await giveUp(`The ${kind} failed.`);
          return;
        }

        const act = state.activity();
        // channel_state first: it names the step inside the operation, where action_code
        // names only the operation. And where neither has a name for what it is doing,
        // the machine's OWN WORD rather than a sentence about waiting: a dialog reading
        // `wait_insert` says which state nothing is moving in, and one reading "Asking the
        // printer..." for ninety seconds says only that the panel has stopped talking.
        const raw = feed && feed.channelState;
        const label = (step && step.label) ? `${step.label}  (${step.at + 1}/${step.total})`
                    : machineActivity(act) || channelWord(raw);
        if (label && label !== last) { dlg.update(label); last = label; }

        if ((step && step.at != null) || isBusy(act)) {
          sawBusy = true;
          quiet = Date.now() + QUIET_MS;
        }

        if (!sawBusy && Date.now() - started > NO_START_MS) {
          // An `ok` is not a yes on this machine, so nothing having started is a real
          // outcome - and the reason for it is on the printer's console, not in the reply.
          const where = channelWord(raw);
          await giveUp(where ? `Nothing started. The toolhead is ${where.toLowerCase()}.`
                             : 'Nothing started.');
          return;
        }
        if (Date.now() > quiet) {
          dlg.fail('The printer stopped reporting. It may have finished.');
          render();
          return;
        }
        if (Date.now() - started > FILAMENT_HARD_CAP_MS) {
          dlg.fail('Giving up after ten minutes. The printer may still be working.');
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
        // `ace` is not on the stream, so it has to be asked for - and this is the one
        // moment it changes most.
        await session.refreshAce();
      }
    })();
  }

  function runVerb(v) {
    // EVERY macro the verb would send, not just the one it is named for. A swap sends
    // two, and checking one of them is not a gate.
    if (!(v.macros || [v.macro]).every((m) => VERB_MACROS.has(m))) {
      setStatus(`${v.name} is not available`, 'err');
      return Promise.resolve(false);
    }
    // `HEAD=` is multiACE's word for it and `EXTRUDER=` is the U1's, and the same
    // toolhead is meant by both. Reading only the first left a feeder verb addressing
    // nothing: an untitled dialog with no channel to follow, which is what "Load" with
    // no toolhead and a permanent "Asking the printer..." looked like.
    const head = v.args && (v.args.HEAD != null ? v.args.HEAD : v.args.EXTRUDER);
    const slot = v.args && v.args.SLOT;
    const unit = v.args && v.args.ACE;
    // Named end to end, because this is the title of a dialog someone will be looking at
    // for three minutes: which bay, and which head it is going to.
    const bay = (slot != null && unit != null) ? `${aceUnitId(unit)}${slot + 1}` : null;
    const label = head == null ? v.name
      : bay ? `${v.name} ${bay} \u2192 Toolhead ${head + 1}`
            : `${v.name} \u2014 Toolhead ${head + 1}`;
    const value = (slot != null && unit != null) ? `${aceUnitId(unit)}${slot + 1}`
                : /Unload/.test(v.name) ? '' : 'loading';
    // A background verb runs while the printer gets on with something else, so it must
    // not block; everything else takes the machine over and says so.
    if (v.bg) return macro(v.cmd, label, `ace-load-${head}`, value);

    const kind = /^Swap/.test(v.name) ? 'swap' : /^Unload/.test(v.name) ? 'unload' : 'load';
    pending.track(`ace-load-${head}`, value, null);
    confirmAce();
    return runFilamentAction({
      title: label,
      script: v.cmd,
      head,
      kind,
      waiting: 'Asking the printer\u2026',
    });
  }

  /**
   * Declare a head background-capable.
   *
   * Its own help says what the claim MEANS: the dock below that head is open, and the
   * cold-pull purges ~60 mm through it. So this is asked for on its own rather than
   * folded into the verb that needs it - the panel offers the macro, and sending it is a
   * separate decision from running a swap with it.
   */
  const declareBgHead = (i) =>
    macro(aceLine(ACE.BG_SET_HEAD, { HEAD: i, ENABLE: 1 }),
          `Toolhead ${i + 1}: background swap enabled`);

  /* ---- the dryer ---------------------------------------------------- */

  /**
   * The panel offers hours and the macro takes MINUTES.
   *
   * Measured: `DURATION=3` came back as `duration: 180` seconds and `DURATION=240` as
   * `14400`. Sending the panel's `4` unconverted asked the machine to dry for four
   * minutes - and it answered `ok`, which is why this was worth an experiment rather
   * than a reading of the help text, which says only `[DURATION=]`.
   */
  const startDrying = (unit, temp, hours) =>
    macro(line(ACE.DRY, { ACE: unit, TEMP: temp,
                          DURATION: Math.round(hours * DRY_MINUTES_PER_HOUR) }),
          `ACE ${aceUnitId(unit)}: drying at ${temp} °C for ${hours} h`,
          `ace-dry-${unit}`, true);

  // ACE_STOP_DRYING takes the unit. ACED__DRY_STOP stops "the current ACE", which on a
  // machine with two units is whichever is active rather than the one that was pressed.
  const stopDrying = (unit) =>
    macro(line(ACE.DRY_STOP, { ACE: unit }),
          `ACE ${aceUnitId(unit)}: dryer stopped`, `ace-dry-${unit}`, false);

  /**
   * Humidity-controlled drying, per unit.
   *
   * `THRESHOLD=` was a guess and the machine took it, answered `ok`, and changed
   * nothing - the reading in `auto_dry` was untouched. The arguments are `ENABLE=0|1`
   * and `RH_START=<%>`, settled by sending each and reading the object back.
   */
  const setAutoDry = (unit, threshold) =>
    macro(line(ACE.SET_AUTO_DRY, threshold
                 ? { ACE: unit, ENABLE: 1, RH_START: threshold }
                 : { ACE: unit, ENABLE: 0 }),
          threshold ? `ACE ${aceUnitId(unit)}: dry automatically above ${threshold} %`
                    : `ACE ${aceUnitId(unit)}: automatic drying off`);

  /* ---- the settings a person sets once ------------------------------ */
  /*
   * These live behind the panel header's overflow rather than on the face of the panel,
   * where they would bury the four things that change daily.
   *
   * Three of the four ARE reported back - `confirm_commands`, `spoolman_url`,
   * `spoolman_auto` and `purge_matrix` are all in the `ace` object - so each dialog opens
   * on the machine's own value. They were written as write-only on the assumption that
   * none of them was readable, which was wrong, and a dialog that sets a value it could
   * have shown is one that asks you to remember what you chose.
   *
   * The flush LENGTH is the one that genuinely is not there: `purge_matrix` says whether
   * the per-pair stamps from the slicer's flush matrix are honoured, and the length
   * itself lives in the config. That field says so rather than pretending.
   */

  const note = (b, text) => {
    const p = el('p', 'ms-note', text);
    b.appendChild(p);
  };

  function setPurge() {
    const now = state.ace().settings;
    let mm; let matrix;
    openDialog({
      title: 'Flush length',
      build: (b) => {
        note(b, 'Flush for the next swap or load. 0 uses the stock 80 mm. '
              + 'Not reported back by the machine.');
        mm = numberField(b, { label: 'Length', value: 0, min: 0, max: 400, unit: 'mm' });
        matrix = toggleField(b, { label: 'Honour the slicer’s flush matrix',
                                  checked: now.purgeMatrix });
      },
      confirmLabel: 'Set',
      onConfirm: () => macro(line(ACE.SET_PURGE, { LENGTH: Number(mm.value),
                                                   MATRIX: matrix.checked ? 1 : 0 }),
                             `Flush length: ${Number(mm.value) || 'stock default'}`),
    });
  }

  function setConfirmCommands() {
    const now = state.ace().settings;
    let on;
    openDialog({
      title: 'Confirmations',
      build: (b) => {
        note(b, 'The printer asks on its own screen before a load or unload.');
        on = toggleField(b, { label: 'Confirm before load and unload',
                              checked: now.confirmCommands });
      },
      confirmLabel: 'Set',
      onConfirm: () => macro(line(ACE.SET_CONFIRM, { ENABLE: on.checked ? 1 : 0 }),
                             on.checked ? 'Confirmations on' : 'Confirmations off'),
    });
  }

  function setSpoolman() {
    const now = state.ace().settings;
    let url; let auto;
    openDialog({
      title: 'Spoolman',
      build: (b) => {
        note(b, 'Where the ACE looks up spool weights. '
              + (now.bound ? `${now.bound} bay${now.bound > 1 ? 's' : ''} bound.`
                           : 'No bay is bound.'));
        const row = el('label', 'field');
        row.appendChild(el('span', 'field-label', 'URL'));
        const wrap = el('div', 'field-row');
        url = document.createElement('input');
        url.type = 'url';
        url.value = now.spoolmanUrl;
        url.placeholder = 'http://spoolman.local:7912';
        wrap.appendChild(url);
        row.appendChild(wrap);
        b.appendChild(row);
        auto = toggleField(b, { label: 'Sync automatically', checked: now.spoolmanAuto });
      },
      confirmLabel: 'Set',
      onConfirm: () => macro(line(ACE.SET_SPOOLMAN,
                                  { URL: url.value.trim(), AUTO: auto.checked ? 1 : 0 }),
                             'Spoolman updated'),
    });
  }

  const clearHeads = () => macro(ACE.CLEAR_HEADS, 'Head→bay bookkeeping cleared');

  /* ---- the head's own filament, unchanged --------------------------- */

  return {
    /**
     * Name what is in one head.
     *
     * `SET_PRINT_FILAMENT_CONFIG` is the write, and it is the write the firmware gates:
     * `print_task_config.py` refuses an `official` slot without `FORCE=1`, which is the
     * same `filament_edit` the panel reads before offering the form at all. Colour goes
     * out in the form the printer sends - RRGGBBAA, no '#'; writing CSS here would put a
     * value on the machine that nothing else on it can read.
     *
     * This used to send `sw_UpdateMachineFilamentInfo` with the slot arrays as its
     * parameters. That command never reaches the printer - it writes ORCA's filament
     * record, wants `{objects:[{key,value}]}`, and answered every one of these with
     * "param [objects] required or wrong type!". Nothing on the machine changed, and the
     * panel had no way to know: it does not await this, by design. Orca's record is now
     * kept by core/orcasync.js, which is a different job in the opposite direction.
     */
    setFilament: (index, type, color, vendor) => {
      const hex = (cssColor(color) || '#CCCCCC').slice(1).toUpperCase();
      // SAVE=1 is the bundle's own: without it the machine forgets on the next restart.
      // An undefined vendor is dropped rather than sent empty, because an absent argument
      // leaves the field alone and an empty one clears it.
      const script = quotedLine(PRINT_TASK.FILAMENT_CONFIG, {
        CONFIG_EXTRUDER: index,
        FILAMENT_TYPE: type,
        FILAMENT_COLOR_RGBA: `${hex}FF`,
        VENDOR: vendor === undefined ? null : vendor,
        SAVE: 1,
      });
      send(CMD.SEND_GCODES, { script }, 'set filament');
    },

    syncBays: () => syncBays(),
    setSource: (i, source) => setSource(i, source),
    setAceMode: (m, head) => setAceMode(m, head),
    unloadAllHeads: () => unloadAllHeads(),
    runVerb: (v) => runVerb(v),
    declareBgHead: (i) => declareBgHead(i),
    startDrying: (u, t, h) => startDrying(u, t, h),
    stopDrying: (u) => stopDrying(u),
    setAutoDry: (u, t) => setAutoDry(u, t),
    setPurge: () => setPurge(),
    setConfirmCommands: () => setConfirmCommands(),
    setSpoolman: () => setSpoolman(),
    clearHeads: () => clearHeads(),

    filamentHelp: () => openDialog({
      title: 'Filament sources',
      build: (b) => {
        // UI copy stays to the point: what a control is, not what multiACE is. The
        // reasoning lives in docs/u1-webui/02-device-page/.
        const p = el('p', 'ms-note');
        p.textContent = 'One card per toolhead. Its header chooses the source: stock '
          + 'feeder, an ACE unit, or hand-fed.';
        p.insertBefore(aceGlyph(), p.firstChild);
        b.appendChild(p);
        b.appendChild(el('p', 'ms-note',
          'A grey bay with no name is occupied and unidentified. No bay has a level.'));
      },
      confirmLabel: 'Close',
      cancel: false,
      onConfirm: () => true,
    }),
  };
}
