/*
 * session.js - everything the dialog knows, and where it came from.
 *
 * The dialog has TWO sources and the whole surface exists to reconcile them:
 *
 *   the FILE      sw_GetFileFilamentMapping, answered by Orca out of the sliced plate
 *   the MACHINE   print_task_config on the state stream, plus each extruder's
 *                 nozzle_diameter
 *
 * Neither is derived from the other, and that is the point: the toolhead a filament may
 * be assigned to is one whose TYPE and NOZZLE both match, so a page that built one list
 * out of the other could never report a mismatch. The shipped bundle names a third
 * command for the machine side - `sw_GetMachineFilamentMapping`, index 29 - which
 * Orca does not implement (`implemented_in_cpp: false` in data/wcp-commands.json), so
 * `print_task_config` is the only source there is.
 *
 * What this module does NOT do is decide anything. It reads, it normalises the two
 * shapes into one vocabulary, and it holds the operator's edits. Which head is offered,
 * which is refused and what the Send button does are the panels' and send.js's.
 */
'use strict';

import { CMD, SUBSCRIBE_OBJECTS, TOOLHEADS } from '../../../shared/js/protocol.js';
import { connect } from '../../../shared/js/connection.js';
import { aceBayAddr, aceOverridesUrl, parseAceOverrides } from '../../../shared/js/multiACE.js';
import { cssColor, nozzleStr } from '../widgets/format.js';

/**
 * One file filament, from the reply's PARALLEL ARRAYS.
 *
 * There is no `filaments[]` in this reply and there never has been. The previous
 * reconstruction read one, its own mock returned one, and the two agreed with each other
 * all the way past a real Orca - which answers with `filament_type[]`,
 * `filament_color_rgba[]`, `filament_weight[]` and the rest. SSWCP.cpp:3039.
 *
 * `A.bEE` is the bundle's own filter: a filament the plate does not actually use is
 * dropped from the grid rather than drawn empty.
 */
export function fileFilaments(mapping, keep = null) {
  if (!mapping) return [];
  const arr = (k) => (Array.isArray(mapping[k]) ? mapping[k] : []);
  const types = arr('filament_type');
  const rgba = arr('filament_color_rgba');
  const argb = arr('filament_color');
  const multi = arr('filament_color_multi');
  const weight = arr('filament_weight');
  const usedMm = arr('filament_used_mm');
  const nozzles = arr('nozzle_diameters');

  /*
   * `nozzle_diameters` is NOT one per filament. The C++ builds it from
   * `full_config.nozzle_diameter`, which is one per EXTRUDER, while `filament_type`
   * comes from the filament presets loaded and is routinely longer - a real plate off
   * this Orca reports seven filament types and four nozzles.
   *
   * The match test needs a nozzle per FILAMENT, so the two have to be paired, and the
   * reply does not say how. Two rules, and only the first is derivable:
   *
   *   one distinct diameter   every filament was sliced for it. Nothing to infer.
   *   several                 pair by the filament's own index, and leave the ones past
   *                           the end null
   *
   * A null nozzle FAILS the match on its own (`fil.nozzleDiameter != null` is half of
   * `A.aJQ`'s test), so the second rule refuses rather than guesses: a filament this
   * page cannot place is one the operator is told about, not one silently assigned.
   *
   * INFERRED, and the only inferred thing on this surface. The bundle pairs them
   * somewhere in its view-model and that code has not been read.
   */
  const distinct = [...new Set(nozzles.filter(Boolean).map(String))];
  const nozzleFor = (i) => (distinct.length === 1 ? distinct[0] : nozzleStr(nozzles[i]));

  return types.map((type, i) => ({
    index: i,
    key: String(i),
    type: type || '---',
    // `filament_color_multi[i]` carries {mode, colors} for a gradient or segmented
    // spool; a plain one falls back to the single colour. Both spellings are read
    // because the reply carries the colour twice, as a string and as an integer.
    colors: multiColors(multi[i]) || single(rgba[i] != null ? rgba[i] : argb[i]),
    colorMode: multi[i] && multi[i].mode != null ? Number(multi[i].mode) : 0,
    used: Number(weight[i]) || 0,
    usedMm: Number(usedMm[i]) || 0,
    nozzle: nozzleFor(i),
  })).filter((f) => usesMaterial(f) || (keep && keep.has(f.index)));
}

