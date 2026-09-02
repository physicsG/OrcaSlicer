/*
 * option-f.js - one line per filament.
 *
 * The Prepare sidebar's Project Filaments list carried through to the print. One row per
 * file filament, in the plate's own order: the numbered colour badge the sidebar already
 * gave it, what it is, where it comes from, and whether it is there.
 *
 * It is the only one of the three that does not break at scale. Seven filaments on one
 * ACE is this machine; four units is sixteen bays, and no picture of sixteen bays fits a
 * 714px dialog at a density anyone can read. Sixteen rows do.
 */
'use strict';

import {
  SCENARIO, MODE, WITH_PRINT_SETUP, $, makeModel, blockers, sendRefused, needsOverride,
  runSend, prefRows, markMockup, expose, el,
} from './ace-shell.js';
import { humanDuration, grams, megabytes } from './ace-fixture.js';
import { aceBadge, ACE_MODE_LABELS } from '../../shared/js/multiACE.js';
import { inkOn, fnum, VERDICT, modeRow } from './ace-art.js';

const model = makeModel();

/* ---- Model Information -------------------------------------------------- */

function paintModel() {
  const body = $('#c-model .card-body');
  body.textContent = '';
  const m = model.mapping;

  const row = el('div', 'model-row');
  const img = document.createElement('img');
  img.className = 'thumb';
  img.width = 80; img.height = 80;
  img.src = m.thumbnails[0].url;
  img.alt = 'The sliced plate';
  row.appendChild(img);

  const facts = el('div', 'model-facts');
  facts.appendChild(el('div', 'model-name', m.filename));
  const line = el('div', 'model-meta');
  line.appendChild(el('span', null, humanDuration(m.estimated_time)));
  line.appendChild(el('span', null, grams(m.filament_weight_total)));
  line.appendChild(el('span', null, megabytes(31402118)));
  facts.appendChild(line);
  const dev = el('div', 'model-meta');
  dev.appendChild(el('span', null, model.device ? model.device.name : 'No printer'));
  dev.appendChild(el('span', null, model.device ? `${model.device.model} · LAN` : ''));
  facts.appendChild(dev);
  row.appendChild(facts);
  body.appendChild(row);
}


/* ---- the list ----------------------------------------------------------- */

function paintList() {
  const body = $('#c-list .card-body');
  body.textContent = '';

  if (!WITH_PRINT_SETUP) {
    body.appendChild(el('div', 'note muted',
                        'Upload only — the plate is not started, so nothing is checked.'));
    return;
  }

  /* The machine, named rather than drawn. F's whole bet is that a list beats a picture
     here, so what it owes the operator is one line saying what is plugged in. */
  body.appendChild(modeRow(model.ace.present ? (model.ace.mode || 'head') : null,
                           ACE_MODE_LABELS));

  const mach = el('div', 'mach-line');
  /* Every unit, not the first. A machine with two is two badges and two names; naming
     only unit A on a two-ACE machine is the same wrong answer the rows would give. */
  const units = model.ace.units || [];
  units.forEach((u) => {
    const one = el('span', 'mach-unit');
    one.appendChild(aceBadge(u.bays, 17 / 26));
    one.appendChild(el('span', null, `ACE ${u.id}`));
    if (u.humidity != null) one.appendChild(el('span', 'dim', `${u.humidity}%`));
    one.title = `ACE ${u.id} · ${u.model}`;
    mach.appendChild(one);
  });
  if (!units.length && model.ace.present === false) {
    mach.appendChild(el('span', null, 'No ACE reported by this printer'));
  }
  mach.appendChild(el('span', 'spacer'));
  /* Heads an ACE feeds are the plan's; the rest are on their own feeders. */
  const aceHeads = model.plan
    ? model.plan.heads.filter((h) => !h.feeder).length : (units.length ? 1 : 0);
  const feeders = model.heads.length - aceHeads;
  mach.appendChild(el('span', null, `${feeders} stock feeders · 4 toolheads`));
  body.appendChild(mach);

  const list = el('div', 'flist');
  const c = model.check;

  if (!model.plan) {
    /* No plan: the plate is an ordinary one and every filament is its own head. Same
       row, one source each - which is what makes this option the same list either way. */
    model.mapping.filament_type.forEach((type, i) => {
      const head = model.heads[i];
      list.appendChild(plainRow(i, type, head));
    });
  } else {
    let lastHead = -1;
    c.rows.forEach((r, i) => {
      const same = r.head === lastHead;
      const last = same && (i === c.rows.length - 1 || c.rows[i + 1].head !== r.head);
      lastHead = r.head;
      list.appendChild(filRow(r, same, last));
      if (r.fix) list.appendChild(fixLine(r));
    });
  }
  body.appendChild(list);

  const cost = $('#cost');
  cost.textContent = '';
  if (model.plan) {
    cost.appendChild(el('b', null, String(model.plan.swaps)));
    cost.appendChild(el('span', null, 'ACE swaps'));
    cost.appendChild(el('b', null, grams(model.plan.purge_g)));
    cost.appendChild(el('span', null, 'purged'));
  }

  if (needsOverride(model)) body.appendChild(overrideBox());
}

