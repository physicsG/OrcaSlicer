/*
 * multiACE.js - everything about multiACE, in one place.
 *
 * Named for the plugin and not for the hardware, because they are not the same thing and
 * the difference is load-bearing. The **ACE** is Snapmaker's own unit. **multiACE**
 * (github.com/decay71/multiACE) is the third-party Klipper plugin that drives up to four
 * of them, and it is what publishes the `ace` object, the macros, the override store and
 * the web service this page reads. None of it is official Snapmaker firmware: a stock U1
 * reports no `ace` object at all, which is the state the Filament panel degrades into.
 * Anything here can change with a plugin release; the ACE itself cannot.
 *
 * It lives apart from state.js because it is not one model but two, from two sources
 * that do not carry the same thing:
 *
 *   the `ace` Klipper object   topology, unit health, the dryer, occupancy, and the full
 *                              identity of what is LOADED in each head. Machine state,
 *                              read with everything else.
 *   the override store         what is in each BAY. The Klipper object carries none of
 *                              it - every raw slot reads {material:"", brand:"", rfid:0}
 *                              because these spools have no tags - and multiACE keeps
 *                              the names its own web UI shows in a file, merging them in
 *                              its `_parse_state()`. Not machine state: a file the PAGE
 *                              fetched, held in `store.aceBays`.
 *
 * The panel drew three of four bays as `?` on a machine that knew all four, because it
 * read only the first. Orca's own Prepare page polls the merged endpoint from C++ and saw
 * the names. Both were reading correctly, from two different things - which is exactly
 * why the merge, and the precedence it follows, is one function here rather than a rule
 * spread across a view and a command module.
 *
 * `MachineState.ace()` is a call into `parseAce()`, so the accessor still sits where every
 * other accessor does; the constants stay in protocol.js, which is the table of things
 * recovered from evidence. What is here is the modelling, and it is pure - no DOM, no
 * transport - so unit_jsc.py can hold the precedence rule to account in JavaScriptCore.
 */
'use strict';

import { TOOLHEADS, DEVICE, MOONRAKER_HTTP_PORT } from './protocol.js';

/**
 * The multiACE this was written against, and verified on.
 *
 * A plugin, not firmware: `0.99.8b+9ba137e1` on a U1 running 1.5.2, publishing
 * `api_version: 1`, with `ace_bg_swap` at its own `v0.9`. Everything here can move with a
 * plugin release, which is why `parseAce()` reads defensively and why the version is
 * carried through into the model rather than only living in a comment.
 */
export const MULTIACE_VERIFIED = { web: '0.99.8b', apiVersion: 1, bgSwap: 'v0.9',
                                   on: '2026-08-26' };

/** Every ACE has four bays, whatever it is: multiACE's own SLOT_COUNT. */
const ACE_SLOTS = 4;

/* ------------------------------------------------------------------ *
 * multiACE
 *
 * Every control on the Filament panel is a plain G-code macro with documented
 * arguments, read out of `printer.gcode.help` on the machine on 2026-08-25, and the
 * page already owns sw_SendGCodes - so none of this needs a new bridge command.
 *
 * Names only. What each one takes lives beside the call in filament-commands.js,
 * because an argument list written twice is an argument list that drifts.
 * ------------------------------------------------------------------ */
export const ACE = {
  SET_MODE:        'SET_ACE_MODE',            // MODE=normal|multi|head [HEAD=n]
  SET_HEAD_FEEDER: 'ACE_SET_HEAD_FEEDER',     // HEAD=n ENABLE=0|1   (head mode only)
  SET_HEAD_ACE:    'ACE_SET_HEAD_ACE',        // HEAD=n ACE=a        (head mode only)
  SET_HEAD_MANUAL: 'ACE_SET_HEAD_MANUAL',     // HEAD=n ENABLE=0|1
  LOAD_HEAD:       'ACE_LOAD_HEAD',           // HEAD=n [ACE=a] [SLOT=s]
  UNLOAD_HEAD:     'ACE_UNLOAD_HEAD',         // HEAD=n [RETRACT_LENGTH=] [KEEP_HEAT=]
  SWAP_HEAD:       'ACE_SWAP_HEAD',           // HEAD=n ACE=a [SLOT=s]
  DRY:             'ACE_DRY',                 // ACE=a [TEMP=C] [DURATION=MINUTES]
  // NOT ACED__DRY_STOP, which stops "the current ACE" - on a machine with two units that
  // is whichever one is active, and not necessarily the one whose chip was pressed.
  DRY_STOP:        'ACE_STOP_DRYING',         // [ACE=a]
  SET_AUTO_DRY:    'ACE_SET_AUTO_DRY',        // ACE=a ENABLE=0|1 [RH_START=%]
  UNLOAD_ALL:      'ACE_UNLOAD_ALL_HEADS',    // no arguments
  SET_PURGE:       'ACE_SET_PURGE',           // LENGTH=<mm> | RESET=1
  SET_CONFIRM:     'ACE_SET_CONFIRM_COMMANDS',// ENABLE=0|1
  SET_SPOOLMAN:    'ACE_SET_SPOOLMAN',        // URL= AUTO=0|1
  CLEAR_HEADS:     'ACE_CLEAR_HEADS',         // [HEAD=n]
};

