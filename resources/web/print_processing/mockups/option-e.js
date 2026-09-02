/*
 * option-e.js - the machine, whole.
 *
 * The Device page's Filament panel, laid out as one row rather than a 2x2 grid: every
 * place a spool can be, drawn once, with the tube from each to the head it feeds.
 *
 * The row is unequal on purpose. A stock feeder module is one bay wide and an ACE
 * cabinet is four, so the columns are 94 and 310, which is what the hardware is - and a
 * grid of four equal cells would draw three mostly-empty boxes to make the fourth fit.
 */
'use strict';

import {
  SCENARIO, MODE, WITH_PRINT_SETUP, $, makeModel, blockers, sendRefused, needsOverride,
  runSend, prefRows, markMockup, expose, el,
} from './ace-shell.js';
import { FILAMENTS, humanDuration, grams, megabytes, bayAddr } from './ace-fixture.js';
import { place, cabinet, feederBox, laneBoxes, unitStrip, toolhead, drawTubes, modeRow,
         inkOn, fnum, VERDICT } from './ace-art.js';
import { ACE_MODE_LABELS } from '../../shared/js/multiACE.js';

const model = makeModel();

/* ---- Model Information -------------------------------------------------- */

function paintModel() {
  const body = $('#c-model .card-body');
  body.textContent = '';
  const m = model.mapping;

  const row = el('div', 'model-row');
  const img = document.createElement('img');
  img.className = 'thumb';
  img.width = 78; img.height = 78;
  img.src = m.thumbnails[0].url;
  img.alt = 'The sliced plate';
  row.appendChild(img);

  const facts = el('div', 'model-facts');
  facts.appendChild(el('div', 'model-name', m.filename));
  const line = el('div', 'model-meta');
  line.appendChild(el('span', null, humanDuration(m.estimated_time)));
  line.appendChild(el('span', null, grams(m.filament_weight_total)));
  line.appendChild(el('span', null, megabytes(31402118)));
  line.appendChild(el('span', null,
                      `${m.filament_type.length} filaments · ${model.device.name}`));
  facts.appendChild(line);

  const strip = el('div', 'plate-strip');
  m.filament_type.forEach((t, i) => strip.appendChild(fnum(i, m.filament_color_rgba[i], t)));
  facts.appendChild(strip);
  row.appendChild(facts);
  body.appendChild(row);
}


/* ---- the machine -------------------------------------------------------- */

function paintMachine() {
  const body = $('#c-machine .card-body');
  body.textContent = '';

  if (!WITH_PRINT_SETUP) {
    body.appendChild(el('div', 'note muted',
                        'Upload only — the plate is not started, so nothing is checked.'));
    return;
  }

  body.appendChild(modeRow(model.ace.present ? (model.ace.mode || 'head') : null,
                           ACE_MODE_LABELS));

  const rowEl = el('div', 'machine');
  const c = model.check;
  /* Each head's OWN unit. `ACE_SET_HEAD_ACE` binds a head to exactly one, so on a
     machine with two plugged in, reading the first for every head draws toolhead 3's
     bays out of toolhead 4's cabinet - four bays that agree with themselves and are the
     wrong four. */
  const unitOf = (i) => (model.ace.units || []).find((u) => u.index === i) || null;

  model.heads.forEach((head, h) => {
    const rows = c.rows.filter((r) => r.head === h);
    const planned = model.plan ? model.plan.heads.find((p) => p.head === h) : null;
    rowEl.appendChild(column(head, h, planned, rows,
                            planned && !planned.feeder ? unitOf(planned.unit) : null));
  });
  body.appendChild(rowEl);

  const cost = $('#cost');
  cost.textContent = '';
  if (model.plan) {
    cost.appendChild(el('b', null, String(model.plan.swaps)));
    cost.appendChild(el('span', null, 'ACE swaps'));
    cost.appendChild(el('b', null, grams(model.plan.purge_g)));
    cost.appendChild(el('span', null, 'purged'));
  }

  /* Measured after layout, because the tube moves when the column width does and no
     model signature can see that. */
  requestAnimationFrame(() => {
    document.querySelectorAll('.mcol').forEach((col) => {
      drawTubes(col, { coreColour: col.dataset.core || null,
                       fedIndex: Number(col.dataset.fed || 0) });
    });
  });
}

