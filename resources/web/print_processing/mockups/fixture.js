/*
 * fixture.js - the data all three mockups run on.
 *
 * The mapping object is the REAL `sw_GetFileFilamentMapping` reply shape, read off
 * SSWCP.cpp:3039 - parallel arrays, not a `filaments[]` array of objects. The
 * reconstruction's own mock invented the latter, which is why the popup renders four
 * rows against the simulator and none against Orca. Building the mockups on the
 * handler's shape is half the point of having them.
 *
 * The heads are `state.filaments()`' shape, from the shared model the Device page reads.
 */
'use strict';

/* A plate render, standing in for `thumbnails[0].url`. The real one is a
   `data:image/png;base64,` PNG that Orca embeds in the same reply. */
function plateThumb(colors) {
  const [a, b, c, d] = colors;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a3542"/><stop offset="1" stop-color="#131a22"/>
    </linearGradient></defs>
    <rect width="200" height="200" fill="url(#bg)"/>
    <g opacity=".18" stroke="#7f8d9d" stroke-width="1">
      ${Array.from({ length: 9 }, (_, i) => `<path d="M${20 + i * 20} 148 L${100 + (i - 4) * 9} 178"/>`).join('')}
      ${Array.from({ length: 5 }, (_, i) => `<path d="M20 ${148 - i * 7} L180 ${148 - i * 7}"/>`).join('')}
    </g>
    <path d="M20 148 L100 178 L180 148 L100 122 Z" fill="#1b232d" stroke="#3c4956"/>
    <g>
      <path d="M62 140 L100 154 L138 140 L138 96 Q100 78 62 96 Z" fill="${a}"/>
      <path d="M62 96 Q100 78 138 96 L138 88 Q100 70 62 88 Z" fill="${b}"/>
      <rect x="86" y="52" width="28" height="30" rx="3" fill="${c}"/>
      <rect x="92" y="58" width="16" height="12" rx="2" fill="#0e1319" opacity=".55"/>
      <path d="M108 30 h6 v24 h-6 Z" fill="${d}"/>
      <path d="M62 140 L100 154 L100 110 L62 96 Z" fill="#000" opacity=".16"/>
    </g>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const COLORS = ['#D8452F', '#2F6FE0', '#2E9E5B', '#E9A21B'];

/** The `sw_GetFileFilamentMapping` reply, verbatim in shape. */
export const MAPPING = {
  filename: 'benchy_4colour.gcode',
  filepath: '/tmp/SnapmakerOrca/plate_1.gcode',
  machine_model: 'Snapmaker U1',
  estimated_time: 4412,
  filament_type: ['PLA', 'PLA', 'PETG', 'PLA'],
  filament_color_rgba: COLORS,
  filament_color: [14173487, 3108320, 3055707, 15311387],
  filament_color_multi: [null, null, null,
    { mode: 'gradient', colors: ['#E9A21B', '#E9601B'] }],
  filament_weight: [12.4, 9.1, 6.7, 3.2],
  filament_weight_total: 31.4,
  filament_used_mm: [4123, 3027, 2229, 1064],
  filament_used_m: [4.1, 3.0, 2.2, 1.1],
  nozzle_diameters: ['0.4', '0.4', '0.4', '0.4'],
  nozzle_info: ['0.4'],
  filament_extruder_map: { 0: '0', 1: '1', 2: '2', 3: '3' },
  thumbnails: [{ url: plateThumb(COLORS), width: 512, height: 512 }],
};

/** `sw_GetActiveFile` / the preceding native dialog's answers. */
export const JOB = {
  displayName: 'benchy_4colour.gcode',
  sizeBytes: 12_684_221,
  postAction: 'StartPrint',      // None -> the popup opens in upload-only mode
  switchToDeviceTab: true,
};

/*
 * What is actually in the printer - `state.filaments()`' shape. Three scenarios,
 * because a print dialog is only interesting when the plate and the machine disagree.
 */
const HEAD = (i, o) => Object.assign({
  index: i, type: null, subType: null, vendor: null, color: null,
  loaded: false, tag: null, nozzle: '0.4', feed: null,
}, o);

export const SCENARIOS = {
  ready: {
    label: 'Everything matches',
    note: 'Four heads loaded, every file filament has a home, nozzles agree.',
    device: { name: 'U1 (workshop)', model: 'Snapmaker U1', sn: '811002511261022618B3',
              connected: true },
    legal: { legal: true, preset_model: 'Snapmaker U1' },
    heads: [
      HEAD(0, { type: 'PLA', subType: 'Marble', vendor: 'Jayo', color: '#D8452F',
                loaded: true, tag: { vendor: 'Jayo', type: 'PLA', subType: 'Marble' } }),
      HEAD(1, { type: 'PLA', vendor: 'Forshape', color: '#2F6FE0', loaded: true }),
      HEAD(2, { type: 'PETG', vendor: 'Polymaker', color: '#2E9E5B', loaded: true }),
      HEAD(3, { type: 'PLA', subType: 'Basic', vendor: 'Kingroon', color: '#E9A21B',
                loaded: true }),
    ],
  },

  mismatch: {
    label: 'The plate and the machine disagree',
    note: 'Head 3 is empty, no PETG is loaded, and head 4 has a 0.2 nozzle where the '
        + 'file wants 0.4.',
    device: { name: 'U1 (workshop)', model: 'Snapmaker U1', sn: '811002511261022618B3',
              connected: true },
    legal: { legal: true, preset_model: 'Snapmaker U1' },
    heads: [
      HEAD(0, { type: 'PLA', subType: 'Marble', vendor: 'Jayo', color: '#D8452F',
                loaded: true, tag: { vendor: 'Jayo', type: 'PLA', subType: 'Marble' } }),
      HEAD(1, { type: 'PLA', vendor: 'Forshape', color: '#2F6FE0', loaded: true }),
      HEAD(2, {}),
      HEAD(3, { type: 'PLA', subType: 'Basic', vendor: 'Kingroon', color: '#E9A21B',
                loaded: true, nozzle: '0.2' }),
    ],
  },

  wrongmodel: {
    label: 'Sliced for another printer',
    note: 'sw_GetPrintLegal says the edited preset is not the connected machine. '
        + 'Nothing currently decides what that should do.',
    device: { name: 'U1 (workshop)', model: 'Snapmaker U1', sn: '811002511261022618B3',
              connected: true },
    legal: { legal: false, preset_model: 'Snapmaker A350' },
    heads: [
      HEAD(0, { type: 'PLA', vendor: 'Jayo', color: '#D8452F', loaded: true }),
      HEAD(1, { type: 'PLA', vendor: 'Forshape', color: '#2F6FE0', loaded: true }),
      HEAD(2, { type: 'PETG', vendor: 'Polymaker', color: '#2E9E5B', loaded: true }),
      HEAD(3, { type: 'PLA', vendor: 'Kingroon', color: '#E9A21B', loaded: true }),
    ],
  },

  noprinter: {
    label: 'No printer connected',
    note: 'sw_GetConnectedMachine returns nothing. Send cannot proceed and the '
        + 'machine half of every design goes blank.',
    device: null,
    legal: null,
    heads: [HEAD(0), HEAD(1), HEAD(2), HEAD(3)],
  },
};

/* ---- formatting, shared by all three mockups ----------------------------- */

export function humanDuration(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return 'N/A';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export const grams = (g) => (Number.isFinite(+g) && +g > 0 ? `${(+g).toFixed(1)} g` : '—');
export const metres = (mm) => `${(Number(mm) / 1000).toFixed(1)} m`;
export const megabytes = (b) => `${(Number(b) / 1048576).toFixed(1)} MB`;

/** How a head describes itself in one line. */
export function headWords(h) {
  if (!h.loaded) return 'Empty';
  const bits = [h.vendor, h.type, h.subType].filter(Boolean);
  return bits.length ? bits.join(' ') : 'Loaded, not named';
}

/**
 * Is this head an acceptable home for this file filament?
 *
 * Type equality only - the popup has no business guessing that PETG-CF will do where
 * PETG was sliced. `ok` blocks; `warn` is a judgement the operator makes.
 */
export function matchOf(mapping, heads, filIdx, headIdx) {
  const head = heads[headIdx];
  const wantType = mapping.filament_type[filIdx];
  const wantNozzle = mapping.nozzle_diameters[filIdx];
  if (!head || !head.loaded) return { level: 'bad', why: `Toolhead ${headIdx + 1} is empty` };
  if (head.nozzle && wantNozzle && head.nozzle !== wantNozzle) {
    return { level: 'bad',
             why: `Sliced for a ${wantNozzle} mm nozzle; toolhead ${headIdx + 1} has ${head.nozzle} mm` };
  }
  if (head.type && wantType && head.type !== wantType) {
    return { level: 'warn', why: `${wantType} in the file, ${head.type} in toolhead ${headIdx + 1}` };
  }
  return { level: 'ok', why: `${headWords(head)} in toolhead ${headIdx + 1}` };
}

/** The mapping Orca already made, as an array. `filament_extruder_map` is Orca's own. */
export function initialAssignment(mapping) {
  return mapping.filament_type.map((_, i) => {
    const v = mapping.filament_extruder_map[i];
    return v == null ? i : Number(v);
  });
}

export const PREFERENCES = [
  { key: 'flow_calibrate',    label: 'Extrusion Flow Calibration',
    hint: 'Runs a short flow test before the print.' },
  { key: 'time_lapse_camera', label: 'Time-lapse Camera',
    hint: 'Records a frame per layer.' },
  { key: 'auto_bed_leveling', label: 'Auto Leveling',
    hint: 'Probes the bed before starting.' },
];
