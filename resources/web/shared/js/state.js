/*
 * state.js - machine state store.
 *
 * Orca normalises every status message before it reaches the page
 * (Moonraker_Mqtt::on_status_arrived):
 *
 *   payload.data = { data: <object map | [object map, eventtime]>, method: "..." }
 *
 * where <object map> is keyed by Klipper object name. Pushes are PARTIAL - only
 * changed objects, and only their filtered fields - so the store merges rather
 * than replaces. See docs/u1-webui/05-printer-protocol/04-state-model.md
 */
'use strict';

import { TOOLHEADS, PRINT_STATE, PURIFIER_MODES,
         ACE_UNIT_IDS, aceUnitId, aceBayAddr } from './protocol.js';

/** Every ACE has four bays, whatever it is: multiACE's own SLOT_COUNT. */
const ACE_SLOTS = 4;

/** Pull the object map out of whatever shape the transport handed us. */
export function unwrapStatus(data) {
  if (!data || typeof data !== 'object') return null;
  let inner = ('data' in data) ? data.data : data;
  // Moonraker's notify_status_update sends params as [ {objects}, eventtime ]
  if (Array.isArray(inner)) inner = inner[0];
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return null;
  // a query result may still be wrapped as { status: {...} }
  if (inner.status && typeof inner.status === 'object' && !Array.isArray(inner.status)) {
    return inner.status;
  }
  return inner;
}

export class MachineState {
  constructor() {
    this.objects = Object.create(null);
    this.lastUpdate = 0;
    this._listeners = new Set();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(changed) {
    this.lastUpdate = Date.now();
    for (const fn of this._listeners) {
      try { fn(this, changed); } catch (e) { console.error('[state] listener threw', e); }
    }
  }

  /** Merge a (partial) object map. Returns the set of object names touched. */
  apply(objectMap) {
    if (!objectMap) return [];
    const changed = [];
    for (const [name, fields] of Object.entries(objectMap)) {
      if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
        this.objects[name] = fields;
        changed.push(name);
        continue;
      }
      const cur = this.objects[name];
      this.objects[name] = (cur && typeof cur === 'object' && !Array.isArray(cur))
        ? Object.assign({}, cur, fields)   // shallow merge is correct: filters are flat
        : Object.assign({}, fields);
      changed.push(name);
    }
    if (changed.length) this._emit(changed);
    return changed;
  }

  /** Apply a raw SSWCP payload.data from a state push or query. */
  applyPayload(data) {
    return this.apply(unwrapStatus(data));
  }

  get(name) { return this.objects[name] || null; }

  // ---- typed accessors -------------------------------------------------

  /** Four toolheads; Klipper names the first `extruder`, not `extruder0`. */
  toolheads() {
    return TOOLHEADS.map((key, i) => {
      const o = this.objects[key] || {};
      return {
        key,
        index: i,
        label: `Toolhead ${i + 1}`,
        temperature: num(o.temperature),
        target: num(o.target),
        power: num(o.power),
        canExtrude: !!o.can_extrude,
        state: o.state ?? null,
        nozzleDiameter: o.nozzle_diameter ?? null,
        present: Object.keys(o).length > 0,
      };
    });
  }