/** One source and the head it feeds: a header line, the box, the lane, the toolhead. */
function column(head, h, planned, rows, unit) {
  const col = el('div', 'mcol');
  const fedByAce = planned ? !planned.feeder : false;
  if (!planned) col.classList.add('is-idle');
  if (!fedByAce) col.classList.add('is-feeder');

  const wire = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wire.setAttribute('class', 'ace-wire');
  wire.setAttribute('aria-hidden', 'true');
  col.appendChild(wire);

  if (fedByAce && model.ace.mode === 'multi') {
    /* The lane's own strip is added beside the box below, because it needs the lane and
       this branch does not have it yet. */
  } else if (fedByAce && unit) {
    col.appendChild(unitStrip(unit));
  } else {
    const strip = el('div', 'ace-strip');
    strip.appendChild(el('span', null, fedByAce ? 'No ACE reported' : 'Stock feeder'));
    col.appendChild(strip);
  }

  const boxWrap = el('div', 'ace-box');
  if (fedByAce && model.ace.mode === 'multi') {
    const lane = planned.lane != null ? planned.lane : h;
    const units = model.ace.units || [];
    boxWrap.appendChild(laneBoxes(units.map((u) => {
      const r = rows.find((x) => x.unit === u.index && x.slot === lane);
      return place({ bay: u.bays[lane], want: r && r.want, verdict: r && r.verdict,
                     addr: bayAddr(u.index, lane) });
    })));
    const first = units.find((u) => u.bays[lane] && u.bays[lane].occupied);
    col.dataset.core = first ? (first.bays[lane].color || '') : '';
    /* Appended, not inserted before `boxWrap`: the box is not a child of the column yet
       at this point, and `insertBefore` against a node that is not there throws - which
       took the whole module down and left the page blank in this one mode. */
    const strip = el('div', 'ace-strip');
    strip.appendChild(el('span', null, `Lane · ${units
      .map((u) => bayAddr(u.index, lane)).join(' · ')}`));
    col.appendChild(strip);
  } else if (fedByAce && unit) {
    boxWrap.appendChild(cabinet(unit.bays.map((b) => {
      const r = rows.find((x) => x.slot === b.index);
      return place({ bay: b, want: r && r.want, verdict: r && r.verdict,
                     addr: bayAddr(unit.index, b.index) });
    })));
    /* The lane the head is actually being fed from gets the filament's own colour laid
       over the tube - the Device page's word for "this is what is in the nozzle". */
    const fed = unit.bays.findIndex((b) => b.occupied && b.color);
    col.dataset.fed = String(Math.max(fed, 0));
    col.dataset.core = (unit.bays[Math.max(fed, 0)] || {}).color || '';
  } else {
    const r = rows[0];
    const spool = { occupied: head.loaded, known: !!head.type, material: head.type || '',
                    vendor: head.vendor, color: head.color, source: 'derived' };
    boxWrap.appendChild(feederBox(place({ bay: spool, want: r && r.want,
                                          verdict: r && r.verdict, feeder: true })));
    col.dataset.core = head.loaded ? (head.color || '') : '';
  }
  col.appendChild(boxWrap);

  col.appendChild(el('div', 'mlane'));

  const headWrap = el('div', 'mhead');
  headWrap.appendChild(toolhead(head.loaded ? head.color : null, null));
  headWrap.appendChild(el('span', 'mname', `Toolhead ${h + 1}`));
  if (planned) {
    const runs = el('div', 'mruns');
    planned.run.forEach((step) => {
      const f = FILAMENTS[step.filament];
      runs.appendChild(fnum(f.index, f.color, `${f.name} ${f.type}`, true));
    });
    headWrap.appendChild(runs);
  } else {
    headWrap.appendChild(el('span', 'mname muted', 'not used'));
  }
  col.appendChild(headWrap);
  return col;
}

/* ---- what has to change ------------------------------------------------- */

/*
 * Only the places that are not ready. A section listing everything that is fine is
 * lines of nothing, and it pushes the thing that is not fine below the fold.
 */
function paintTodo() {
  const card = $('#c-todo');
  card.hidden = !WITH_PRINT_SETUP;
  const body = $('#c-todo .card-body');
  body.textContent = '';
  if (!WITH_PRINT_SETUP) return;

  const c = model.check;
  if (!model.plan) {
    body.appendChild(el('div', 'note muted',
                        'This plate was not sliced for an ACE — nothing to reconcile.'));
    return;
  }
  if (!c.checked) {
    body.appendChild(el('div', 'note warn',
                        'The printer reports no ACE, so none of the bays can be checked.'));
    /* And the override still has to be here. Found by the scenario sweep: this branch
       returned early, so `noace` blocked Send and offered no way past it - a refusal with
       no door, on the one scenario where the page has no evidence either way. */
    if (needsOverride(model)) body.appendChild(overrideBox());
    return;
  }

  const bad = c.rows.filter((r) => r.verdict === 'differs' || r.verdict === 'unsure');
  if (!bad.length) {
    const ok = el('div', 'all-good');
    ok.appendChild(el('span', 'dot ok'));
    ok.appendChild(el('span', null,
      `All ${c.rows.filter((r) => !r.feeder).length} ACE bays hold what the plate was sliced for.`));
    body.appendChild(ok);
    body.appendChild(el('div', 'note muted',
      'The three stock feeders are not reported by the ACE and have not been checked.'));
    return;
  }

  bad.forEach((r) => {
    const row = el('div', 'todo-row');
    row.appendChild(el('span', `dot ${VERDICT[r.verdict].cls}`));
    row.appendChild(el('span', 'addr', r.addr));
    const grow = el('div', 'grow');
    grow.appendChild(el('div', 'what', r.fix || r.say));
    grow.appendChild(el('div', 'why', `${r.say} · Toolhead ${r.head + 1}`));
    row.appendChild(grow);
    row.appendChild(fnum(r.want.index, r.want.color, `${r.want.name} ${r.want.type}`));
    body.appendChild(row);
  });

  if (needsOverride(model)) body.appendChild(overrideBox());
}

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
  $('#c-machine').hidden = !WITH_PRINT_SETUP;
  paintMachine();
  paintTodo();
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
markMockup('E · The machine');
expose(model, {
  destinationControls: () => 0,
  disclosed: true,
  columns: () => document.querySelectorAll('.mcol').length,
  tubes: () => document.querySelectorAll('.ace-wire path').length,
});
