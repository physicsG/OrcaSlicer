/*
 * Option A - the shipped four cards, corrected.
 *
 * Nothing moves. Model Information, Select Printer, Edit Filament, Print Preferences,
 * then the send bar - the order and the labels the Flutter popup uses. The changes are
 * all inside the cards, and each one is a field the host was already returning and the
 * popup was not reading.
 */
'use strict';

import { MAPPING, JOB, humanDuration, grams, metres, headWords, matchOf, PREFERENCES }
  from './fixture.js';
import { $, el, swatch, makeModel, blockers, runSend, prefRows, markMockup, expose,
         WITH_PRINT_SETUP, MODE } from './shell.js';

const model = makeModel();
let sending = false;

/* ---- Model Information ------------------------------------------------- */
function drawModel() {
  const b = $('#c-model .card-body');
  b.innerHTML = '';
  const row = el('div', 'model-row');

  // thumbnails[0].url - a data: PNG of the sliced plate, in the reply all along.
  const img = el('img', 'thumb');
  img.src = MAPPING.thumbnails[0].url;
  img.alt = 'Plate preview';
  img.width = 104; img.height = 104;
  row.appendChild(img);

  const dl = el('dl', 'facts');
  const add = (k, v, mono) => {
    dl.appendChild(el('dt', null, k));
    dl.appendChild(el('dd', mono ? 'mono' : null, v));
  };
  add('Filename', MAPPING.filename);
  add('Estimated Time', humanDuration(MAPPING.estimated_time), true);
  add('Estimated Materials', grams(MAPPING.filament_weight_total), true);
  // nozzle_diameters is what the FILE was sliced for. Nothing checked it before.
  add('Nozzle', `${[...new Set(MAPPING.nozzle_diameters)].join(', ')} mm`, true);
  row.appendChild(dl);

  b.appendChild(row);
}

/* ---- Select Printer ---------------------------------------------------- */
function drawPrinter() {
  const b = $('#c-printer .card-body');
  b.innerHTML = '';
  const row = el('div', 'printer-row');

  const pick = el('button', 'printer-pick');
  pick.type = 'button';
  if (model.device) {
    const txt = el('div');
    txt.appendChild(el('div', null, model.device.name));
    txt.appendChild(el('div', 'sub', `${model.device.model} · ${model.device.sn}`));
    pick.appendChild(txt);
  } else {
    pick.appendChild(el('div', null, 'Click to select printer'));
  }
  pick.appendChild(el('span', 'caret', '▾'));
  // sw_GetLocalDevices returns the saved list; nothing has ever called it.
  pick.onclick = () => alert('sw_GetLocalDevices — the saved-device list, unwired.');
  row.appendChild(pick);
  b.appendChild(row);

  if (model.legal && model.legal.legal === false) {
    const w = el('p', 'note bad',
      `Sliced for ${model.legal.preset_model}, which is not the connected printer.`);
    w.style.margin = '9px 0 0';
    b.appendChild(w);
  }
}