  /**
   * The `toolhead` object: which tool is live, where the gantry is, what is homed.
   *
   * Measured on a U1 - `{extruder:"extruder3", position:[x,y,z,e], homed_axes:""}`.
   * Without it the Tool buttons were a local variable with nothing behind them and the
   * axis readouts could only ever show their placeholder. `homed_axes` matters just as
   * much: Klipper refuses a G0 on an unhomed axis, so a jog looks like it did nothing.
   */
  toolhead() {
    // Deliberately NOT from a `toolhead` subscription: the shipped page does not
    // subscribe that object, and the conformance suite holds the list to the bundle's.
    // Everything needed is already in the subscribed set - the active tool is the
    // extruder reporting state ACTIVATE, and the live position is on motion_report.
    // `homed_axes` exists only on `toolhead`, so it arrives from an explicit one-shot
    // query (see refreshToolhead in app.js) rather than from the stream.
    const o = this.objects['toolhead'] || {};
    const mr = this.objects['motion_report'] || {};
    const pos = Array.isArray(mr.live_position) ? mr.live_position
              : (Array.isArray(o.position) ? o.position : []);
    const hasHomed = Object.prototype.hasOwnProperty.call(o, 'homed_axes');
    const homed = String(o.homed_axes || '');

    // Which head is ENGAGED is answered only by `extruder*.state === 'ACTIVATE'`.
    //
    // `toolhead.extruder` is NOT a second opinion on that and must not be used as one.
    // It is Klipper's current-extruder pointer for G-code purposes, and it goes on
    // naming the last head used after that head has been parked - measured on this
    // machine reading "extruder" while all four reported PARKED. Trusting it let the
    // panel believe a head was live when none was: the button offered to park it,
    // PARK_EXTRUDER<n> returned an instant no-op "ok" with nothing moving, and the wait
    // then sat out its full timeout for an activeIndex that could never change.
    //
    // Nothing reporting ACTIVATE means nothing is engaged. That is an answer, not a gap
    // to be filled from elsewhere.
    const activeKey = TOOLHEADS.find(
      (k) => (this.objects[k] || {}).state === 'ACTIVATE') || null;

    return {
      activeKey,
      activeIndex: TOOLHEADS.indexOf(activeKey) >= 0 ? TOOLHEADS.indexOf(activeKey) : null,
      x: numOrNull(pos[0]), y: numOrNull(pos[1]), z: numOrNull(pos[2]), e: numOrNull(pos[3]),
      homedAxes: homed,
      // Unknown and "nothing is homed" look alike in the value and are not the same
      // thing, so the distinction is drawn on whether the field is THERE. An absent
      // toolhead snapshot is unknown; `homed_axes: ""` is the machine saying plainly
      // that no axis is homed - which is what it reports from a cold boot. Reading the
      // empty string as "unknown" let every Z and XY jog through to a printer that
      // refuses them, so the buttons looked dead.
      isHomed: (a) => (hasHomed ? homed.toLowerCase().includes(String(a).toLowerCase()) : true),
      allHomed: hasHomed ? ['x', 'y', 'z'].every((a) => homed.toLowerCase().includes(a)) : null,
      present: Object.keys(o).length > 0,
    };
  }

  /**
   * Filament slots, normalised.
   *
   * `filament_exist` is the authority on whether a slot is loaded - a slot can carry a
   * type of "NONE" and still be reported present, so both are checked.
   */
  filaments() {
    const c = this.objects['print_task_config'] || {};
    const arr = (k) => (Array.isArray(c[k]) ? c[k] : []);
    const types = arr('filament_type'), vendors = arr('filament_vendor');
    const subs = arr('filament_sub_type');
    const rgba = arr('filament_color_rgba'), argb = arr('filament_color');
    const exists = arr('filament_exist');

    // The RFID tag, when there is one. `filament_detect.info` is one entry per slot in
    // slot order - TRAY is 0 on every entry, so it is the position that identifies the
    // slot, not that field. A manually-set filament has no tag and reads NONE here even
    // though print_task_config has a type for it, so the two sources are kept separate
    // rather than one overwriting the other.
    const det = this.objects['filament_detect'] || {};
    const tags = Array.isArray(det.info) ? det.info : [];
    const feed = this.feedChannels();

    return TOOLHEADS.map((key, i) => {
      const type = types[i];
      const tag = tags[i] || {};
      const tagged = tag.MAIN_TYPE && tag.MAIN_TYPE !== 'NONE';
      const ext = this.objects[key] || {};
      return {
        index: i,
        type: (type && type !== 'NONE') ? type : null,
        subType: (subs[i] && subs[i] !== 'NONE') ? subs[i] : null,
        vendor: (vendors[i] && vendors[i] !== 'NONE') ? vendors[i] : null,
        color: rgba[i] != null ? rgba[i] : argb[i],
        loaded: exists[i] !== false && !!type && type !== 'NONE',
        // from the tag - null when the spool carries none
        tag: tagged ? {
          vendor: tag.VENDOR !== 'NONE' ? tag.VENDOR : null,
          type: tag.MAIN_TYPE,
          subType: tag.SUB_TYPE !== 'NONE' ? tag.SUB_TYPE : null,
          color: tag.ARGB_COLOR,
          nozzleMin: numOrNull(tag.HOTEND_MIN_TEMP),
          nozzleMax: numOrNull(tag.HOTEND_MAX_TEMP),
          bedTemp: numOrNull(tag.BED_TEMP),
          dryingTemp: numOrNull(tag.DRYING_TEMP),
          dryingTime: numOrNull(tag.DRYING_TIME),
          sku: tag.SKU || null,
        } : null,
        // Klipper's pressure advance is this machine's flow-dynamics factor - the
        // same role Bambu's "Factor K" plays.
        pressureAdvance: numOrNull(ext.pressure_advance),
        smoothTime: numOrNull(ext.smooth_time),
        feed: feed[i] || null,
      };
    });
  }

