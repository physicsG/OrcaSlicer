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
 *   core/pending.js and confirmed against machine state, never against the ack.
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

import { CMD, TASK_CONFIG, ACE, DRY_MINUTES_PER_HOUR, cssColor, aceUnitId }
  from '../../../../../shared/js/protocol.js';
import { openDialog, numberField, toggleField } from '../../../core/overlay.js';
import { el } from '../../../core/dom.js';

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
  const { state, pending, session, send, setStatus, render } = deps;

  /** `ACE_DRY` + {ACE:'A', TEMP:55} -> `ACE_DRY ACE=A TEMP=55`. */
  const line = (macro, args) => [macro].concat(
    Object.entries(args || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${v}`)).join(' ');

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

  const setAceMode = (mode) =>
    macro(line(ACE.SET_MODE, { MODE: mode }), `ACE mode: ${mode}`, 'ace-mode', mode);

  /* ---- loading, unloading, swapping -------------------------------- */

  /**
   * Put the filament in one bay into one head.
   *
   * ACE_SWAP_HEAD is the right macro even for a head that is empty - it is the one that
   * takes a slot - and the pending key is the head's own source, because what confirms
   * this is `head_source[n]` naming the bay that was asked for.
   */
  const loadBay = (i, unit, slot) =>
    macro(line(ACE.SWAP_HEAD, { HEAD: i, ACE: unit, SLOT: slot }),
          `Toolhead ${i + 1}: load ${aceUnitId(unit)}${slot + 1}`,
          `ace-load-${i}`, `${aceUnitId(unit)}${slot + 1}`);

  const loadHead = (i, unit) =>
    macro(line(ACE.LOAD_HEAD, { HEAD: i, ACE: unit }),
          `Toolhead ${i + 1}: load`, `ace-load-${i}`, 'loading');

  const unloadHead = (i) =>
    macro(line(ACE.UNLOAD_HEAD, { HEAD: i }),
          `Toolhead ${i + 1}: unload`, `ace-load-${i}`, '');

  const unloadAllHeads = () =>
    macro(ACE.UNLOAD_ALL, 'Unloading every toolhead');

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
        note(b, 'How much filament the next swap or load purges. This one the machine '
              + 'does not report back — only whether the slicer’s per-pair stamps are '
              + 'honoured, below — so the length sets rather than shows. 0 means the '
              + 'stock default of 80 mm.');
        mm = numberField(b, { label: 'Length', value: 0, min: 0, max: 400, unit: 'mm',
                              hint: 'ACE_SET_PURGE LENGTH=<mm>' });
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
        note(b, 'Whether the printer asks on its own screen before it loads or unloads. '
              + 'This is the machine’s current setting, read from `confirm_commands`.');
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
        note(b, now.bound
          ? `Where the ACE looks up spool weights. ${now.bound} slot`
            + `${now.bound > 1 ? 's are' : ' is'} bound to a spool.`
          : 'Where the ACE looks up spool weights. Nothing is bound to a slot on this '
            + 'machine, which is why no bay on the panel shows a level.');
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

    setSource: (i, source) => setSource(i, source),
    setAceMode: (m) => setAceMode(m),
    loadBay: (i, unit, slot) => loadBay(i, unit, slot),
    loadHead: (i, unit) => loadHead(i, unit),
    unloadHead: (i) => unloadHead(i),
    unloadAllHeads: () => unloadAllHeads(),
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
        const p = el('p', 'ms-note');
        p.textContent = 'Each card is one of the U1’s four toolheads and its header '
          + 'chooses what feeds it: its own stock feeder, one of the ACE units, or '
          + 'hand-fed. What a head IS fed resolves head_manual, then head_feeder, then '
          + 'head_ace — in that order, because head_ace answers for every head '
          + 'whether or not that head is on an ACE.';
        b.appendChild(p);
        const q = el('p', 'ms-note');
        q.textContent = 'A bay drawn grey with no name is occupied and unidentified, '
          + 'which is what the machine reports: the raw slots carry no material, brand '
          + 'or tag. Only the bay a head is loaded from is named, from head_source. No '
          + 'bay has a level — nothing is bound in Spoolman — so a disc is a '
          + 'colour and not a gauge.';
        b.appendChild(q);
      },
      confirmLabel: 'Close',
      onConfirm: () => true,
    }),
  };
}