/**
 * `A.bEE`: keep a filament the plate actually consumes. -1 mm means "unknown, keep".
 *
 * `keep` overrides it, and it exists because on a real ACE plate this filter is WRONG.
 * Measured on `Test_Cube_PLA_4h15m_multiACE.gcode`: the file declares seven filaments and
 * reports usage for four -
 *
 *     filament_type      PLA;PLA;PLA;PLA;PLA;PLA;PLA
 *     filament used [g]  7.27, 7.36, 7.58, 26.52, 0.00, 0.00, 0.00
 *
 * - because `filament_type` is indexed by PROJECT filament and the usage arrays come from
 * `total_volumes_per_extruder`, which is indexed by EMITTED extruder and padded with
 * zeros. The two coincide on an ordinary printer, which is why the filter has always
 * looked right; an ACE plate puts several filaments on one head and they diverge.
 *
 * So three of the seven have zero usage and are not unused: the plan says the machine
 * prints them. Dropping them left the grouping panel drawing `---` chips for filaments
 * the file names. The real repair is in `sw_GetFileFilamentMapping` - item 2 of
 * 06-multiace.md - and until it lands, a filament the PLAN references is kept.
 */
function usesMaterial(f) {
  return f.used > 0 || f.usedMm > 0 || f.usedMm === -1;
}

function multiColors(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.colors)) return null;
  const out = m.colors.map(cssColor).filter(Boolean);
  return out.length ? out : null;
}
const single = (v) => { const c = cssColor(v); return c ? [c] : []; };

/**
 * One toolhead, as the dropdown item needs it: `index`, `filamentType`,
 * `nozzleDiameter`, and the colour.
 *
 * The nozzle comes off the EXTRUDER object rather than print_task_config, because that
 * is where the machine reports it - `SUBSCRIBE_OBJECTS` asks each extruder for
 * `nozzle_diameter` and has since the Device page's first subscription.
 */
export function machineToolheads(state) {
  const tc = (state && state.objects && state.objects['print_task_config']) || {};
  const arr = (k) => (Array.isArray(tc[k]) ? tc[k] : []);
  const types = arr('filament_type');
  const rgba = arr('filament_color_rgba');
  const argb = arr('filament_color');
  const multi = arr('filament_color_multi');
  const exists = arr('filament_exist');

  return TOOLHEADS.map((key, i) => {
    const ext = (state && state.objects && state.objects[key]) || {};
    const type = types[i];
    return {
      index: i,
      // The bundle compares this string directly, and treats "NONE" as its own case -
      // it gets a different tooltip from a plain mismatch.
      filamentType: type == null || type === '' ? 'NONE' : type,
      nozzleDiameter: nozzleStr(ext.nozzle_diameter),
      colors: multiColors(multi[i]) || single(rgba[i] != null ? rgba[i] : argb[i]),
      colorMode: multi[i] && multi[i].mode != null ? Number(multi[i].mode) : 0,
      loaded: exists[i] !== false,
    };
  });
}

/**
 * May this file filament print from this toolhead?
 *
 * `A.aJQ.$1`, verbatim:
 *
 *     r = file.filamentType == head.filamentType
 *      && file.nozzleDiameter != null
 *      && String(file.nozzleDiameter) === String(head.nozzleDiameter)
 *
 * and `r` is passed as the menu item's ENABLED flag. A head that does not match is not
 * merely discouraged - it cannot be chosen. Both halves matter and the file having no
 * declared nozzle fails the test on its own.
 *
 * The two refusals are told apart because the bundle tells them apart: a head reading
 * NONE gets `dialog_filament_type_none_tips`, anything else
 * `dialog_filament_type_not_match_tips`.
 */
export function matchOf(fil, head) {
  if (!fil || !head) return { ok: false, reason: 'none' };
  const ok = head.filamentType === fil.type
          && fil.nozzle != null
          && String(fil.nozzle) === String(head.nozzleDiameter);
  if (ok) return { ok: true, reason: null };
  return { ok: false, reason: head.filamentType === 'NONE' ? 'none' : 'mismatch' };
}

/**
 * `A.R5`, the nozzle-mismatch banner, and `A.c8l`, the comparison behind it.
 *
 * Set containment, not equality, and deliberately silent at both edges: an empty machine
 * list means the banner never fires, so a page that has not heard from the printer yet
 * does not accuse it of anything.
 */
export function nozzleMismatch(fileNozzles, machineNozzles) {
  const a = (fileNozzles || []).filter(Boolean);
  const b = (machineNozzles || []).filter(Boolean);
  if (!a.length && !b.length) return false;
  if (!b.length) return false;              // c8l: `!n && b.length === 0` -> true
  const have = new Set(b.map(String));
  return !a.every((x) => have.has(String(x)));
}