  /**
   * Per-extruder ACE feed state, from `filament_feed left` / `filament_feed right`.
   *
   * Each object is keyed by extruder name - and the keys are `extruder0`..`extruder3`,
   * which is NOT how Klipper names the first one anywhere else (`extruder`, no zero).
   */
  feedChannels() {
    const out = [];
    for (const side of ['filament_feed left', 'filament_feed right']) {
      const o = this.objects[side];
      if (!o || typeof o !== 'object') continue;
      for (const [k, v] of Object.entries(o)) {
        const m = /^extruder(\d+)$/.exec(k);
        if (!m || !v || typeof v !== 'object') continue;
        out[Number(m[1])] = {
          detected: !!v.filament_detected,
          inAce: !!v.filament_in_ace,
          inToolhead: !!v.filament_in_toolhead,
          atExtruder: !!v.filament_at_extruder,
          channelState: v.channel_state || null,
          error: v.channel_error && v.channel_error !== 'ok' ? v.channel_error : null,
        };
      }
    }
    return out;
  }

  /**
   * The multiACE topology, from the `ace` Klipper object.
   *
   * `ace` is NOT in SUBSCRIBE_OBJECTS - that list is pinned to the shipped bundle's -
   * so it arrives from an explicit one-shot query, the same way `toolhead` does. See
   * refreshAce() in device_page/js/core/session.js.
   *
   * Measured on 811002511261022618B3 (2026-08-25): one ACE 2 Pro, `protocol: "v2"`,
   * `mode: "head"`, `device_count: 1`, 38 % RH at 31 C, feeding Toolhead 4 from bay 3,
   * four PETG spools. `head_feeder {0,1,2 true, 3 false}`, `gate_status [1,1,1,1]`,
   * and every raw slot `{material:"", brand:"", color:[0,0,0], rfid:0}`.
   *
   * Two things that only hardware said, and both change what this returns:
   *
   *   `head_ace` is NOT the answer to "what feeds this head". It reads
   *   `{0:0, 1:1, 2:2, 3:0}` on a machine with `device_count: 1`, so heads 2 and 3 name
   *   units that do not exist. A head's source resolves `head_manual`, then
   *   `head_feeder`, and `head_ace` only for what is left - and only when the unit it
   *   names is actually there. Same bug class as `toolhead.extruder` naming a parked
   *   head.
   *
   *   No bay has a level. `spool_mode` is `spoolman` and `spool_binding` is `{}`, so
   *   nothing is bound and no bay has a weight behind it. A bay carries a colour, not
   *   a gauge; anything drawing a fill height here would be drawing a number the
   *   machine did not give it.
   */
  ace() {
    const o = this.objects['ace'];
    const present = !!o && typeof o === 'object' && !Array.isArray(o);
    if (!present) {
      return { present: false, mode: null, unitCount: 0, activeUnit: 0,
               swapping: false, swapPhase: null, lastSwap: null,
               units: [], heads: TOOLHEADS.map((_k, i) => ({
                 index: i, source: 'feeder', unitIndex: null, unitId: null,
                 bay: null, loaded: null })),
               settings: { confirmCommands: false, spoolmanUrl: '', spoolmanAuto: false,
                           purgeMatrix: false, spoolMode: null, bound: 0 } };
    }

    const rawUnits = Array.isArray(o.aces) ? o.aces : [];
    // `device_count` is the authority on how many units to draw - it is what ace.cfg
    // declares - and `aces[]` may be longer or shorter than it.
    const count = Number.isFinite(Number(o.device_count))
      ? Math.max(0, Math.min(ACE_UNIT_IDS.length, Number(o.device_count)))
      : rawUnits.length;

    const units = [];
    for (let i = 0; i < count; i += 1) units.push(aceUnit(rawUnits[i] || {}, i));

    const heads = TOOLHEADS.map((_k, i) => {
      const src = headSource(o, i, units.length);
      const from = mapAt(o.head_source, i);
      const loaded = spoolOf(from);
      if (src.source === 'ace' && loaded && units[src.unitIndex]) {
        // The one identity the raw object does carry. Every unloaded bay reads
        // `{material:"", brand:"", rfid:0}`, but `head_source[n]` names what is IN the
        // head - which is also what is in the bay it came from, so the bay it came from
        // stops being "occupied, not named".
        const bay = units[src.unitIndex].bays[src.bay];
        if (bay && bay.occupied && !bay.material) {
          Object.assign(bay, loaded, { known: true, source: bay.rfid ? 'rfid' : 'typed' });
        }
      }
      return { index: i, ...src, loaded };
    });

    return {
      present: true,
      mode: o.mode || null,
      unitCount: units.length,
      activeUnit: Number(o.active_device) || 0,
      swapping: !!o.swap_in_progress || (o.swap_phase && o.swap_phase !== 'idle'),
      swapPhase: nonEmpty(o.swap_phase),
      lastSwap: o.last_swap_result != null ? o.last_swap_result : null,
      units,
      heads,
      /*
       * The settings a person sets once, AS THE MACHINE REPORTS THEM.
       *
       * These were written as write-only - "the machine does not report this back, so
       * this sets it rather than shows it" - and that was simply wrong: three of the four
       * are right there in the object. A dialog that sets a value it could have shown is
       * a dialog that asks you to remember what you chose.
       *
       * The flush LENGTH really is absent. `purge_matrix` is the boolean that says
       * whether the per-pair stamps from the slicer's flush matrix are honoured; the
       * length itself lives in the config and is not in this object.
       */
      settings: {
        confirmCommands: o.confirm_commands === true,
        spoolmanUrl: nonEmpty(o.spoolman_url) || '',
        spoolmanAuto: o.spoolman_auto === true,
        purgeMatrix: o.purge_matrix === true,
        spoolMode: nonEmpty(o.spool_mode),
        // Empty on this machine, which is why no bay has a level. When it is not, the
        // entry it points at carries `weight_g` - remaining grams, an estimate from
        // extruded length. There is still no original weight, so a PERCENTAGE is not
        // derivable and a disc stays a colour rather than a gauge.
        bound: Object.keys(o.spool_binding || {}).length,
      },
    };
  }

