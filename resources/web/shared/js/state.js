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

import { TOOLHEADS, PRINT_STATE } from './protocol.js';

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
    return {
      powerDetected: !!o.power_detected,
      powerDetValue: num(o.power_det_value),
      mode: o.mode ?? null,
      exhaustFan: o.exhaust_fan ?? null,
      innerFan: o.inner_fan ?? null,
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

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function pct(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
