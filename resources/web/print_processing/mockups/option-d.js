/*
 * option-d.js - per head, two across.
 *
 * The Prepare tab's Printer section, brought into the dialog: a bordered box per
 * toolhead, wrapped two across, each with an `ACE` row and a green corner tick when what
 * is in it agrees with what the plate was sliced for.
 */
'use strict';

import {
  SCENARIO, MODE, WITH_PRINT_SETUP, $, makeModel, blockers, sendRefused, needsOverride,
  runSend, prefRows, markMockup, expose, el,
} from './ace-shell.js';
import { FILAMENTS, humanDuration, grams, megabytes, bayAddr } from './ace-fixture.js';
import { aceBadge, ACE_MODE_LABELS } from '../../shared/js/multiACE.js';
import { syncTick, place, cabinet, feederBox, laneBoxes, modeRow, inkOn, fnum }
  from './ace-art.js';

const model = makeModel();

/* ---- Model Information -------------------------------------------------- */

function paintModel() {
  const body = $('#c-model .card-body');
  body.textContent = '';
  const m = model.mapping;

  const row = el('div', 'model-row');
  const img = document.createElement('img');
  img.className = 'thumb';
  img.width = 84; img.height = 84;
  img.src = m.thumbnails[0].url;
  img.alt = 'The sliced plate';
  row.appendChild(img);

  const facts = el('div', 'model-facts');
  facts.appendChild(el('div', 'model-name', m.filename));
  const line = el('div', 'model-meta');
  line.appendChild(el('span', null, humanDuration(m.estimated_time)));
  line.appendChild(el('span', null, grams(m.filament_weight_total)));
  line.appendChild(el('span', null, megabytes(31402118)));
  line.appendChild(el('span', null, `${m.filament_type.length} filaments`));
  facts.appendChild(line);

  /* The printer is a LINE here, not a section of its own. Measured in WebKitGTK: as a
     section it cost 107px of a 650px body to carry one row, and those 107px were what
     pushed Toolhead 4 - the head that is wrong - below the fold. */
  const dev = el('div', 'model-meta');
  if (model.device) {
    dev.appendChild(el('span', 'who', model.device.name));
    dev.appendChild(el('span', null, `${model.device.model} · LAN`));
    dev.appendChild(el('span', 'pill ok', 'Connected'));
  } else {
    dev.appendChild(el('span', 'note bad', 'No printer connected.'));
  }
  facts.appendChild(dev);

  /* The plate's filaments as one wrapping strip. Seven do not fit four cards, and that
     is exactly the thing the four-card dialog cannot say. */
  const strip = el('div', 'plate-strip');
  m.filament_type.forEach((type, i) => strip.appendChild(fnum(i, m.filament_color_rgba[i], type)));
  facts.appendChild(strip);

  row.appendChild(facts);
  body.appendChild(row);
}


/* ---- the head grid ------------------------------------------------------ */

/*
 * One box per head. Which places it draws is the MACHINE's answer, not the plate's: a
 * head fed by an ACE draws that unit's cabinet, a head on its own feeder draws the
 * feeder module. What the plate wants goes on top of them.
 */
