/*
 * Option B - the match sheet.
 *
 * One question, drawn: file filaments on the left, toolheads on the right, a wire
 * between them per assignment. Click a file row and then a head to move a wire. Both
 * lanes are <button>s, so the same two steps work from the keyboard - there is no
 * select anywhere on this design, which is the trade it is making.
 *
 * The wires are laid out after the DOM is, from getBoundingClientRect - so they are
 * redrawn on every assignment change and on resize, and never guessed from row heights.
 */
'use strict';

import { MAPPING, JOB, humanDuration, grams, metres, headWords, matchOf, PREFERENCES }
  from './fixture.js';
import { $, el, swatch, makeModel, blockers, runSend, markMockup, expose,
         WITH_PRINT_SETUP, MODE } from './shell.js';

const model = makeModel();
let picked = null;       // the file filament awaiting a destination
let sending = false;

/* ---- the strip --------------------------------------------------------- */
function drawStrip() {
  const s = $('#strip');
  s.innerHTML = '';
  const img = el('img', 'thumb');
  img.src = MAPPING.thumbnails[0].url;
  img.alt = 'Plate preview';
  s.appendChild(img);

  const g = el('div', 'grow');
  g.appendChild(el('div', 'name', MAPPING.filename));
  g.appendChild(el('div', 'nums',
    `${humanDuration(MAPPING.estimated_time)} · ${grams(MAPPING.filament_weight_total)} · `
    + `${[...new Set(MAPPING.nozzle_diameters)].join('/')} mm nozzle`));
  s.appendChild(g);

  const right = el('div');
  right.style.textAlign = 'right';
  right.appendChild(el('div', 'name', model.device ? model.device.name : 'No printer'));
  right.appendChild(el('div', 'nums',
    model.device ? model.device.model : 'sw_GetConnectedMachine returned nothing'));
  s.appendChild(right);

  const legal = $('#legal');
  const bad = model.legal && model.legal.legal === false;
  legal.hidden = !bad;
  if (bad) legal.textContent =
    `This plate was sliced for ${model.legal.preset_model}, not for the connected printer.`;
}

/* ---- the two lanes ----------------------------------------------------- */
function drawLanes() {
  const fl = $('#lane-file');
  const hl = $('#lane-head');
  fl.innerHTML = '';
  hl.innerHTML = '';

  MAPPING.filament_type.forEach((type, i) => {
    const m = matchOf(MAPPING, model.heads, i, model.assignment[i]);
    const row = el('button', 'frow' + (picked === i ? ' sel' : ''));
    row.type = 'button';
    row.dataset.fil = String(i);
    row.appendChild(swatch(MAPPING.filament_color_rgba[i]));
    const t = el('div', 't');
    t.appendChild(el('div', 'lbl', `${type} · Filament ${i + 1}`));
    t.appendChild(el('div', 'sub',
      `${grams(MAPPING.filament_weight[i])} · ${metres(MAPPING.filament_used_mm[i])}`));
    row.appendChild(t);
    row.appendChild(el('span', `dot ${m.level}`));
    row.setAttribute('aria-pressed', picked === i ? 'true' : 'false');
    row.onclick = () => { picked = picked === i ? null : i; render(); };
    fl.appendChild(row);
  });

  model.heads.forEach((h, t) => {
    const taken = model.assignment.includes(t);
    /*
     * Two different ratings, and which one applies depends on whether a filament is
     * in hand:
     *
     *   picking   every head is rated against the SELECTED filament - "can this one go
     *             here", which is the question being asked at that moment
     *   resting   each head is rated against whatever is already assigned to it, so a
     *             problem is visible on both ends of its wire and not only on the left
     */
    const rating = picked != null
      ? matchOf(MAPPING, model.heads, picked, t)
      : (taken ? matchOf(MAPPING, model.heads, model.assignment.indexOf(t), t) : null);
    const row = el('button',
      'hrow' + (taken ? ' taken' : '')
      + (rating && rating.level === 'bad' ? ' bad' : '')
      + (rating && rating.level === 'warn' ? ' warn' : '')
      + (picked != null && model.assignment[picked] === t ? ' sel' : ''));
    row.type = 'button';
    row.dataset.head = String(t);
    row.appendChild(el('span', 'num', String(t + 1)));
    const tx = el('div', 't');
    tx.appendChild(el('div', 'lbl', headWords(h)));
    tx.appendChild(el('div', 'sub',
      h.loaded ? `${h.nozzle} mm nozzle${h.tag ? ' · tagged' : ''}` : 'nothing loaded'));
    row.appendChild(tx);
    row.appendChild(swatch(h.loaded ? h.color : null));
    row.setAttribute('aria-label',
      `Toolhead ${t + 1}, ${headWords(h)}` + (taken ? ', assigned' : ''));
    row.onclick = () => {
      if (picked == null) { picked = model.assignment.indexOf(t); render(); return; }
      model.assignment[picked] = t;
      picked = null;
      render();
    };
    hl.appendChild(row);
  });
}