  bed() {
    const o = this.objects['heater_bed'] || {};
    return { temperature: num(o.temperature), target: num(o.target) };
  }

  job() {
    const ps = this.objects['print_stats'] || {};
    const vs = this.objects['virtual_sdcard'] || {};
    const ds = this.objects['display_status'] || {};
    const progress = num(ds.progress ?? vs.progress);   // 0..1
    return {
      filename: ps.filename || vs.file_path || '',
      state: ps.state || PRINT_STATE.STANDBY,
      message: ps.message || ds.message || '',
      printDuration: num(ps.print_duration),
      totalDuration: num(ps.total_duration),
      filamentUsed: num(ps.filament_used),
      progress: clamp(progress, 0, 1),
      // Klipper carries the layer counters on print_stats.info, which IS subscribed.
      // numOrNull, not num: "no layer information" and "layer zero" are different
      // answers, and the card shows a dash for the first.
      layer: numOrNull((ps.info || {}).current_layer),
      totalLayer: numOrNull((ps.info || {}).total_layer),
      isActive: !!vs.is_active,
      fileSize: num(vs.file_size),
      filePosition: num(vs.file_position),
    };
  }

  fans() {
    const main = this.objects['fan'] || {};
    const cavity = this.objects['fan_generic cavity_fan'] || {};
    return {
      main: pct(main.speed),
      cavity: pct(cavity.speed),
    };
  }

