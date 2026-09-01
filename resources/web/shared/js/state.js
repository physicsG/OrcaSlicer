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
import { parseAce, headOccupied } from './multiACE.js';

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
    /*
     * Whether the machine considers this slot's identity ITS OWN, and whether it will
     * let it be edited. Both are the printer's, per slot, and both were on the
     * subscription and unread while the panel decided the same question from the RFID
     * tag - which is not the same question.
     *
     * Measured on 811002511261022618B3, 2026-08-28:
     *
     *   head            0          1          2         3
     *   vendor        Jayo     Forshape     NONE    Kingroon
     *   sub_type     Marble        ""       NONE      Basic
     *   filament_detect: a decodable tag?    yes       yes      no        no
     *   filament_official                   true     FALSE   false     false
     *   filament_edit                      false      TRUE   false      TRUE
     *
     * Head 1 is the case that settles it: it carries a physical tag (`filament_detect`
     * reads Forshape PLA Silk, OFFICIAL, with a CARD_UID) and the machine still says
     * `filament_edit: true`, because the record in use has been overridden - the
     * sub-type there is `""` where the tag says `Silk`. **A tag present is not the same
     * question as read-only**, and the panel was asking the wrong one.
     */
    const official = arr('filament_official');
    const editable = arr('filament_edit');

    // The RFID tag, when there is one. `filament_detect.info` is one entry per slot in
    // slot order - TRAY is 0 on every entry, so it is the position that identifies the
    // slot, not that field. A manually-set filament has no tag and reads NONE here even
    // though print_task_config has a type for it, so the two sources are kept separate
    // rather than one overwriting the other.
    const det = this.objects['filament_detect'] || {};
    const tags = Array.isArray(det.info) ? det.info : [];
    const feed = this.feedChannels();

    const named = (v) => (v && v !== 'NONE' ? v : null);

    return TOOLHEADS.map((key, i) => {
      const type = types[i];
      const tag = tags[i] || {};
      const tagged = tag.MAIN_TYPE && tag.MAIN_TYPE !== 'NONE';
      const ext = this.objects[key] || {};
      /*
       * The spool's own record, when the machine's working copy has none.
       *
       * `print_task_config` and `filament_detect` are two records of one slot and the
       * first is not always filled: multiACE wipes it on every stock-feeder head when the
       * machine enters head mode (`_clear_filament_display`: empty type, empty vendor,
       * `FILAMENT_COLOR_RGBA=00000000`) and does NOT touch the tag. Measured on
       * 811002511261022618B3 after cycling normal → multi → head:
       *
       *   head 0   ptc '' '' '00000000'   exist true   TAG Jayo PLA Marble, OFFICIAL
       *   head 1   ptc '' '' '00000000'   exist true   TAG Forshape PLA Silk, OFFICIAL
       *
       * The panel drew both as "occupied, not named" while the identity was sitting in
       * the other object, which is what was reported: two toolheads that had shown their
       * filament went blank after a mode switch.
       *
       * This is multiACE's own precedence one level up - a tag beats a typed value -
       * applied where it had not been: the tag is only a FALLBACK here, so a record
       * someone set deliberately still wins while it exists.
       */
      const ptcType = named(type);
      const fromTag = !ptcType && tagged;
      return {
        index: i,
        type: ptcType || (fromTag ? named(tag.MAIN_TYPE) : null),
        subType: named(subs[i]) || (fromTag ? named(tag.SUB_TYPE) : null),
        vendor: named(vendors[i]) || (fromTag ? named(tag.VENDOR) : null),
        color: fromTag ? tag.ARGB_COLOR
             : (rgba[i] != null ? rgba[i] : argb[i]),
        // Where the identity on screen came from, so a caller need not re-derive it.
        fromTag: !!fromTag,
        // The machine says a slot HAS filament in `filament_exist`; the identity is a
        // separate question and a wiped one does not make the slot empty. This read
        // `!!type`, so a head the mode switch had blanked reported itself unloaded.
        loaded: exists[i] !== false && !!(ptcType || tagged),
        // The machine's own answer to "is this identity the spool's own record".
        official: official[i] === true,
        /*
         * The machine's own PERMISSION, verbatim. Its firmware computes it as:
         *
         *     allowed_edit = False
         *     if filament_exist[ch] and filament_official[ch] == False:
         *         allowed_edit = True
         *
         * and enforces the other half in `SET_PRINT_FILAMENT_CONFIG`, which raises
         * "official filament, not configurable!" without `FORCE=1`. So this is a real
         * gate and not a hint - but it is a LATCH, see `editable` below.
         *
         * The fallback is for a firmware that does not report the field; on this one it
         * is always there.
         */
        allowedEdit: editable[i] != null ? editable[i] === true
                   : (exists[i] !== false && !!type && type !== 'NONE'
                      && !(tag.MAIN_TYPE && tag.MAIN_TYPE !== 'NONE')),
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
    }).map((f) => Object.assign(f, {
      /*
       * What this PAGE will offer, which is deliberately stricter than the machine's
       * permission: a spool that carries a tag is not edited from here, whatever the
       * latch says.
       *
       * `allowedEdit` above is a latch, not a statement about the spool. Writing a slot
       * sets `filament_official[ch] = False` in the same firmware function, so ONE edit
       * unlocks a tagged spool permanently - until the tag is read again, which happens
       * when the filament is next loaded. Head 2 of 811002511261022618B3 is sitting in
       * exactly that state: an NTAG reading Forshape PLA **Silk** is physically there,
       * `print_task_config` says PLA with sub-type `""`, and the machine will cheerfully
       * take another write.
       *
       * Following the latch alone means the panel offers to type over a spool that will
       * revert on its next load, and the record drifts further from the tag each time.
       * So both must hold. A page may be more restrictive than a permission; it must
       * never be more permissive, and this is never that - `allowedEdit` is still
       * required, so an official or empty slot stays closed for the machine's own reason.
       *
       * Reported from the panel, on the real machine: "it has an rfid icon and is still
       * editable, which it should not be."
       */
      editable: f.allowedEdit && !f.tag,
    }));
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
          // The LAST OPERATION THAT FINISHED on this channel, which is a different
          // question from what it is doing now and outlives the answer to it:
          // `channel_state` settles back to `wait_insert`, this one stays. It is what
          // says whether a head is holding filament - see multiACE.js's headOccupied().
          actionState: v.channel_action_state || null,
          error: v.channel_error && v.channel_error !== 'ok' ? v.channel_error : null,
        };
      }
    }
    return out;
  }

  /**
   * Whether toolhead `i` is holding filament, for anything that has not already got the
   * three sources in hand. The rule - and the measurement behind it - is
   * multiACE.js's headOccupied(); the filament panel calls that directly because it is
   * already holding all three and this would re-parse them per card.
   */
  headLoaded(i) {
    return headOccupied(this.feedChannels()[i], this.ace().heads[i],
                        !!(this.filaments()[i] || {}).loaded);
  }

  /**
   * The multiACE topology. The model is `multiACE.js`, which also owns the override
   * merge -
   * two sources that do not carry the same thing, and one place that knows how they fit
   * together.
   */
  ace() {
    return parseAce(this.objects);
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
