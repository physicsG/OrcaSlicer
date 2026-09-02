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
export function fileFilaments(mapping) {
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
  })).filter(usesMaterial);
}

/** `A.bEE`: keep a filament the plate actually consumes. -1 mm means "unknown, keep". */
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
    out[f.key] = Number.isFinite(n) ? n : f.index;
  });
  return out;
}