/**
 * Units are addressed by index on the wire and by letter on screen, the way Bambu
 * addresses an AMS - so a bay is A1..D4 and the address fits inside its own disc.
 */
export const ACE_UNIT_IDS = ['A', 'B', 'C', 'D'];
export const aceUnitId = (i) => ACE_UNIT_IDS[i] || String((i | 0) + 1);
export const aceBayAddr = (unit, slot) => `${aceUnitId(unit)}${(slot | 0) + 1}`;

/** SET_ACE_MODE's three, in the order the macro help lists them. */
export const ACE_MODES = ['normal', 'multi', 'head'];
export const ACE_MODE_LABELS = { normal: 'Normal', multi: 'Multi', head: 'Head' };

/**
 * What the dryer dialog offers, and what the macro will take.
 *
 * The presets are the common answers; the limits are there because ACE_DRY takes a
 * number and not a menu, and a spool whose tag says 65 C for 8 h should not have to be
 * rounded to the nearest chip.
 */
export const DRY_TEMPS = [45, 55, 65, 70];
export const DRY_HOURS = [2, 4, 6, 12];
export const DRY_LIMITS = { temp: [35, 80], hours: [1, 24] };
export const AUTO_DRY_THRESHOLDS = [45, 55, 65];

/**
 * ACE_DRY's DURATION is in MINUTES, and the panel offers hours.
 *
 * Measured, because it had to be: `DURATION=3` came back as `duration: 180` and
 * `DURATION=240` as `14400`, both in seconds. Sending the panel's `4` unconverted asked
 * for four MINUTES of drying and the machine answered `ok`, which is the whole reason
 * this constant exists rather than a bare multiplication somewhere.
 */
export const DRY_MINUTES_PER_HOUR = 60;

/**
 * Where multiACE keeps what is in each bay, and why it is a file.
 *
 * The `ace` Klipper object carries NO per-bay identity: every raw slot reads
 * `{material:"", brand:"", rfid:0}` because these spools have no tags. multiACE keeps
 * the names its own web UI shows in an override store and merges them in `_parse_state()`
 * — which is why `/multiace/api/state` shows four named bays where the Klipper object
 * shows four blanks, and why Orca's own AceMmuProvider (which polls that endpoint from
 * C++) sees filament this page could not.
 *
 * That endpoint is not reachable from a browser: nginx serves `/multiace/` with **no
 * CORS header at all**, measured. What IS reachable is the store itself — Moonraker's
 * file server on :7125 reflects the Origin, the same server this page already fetches
 * camera frames and job thumbnails from, and the override store lives under its `config`
 * root. So this needs no proxy, no new bridge command and no C++.
 *
 * Keyed `"<ace>_<slot>"` -> `{ace, slot, material, brand, subtype, color}`.
 */
export const ACE_OVERRIDES_FILE = 'config/extended/multiace/slot_overrides.json';

export function aceOverridesUrl(device) {
  const ip = device && device[DEVICE.IP];
  if (!ip) return null;
  return `http://${ip}:${MOONRAKER_HTTP_PORT}/server/files/${ACE_OVERRIDES_FILE}`;
}

/**
 * multiACE's own precedence for where a bay's identity came from, and its own words for
 * it: `rfid | override | derived | empty`. Worth keeping verbatim - the panel draws the
 * difference (an eye for what may only be read, a pencil for what may be edited) and
 * inventing a second vocabulary for the same fact is how two of them drift apart.
 */
export const BAY_SOURCES = ['rfid', 'override', 'derived', 'unknown', 'empty'];

/**
 * Orca's own humidity buckets - `hum_level1..5` at <=20, <=35, <=50, <=65, >65.
 *
 * The same thresholds AMSinfo uses to pick its droplet, so a tinted pill on this page
 * and the C++ widget cannot disagree about the same number.
 */
export function humidityLevel(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return 0;
  return n <= 20 ? 1 : n <= 35 ? 2 : n <= 50 ? 3 : n <= 65 ? 4 : 5;
}

/**
 * One macro line: `ACE_DRY` + {ACE: 0, TEMP: 55} -> `ACE_DRY ACE=0 TEMP=55`.
 *
 * Here rather than in the panel's commands because the panel is not the only thing that
 * will ever send one, and because the argument names are the half of this subsystem that
 * has actually been wrong: `THRESHOLD=` was accepted, acked and ignored.
 */