/**
 * Read everything Orca can tell us about the job, in the shipped popup's own order.
 *
 * Each is independent and each is allowed to fail: a dialog that cannot read the
 * legality check should still draw the file, and one that cannot reach the printer
 * should still say which file it was about to send. What a failure must never do is
 * pass silently - every one lands in `errors`, which the status line reads.
 */
export async function readJob(bridge, { log = () => {} } = {}) {
  const out = { file: null, mapping: null, legal: null, device: null, devices: [],
                errors: [] };

  const step = async (what, fn) => {
    try { return await fn(); }
    catch (e) { out.errors.push(`${what}: ${e.message}`); log(what, e); return null; }
  };

  out.file = await step('active file', () => bridge.request(CMD.GET_ACTIVE_FILE, {}));
  out.device = await step('connected machine',
                          () => bridge.request(CMD.GET_CONNECTED_MACHINE, {}));
  // The saved list, so the picker has something to offer even when nothing is connected.
  const list = await step('device list', () => bridge.request(CMD.GET_LOCAL_DEVICES, {}));
  out.devices = Array.isArray(list) ? list : (list && list.devices) || [];

  if (out.device && (out.device.model_name || out.device.machineType)) {
    out.legal = await step('legality', () => bridge.request(CMD.GET_PRINT_LEGAL, {
      connected_model: out.device.model_name || out.device.machineType,
    }));
  }

  out.mapping = await step('filament mapping', () => bridge.request(
    CMD.GET_FILE_FILAMENT_MAPPING,
    { filename: (out.file && out.file.filename) || '' }));

  return out;
}

/**
 * Bring the machine half up: a transport if nothing has one, then the subscription.
 *
 * `sw_GetMachineState` answers out of a Moonraker host, and something has to ATTACH one
 * first - `sw_mqtt_set_engine` is what does it. Inside Orca the Device tab usually has,
 * and this popup inherits it. Opened without the Device tab having connected, or run
 * outside Orca against u1_bridge.py, nothing has: every state command comes back
 *
 *     no engine attached yet (sw_mqtt_set_engine has not run)
 *
 * and the dialog draws four toolheads reading NONE with no nozzles - which looks exactly
 * like a printer with nothing loaded. That is the worst kind of wrong: it is a plausible
 * screen, and the operator would map filaments against it.
 *
 * So: try, and if the host says there is no engine, connect and try again. The connect
 * path is the Device page's, unchanged - `shared/js/connection.js`.
 *
 * A device that has never been paired cannot be brought up from here. Pairing needs the
 * PIN the printer is showing, and asking for it is the Device tab's job; this returns the
 * failure rather than growing a second pairing flow.
 */
export async function subscribeState(bridge, state, device,
                                     { log = () => {}, onStep = () => {} } = {}) {
  const filterAndSubscribe = async () => {
    try {
      await bridge.request(CMD.SET_SUBSCRIBE_FILTER, { objects: SUBSCRIBE_OBJECTS });
    } catch (e) {
      // Best-effort, as on the Device page: the filter narrows what arrives, and a host
      // that refuses it still pushes everything.
      log('subscribe filter', e);
    }
    const snap = await bridge.request(CMD.GET_MACHINE_STATE, { objects: SUBSCRIBE_OBJECTS });
    state.applyPayload(snap);
    await bridge.subscribe(CMD.SUBSCRIBE_MACHINE_STATE, {}, (d) => state.applyPayload(d));
  };

  try {
    await filterAndSubscribe();
    return { connected: false };            // something already had a host attached
  } catch (e) {
    if (!needsEngine(e) || !device) throw e;
    log('no engine attached; connecting', e);
  }

  onStep('Connecting to the printer…');
  const engine = await connect(bridge, device, { onStep, trace: (m) => log('connect', m) });
  await filterAndSubscribe();
  return { connected: true, engine };
}

/**
 * Did that fail because no transport is attached, rather than because the machine said
 * no? The host answers with that sentence and nothing else does.
 */
function needsEngine(e) {
  return /no engine attached/i.test((e && e.message) || '');
}

/**
 * The assignment: which toolhead each file filament prints from.
 *
 * It starts from `filament_extruder_map` - Orca's OWN map, made in the Prepare sidebar
 * and handed over in the mapping reply - rather than from nothing. Falls back to
 * identity, which is what the popup shows for a plate Orca has no opinion about.
 */
