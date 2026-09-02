/*
 * ace-fixture.js - the data the multiACE print-dialog mockups run on.
 *
 * Three things and nothing else: the FILE (a plate wanting seven filaments), the MACHINE
 * (four toolheads and the places that can feed them), and the judgement between them.
 *
 * IT IS THE DEVICE PAGE'S MODEL, NOT A NEW ONE
 *
 * `bays[]` here is exactly what `aceUnit()` in shared/js/multiACE.js returns - `index`,
 * `addr`, `occupied`, `known`, `material`, `subType`, `vendor`, `color`, `rfid`,
 * `source` - because the print dialog is looking at the same machine the Device page's
 * Filament panel draws, and a second vocabulary for one object is how two surfaces come
 * to disagree about it. `source` carries multiACE's own precedence, `rfid > override >
 * derived`, and that is what makes the verdict below three-valued rather than two.
 *
 * `heads[]` is `state.filaments()`' shape plus the head's `nozzle`, which is where the
 * dialog already reads it from - the extruder object, not print_task_config.
 *
 * WHERE THE NUMBERS COME FROM
 *
 * The machine is the U1 at 192.168.2.242 as the Filament panel was measured against it:
 * `mode: "head"`, one ACE 2 Pro (`protocol: "v2"`) at 39% RH feeding toolhead 4, heads
 * 1-3 on their stock feeders. Capacity is therefore 3 + 4 = SEVEN places, which is the
 * whole reason this dialog needs rebuilding: the four-card dialog has four labels.
 *
 * THE PLATE'S SIDE IS A PLAN, AND IT IS THE FILE'S
 *
 * On a plate sliced for an ACE the emitter has already decided which head runs which
 * filament and out of which bay, and it wrote that into the gcode. So `PLAN` describes a
 * file that exists; it is not a proposal this dialog is making, and none of these three
 * options has a head picker. What the dialog can still do is check the machine against
 * it, and say what to move.
 */
'use strict';

/* ---- the plate ---------------------------------------------------------- */