  led() {
    const o = this.objects['led cavity_led'] || {};
    // color_data is Klipper's [[r,g,b,w]] form; the U1 drives the white channel
    let white = 0;
    const cd = o.color_data;
    if (Array.isArray(cd) && Array.isArray(cd[0])) white = num(cd[0][3] ?? cd[0][0]);
    else if (typeof cd === 'number') white = cd;
    return { on: white > 0, white };
  }

  speed() {
    const g = this.objects['gcode_move'] || {};
    return {
      factorPct: g.speed_factor != null ? Math.round(num(g.speed_factor) * 100) : null,
      extrudeFactor: num(g.extrude_factor),
    };
  }

  purifier() {
    const o = this.objects['purifier'] || {};
    // Measured: mode is an INTEGER (0), and exhaust_fan / inner_fan are objects
    // ({speed, delay, speed_threshold}) rather than scalars. The page used to print
    // the raw mode, which showed a bare "0", and treat the fans as numbers.
    const fanSpeed = (f) => (f && typeof f === 'object' ? pct(f.speed) : pct(f));
    return {
      powerDetected: !!o.power_detected,
      powerDetValue: num(o.power_det_value),
      mode: o.mode ?? null,
      modeName: PURIFIER_MODES[o.mode] ?? (o.mode == null ? null : String(o.mode)),
      exhaustFan: fanSpeed(o.exhaust_fan),
      innerFan: fanSpeed(o.inner_fan),
      present: Object.keys(o).length > 0,
    };
  }

