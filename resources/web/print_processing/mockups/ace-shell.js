/*
 * ace-shell.js - what the three multiACE mockups share below the design.
 *
 * The same contract the four-card mockups have: scenario and mode come off the query
 * string so the chooser can drive every frame at once and a `--drive` script can put any
 * option into any state.
 *
 *   ?scenario=ready|swapped|unnamed|wrong|noace|plain     default ready
 *   ?mode=print|upload                                    default print
 *
 * The send is the corrected sequence, unchanged from shell.js, plus one step that only
 * exists on an ACE plate: SET_PRINT_EXTRUDER_MAP must go out as the IDENTITY. On a plate
 * whose gcode names a head in every `ACE_SWAP_HEAD HEAD=n`, remapping the tools without
 * remapping the swaps prints on one head while the ACE feeds another. So the map is not
 * a choice here and the dialog does not offer one.
 */
'use strict';

import { SCENARIOS, PREFERENCES, JOB, DEVICE, reconcile } from './ace-fixture.js';
export { el, svg } from './ace-art.js';

/*
 * A `srcdoc` document has no query string - its URL is `about:srcdoc` - so the
 * standalone bundle (build_standalone.py) has nowhere to put the switches. This is the
 * one seam it gets: a global it may set, and the query string everywhere else. Making
 * the bundle a second copy of these modules instead would have been the alternative, and
 * a copy drifts.
 */
export const qs = new URLSearchParams(
  typeof window.__SWITCHES === 'string' ? window.__SWITCHES : location.search);
export const SCENARIO_KEY = SCENARIOS[qs.get('scenario')] ? qs.get('scenario') : 'ready';
export const SCENARIO = SCENARIOS[SCENARIO_KEY];
export const MODE = qs.get('mode') === 'upload' ? 'upload' : 'print';
export const WITH_PRINT_SETUP = MODE === 'print';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---- the model ---------------------------------------------------------- */

/**
 * One mutable object per mockup. There is no `assignment` in it, and that absence is the
 * design: on an ACE plate the file already decided, so what the operator can change here
 * is the preferences and whether to send in spite of a mismatch.
 */
export function makeModel() {
  const prefs = {};
  PREFERENCES.forEach((p) => { prefs[p.key] = p.key === 'auto_bed_leveling'; });
  return {
    prefs,
    override: false,
    device: DEVICE,
    scenario: SCENARIO,
    plan: SCENARIO.plan,
    mapping: SCENARIO.mapping,
    ace: SCENARIO.ace,
    heads: SCENARIO.heads,
    get check() { return reconcile(SCENARIO); },
  };
}

/**
 * What stops Send, and what merely warns.
 *
 * The split is the one the reconciliation makes, and it is deliberate on both sides:
 *
 *   differs   BLOCKS. A named spool that is not the one the plate wants, or an empty
 *             bay, is a fact - and printing it wastes the whole plate.
 *   unsure    WARNS. Nothing asserted what is in that bay, so calling it wrong would be
 *             a false accusation. A check that cries wolf gets ignored, which costs
 *             more than no check.
 *   unchecked SAYS NOTHING. A stock feeder is not reported by the ACE at all; claiming
 *             either way about it would be inventing an answer.
 *
 * Both blocking and warning are lifted by one tick, because the operator can see the
 * machine and the page cannot. What the tick must never do is disappear the sentence.
 */
export function blockers(model) {
  const out = [];
  if (!model.device) { out.push({ level: 'bad', text: 'No printer is connected.' }); return out; }
  if (!model.plan) return out;
  const c = model.check;
  if (!c.checked) {
    out.push({ level: 'warn',
               text: 'This plate was sliced for an ACE and the printer reports none. '
                   + 'Nothing about the bays can be checked.' });
    return out;
  }
  if (c.differs) {
    out.push({ level: 'bad',
               text: `${c.differs} ${c.differs === 1 ? 'bay holds' : 'bays hold'} `
                   + 'something other than the plate was sliced for.' });
  }
  if (c.unsure) {
    out.push({ level: 'warn',
               text: `${c.unsure} ${c.unsure === 1 ? 'bay is' : 'bays are'} occupied by a `
                   + 'spool nothing has named.' });
  }
  return out;
}

