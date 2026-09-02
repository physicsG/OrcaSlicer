/*
 * shell.js - what the three mockups share below the design.
 *
 * Scenario and mode come off the query string so the chooser can drive all three
 * frames at once, and so a `--drive` script can put any option into any state:
 *
 *   ?scenario=ready|mismatch|wrongmodel|noprinter   default ready
 *   ?mode=print|upload                              default print   (path=4 | path=5)
 *
 * The send simulation follows the CORRECTED sequence from 04-requirements.md, not the
 * one the reconstruction currently ships: the file crosses as a URL rather than as a
 * JSON array of bytes, the progress is a byte count rather than a timer, and
 * sw_StartLocalPrint carries the { type, path } it refuses to run without.
 */
'use strict';

import { SCENARIOS, JOB, MAPPING, initialAssignment, PREFERENCES } from './fixture.js';

export const qs = new URLSearchParams(location.search);
export const SCENARIO_KEY = SCENARIOS[qs.get('scenario')] ? qs.get('scenario') : 'ready';
export const SCENARIO = SCENARIOS[SCENARIO_KEY];
export const MODE = qs.get('mode') === 'upload' ? 'upload' : 'print';
/** ?path=5 drops the filament mapping and the preferences. That is the whole difference. */
export const WITH_PRINT_SETUP = MODE === 'print';

/* ---- DOM ---------------------------------------------------------------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** A filament swatch. `null` colour is an absence, and draws as one. */
export function swatch(color, size = '') {
  const n = el('span', 'sw' + (size ? ' ' + size : ''));
  if (color) n.style.background = color;
  else n.classList.add('empty');
  return n;
}

/* ---- shared model ------------------------------------------------------- */

/**
 * One mutable object per mockup: which head each file filament goes to, and the three
 * preferences. Options differ in how they DRAW this; none of them differs in what it is.
 */
export function makeModel() {
  const prefs = {};
  PREFERENCES.forEach((p) => { prefs[p.key] = p.key === 'auto_bed_leveling'; });
  return {
    assignment: initialAssignment(MAPPING),
    prefs,
    device: SCENARIO.device,
    heads: SCENARIO.heads,
    legal: SCENARIO.legal,
  };
}

/** Every file filament assigned to a head that can take it. */
export function blockers(model) {
  const out = [];
  if (!model.device) out.push({ level: 'bad', text: 'No printer is connected.' });
  if (model.legal && model.legal.legal === false) {
    out.push({ level: 'bad',
               text: `This plate was sliced for ${model.legal.preset_model}.` });
  }
  return out;
}

/* ---- the send ----------------------------------------------------------- */

/**
 * The sequence, staged the way the real one would be. Each stage reports a fraction and
 * a line for the trace; `onStage` is how an option draws it, and every option draws it
 * differently, which is part of what is being chosen between.
 */
export async function runSend(model, { onStage, onDone, onFail }) {
  const path = `gcodes/${JOB.displayName.replace(/\.gcode$/, '.zip')}`;
  const steps = [
    { cmd: 'sw_GetFileStream', params: { is_zip: true },
      say: 'Packaging', detail: 'Orca zips the plate and hands back a URL, a size and a SHA-256.' },
    { cmd: 'fetch(file_url)', params: null,
      say: 'Reading', detail: `${(JOB.sizeBytes / 1048576).toFixed(1)} MB from Orca's own HTTP server.` },
    { cmd: 'POST /server/files/upload', params: { host: model.device && model.device.name },
      say: 'Uploading', detail: 'Multipart to the printer. This is where the bar is real.',
      bytes: true },
    { cmd: 'sw_StartLocalPrint', params: { type: 'zip', path },
      say: 'Starting', detail: 'The two parameters the handler refuses to run without.' },
    { cmd: 'sw_FinishPreprint', params: { status: 'success' }, say: 'Reporting' },
    { cmd: 'sw_SetFilamentMappingComplete', params: { status: 'success' },
      say: 'Recording', detail: 'Records the outcome. Does not close the dialog.' },
    { cmd: 'sw_FinishFilamentMapping', params: {},
      say: 'Closing', detail: 'This one closes it.' },
  ];

  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.bytes) {
        // The one stage with a real byte count behind it.
        for (let p = 0; p <= 100; p += 4) {
          onStage({ step: s, index: i, of: steps.length, pct: p,
                    sent: Math.round(JOB.sizeBytes * p / 100) });
          await sleep(28);
        }
      } else {
        onStage({ step: s, index: i, of: steps.length, pct: null });
        await sleep(190);
      }
    }
    onDone();
  } catch (e) {
    onFail(e);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- the preference rows, identical in all three ------------------------ */
export function prefRows(model, onChange) {
  const frag = document.createDocumentFragment();
  PREFERENCES.forEach(({ key, label, hint }) => {
    const row = el('label', 'pref');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!model.prefs[key];
    box.onchange = () => { model.prefs[key] = box.checked; onChange(key, box.checked); };
    const text = el('div', 'pref-text');
    text.appendChild(el('div', 'pref-label', label));
    text.appendChild(el('div', 'pref-hint', hint));
    row.appendChild(text);
    row.appendChild(box);
    row.appendChild(el('span', 'switch'));
    frag.appendChild(row);
  });
  return frag;
}

/** The marker that says this is not the page. */
export function markMockup(name) {
  const tag = el('div', 'mock-tag', `mockup · ${name} · ${SCENARIO_KEY}`);
  document.body.appendChild(tag);
  document.title = `Print processing — ${name}`;
}

/* Handed to the chooser and to any --drive script. */
export function expose(model, extra = {}) {
  window.__mockup = Object.assign({
    get model() { return model; },
    scenario: SCENARIO_KEY, mode: MODE, mapping: MAPPING, job: JOB,
  }, extra);
}
