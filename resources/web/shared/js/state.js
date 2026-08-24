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

import { TOOLHEADS, PRINT_STATE, PURIFIER_MODES } from './protocol.js';

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

    // The SUBSCRIBED source wins. `extruder*.state` arrives on the live stream, while
    // `toolhead.extruder` comes from the one-shot query at connect and after homing -
    // so preferring the latter froze the active tool at whatever it was when the page
    // loaded. A pick then waited forever for a change it could not see, and a park
    // waited for a null that never arrived; both timed out having actually worked.
    //
    // `toolhead.extruder` is kept only as a cold-start fallback, for the window before
    // the first state snapshot arrives.
    let activeKey = null;
    const reporting = TOOLHEADS.some((k) => (this.objects[k] || {}).state != null);
    if (reporting) {
      activeKey = TOOLHEADS.find((k) => (this.objects[k] || {}).state === 'ACTIVATE') || null;
    } else {
      activeKey = o.extruder || null;
    }
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

  /** machine_state_manager drives the activity banner and the error code. */
  activity() {
    const m = this.objects['machine_state_manager'] || {};
    return { mainState: m.main_state ?? null, actionCode: m.action_code ?? null };
  }

  connection() {
    const w = this.objects['webhooks'] || {};
    return { state: w.state ?? null, message: w.state_message ?? '' };
  }

  taskConfig() {
    return this.objects['print_task_config'] || {};
  }
}

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function pct(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