export function initialAssignment(mapping, filaments) {
  const map = (mapping && mapping.filament_extruder_map) || {};
  const out = {};
  filaments.forEach((f) => {
    const v = map[f.key] != null ? map[f.key] : map[f.index];
    const n = Number(v);
    // NOT identity. A filament Orca has no opinion about is UNASSIGNED, which the card
    // draws as `!` in the warning colour, and which is the bundle's own answer.
    //
    // Falling back to `f.index` looked harmless and is not. Against the real machine on
    // 2026-09-02 the plate wanted PLA in all four while the printer held
    // ["PLA","PLA","NONE","PETG"], so identity put filament 3 on an empty head and
    // filament 4 on PETG - two toolheads the picker itself REFUSES - and nothing on
    // screen said so, because the warning mark means "nothing chosen" and something had
    // been. An assignment the operator never made should not be one they have to notice
    // is wrong.
    out[f.key] = Number.isFinite(n) ? n : null;
  });
  return out;
}

/* ==================================================================== *
 * The ACE half.
 *
 * Everything below is inert on every plate the slicer can produce today: `ace_plan` is
 * a key `sw_GetFileFilamentMapping` does not send, so `filePlan()` returns null and the
 * dialog is exactly the dialog that already ships. It lights up when the planner lands.
 * See docs/u1-webui/03-print-processing/06-multiace.md.
 * ==================================================================== */

/**
 * The plan the SLICER made, if this plate has one.
 *
 * Normalised rather than trusted: every field is defaulted, and a step's unit falls back
 * to its head's. That fallback is not tidiness - in `head` mode a head is wired to one
 * unit and carrying it per step is redundant, but in `multi` a head has NO unit and its
 * places come one from each cabinet, so the step is the only thing that can say which.
 * Reading the head's there produced `bayAddr(undefined, …)`, which renders as `NaN1`.
 */
export function filePlan(mapping) {
  const raw = mapping && mapping.ace_plan;
  if (!raw || !Array.isArray(raw.heads) || !raw.heads.length) return null;
  return {
    mode: raw.mode || 'head',
    swaps: Number(raw.swaps) || 0,
    purgeG: Number(raw.purge_g) || 0,
    savedSwaps: Number(raw.saved_swaps) || 0,
    savedPurgeG: Number(raw.saved_purge_g) || 0,
    heads: raw.heads.map((h) => ({
      head: Number(h.head) || 0,
      feeder: !!h.feeder,
      unit: h.unit != null ? Number(h.unit) : null,
      lane: h.lane != null ? Number(h.lane) : null,
      run: (Array.isArray(h.run) ? h.run : []).map((s) => ({
        filament: Number(s.filament) || 0,
        unit: s.unit != null ? Number(s.unit) : (h.unit != null ? Number(h.unit) : null),
        slot: s.slot != null ? Number(s.slot) : null,
      })),
    })),
  };
}

/**
 * Read the `ace` object.
 *
 * On its own, because it is NOT on `SUBSCRIBE_OBJECTS` - that list is pinned to the
 * shipped bundle's and adding to it would change what every other surface receives. The
 * Device page reads it exactly this way and for exactly this reason.
 *
 * Fails quietly: no multiACE, no printer, or a host that does not know the object all
 * mean the same thing here - there is no ACE to draw, and `ace().present` is false.
 */