export function aceLine(macro, args) {
  return [macro].concat(
    Object.entries(args || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${v}`)).join(' ');
}


/**
 * The `ace` Klipper object, unpacked.
 *
 * Measured on 811002511261022618B3 (2026-08-25, again 2026-08-26): one ACE 2 Pro,
 * `protocol: "v2"`, `mode: "head"`, `device_count: 1`, 38 % RH at 30 C, feeding Toolhead 4
 * from bay 3, four PETG spools. `head_feeder {0,1,2 true, 3 false}`,
 * `gate_status [1,1,1,1]`, and every raw slot `{material:"", brand:"", color:[0,0,0],
 * rfid:0}`.
 *
 * Two things that only hardware said, and both change what this returns:
 *
 *   `head_ace` is NOT the answer to "what feeds this head". It reads
 *   `{0:0, 1:1, 2:2, 3:0}` on a machine with `device_count: 1`, so heads 2 and 3 name
 *   units that do not exist. A head's source resolves `head_manual`, then `head_feeder`,
 *   and `head_ace` only for what is left - and only when the unit it names is actually
 *   there. Same bug class as `toolhead.extruder` naming a parked head.
 *
 *   No bay has a level. `spool_mode` is `spoolman` and `spool_binding` is `{}`, so
 *   nothing is bound and no bay has a weight behind it. A bay carries a colour, not a
 *   gauge; anything drawing a fill height here would be drawing a number the machine did
 *   not give it.
 */
export function parseAce(objects) {
    const o = (objects || {})['ace'];
    const present = !!o && typeof o === 'object' && !Array.isArray(o);
    if (!present) {
      return { present: false, mode: null, unitCount: 0, activeUnit: 0,
               swapping: false, swapPhase: null, lastSwap: null,
               units: [], heads: TOOLHEADS.map((_k, i) => ({
                 index: i, source: 'feeder', unitIndex: null, unitId: null,
                 bay: null, loaded: null })),
               apiVersion: null,
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
          // multiACE's own word for this: the identity was DERIVED from what is loaded,
          // not read off a tag and not typed against the bay. It is the weakest of the
          // three, so an override read off the printer replaces it - see the panel.
          Object.assign(bay, loaded, { known: true, source: bay.rfid ? 'rfid' : 'derived' });
        }
      }
      return { index: i, ...src, loaded };
    });

    return {
      present: true,
      /*
       * Which multiACE this is talking to.
       *
       * The whole surface below belongs to a plugin someone chose to install, not to the
       * U1's firmware, and it is pre-1.0: `api_version` is the contract the object
       * claims, and `ace_bg_swap.version` its own. Carried so a mismatch is something
       * the page can SAY rather than something a user discovers when a control does
       * nothing - and so the version this was verified against is checkable rather than
       * only written in a document.
       */
      apiVersion: numOrNull(o.api_version),
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

/**
 * The override store, as it comes off the printer's file server.
 *
 * The file is the map itself; multiACE's own API wraps it in `{overrides: ...}`. Both are
 * accepted, because the two are the same data and a caller should not have to know which
 * end it came from.
 */
export function parseAceOverrides(raw) {
  const map = (raw && typeof raw === 'object' && raw.overrides) ? raw.overrides : raw;
  return (map && typeof map === 'object' && !Array.isArray(map)) ? map : null;
}

/**
 * What is actually in one unit's bays.
 *
 * multiACE's precedence, kept verbatim: **rfid, then the override, then derived.** A tag
 * is the hardware's own answer and beats a name someone typed against the bay; both beat
 * an identity inferred from what happens to be loaded in the head. Those are multiACE's
 * own words (`rfid | override | derived`) and using the same ones is what stops the two
 * vocabularies drifting apart.
 *
 * Pure, and returns a new array rather than touching the unit: with no store there is
 * nothing to merge and the bays are handed straight back, which is the same answer as a
 * printer that has no multiACE web service at all.
 */
export function mergeAceBays(unit, overrides) {
  if (!unit || !overrides) return (unit && unit.bays) || [];
  return unit.bays.map((b) => {
    if (!b.occupied || b.source === 'rfid') return b;
    const o = overrides[`${unit.index}_${b.index}`];
    const material = (o && typeof o === 'object' && typeof o.material === 'string')
      ? o.material.trim() : '';
    if (!material) return b;
    return Object.assign({}, b, {
      known: true,
      material,
      subType: ((o.subtype || '').trim()) || b.subType,
      vendor: ((o.brand || '').trim()) || b.vendor,
      color: o.color || b.color,
      source: 'override',
    });
  });
}

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

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