/* ---- the wires --------------------------------------------------------- */
function drawWires() {
  const svg = $('#wires');
  const box = $('#match').getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  svg.innerHTML = '';

  MAPPING.filament_type.forEach((_, i) => {
    const from = $(`.frow[data-fil="${i}"]`);
    const to = $(`.hrow[data-head="${model.assignment[i]}"]`);
    if (!from || !to) return;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const x1 = a.right - box.left, y1 = a.top + a.height / 2 - box.top;
    const x2 = b.left - box.left, y2 = b.top + b.height / 2 - box.top;
    const mid = (x1 + x2) / 2;

    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`);
    p.setAttribute('stroke', MAPPING.filament_color_rgba[i]);
    const m = matchOf(MAPPING, model.heads, i, model.assignment[i]);
    p.setAttribute('class',
      (m.level === 'bad' ? 'bad ' : '')
      + (picked == null ? '' : (picked === i ? 'live' : 'dim')));
    svg.appendChild(p);
  });
}

/* ---- footer ------------------------------------------------------------ */
function drawPrefs() {
  const f = $('#foot-prefs');
  f.innerHTML = '';
  PREFERENCES.forEach(({ key, label }) => {
    const c = el('label', 'chip');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!model.prefs[key];
    box.onchange = () => { model.prefs[key] = box.checked; drawPrefs(); };
    c.appendChild(box);
    c.appendChild(el('span', 'box'));
    c.appendChild(el('span', null, label));
    f.appendChild(c);
  });
}

function drawSend() {
  const bad = blockers(model).map((b) => b.text).concat(
    WITH_PRINT_SETUP
      ? MAPPING.filament_type
          .map((_, i) => matchOf(MAPPING, model.heads, i, model.assignment[i]))
          .filter((m) => m.level === 'bad').map((m) => m.why)
      : []);
  const warn = WITH_PRINT_SETUP
    ? MAPPING.filament_type
        .map((_, i) => matchOf(MAPPING, model.heads, i, model.assignment[i]))
        .filter((m) => m.level === 'warn').map((m) => m.why)
    : [];

  $('#send').disabled = sending || bad.length > 0;
  const hint = $('#hint');
  if (sending) return;
  if (picked != null) {
    hint.textContent = `Filament ${picked + 1} selected — pick a toolhead for it.`;
    hint.className = 'hint';
  } else if (bad.length) {
    hint.textContent = bad[0];
    hint.className = 'hint bad';
  } else if (warn.length) {
    hint.textContent = `${warn[0]}. Send anyway if that is deliberate.`;
    hint.className = 'hint warn';
  } else {
    hint.textContent = MODE === 'upload'
      ? 'The file will be uploaded and not started.'
      : 'Every filament has a toolhead that can print it.';
    hint.className = 'hint';
  }
}

/* ---- render ------------------------------------------------------------ */
function render() {
  drawStrip();
  $('#match').hidden = !WITH_PRINT_SETUP;
  $('#foot-prefs').hidden = !WITH_PRINT_SETUP;
  if (WITH_PRINT_SETUP) { drawLanes(); drawPrefs(); drawWires(); }
  drawSend();
}

$('#title').textContent = WITH_PRINT_SETUP ? 'Print Preprocessing'
                                           : 'Pretreat the uploaded content';
$('#subtitle').textContent = WITH_PRINT_SETUP ? '?path=4' : '?path=5';

$('#send').onclick = () => {
  sending = true;
  drawSend();
  runSend(model, {
    onStage: ({ step, index, of, pct, sent }) => {
      const overall = Math.round(((index + (pct == null ? 0.5 : pct / 100)) / of) * 100);
      $('#fill').style.width = `${overall}%`;
      $('#pct').textContent = `${overall}%`;
      $('#stage').textContent = step.bytes
        ? `${step.say} ${(sent / 1048576).toFixed(1)}/${(JOB.sizeBytes / 1048576).toFixed(1)} MB`
        : step.say;
      $('#hint').textContent = step.detail || '';
      $('#hint').className = 'hint';
    },
    onDone: () => {
      $('#fill').style.width = '100%';
      $('#pct').textContent = '100%';
      $('#stage').textContent = 'Sent';
      $('#hint').textContent = 'sw_FinishFilamentMapping closed the dialog.';
      $('#send').textContent = 'Sent';
    },
    onFail: (e) => { sending = false; $('#stage').textContent = String(e); render(); },
  });
};

window.addEventListener('resize', () => { if (WITH_PRINT_SETUP) drawWires(); });
render();
markMockup('B · match sheet');
expose(model, { render, get picked() { return picked; },
                destinationControls: () => document.querySelectorAll('.hrow').length });