/** Send is refused while anything blocks and the operator has not overridden it. */
export function sendRefused(model) {
  if (!model.device) return true;
  if (!WITH_PRINT_SETUP) return false;
  return blockers(model).length > 0 && !model.override;
}

/** Whether the override tick should be offered at all. */
export function needsOverride(model) {
  return WITH_PRINT_SETUP && !!model.device && blockers(model).length > 0;
}

/* ---- the send ----------------------------------------------------------- */

/**
 * The corrected sequence. `SET_PRINT_EXTRUDER_MAP` is listed with its arguments because
 * on this plate they are the identity, and that is a claim worth being able to read in
 * the trace rather than one to take on faith.
 */
export async function runSend(model, { onStage, onDone, onFail }) {
  const path = `gcodes/${JOB.displayName.replace(/\.gcode$/, '.zip')}`;
  const heads = model.plan ? model.plan.heads.map((h) => h.head).join(',') : '0,1,2,3';
  const steps = [
    { cmd: 'sw_GetFileStream', params: { is_zip: true }, say: 'Packaging',
      detail: 'Orca zips the plate and hands back a URL, a size and a SHA-256.' },
    { cmd: 'fetch(file_url)', say: 'Reading',
      detail: `${(JOB.sizeBytes / 1048576).toFixed(1)} MB from Orca's own HTTP server.` },
    { cmd: 'POST /server/files/upload', say: 'Uploading', bytes: true,
      detail: 'Multipart to the printer. This is where the bar is real.' },
    ...(model.plan ? [{
      cmd: 'SET_PRINT_EXTRUDER_MAP', params: { identity: true, EXTRUDERS: heads },
      say: 'Mapping',
      detail: 'The identity, one line per head. A remap would move the tool changes off '
            + 'the heads the ACE swaps name.' }] : []),
    { cmd: 'sw_StartLocalPrint', params: { type: 'zip', path }, say: 'Starting',
      detail: 'The two parameters the handler refuses to run without.' },
    { cmd: 'sw_SetFilamentMappingComplete', params: { status: 'success' }, say: 'Recording',
      detail: 'Records the outcome. Does not close the dialog.' },
    { cmd: 'sw_FinishFilamentMapping', say: 'Closing', detail: 'This one closes it.' },
  ];

  try {
    for (let i = 0; i < steps.length; i += 1) {
      const s = steps[i];
      if (s.bytes) {
        for (let p = 0; p <= 100; p += 4) {
          onStage({ step: s, index: i, of: steps.length, pct: p,
                    sent: Math.round(JOB.sizeBytes * p / 100) });
          await sleep(24);
        }
      } else {
        onStage({ step: s, index: i, of: steps.length, pct: null });
        await sleep(180);
      }
    }
    onDone();
  } catch (e) { onFail(e); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- the preference rows, identical in all three ------------------------ */

export function prefRows(model, onChange) {
  const frag = document.createDocumentFragment();
  PREFERENCES.forEach(({ key, label, hint }) => {
    const row = document.createElement('label');
    row.className = 'pref';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!model.prefs[key];
    box.onchange = () => { model.prefs[key] = box.checked; onChange(key, box.checked); };
    const text = document.createElement('div');
    text.className = 'pref-text';
    const l = document.createElement('div'); l.className = 'pref-label'; l.textContent = label;
    const h = document.createElement('div'); h.className = 'pref-hint'; h.textContent = hint;
    text.append(l, h);
    const sw = document.createElement('span'); sw.className = 'switch';
    row.append(text, box, sw);
    frag.appendChild(row);
  });
  return frag;
}

/** The marker that says this is not the page. */
export function markMockup(name) {
  const tag = document.createElement('div');
  tag.className = 'mock-tag';
  tag.textContent = `mockup · ${name} · ${SCENARIO_KEY}`;
  document.body.appendChild(tag);
  document.title = `multiACE print — ${name}`;
}

/** Handed to the chooser and to any --drive script. */
export function expose(model, extra = {}) {
  window.__mockup = Object.assign({
    get model() { return model; },
    get check() { return model.check; },
    scenario: SCENARIO_KEY, mode: MODE, mapping: model.mapping, plan: model.plan,
    job: JOB,
  }, extra);
}