/** Standing in for `thumbnails[0].url` - on a real reply, a base64 PNG of the plate. */
function plateThumb(colors) {
  const band = (i, c) => `<rect x="58" y="${56 + i * 12}" width="84" height="12" fill="${c}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a3542"/><stop offset="1" stop-color="#131a22"/>
    </linearGradient></defs>
    <rect width="200" height="200" fill="url(#bg)"/>
    <g opacity=".16" stroke="#7f8d9d" stroke-width="1">
      ${Array.from({ length: 7 }, (_, i) => `<path d="M${30 + i * 20} 150 L${100 + (i - 3) * 10} 176"/>`).join('')}
    </g>
    <path d="M30 150 L100 176 L170 150 L100 126 Z" fill="#1b232d" stroke="#3c4956"/>
    <g>${colors.map((c, i) => band(colors.length - 1 - i, c)).join('')}</g>
    <path d="M58 56 L58 140 L100 156 L100 72 Z" fill="#000" opacity=".18"/>
    <path d="M100 72 L100 156 L142 140 L142 56 Z" fill="#fff" opacity=".07"/>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const F = (i, type, color, name, weight, mm) =>
  ({ index: i, key: String(i), type, color, name, weight, usedMm: mm });

/** The seven the plate prints, in the plate's own order. */
export const FILAMENTS = [
  F(0, 'PLA', '#EC008C', 'Magenta', 6.6, 2210),
  F(1, 'PLA', '#FEC600', 'Amber', 7.27, 2431),
  F(2, 'PLA', '#00AE42', 'Green', 7.36, 2460),
  F(3, 'PLA', '#0056B8', 'Blue', 7.58, 2534),
  F(4, 'PLA', '#F44336', 'Red', 6.7, 2240),
  F(5, 'PLA', '#F2F2F2', 'White', 6.5, 2173),
  F(6, 'PLA', '#1A1A1A', 'Black', 6.7, 2241),
];

/*
 * `sw_GetFileFilamentMapping` as SSWCP.cpp:3039 builds it - PARALLEL ARRAYS, never a
 * `filaments[]` of objects.
 *
 * Everything here exists today. What does not is `ace_plan` below, and its absence is
 * the first integration item: nothing in this reply says a plate was sliced for an ACE.
 */
export const MAPPING = {
  filename: 'colour_cube_7.gcode',
  filepath: '/tmp/SnapmakerOrca/plate_1.gcode',
  machine_model: 'Snapmaker U1',
  estimated_time: 14232,
  filament_type: FILAMENTS.map((f) => f.type),
  filament_color_rgba: FILAMENTS.map((f) => f.color),
  filament_weight: FILAMENTS.map((f) => f.weight),
  filament_weight_total: FILAMENTS.reduce((a, f) => a + f.weight, 0),
  filament_used_mm: FILAMENTS.map((f) => f.usedMm),
  nozzle_diameters: ['0.4', '0.4', '0.4', '0.4'],
  nozzle_info: ['0.4'],
  filament_extruder_map: { 0: '3', 1: '0', 2: '1', 3: '2', 4: '3', 5: '3', 6: '3' },
  thumbnails: [{ url: plateThumb(FILAMENTS.map((f) => f.color)), width: 512, height: 512 }],
};

/*
 * PROPOSED - `ace_plan`, the one key that would make a plate legible here.
 *
 * Nothing in it would be computed by the page: the slicer decides the layout, writes a
 * plan line into the gcode header and emits an `ACE_SWAP_HEAD HEAD=n ACE=u SLOT=s` for
 * every swap. This is that, handed over.
 *
 *   heads[h].run   the file filaments head h runs, IN THE ORDER IT RUNS THEM, each with
 *                  the bay it comes from when the head is ACE-fed
 *   swaps/purge_g  what the layout costs, which the operator is entitled to before Send
 */
export const PLAN = {
  mode: 'head',
  swaps: 300,
  purge_g: 40.4,
  /*
   * What the grouping BOUGHT, which is the line Bambu's Slicing Result panel carries
   * ("Save 25g filament and 100 nozzle purges compared to a printer with one nozzle").
   *
   * The U1's comparison is not against one nozzle - it has four - but against the same
   * plate with every filament on the ACE head, which is what a machine with no free tool
   * changes would have to do. Three of the seven ride stock feeders, so every change into
   * those three is a tool change instead of a swap. The planner computes both; these are
   * the difference.
   */
  savedSwaps: 212,
  savedPurge_g: 28.6,
  heads: [
    { head: 0, feeder: true, run: [{ filament: 1 }] },
    { head: 1, feeder: true, run: [{ filament: 2 }] },
    { head: 2, feeder: true, run: [{ filament: 3 }] },
    { head: 3, feeder: false, unit: 0,
      run: [{ filament: 0, unit: 0, slot: 0 }, { filament: 4, unit: 0, slot: 1 },
            { filament: 5, unit: 0, slot: 2 }, { filament: 6, unit: 0, slot: 3 }] },
  ],
};

/*
 * The same seven filaments on a machine with TWO ACE units.
 *
 * Two stock feeders and two ACE-fed heads is 2 + 4 + 4 = TEN places, so a seven-filament
 * plate no longer has to stack four onto one head: the planner spreads them, and the
 * swap count falls because each ACE head changes spools less often. Which is the whole
 * argument for a second unit, and the reason it belongs in a mockup - the dialog has to
 * be legible when a chip's address could name either cabinet.
 */
export const PLAN_TWO = {
  mode: 'head',
  swaps: 164,
  purge_g: 22.1,
  savedSwaps: 348,
  savedPurge_g: 46.9,
  heads: [
    { head: 0, feeder: true, run: [{ filament: 1 }] },
    { head: 1, feeder: true, run: [{ filament: 2 }] },
    { head: 2, feeder: false, unit: 1,
      run: [{ filament: 3, unit: 1, slot: 0 }, { filament: 4, unit: 1, slot: 1 }] },
    { head: 3, feeder: false, unit: 0,
      run: [{ filament: 0, unit: 0, slot: 0 }, { filament: 5, unit: 0, slot: 1 },
            { filament: 6, unit: 0, slot: 2 }] },
  ],
};

/*
 * The same plate in MULTI mode, which is a different machine.
 *
 * The Device page's reading, measured: bay `i` of EVERY unit is plumbed to head `i`. So a
 * head is not wired to a unit at all - it has a LANE, and its places are one bay from
 * each cabinet. Head 1 can only ever be fed A1 or B1; A2 is not reachable from it at any
 * price. `head_feeder` and `head_ace` are ignored outright in this mode, so no head is a
 * stock feeder and the capacity is heads x units = EIGHT.
 *
 * That constraint is what the mode costs: seven filaments fit, but only in the shape the
 * lanes allow, and the planner has less freedom than in head mode - here 214 swaps
 * against head mode's 164 on the same two units.
 *
 * NOTE, and it is a real disagreement rather than a wording difference: the Prepare tab
 * says the opposite. `Plater.cpp:9845` labels this mode "Units pooled onto a single ACE
 * head" and `PrintConfig.cpp:3995` "\"Combined\" pools several units onto a single head".
 * One says every head gets a lane; the other says every unit converges on one head. Only
 * one can be true of the hardware. These mockups follow the Device page, which is the
 * surface that was built against the live mode switch.
 */
export const PLAN_MULTI = {
  mode: 'multi',
  swaps: 214,
  purge_g: 29.8,
  savedSwaps: 298,
  savedPurge_g: 39.2,
  heads: [
    { head: 0, feeder: false, lane: 0,
      run: [{ filament: 1, unit: 0, slot: 0 }, { filament: 0, unit: 1, slot: 0 }] },
    { head: 1, feeder: false, lane: 1,
      run: [{ filament: 2, unit: 0, slot: 1 }, { filament: 4, unit: 1, slot: 1 }] },
    { head: 2, feeder: false, lane: 2,
      run: [{ filament: 3, unit: 0, slot: 2 }, { filament: 5, unit: 1, slot: 2 }] },
    { head: 3, feeder: false, lane: 3,
      run: [{ filament: 6, unit: 0, slot: 3 }] },
  ],
};

/** Four filaments, no plan - which is every plate the slicer can make today. */
export const PLAIN_MAPPING = {
  ...MAPPING,
  filename: 'benchy_4colour.gcode',
  estimated_time: 4412,
  filament_type: ['PLA', 'PLA', 'PLA', 'PLA'],
  filament_color_rgba: ['#FEC600', '#00AE42', '#0056B8', '#EC008C'],
  filament_weight: [7.27, 7.36, 7.58, 6.6],
  filament_used_mm: [2431, 2460, 2534, 2210],
  filament_extruder_map: { 0: '0', 1: '1', 2: '2', 3: '3' },
};

export const JOB = { displayName: 'colour_cube_7.gcode', sizeBytes: 31_402_118 };
export const DEVICE = { name: 'U1 (workshop)', model: 'Snapmaker U1',
                        sn: '811002511261022618B3', connected: true };

/* ---- the machine -------------------------------------------------------- */

/*
 * A bay, in `aceUnit()`'s own shape. `source` is where the identity came from, and it is
 * the field the whole judgement turns on:
 *
 *   rfid      the spool said so over the air        eye, and the green RFID mark
 *   override  somebody named it in multiACE         pencil
 *   derived   inferred from what the head loaded    pencil, but nobody asserted it
 *   unknown   occupied, nothing names it            the grey chip and `?`
 *   empty     the checkerboard
 */
const BAY = (index, o) => Object.assign(
  { index, addr: bayAddr(0, index), occupied: false, known: false,
    material: '', subType: '', vendor: '', color: null, rfid: 0, source: 'empty' }, o);

const SPOOL = (index, material, color, vendor, source) => BAY(index, {
  occupied: true, known: true, material, color, vendor,
  rfid: source === 'rfid' ? 1 : 0, source,
});

/** rfid and override are ASSERTED. derived is inferred, and is not evidence of a colour. */
export const TRUSTED = new Set(['rfid', 'override']);

const HEAD = (index, o) => Object.assign(
  { index, type: null, color: null, vendor: null, nozzle: '0.4', loaded: false }, o);

/* Heads 1-3 on their stock feeders, head 4 fed by ACE 1 - the measured machine. */
const FEEDERS = [
  HEAD(0, { type: 'PLA', color: '#FEC600', vendor: 'Jayo', loaded: true }),
  HEAD(1, { type: 'PLA', color: '#00AE42', vendor: 'Forshape', loaded: true }),
  HEAD(2, { type: 'PLA', color: '#0056B8', vendor: 'Kingroon', loaded: true }),
];
const ACE_HEAD = HEAD(3, { type: 'PLA', color: '#EC008C', vendor: 'Jayo', loaded: true });

const UNIT = (bays, o) => Object.assign(
  { index: 0, id: 'A', model: 'ACE 2 Pro', connected: true, humidity: 39,
    temperature: 27, dryer: { running: false }, bays }, o);

/*
 * A second unit. `ACE_SET_HEAD_ACE` binds a head to exactly one unit and says nothing
 * about the reverse, so two units feeding two heads is the ordinary two-ACE shape - and
 * the machine reports the model per unit, which is why B is an older ACE Pro here: two
 * units are not necessarily the same device, and a page that assumes they are will draw
 * the wrong one.
 */
const UNIT_B = (bays, o) => UNIT(bays, Object.assign(
  { index: 1, id: 'B', model: 'ACE Pro', humidity: 44, temperature: 26 }, o));

const bayIn = (unit, index, o) => Object.assign(
  BAY(index, o), { addr: bayAddr(unit, index) });

const SPOOL_B = (index, material, color, vendor, source) => bayIn(1, index, {
  occupied: true, known: true, material, color, vendor,
  rfid: source === 'rfid' ? 1 : 0, source,
});

const AS_PLANNED = () => [
  SPOOL(0, 'PLA', '#EC008C', 'Jayo', 'rfid'),
  SPOOL(1, 'PLA', '#F44336', 'Jayo', 'rfid'),
  SPOOL(2, 'PLA', '#F2F2F2', 'Generic', 'override'),
  SPOOL(3, 'PLA', '#1A1A1A', 'Jayo', 'rfid'),
];

/* ---- the scenarios ------------------------------------------------------ */

/*
 * Six. Each is a thing that has happened on this machine or is one spool away from it.
 * "No printer" is not among them - the four-card mockups already cover it and nothing
 * about it is ACE-specific.
 */
export const SCENARIOS = {
  ready: {
    label: 'Every place holds the plan',
    note: 'All seven places hold what the plate was sliced for, and every ACE bay is '
        + 'either tag-read or named by hand.',
    plan: PLAN, mapping: MAPPING,
    ace: { present: true, mode: 'head', units: [UNIT(AS_PLANNED())] },
    heads: FEEDERS.concat([ACE_HEAD]),
  },

  swapped: {
    label: 'Two bays are the other way round',
    note: 'A2 holds white and A3 holds red; the plate wants the reverse. Both are named, '
        + 'so the machine is sure, and the fix is two spools.',
    plan: PLAN, mapping: MAPPING,
    ace: { present: true, mode: 'head',
           units: [UNIT((() => { const b = AS_PLANNED();
                                 const r = { ...b[1] }, w = { ...b[2] };
                                 b[1] = { ...w, index: 1, addr: 'A2' };
                                 b[2] = { ...r, index: 2, addr: 'A3' };
                                 return b; })())] },
    heads: FEEDERS.concat([ACE_HEAD]),
  },

  unnamed: {
    label: 'A bay nobody named',
    note: 'A4 holds a spool with no tag and no override. Its identity is derived, not '
        + 'asserted, so the honest verdict is “cannot tell” rather than “wrong”.',
    plan: PLAN, mapping: MAPPING,
    ace: { present: true, mode: 'head',
           units: [UNIT((() => { const b = AS_PLANNED();
                                 b[3] = BAY(3, { addr: 'A4', occupied: true, known: false,
                                                 source: 'unknown' });
                                 return b; })(), { humidity: 52 })] },
    heads: FEEDERS.concat([ACE_HEAD]),
  },

  wrong: {
    label: 'Wrong material, and an empty bay',
    note: 'A2 has Kingroon PETG where the plate wants PLA, and A4 is empty. Emptiness is '
        + 'never a judgement call.',
    plan: PLAN, mapping: MAPPING,
    ace: { present: true, mode: 'head',
           units: [UNIT((() => { const b = AS_PLANNED();
                                 b[1] = SPOOL(1, 'PETG', '#83AFFF', 'Kingroon', 'rfid');
                                 b[1].addr = 'A2';
                                 b[3] = BAY(3, { addr: 'A4' });
                                 return b; })())] },
    heads: FEEDERS.concat([ACE_HEAD]),
  },

  noace: {
    label: 'The plate has a plan; the machine has no ACE',
    note: 'The printer reports no `ace` object at all. Nothing can be checked, and a tick '
        + 'meaning “could not check” would be worse than no tick.',
    plan: PLAN, mapping: MAPPING,
    ace: { present: false, mode: null, units: [] },
    heads: FEEDERS.concat([HEAD(3, {})]),
  },

  twoace: {
    label: 'Two ACE units',
    note: 'ACE A feeds toolhead 4 and ACE B feeds toolhead 3, so ten places hold seven '
        + 'filaments and the ACE heads swap far less. Every chip’s address could now name '
        + 'either cabinet.',
    plan: PLAN_TWO, mapping: MAPPING,
    ace: { present: true, mode: 'head',
           units: [
             UNIT([
               SPOOL(0, 'PLA', '#EC008C', 'Jayo', 'rfid'),
               SPOOL(1, 'PLA', '#F2F2F2', 'Generic', 'override'),
               SPOOL(2, 'PLA', '#1A1A1A', 'Jayo', 'rfid'),
               BAY(3, { addr: 'A4' }),
             ]),
             UNIT_B([
               SPOOL_B(0, 'PLA', '#0056B8', 'Kingroon', 'rfid'),
               SPOOL_B(1, 'PLA', '#F44336', 'Jayo', 'rfid'),
               bayIn(1, 2, {}),
               bayIn(1, 3, {}),
             ]),
           ] },
    heads: [
      HEAD(0, { type: 'PLA', color: '#FEC600', vendor: 'Jayo', loaded: true }),
      HEAD(1, { type: 'PLA', color: '#00AE42', vendor: 'Forshape', loaded: true }),
      HEAD(2, { type: 'PLA', color: '#0056B8', vendor: 'Kingroon', loaded: true }),
      ACE_HEAD,
    ],
  },

  multi: {
    label: 'Multi mode — every head has a lane',
    note: 'Bay i of every unit is plumbed to head i, so head 1 can only ever be fed A1 or '
        + 'B1. No head is a stock feeder, capacity is heads x units = eight, and the '
        + 'planner has less freedom than head mode has on the same two cabinets.',
    plan: PLAN_MULTI, mapping: MAPPING,
    ace: { present: true, mode: 'multi',
           units: [
             UNIT([
               SPOOL(0, 'PLA', '#FEC600', 'Jayo', 'rfid'),
               SPOOL(1, 'PLA', '#00AE42', 'Forshape', 'rfid'),
               SPOOL(2, 'PLA', '#0056B8', 'Kingroon', 'override'),
               SPOOL(3, 'PLA', '#1A1A1A', 'Jayo', 'rfid'),
             ]),
             UNIT_B([
               SPOOL_B(0, 'PLA', '#EC008C', 'Jayo', 'rfid'),
               SPOOL_B(1, 'PLA', '#F44336', 'Jayo', 'rfid'),
               SPOOL_B(2, 'PLA', '#F2F2F2', 'Generic', 'override'),
               bayIn(1, 3, {}),
             ]),
           ] },
    heads: [
      HEAD(0, { type: 'PLA', color: '#FEC600', vendor: 'Jayo', loaded: true }),
      HEAD(1, { type: 'PLA', color: '#00AE42', vendor: 'Forshape', loaded: true }),
      HEAD(2, { type: 'PLA', color: '#0056B8', vendor: 'Kingroon', loaded: true }),
      HEAD(3, { type: 'PLA', color: '#1A1A1A', vendor: 'Jayo', loaded: true }),
    ],
  },

  plain: {
    label: 'An ordinary plate — no ACE plan',
    note: 'Four filaments, four heads, nothing in the file about an ACE — which is every '
        + 'plate today. The dialog must be the dialog that already shipped.',
    plan: null, mapping: PLAIN_MAPPING,
    ace: { present: true, mode: 'head', units: [UNIT(AS_PLANNED())] },
    heads: FEEDERS.concat([ACE_HEAD]),
  },
};

/* ---- the judgement ------------------------------------------------------ */

/**
 * Does this place hold what the plate wants of it?
 *
 * Colour and material, and the brand is ignored on purpose: colour alone would pass PLA
 * where PETG is loaded, and a brand check flags a Kingroon-vs-Generic difference nobody
 * cares about.
 *
 * Four answers, and the third is the one that earns the design its keep:
 *
 *   agrees     it is what the plate wants
 *   differs    it is not, and the machine is sure - a named spool, or an empty bay
 *   unsure     something is there, nothing asserted what - do not accuse it
 *   unchecked  no answer exists: a stock feeder, or a machine with no ACE
 */
export function judge(bay, want) {
  if (!bay) return { verdict: 'unchecked', say: 'Not reported' };
  if (!bay.occupied) {
    return { verdict: 'differs', say: 'Empty', fix: `Put the ${want.name} spool in` };
  }
  if (!TRUSTED.has(bay.source)) {
    return { verdict: 'unsure', say: 'Occupied, nothing names it',
             fix: 'Tag it, or name it in multiACE' };
  }
  const sameType = bay.material === want.type;
  const sameColour = !!bay.color && bay.color.toUpperCase() === want.color.toUpperCase();
  if (sameType && sameColour) {
    return { verdict: 'agrees', say: [bay.vendor, bay.material].filter(Boolean).join(' ') };
  }
  if (!sameType) {
    return { verdict: 'differs', say: `${bay.material}, not ${want.type}`,
             fix: `Put the ${want.name} ${want.type} spool in` };
  }
  return { verdict: 'differs', say: `${bay.material}, wrong colour`,
           fix: `Put the ${want.name} spool in` };
}

/**
 * Every place the plate needs, in plan order, judged.
 *
 * A stock feeder is NOT judged, and the page has to say so rather than tick it: the ACE
 * reports its own bays and nothing else, so a wrong colour on a feeder head goes
 * undetected. Ticking it would claim a check that was never made.
 */
export function reconcile(scn) {
  const rows = [];
  if (!scn.plan) return { rows, differs: 0, unsure: 0, checked: false };
  const units = scn.ace.units || [];
  /* The head's OWN unit, not the first one. `ACE_SET_HEAD_ACE` binds each head to exactly
     one unit, so with two plugged in, reading unit[0] for every head judges toolhead 3's
     bays against toolhead 4's cabinet - which agrees with itself and is wrong. */
  const unitOf = (i) => units.find((u) => u.index === i) || null;
  const checked = !!(scn.ace && scn.ace.present) && units.length > 0;

  scn.plan.heads.forEach((h) => {
    h.run.forEach((step, order) => {
      const want = FILAMENTS[step.filament];
      if (h.feeder) {
        rows.push({ head: h.head, feeder: true, order, want,
                    verdict: 'unchecked', say: 'Stock feeder — the ACE does not report it' });
        return;
      }
      /* The STEP's unit, not the head's. In multi a head's places come from different
         cabinets - one bay from each - so a unit on the head cannot describe it. */
      const u = unitOf(step.unit != null ? step.unit : h.unit);
      const bay = u ? u.bays[step.slot] : null;
      const j = checked && u ? judge(bay, want)
                             : { verdict: 'unchecked', say: 'No ACE reported' };
      const ui = step.unit != null ? step.unit : h.unit;
      rows.push({ head: h.head, feeder: false, unit: ui, slot: step.slot, order,
                  addr: bayAddr(ui, step.slot), want, bay, ...j });
    });
  });

  return { rows, checked,
           differs: rows.filter((r) => r.verdict === 'differs').length,
           unsure: rows.filter((r) => r.verdict === 'unsure').length };
}

/** `aceBayAddr` in shared/js/multiACE.js: unit A-D, slot 1-based. "A2". */
export function bayAddr(unit, slot) {
  return `${['A', 'B', 'C', 'D'][unit] || Number(unit) + 1}${(slot | 0) + 1}`;
}

/* ---- formatting --------------------------------------------------------- */

export function humanDuration(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return 'N/A';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
export const grams = (g) => (Number.isFinite(+g) && +g > 0 ? `${(+g).toFixed(1)} g` : '—');
export const megabytes = (b) => `${(Number(b) / 1048576).toFixed(1)} MB`;

export const PREFERENCES = [
  { key: 'flow_calibrate', label: 'Extrusion Flow Calibration',
    hint: 'Runs a short flow test before the print.' },
  { key: 'time_lapse_camera', label: 'Time-lapse Camera', hint: 'Records a frame per layer.' },
  { key: 'auto_bed_leveling', label: 'Auto Leveling', hint: 'Probes the bed before starting.' },
];