function paintHeads() {
  const body = $('#c-heads .card-body');
  body.textContent = '';

  if (!WITH_PRINT_SETUP) {
    body.appendChild(el('div', 'note muted',
                        'Upload only — the plate is not started, so nothing is checked.'));
    return;
  }

  /* The mode first: it decides what every address under it means. */
  body.appendChild(modeRow(model.ace.present ? (model.ace.mode || 'head') : null,
                           ACE_MODE_LABELS));

  const grid = el('div', 'head-grid');
  const c = model.check;
  /* Each head's OWN unit. `ACE_SET_HEAD_ACE` binds a head to exactly one, so on a
     machine with two plugged in, reading the first for every head draws toolhead 3's
     bays out of toolhead 4's cabinet - four bays that agree with themselves and are the
     wrong four. */
  const unitOf = (i) => (model.ace.units || []).find((u) => u.index === i) || null;

  model.heads.forEach((head, h) => {
    const rows = c.rows.filter((r) => r.head === h);
    const planned = model.plan ? model.plan.heads.find((p) => p.head === h) : null;
    grid.appendChild(headBox(head, h, planned, rows,
                             planned && !planned.feeder ? unitOf(planned.unit) : null));
  });
  body.appendChild(grid);

  /* The cost, in the section header where it is read once rather than argued with. 300
     swaps is what seven colours on four heads costs; it is not a defect. */
  const cost = $('#cost');
  cost.textContent = '';
  if (model.plan) {
    cost.appendChild(el('b', null, String(model.plan.swaps)));
    cost.appendChild(el('span', null, 'ACE swaps'));
    cost.appendChild(el('b', null, grams(model.plan.purge_g)));
    cost.appendChild(el('span', null, 'purged'));
  }

  /* Said once, for the whole grid. */
  const feeders = model.plan
    ? model.plan.heads.filter((h) => h.feeder).length : 0;
  if (feeders) {
    body.appendChild(el('div', 'note muted grid-note',
      `The ACE reports its own bays and nothing else, so the ${feeders} stock feeders `
      + 'have not been checked.'));
  }

  if (needsOverride(model)) body.appendChild(overrideBox());
}

function headBox(head, h, planned, rows, unit) {
  const box = el('div', 'head-box');
  if (!planned) box.classList.add('is-idle');

  box.appendChild(el('h3', null, `Toolhead ${h + 1}`));

  /* The tick is the box's own claim about the machine, so it appears only where a check
     was actually made: never on a stock feeder, which the ACE does not report, and never
     on a machine nobody has read. */
  const judged = rows.filter((r) => r.verdict !== 'unchecked');
  if (judged.length && judged.every((r) => r.verdict === 'agrees')) box.appendChild(syncTick());

  /* What this head runs, in the order it runs it. On the ACE head this is the sentence
     the four-card dialog cannot say. */
  if (planned) {
    const runs = el('div', 'head-runs');
    planned.run.forEach((step, i) => {
      if (i) runs.appendChild(el('span', 'arrow', '›'));
      const f = FILAMENTS[step.filament];
      runs.appendChild(fnum(f.index, f.color, `${f.name} ${f.type}`, true));
    });
    box.appendChild(runs);
  }

  /* The ACE row, as the Prepare tab builds it: a 34px key, then the value hard right - a
     badge when a unit feeds this head, the words otherwise. */
  const row = el('div', 'hrow');
  row.appendChild(el('span', 'k', 'ACE'));
  row.appendChild(el('span', 'spacer'));
  const fedByAce = planned ? !planned.feeder : false;
  if (fedByAce && model.ace.mode === 'multi') {
    const lane = planned.lane != null ? planned.lane : h;
    row.appendChild(el('span', 'v', `Lane · ${(model.ace.units || [])
      .map((u) => bayAddr(u.index, lane)).join(' · ')}`));
  } else if (fedByAce && unit) {
    row.appendChild(aceBadge(unit.bays, 17 / 26));
    row.appendChild(el('span', 'v', `ACE ${unit.id}`));
  } else if (fedByAce) {
    row.appendChild(el('span', 'v dim', 'No ACE reported'));
  } else {
    row.appendChild(el('span', 'v dim', 'Stock feeder'));
  }
  box.appendChild(row);

  /* The places. A feeder head has one; an ACE head has its unit's four. */
  const boxWrap = el('div', 'ace-box is-small');
  if (fedByAce && model.ace.mode === 'multi') {
    /* The LANE: bay `lane` of every cabinet, one box each. A head has no unit in this
       mode, so drawing one cabinet's four bays here would be drawing hardware that is not
       wired that way. */
    const lane = planned.lane != null ? planned.lane : h;
    boxWrap.appendChild(laneBoxes((model.ace.units || []).map((u) => {
      const r = rows.find((x) => x.unit === u.index && x.slot === lane);
      return place({ bay: u.bays[lane], want: r && r.want, verdict: r && r.verdict,
                     addr: bayAddr(u.index, lane) });
    })));
  } else if (fedByAce && unit) {
    const bays = unit.bays.map((b) => {
      const r = rows.find((x) => x.slot === b.index);
      return place({ bay: b, want: r && r.want, verdict: r && r.verdict,
                     addr: bayAddr(unit.index, b.index) });
    });
    boxWrap.appendChild(cabinet(bays));
  } else {
    const r = rows[0];
    const spool = { occupied: head.loaded, known: !!head.type, material: head.type || '',
                    vendor: head.vendor, color: head.color, source: 'derived' };
    boxWrap.appendChild(feederBox(place({ bay: spool, want: r && r.want,
                                          verdict: r && r.verdict, feeder: true })));
  }
  box.appendChild(boxWrap);

  box.appendChild(headVerdict(rows, planned));
  return box;
}