  /**
   * Why the machine is busy, from the sources that actually answer.
   *
   * Measured, not assumed. A real `T0 A0` on an unhomed U1 was watched end to end
   * (2026-08-24, 31 s) and this is what moved:
   *
   *     0.7s  homed_axes "z"   idle_timeout "Printing"
   *     2.7s  homed_axes ""
   *     4.7s  homed_axes "y"
   *    14.7s  homed_axes "xy"          <- the "XY calibration" a user sees
   *    28.7s  extruder.activating_move true
   *    30.7s  extruder.state "ACTIVATE"
   *    32.7s  idle_timeout "Ready"
   *
   * Two things did NOT move at any point: `machine_state_manager`, which stayed
   * {main_state: 0, action_code: 0}, and `extruder_offset_calibration.calibration_step`,
   * which stayed "idle". Both were previously trusted here and both are silent for a
   * manual toolchange, which is why the dialog had nothing to say.
   *
   * `idle_timeout` is now treated as busy after all. It was excluded for reading
   * "Printing" on an apparently idle machine - but that is Klipper's timeout not having
   * elapsed yet, not a lie, and across the capture it bracketed the operation exactly.
   * Lingering is harmless because every wait also has its own done() and a hard cap.
   */
  busyReason() {
    const act = this.activity();
    const th = this.objects['toolhead'] || {};
    const cal = this.objects['extruder_offset_calibration'] || {};
    const disp = this.objects['display_status'] || {};
    const mr = this.objects['motion_report'] || {};
    const idle = this.objects['idle_timeout'] || {};

    const running = idle.state === 'Printing';
    const step = typeof cal.calibration_step === 'string' ? cal.calibration_step : '';
    const calibrating = !!step && step !== 'idle';
    const moving = Math.abs(num(mr.live_velocity)) > 0.001;
    const msg = typeof disp.message === 'string' && disp.message.trim()
      ? disp.message.trim() : null;

    const hasHomed = Object.prototype.hasOwnProperty.call(th, 'homed_axes');
    const homed = String(th.homed_axes || '').toLowerCase();
    // Homing while the machine is running is the long phase of a toolchange.
    //
    // The label used to name the axes already done - "Homing - Z done", then "Y done",
    // then "X, Y done". Two things were wrong with that. Klipper CLEARS homed_axes as
    // it re-homes, so Z vanishes from the list after being reported done, which reads
    // as the machine going backwards. And a person waiting for a toolhead does not want
    // an axis-by-axis account; they want to know it is working and will take a moment.
    // One step, named for what is happening.
    const homing = running && hasHomed && homed !== 'xyz';
    const engaging = TOOLHEADS.findIndex(
      (k) => (this.objects[k] || {}).activating_move === true);

    let label = null;
    if (calibrating) label = `Calibrating \u2014 ${prettyStep(step)}`;
    else if (engaging >= 0) label = `Engaging toolhead ${engaging + 1}\u2026`;
    else if (homing) label = 'Homing axes\u2026';
    else if (msg) label = msg;
    else if (moving) label = 'Moving\u2026';
    else if (running) label = 'Working\u2026';

    return {
      label,
      busy: calibrating || moving || running || engaging >= 0,
      homing,
      homedAxes: hasHomed ? homed : null,
      calibrationStep: calibrating ? step : null,
    };
  }

  /** machine_state_manager drives the activity banner and the error code. */
  activity() {
    const m = this.objects['machine_state_manager'] || {};
    return { mainState: m.main_state ?? null, actionCode: m.action_code ?? null };
  }

  /**
   * Milliseconds since anything last arrived; Infinity if nothing ever has.
   *
   * `lastUpdate > 0` answers a different question - whether the machine has EVER
   * spoken - and using it as a liveness test left a rebooting printer showing as
   * connected, with its last snapshot presented as current.
   */
  age(now = Date.now()) {
    return this.lastUpdate ? now - this.lastUpdate : Infinity;
  }

  connection() {
    const w = this.objects['webhooks'] || {};
    return { state: w.state ?? null, message: w.state_message ?? '' };
  }

  taskConfig() {
    return this.objects['print_task_config'] || {};
  }
}