function filRow(r, same, last) {
  const row = el('div', 'frow' + (same ? ' is-same' : '') + (last ? ' is-last' : ''));
  row.appendChild(el('span', 'lane', `Toolhead ${r.head + 1}`));
  row.appendChild(fnum(r.want.index, r.want.color, `${r.want.name} ${r.want.type}`));

  const name = el('span', 'name', `${r.want.name} ${r.want.type}`);
  row.appendChild(name);
  row.appendChild(el('span', 'used', grams(r.want.weight)));

  const from = el('div', 'from');
  if (r.feeder) {
    from.appendChild(el('span', 'what', 'Stock feeder'));
  } else {
    from.appendChild(el('span', 'addr', r.addr));
    const sw = el('span', 'sw' + (r.bay && r.bay.occupied && r.bay.color ? '' : ' empty'));
    if (r.bay && r.bay.occupied && r.bay.color) sw.style.background = r.bay.color;
    from.appendChild(sw);
    from.appendChild(el('span', 'what', r.say));
  }
  row.appendChild(from);

  const v = VERDICT[r.verdict];
  const verdict = el('div', `verdict ${v.cls}`);
  verdict.appendChild(el('span', `dot ${v.cls === 'muted' ? '' : v.cls}`));
  /* A feeder row says WHAT was not checked, not the word "unchecked". */
  verdict.appendChild(el('span', null, r.feeder ? 'Not checked' : v.word));
  row.appendChild(verdict);
  return row;
}

function fixLine(r) {
  const n = el('div', 'frow-fix' + (r.verdict === 'unsure' ? ' warn' : ''), r.fix);
  return n;
}

/** An ordinary plate: filament i on head i, and nothing about an ACE. */
function plainRow(i, type, head) {
  const row = el('div', 'frow');
  row.appendChild(el('span', 'lane', `Toolhead ${i + 1}`));
  row.appendChild(fnum(i, model.mapping.filament_color_rgba[i], type));
  row.appendChild(el('span', 'name', type));
  row.appendChild(el('span', 'used', grams(model.mapping.filament_weight[i])));

  const from = el('div', 'from');
  const sw = el('span', 'sw' + (head && head.loaded ? '' : ' empty'));
  if (head && head.color) sw.style.background = head.color;
  from.appendChild(sw);
  from.appendChild(el('span', 'what',
                      head && head.loaded ? `${head.vendor || ''} ${head.type}`.trim() : 'Empty'));
  row.appendChild(from);

  const ok = head && head.loaded && head.type === type;
  const verdict = el('div', `verdict ${ok ? 'ok' : 'warn'}`);
  verdict.appendChild(el('span', `dot ${ok ? 'ok' : 'warn'}`));
  verdict.appendChild(el('span', null, ok ? 'Ready' : 'Check'));
  row.appendChild(verdict);
  return row;
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
  $('#c-list').hidden = !WITH_PRINT_SETUP;
  paintList();
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
markMockup('F · One line each');
expose(model, {
  destinationControls: () => 0,
  disclosed: true,
  rows: () => document.querySelectorAll('.frow').length,
});