/**
 * One line under the box saying where it stands.
 *
 * A head with nothing wrong says what it holds rather than the word "Ready" - the tick
 * has already said ready, and a second copy of it is not information.
 */
function headVerdict(rows, planned) {
  if (!planned) return el('div', 'head-verdict muted', 'Not used by this plate.');
  const bad = rows.find((r) => r.verdict === 'differs');
  if (bad) return el('div', 'head-verdict bad', `${bad.addr}: ${bad.say}. ${bad.fix}.`);
  const unsure = rows.find((r) => r.verdict === 'unsure');
  if (unsure) return el('div', 'head-verdict warn', `${unsure.addr}: ${unsure.say}.`);
  /* A feeder head has nothing to report and says nothing. The limit it stands for -
     that the ACE reports its own bays and no feeder - is stated ONCE under the grid;
     three copies of it is three lines of a dialog that is already scrolling. */
  if (rows.every((r) => r.verdict === 'unchecked')) return el('div', 'head-verdict');
  return el('div', 'head-verdict ok',
            rows.length > 1 ? `All ${rows.length} bays hold the plan.` : rows[0].say);
}

/**
 * The one thing the operator can decide here.
 *
 * It names what is being overridden rather than saying "I understand": a tick whose
 * sentence is generic gets ticked without reading, which is the failure a gate exists to
 * avoid.
 */
function overrideBox() {
  const wrap = el('label', 'override');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'override';
  box.checked = model.override;
  box.onchange = () => { model.override = box.checked; paint(); };
  wrap.appendChild(box);
  const text = el('div');
  text.appendChild(el('b', null, 'Send anyway — I have checked the spools.'));
  blockers(model).forEach((x) => text.appendChild(el('div', null, x.text)));
  wrap.appendChild(text);
  return wrap;
}

/* ---- preferences and the foot ------------------------------------------- */

function paintPrefs() {
  $('#c-prefs').hidden = !WITH_PRINT_SETUP;
  const body = $('#c-prefs .card-body');
  body.textContent = '';
  body.appendChild(prefRows(model, () => {}));
}

function paintFoot() {
  const send = $('#send');
  send.disabled = sendRefused(model);
  send.textContent = MODE === 'upload' ? 'Upload' : (model.override ? 'Send anyway' : 'Send');
  const stage = $('#stage');
  const b = blockers(model);
  stage.textContent = b.length && !model.override ? b[0].text : 'Ready';
  stage.title = stage.textContent;
}

function paint() {
  paintModel();
  $('#c-heads').hidden = !WITH_PRINT_SETUP;
  paintHeads();
  paintPrefs();
  paintFoot();
}

$('#subtitle').textContent = MODE === 'upload' ? 'Upload only' : SCENARIO.label;

$('#send').onclick = () => {
  $('#send').disabled = true;
  runSend(model, {
    onStage: ({ step, pct }) => {
      $('#stage').textContent = step.say;
      $('#fill').style.width = pct == null ? '100%' : `${pct}%`;
      $('#pct').textContent = pct == null ? '' : `${pct}%`;
    },
    onDone: () => { $('#stage').textContent = 'Sent'; $('#pct').textContent = ''; },
    onFail: (e) => { $('#stage').textContent = `Failed: ${e.message}`; },
  });
};

paint();
markMockup('D · Per head');
expose(model, {
  destinationControls: () => 0,
  disclosed: true,     // D shows the mapping; on an ACE plate it must not offer to change it
  headBoxes: () => document.querySelectorAll('.head-box').length,
  ticks: () => document.querySelectorAll('.tick').length,
});