export async function refreshAce(bridge, state) {
  try {
    const snap = await bridge.request(CMD.GET_MACHINE_STATE, {
      objects: { ace: null, ace_bg_swap: null, save_variables: null },
    });
    state.applyPayload(snap);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * multiACE's override store, which is where a bay's NAME lives.
 *
 * The raw slots carry no identity - `{material:"", brand:"", rfid:0}` - so without this
 * every bay a person named by hand reads as `?`. `/multiace/api/state` is CORS-refused;
 * the store is a file under Moonraker's config root and Moonraker reflects the Origin.
 * Same fetch the Device page makes, and it fails quietly for the same reasons.
 */
export async function syncBays(device, mock) {
  if (mock && mock.aceOverrides) return mock.aceOverrides();
  const url = aceOverridesUrl(device);
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseAceOverrides(await r.json());
  } catch (e) {
    return null;
  }
}

/**
 * The bay assignment that would make every bay agree, or null when there is none.
 *
 * This is the cheap half of a re-map and the reason the panel can offer a fix at all: a
 * filament's toolhead is the tool number in the gcode and moving it re-writes the file,
 * but which bay feeds it is one argument on each `ACE_SWAP_HEAD`. So when the spools the
 * plate wants are all present and merely in the wrong bays, nothing has to be sliced,
 * carried or re-planned - the addresses were simply chosen before anyone could see the
 * machine.
 *
 * Greedy, per head, in the order the head prints: each step takes an unused bay of its own
 * unit that AGREES with it. Greedy is enough because a bay either holds what the step wants
 * or it does not - there is no cost to trade off and no reason to prefer one agreeing bay
 * over another. Anything short of every step placed returns null: a partial fix would clear
 * some marks and leave the plate just as unprintable.
 *
 * Returns `{ [filament]: slot }` only when it differs from what the plan already says.
 */
export function bayFix(plan, ace, filaments) {
  if (!plan || !ace || !ace.present) return null;
  const units = ace.units || [];
  const unitOf = (i) => units.find((u) => u.index === i) || null;
  const out = {};
  let changed = false;

  for (const h of plan.heads) {
    if (h.feeder || !h.run.length) continue;
    const used = new Set();
    for (const step of h.run) {
      const ui = step.unit != null ? step.unit : h.unit;
      const u = unitOf(ui);
      if (!u) return null;                     // the plan names a unit the machine has not got
      const want = filaments[step.filament];
      const bay = (u.bays || []).find(
        (b, i) => !used.has(i) && judgeBay(b, want).verdict === 'agrees');
      if (!bay) return null;                   // nothing loaded can serve this step
      const slot = u.bays.indexOf(bay);
      used.add(slot);
      out[step.filament] = slot;
      if (slot !== step.slot) changed = true;
    }
  }
  return changed ? out : null;
}

/** rfid and override are ASSERTED. derived is inferred, and is not evidence of a colour. */
const TRUSTED = new Set(['rfid', 'override']);

/**
 * Does this bay hold what the plate wants of it?
 *
 * Colour and material, brand ignored: colour alone passes PLA where PETG is loaded, and
 * a brand check flags a Kingroon-against-Generic difference nobody cares about.
 *
 * Four answers, and the third is the one that earns its keep. A bay whose identity was
 * merely DERIVED - inferred from what the head last loaded, asserted by nobody - is not
 * evidence of a wrong spool, and calling it one is a false accusation. A check that cries
 * wolf gets ignored, which costs more than no check. An empty bay is always `differs`:
 * the machine is not guessing about emptiness.
 */
export function judgeBay(bay, want) {
  if (!bay) return { verdict: 'unchecked', say: 'Not reported' };
  if (!bay.occupied) {
    return { verdict: 'differs', say: 'Empty', fix: `Put the ${want.type} spool in` };
  }
  if (!TRUSTED.has(bay.source)) {
    return { verdict: 'unsure', say: 'Occupied, nothing names it',
             fix: 'Tag it, or name it in multiACE' };
  }
  const sameType = (bay.material || '') === want.type;
  const bc = cssColor(bay.color);
  const sameColour = !!bc && !!want.colors[0]
    && bc.toUpperCase() === String(want.colors[0]).toUpperCase();
  if (sameType && sameColour) {
    return { verdict: 'agrees',
             say: [bay.vendor, bay.material].filter(Boolean).join(' ') || bay.material };
  }
  if (!sameType) {
    return { verdict: 'differs', say: `${bay.material || '?'}, not ${want.type}`,
             fix: `Put the ${want.type} spool in` };
  }
  return { verdict: 'differs', say: `${bay.material}, wrong colour`,
           fix: 'Put the right spool in' };
}

/**
 * Every place the plate needs, in plan order, judged against the machine.
 *
 * A stock feeder is NOT judged, and the page has to say so rather than tick it: the ACE
 * reports its own bays and nothing else, so a wrong colour on a feeder head goes
 * undetected. A tick there would claim a check that was never made.
 */
export function reconcile(plan, ace, filaments) {
  const rows = [];
  if (!plan) return { rows, differs: 0, unsure: 0, checked: false };
  const units = (ace && ace.units) || [];
  const unitOf = (i) => units.find((u) => u.index === i) || null;
  const checked = !!(ace && ace.present) && units.length > 0;
  const filAt = (i) => filaments[i] || { index: i, type: '---', colors: [] };

  plan.heads.forEach((h) => {
    h.run.forEach((step, order) => {
      const want = filAt(step.filament);
      if (h.feeder) {
        rows.push({ head: h.head, feeder: true, order, want, addr: null,
                    verdict: 'unchecked',
                    say: 'Stock feeder — the ACE does not report it' });
        return;
      }
      const ui = step.unit != null ? step.unit : h.unit;
      const u = unitOf(ui);
      const bay = u && step.slot != null ? u.bays[step.slot] : null;
      const j = checked && u ? judgeBay(bay, want)
                             : { verdict: 'unchecked', say: 'No ACE reported' };
      rows.push({ head: h.head, feeder: false, unit: ui, slot: step.slot, order,
                  addr: aceBayAddr(ui, step.slot), want, bay, ...j });
    });
  });

  return { rows, checked,
           differs: rows.filter((r) => r.verdict === 'differs').length,
           unsure: rows.filter((r) => r.verdict === 'unsure').length };
}