/** `probe_xy_offset` -> `probe xy offset`: the machine's own word, made readable. */
function prettyStep(s) {
  return String(s).replace(/[_-]+/g, ' ').trim();
}

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function pct(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* ---- the `ace` object, unpacked ------------------------------------- */

/**
 * `head_manual`, `head_feeder`, `head_ace` and `head_source` are maps keyed by head
 * index. multiACE builds them as dicts with integer keys, which JSON carries as
 * strings, and a Klipper object that happened to be a list would read the same way -
 * so both are accepted rather than one assumed.
 */
function mapAt(m, i) {
  if (!m) return undefined;
  if (Array.isArray(m)) return m[i];
  if (typeof m !== 'object') return undefined;
  return m[i] !== undefined ? m[i] : m[String(i)];
}

/**
 * What feeds one head, resolved in the only order that is true.
 *
 * Written one rule per line, because the fallbacks are the whole point: `head_ace`
 * answers for every head whether or not that head is on an ACE, and whether or not the
 * unit it names exists.
 */
function headSource(o, i, unitCount) {
  const none = { source: 'feeder', unitIndex: null, unitId: null, bay: null };
  if (mapAt(o.head_manual, i)) return { source: 'manual', unitIndex: null, unitId: null, bay: null };
  if (mapAt(o.head_feeder, i)) return none;
  const u = Number(mapAt(o.head_ace, i));
  if (!Number.isInteger(u) || u < 0 || u >= unitCount) return none;
  const from = mapAt(o.head_source, i);
  const slot = from && Number.isInteger(Number(from.slot)) ? Number(from.slot) : null;
  return { source: 'ace', unitIndex: u, unitId: aceUnitId(u), bay: slot };
}

/**
 * ACE Pro and ACE 2 Pro are different machines.
 *
 * The unit names itself - `model: "ACE 2 Pro"`, measured 2026-08-26 - so that is what is
 * used. `protocol` is the fallback for a firmware that does not, and it is the field the
 * distinction actually rides on: v2 is the ACE 2 Pro, v1 the ACE Pro.
 */
function aceModel(u) {
  const named = nonEmpty(u.model);
  if (named) return named;
  const p = String(u.protocol || '').toLowerCase();
  if (p === 'v2') return 'ACE 2 Pro';
  if (p === 'v1') return 'ACE Pro';
  return 'ACE';
}

/**
 * A colour as the ACE reports it: `[r, g, b]` in the raw slots, `"632C2C"` in
 * `head_source`. Both are handed on as something cssColor() will take.
 */
function aceColor(c) {
  if (Array.isArray(c)) {
    if (c.length < 3 || c.every((v) => !Number(v))) return null;   // [0,0,0] is "none"
    return '#' + c.slice(0, 3)
      .map((v) => Math.max(0, Math.min(255, Number(v) | 0)).toString(16).padStart(2, '0'))
      .join('').toUpperCase();
  }
  if (typeof c === 'string' && c.trim()) return c.trim();
  return null;
}

const nonEmpty = (v) => (typeof v === 'string' && v.trim() && v.trim() !== 'NONE'
  ? v.trim() : null);

/** What `head_source[n]` says is loaded at a head - or null when it says nothing. */
function spoolOf(from) {
  if (!from || typeof from !== 'object') return null;
  const material = nonEmpty(from.type) || nonEmpty(from.material);
  const color = aceColor(from.color);
  if (!material && !color) return null;
  return {
    material,
    subType: nonEmpty(from.subtype) || nonEmpty(from.sub_type),
    vendor: nonEmpty(from.brand) || nonEmpty(from.vendor),
    color,
    rfid: Number(from.rfid) || 0,
  };
}

/**
 * One unit, its four bays, and its dryer.
 *
 * A bay is occupied when the hardware says so - `gate_status[k]` is the gate sensor and
 * `slots[k].state` is multiACE's naming of the same thing - and *named* only when
 * something carries an identity for it. Those are two different questions and the panel
 * draws the difference, because on this machine the answer to the second is almost
 * always no: the spools have no tags and multiACE keeps typed-in names in its own store,
 * behind CORS. Occupied-and-unnamed is drawn as exactly that rather than as empty.
 */
function aceUnit(u, index) {
  const gates = Array.isArray(u.gate_status) ? u.gate_status : [];
  const rawSlots = Array.isArray(u.slots) ? u.slots : [];
  const bays = [];
  for (let k = 0; k < ACE_SLOTS; k += 1) {
    const s = rawSlots[k] || {};
    const state = nonEmpty(s.state) || nonEmpty(s.status);
    const gate = gates[k];
    const occupied = gate !== undefined ? Number(gate) !== 0 : (!!state && state !== 'empty');
    const material = nonEmpty(s.material) || nonEmpty(s.type);
    const rfid = Number(s.rfid) || 0;
    bays.push({
      index: k,
      addr: aceBayAddr(index, k),
      occupied,
      known: !!material,
      material,
      subType: nonEmpty(s.subtype) || nonEmpty(s.sub_type),
      vendor: nonEmpty(s.brand) || nonEmpty(s.vendor),
      sku: nonEmpty(s.sku),
      color: aceColor(s.color !== undefined ? s.color : s.color_rgb),
      rfid,
      // Where the name came from decides what may be done to it: a tag can be read and
      // not written, so it gets an eye where a typed value gets a pencil.
      source: rfid ? 'rfid' : (material ? 'typed' : (occupied ? 'unknown' : 'empty')),
    });
  }
  return {
    index,
    id: aceUnitId(index),
    model: aceModel(u),
    firmware: nonEmpty(u.firmware) || nonEmpty(u.fw) || nonEmpty(u.version),
    connected: u.connected !== false,
    humidity: numOrNull(u.humidity),
    temperature: numOrNull(u.temp !== undefined ? u.temp : u.temperature),
    dryer: aceDryer(u.dryer_status || u.dryer),
    // Its own object on the unit, not part of dryer_status - measured
    // `{enabled, rh_start, rh_end, temp, master, add_time}`. rh_start is the humidity it
    // starts at and rh_end the one it stops at, so the panel's "above" is rh_start.
    autoDry: {
      enabled: !!(u.auto_dry || {}).enabled,
      running: !!u.auto_dry_running,
      rhStart: numOrNull((u.auto_dry || {}).rh_start),
      rhEnd: numOrNull((u.auto_dry || {}).rh_end),
      temp: numOrNull((u.auto_dry || {}).temp),
    },
    bays,
  };
}

/**
 * The dryer.
 *
 * Every field below was measured on 811002511261022618B3 on 2026-08-26, by running the
 * dryer at its mildest setting for ten seconds - which is the only way to see any of it,
 * and the reason two of the three guesses this replaced were wrong:
 *
 *   {"status": "stop",    "target_temp": 0,  "duration": 0,     "remain_time": 0}
 *   {"status": "keeping", "target_temp": 45, "duration": 180,   "remain_time": 179}
 *
 * `duration` and `remain_time` are **seconds**: `DURATION=3` gave 180 and `DURATION=240`
 * gave 14400, which also settles that ACE_DRY's own argument is in **minutes**. The
 * running word is `keeping`, not `running` or `drying`.
 *
 * The word sets below are still open at one end on purpose. `stop` and `keeping` are the
 * two that have been seen; a firmware with a third word for "heating up to target" would
 * otherwise read as idle, so anything that is neither empty nor a known stopped word
 * counts as running.
 */
const DRYER_STOPPED = new Set(['', 'stop', 'stopped', 'idle', 'off', 'none']);

function aceDryer(d) {
  const off = { running: false, target: null, totalMin: null, remainingMin: null,
                doneMin: null, pct: null, status: null };
  if (!d || typeof d !== 'object') return off;
  const status = String(d.status || d.state || '').toLowerCase();
  const running = d.running === true || (!!status && !DRYER_STOPPED.has(status));
  const target = numOrNull(d.target_temp !== undefined ? d.target_temp
    : (d.target !== undefined ? d.target : d.temp));
  const totalMin = secondsToMin(d.duration !== undefined ? d.duration : d.total);
  const remainingMin = secondsToMin(d.remain_time !== undefined ? d.remain_time
    : (d.remaining !== undefined ? d.remaining : d.left));
  const doneMin = (totalMin != null && remainingMin != null)
    ? Math.max(0, totalMin - remainingMin) : null;
  return {
    running,
    status: status || null,
    target,
    totalMin,
    remainingMin,
    doneMin,
    pct: (totalMin && doneMin != null) ? Math.round((doneMin / totalMin) * 100) : null,
  };
}

/** Seconds on the wire, minutes on the panel. A dash for anything unreadable. */
function secondsToMin(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n / 60);
}