/* ---- Edit Filament ----------------------------------------------------- */
function drawFilament() {
  const b = $('#c-filament .card-body');
  b.innerHTML = '';

  // The real reply is PARALLEL ARRAYS. There is no `filaments[]`, and reading for one
  // is why this card is empty against a real Orca.
  MAPPING.filament_type.forEach((type, i) => {
    const row = el('div', 'fil');
    row.appendChild(swatch(MAPPING.filament_color_rgba[i]));

    const meta = el('div');
    meta.appendChild(el('div', 'fil-name', `Filament ${i + 1} · ${type}`));
    meta.appendChild(el('div', 'fil-sub',
      `${grams(MAPPING.filament_weight[i])} · ${metres(MAPPING.filament_used_mm[i])}`));
    row.appendChild(meta);

    const sel = el('select', 'head-pick');
    sel.setAttribute('aria-label', `Toolhead for filament ${i + 1}`);
    // Just the number: what is IN the head is drawn next to the select, in words, and
    // saying it twice is what made this column 242px wide.
    model.heads.forEach((_, t) => {
      const o = el('option', null, `Toolhead ${t + 1}`);
      o.value = String(t);
      if (model.assignment[i] === t) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => { model.assignment[i] = Number(sel.value); render(); };
    row.appendChild(sel);

    // The destination, drawn. The shipped card names a number and shows nothing.
    const head = model.heads[model.assignment[i]];
    const m = matchOf(MAPPING, model.heads, i, model.assignment[i]);
    const dest = el('div', 'dest');
    dest.appendChild(el('span', `dot ${m.level}`));
    dest.appendChild(swatch(head && head.loaded ? head.color : null, 'sm'));
    const words = el('div', 'dest-words');
    words.appendChild(el('b', null, head && head.loaded ? headWords(head) : 'Empty'));
    words.appendChild(el('span', m.level === 'ok' ? 'muted' : `note ${m.level}`,
      m.level === 'ok' ? `${head.nozzle} mm nozzle` : m.why));
    dest.appendChild(words);
    row.appendChild(dest);

    b.appendChild(row);
  });
}

/* ---- Print Preferences ------------------------------------------------- */
function drawPrefs() {
  const b = $('#c-prefs .card-body');
  b.innerHTML = '';
  b.appendChild(prefRows(model, () => {}));
}

/* ---- send bar ---------------------------------------------------------- */
function drawSend() {
  const problems = blockers(model).concat(
    WITH_PRINT_SETUP
      ? MAPPING.filament_type
          .map((_, i) => matchOf(MAPPING, model.heads, i, model.assignment[i]))
          .filter((m) => m.level === 'bad')
          .map((m) => ({ level: 'bad', text: m.why }))
      : []);

  $('#send').disabled = sending || problems.length > 0;
  if (!sending) {
    $('#stage').textContent = problems.length
      ? problems[0].text
      : (MODE === 'upload' ? 'Ready to upload' : 'Ready to print');
    $('#stage').title = $('#stage').textContent;
    $('#stage').className = problems.length ? 'note bad' : '';
  }
}

/* ---- render ------------------------------------------------------------ */
function render() {
  drawModel();
  drawPrinter();
  $('#c-filament').hidden = !WITH_PRINT_SETUP;
  $('#c-prefs').hidden = !WITH_PRINT_SETUP;
  if (WITH_PRINT_SETUP) { drawFilament(); drawPrefs(); }
  drawSend();
}

$('#title').textContent = WITH_PRINT_SETUP ? 'Print Preprocessing'
                                           : 'Pretreat the uploaded content';
$('#subtitle').textContent = WITH_PRINT_SETUP ? '?path=4' : '?path=5';
$('#refresh').onclick = () => render();

$('#send').onclick = () => {
  sending = true;
  drawSend();
  runSend(model, {
    onStage: ({ step, index, of, pct, sent }) => {
      const overall = Math.round(((index + (pct == null ? 0.5 : pct / 100)) / of) * 100);
      $('#fill').style.width = `${overall}%`;
      $('#stage').textContent = step.bytes
        ? `${step.say} — ${(sent / 1048576).toFixed(1)} of ${(JOB.sizeBytes / 1048576).toFixed(1)} MB`
        : step.say;
      $('#stage').className = '';
      $('#pct').textContent = `${overall}%`;
    },
    onDone: () => {
      $('#fill').style.width = '100%';
      $('#pct').textContent = '100%';
      $('#stage').textContent = 'Sent. The dialog closes here.';
      $('#stage').className = 'note ok';
      $('#send').textContent = 'Sent';
    },
    onFail: (e) => { sending = false; $('#stage').textContent = String(e); render(); },
  });
};

render();
markMockup('A · faithful');
expose(model, { render,
                destinationControls: () => document.querySelectorAll('select.head-pick').length });
