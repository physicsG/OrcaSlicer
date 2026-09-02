/*
 * Option C - the preflight.
 *
 * The screen is a list of checks. Each one owns a question, answers it in a line, and
 * opens only when the answer needs a decision - so a plate with nothing wrong is six
 * short rows and a Send, and a plate with a problem opens at the problem.
 *
 * `level` is the whole grammar: ok, warn, bad. A `bad` disables Send; a `warn` changes
 * its label to "Send anyway", because a filament substitution is a judgement the operator
 * is entitled to make and an empty toolhead is not.
 */
'use strict';

import { MAPPING, JOB, humanDuration, grams, metres, megabytes, headWords, matchOf,
         PREFERENCES } from './fixture.js';
import { $, el, swatch, makeModel, runSend, prefRows, markMockup, expose,
         WITH_PRINT_SETUP, MODE } from './shell.js';

const model = makeModel();
const opened = new Set();
let sending = false;

/* ---- the checks --------------------------------------------------------- */

function checks() {
  const list = [];

  list.push({
    id: 'plate', name: 'Plate', level: 'ok',
    // The thumbnail rides in the ROW, not only in the body: "is this the right plate"
    // is the one question this dialog is always asked, and it should not need a click.
    thumb: MAPPING.thumbnails[0].url,
    said: `${MAPPING.filename} — ${humanDuration(MAPPING.estimated_time)}, `
        + `${grams(MAPPING.filament_weight_total)}`,
    body: plateBody,
  });

  list.push(model.device
    ? { id: 'printer', name: 'Printer', level: 'ok',
        said: `${model.device.name} — connected`, body: printerBody }
    : { id: 'printer', name: 'Printer', level: 'bad',
        said: 'Nothing connected', body: printerBody });

  if (model.legal) {
    list.push(model.legal.legal
      ? { id: 'preset', name: 'Preset', level: 'ok',
          said: `Sliced for ${model.legal.preset_model}, which is what is connected` }
      : { id: 'preset', name: 'Preset', level: 'bad',
          said: `Sliced for ${model.legal.preset_model}, not for the connected printer` });
  }

  if (WITH_PRINT_SETUP) {
    /*
     * nozzle_diameters (what the FILE was sliced for) against the nozzle fitted to the
     * head each filament is assigned to. Nothing checked this before.
     *
     * Following the ASSIGNMENT rather than the head list matters: a 0.2 nozzle on a
     * toolhead this plate never prints from is not a problem, and reporting it as one
     * blocks a print that would have worked.
     */
    const wrong = MAPPING.nozzle_diameters
      .map((want, i) => ({ want, i, head: model.heads[model.assignment[i]],
                           at: model.assignment[i] }))
      .filter(({ want, head }) => head && want && head.nozzle !== want);
    list.push({
      id: 'nozzles', name: 'Nozzles', level: wrong.length ? 'bad' : 'ok',
      said: wrong.length
        ? `Filament ${wrong[0].i + 1} goes to toolhead ${wrong[0].at + 1}, which has a `
          + `${wrong[0].head.nozzle} mm nozzle; the file was sliced for ${wrong[0].want} mm`
        : `All ${[...new Set(MAPPING.nozzle_diameters)].join('/')} mm, as sliced`,
      body: nozzleBody, openIf: wrong.length > 0,
    });

    const verdicts = MAPPING.filament_type.map(
      (_, i) => matchOf(MAPPING, model.heads, i, model.assignment[i]));
    const bad = verdicts.filter((v) => v.level === 'bad');
    const warn = verdicts.filter((v) => v.level === 'warn');
    list.push({
      id: 'filaments', name: 'Filaments', level: bad.length ? 'bad' : warn.length ? 'warn' : 'ok',
      said: bad.length ? bad[0].why
          : warn.length ? warn[0].why
          : `${MAPPING.filament_type.length} needed, each in a toolhead that can print it`,
      swatches: MAPPING.filament_color_rgba,
      body: filamentBody, openIf: bad.length > 0 || warn.length > 0,
    });

    const on = PREFERENCES.filter((p) => model.prefs[p.key]).map((p) => p.label);
    list.push({
      id: 'options', name: 'Options', level: 'ok',
      said: on.length ? on.join(', ') : 'None of the three enabled',
      body: optionsBody,
    });
  }

  list.push({
    id: 'transfer', name: 'Transfer', level: 'ok',
    said: MODE === 'upload'
      ? `${megabytes(JOB.sizeBytes)} to the printer, not started`
      : `${megabytes(JOB.sizeBytes)} to the printer, then start`,
    body: transferBody,
  });

  return list;
}

/* ---- the bodies --------------------------------------------------------- */

function plateBody(b) {
  const wrap = el('div', 'plate-open');
  const img = el('img', 'thumb');
  img.src = MAPPING.thumbnails[0].url;
  img.alt = 'Plate preview';
  wrap.appendChild(img);
  const dl = el('dl');
  const add = (k, v) => { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); };
  add('File', MAPPING.filename);
  add('Time', humanDuration(MAPPING.estimated_time));
  add('Material', `${grams(MAPPING.filament_weight_total)} over `
    + `${MAPPING.filament_type.length} filaments`);
  add('Length', metres(MAPPING.filament_used_mm.reduce((a, x) => a + x, 0)));
  add('Sliced for', MAPPING.machine_model);
  wrap.appendChild(dl);
  b.appendChild(wrap);
}

function printerBody(b) {
  const row = el('div', 'printer-open');
  if (model.device) {
    const t = el('div');
    t.appendChild(el('div', null, `${model.device.model} · ${model.device.sn}`));
    t.appendChild(el('div', 'muted', 'Connected over the LAN.'));
    t.style.flex = '1';
    row.appendChild(t);
  } else {
    row.appendChild(el('div', 'note bad',
      'sw_GetConnectedMachine returned nothing. Nothing can be sent.'));
  }
  const pick = el('button', 'ghost', 'Choose a printer');
  pick.onclick = () => alert('sw_GetLocalDevices — the saved-device list, unwired.');
  row.appendChild(pick);
  b.appendChild(row);
}

function nozzleBody(b) {
  const t = el('table', 'grid');
  t.innerHTML = '<tr><th>Toolhead</th><th>Fitted</th><th>Prints</th><th>Sliced for</th>'
              + '<th></th></tr>';
  model.heads.forEach((h, k) => {
    // Which file filaments, if any, come out of this head.
    const uses = MAPPING.nozzle_diameters
      .map((want, i) => ({ want, i }))
      .filter(({ i }) => model.assignment[i] === k);
    const want = uses.length ? uses[0].want : null;
    const bad = want != null && h.nozzle !== want;
    const tr = el('tr');
    tr.appendChild(el('td', null, `${k + 1} · ${headWords(h)}`));
    tr.appendChild(el('td', 'tight', `${h.nozzle} mm`));
    tr.appendChild(el('td', 'tight',
      uses.length ? uses.map(({ i }) => `Filament ${i + 1}`).join(', ') : 'nothing'));
    tr.appendChild(el('td', 'tight', want != null ? `${want} mm` : '—'));
    const v = el('td', 'tight');
    v.appendChild(el('span', `pill ${!uses.length ? '' : bad ? 'bad' : 'ok'}`,
      !uses.length ? 'unused' : bad ? 'mismatch' : 'ok'));
    tr.appendChild(v);
    t.appendChild(tr);
  });
  b.appendChild(t);
}

function filamentBody(b) {
  const t = el('table', 'grid');
  t.innerHTML = '<tr><th>In the file</th><th>Prints from</th><th></th></tr>';
  MAPPING.filament_type.forEach((type, i) => {
    const m = matchOf(MAPPING, model.heads, i, model.assignment[i]);
    const tr = el('tr');

    const left = el('td');
    const lr = el('div', 'cellrow');
    lr.appendChild(swatch(MAPPING.filament_color_rgba[i], 'sm'));
    const lt = el('div');
    lt.appendChild(el('div', null, `${type} · Filament ${i + 1}`));
    lt.appendChild(el('div', 'muted', `${grams(MAPPING.filament_weight[i])}`));
    lr.appendChild(lt);
    left.appendChild(lr);
    tr.appendChild(left);

    const mid = el('td');
    const sel = el('select', 'head-pick');
    model.heads.forEach((h, k) => {
      const o = el('option', null,
        `${k + 1} · ${h.loaded ? headWords(h) : 'empty'}`);
      o.value = String(k);
      if (model.assignment[i] === k) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => { model.assignment[i] = Number(sel.value); render(); };
    const mr = el('div', 'cellrow');
    mr.appendChild(swatch(model.heads[model.assignment[i]].loaded
      ? model.heads[model.assignment[i]].color : null, 'sm'));
    mr.appendChild(sel);
    mid.appendChild(mr);
    tr.appendChild(mid);

    const v = el('td', 'tight');
    v.appendChild(el('span', `pill ${m.level}`,
      m.level === 'ok' ? 'ok' : m.level === 'warn' ? 'substitution' : 'no'));
    v.title = m.why;
    tr.appendChild(v);

    t.appendChild(tr);
  });
  b.appendChild(t);
}

function optionsBody(b) { b.appendChild(prefRows(model, () => render())); }

function transferBody(b) {
  const p = el('div');
  p.appendChild(el('div', null,
    `${JOB.displayName.replace(/\.gcode$/, '.zip')} — ${megabytes(JOB.sizeBytes)}`));
  p.appendChild(el('div', 'muted',
    MODE === 'upload'
      ? 'Uploaded to the printer and left there.'
      : 'Uploaded, then started with sw_StartLocalPrint.'));
  b.appendChild(p);
}

/* ---- render ------------------------------------------------------------- */

function render() {
  const list = checks();
  const root = $('#checks');
  root.innerHTML = '';

  list.forEach((c) => {
    // A check that found something opens itself, once - reopening it on every render
    // would fight a user who closed it.
    if (c.openIf && !opened.has(`${c.id}:auto`)) { opened.add(c.id); opened.add(`${c.id}:auto`); }
    const isOpen = opened.has(c.id);

    const box = el('section', `chk ${c.level}`);
    box.setAttribute('open-state', isOpen ? '1' : '0');

    const head = el('button', 'chk-head');
    head.type = 'button';
    head.appendChild(el('span', `dot ${c.level}`));
    head.appendChild(el('span', 'name', c.name));
    if (c.thumb) {
      const t = el('img', 'thumb row-thumb');
      t.src = c.thumb;
      t.alt = 'Plate preview';
      head.appendChild(t);
    }
    head.appendChild(el('span', `said ${c.level === 'ok' ? '' : c.level}`, c.said));
    if (c.swatches) {
      const sw = el('span', 'swatches');
      c.swatches.forEach((col) => sw.appendChild(swatch(col, 'sm')));
      head.appendChild(sw);
    }
    if (c.body) head.appendChild(el('span', 'caret', '▸'));
    head.onclick = () => {
      if (!c.body) return;
      if (opened.has(c.id)) opened.delete(c.id); else opened.add(c.id);
      render();
    };
    box.appendChild(head);

    if (c.body && isOpen) {
      const body = el('div', 'chk-body');
      c.body(body);
      box.appendChild(body);
    }
    root.appendChild(box);
  });

  const worst = list.some((c) => c.level === 'bad') ? 'bad'
              : list.some((c) => c.level === 'warn') ? 'warn' : 'ok';
  $('#summary').textContent =
    worst === 'ok' ? 'nothing to resolve'
    : worst === 'warn' ? '1 to look at'
    : `${list.filter((c) => c.level === 'bad').length} blocking`;

  const btn = $('#send');
  btn.disabled = sending || worst === 'bad';
  if (!sending) {
    btn.textContent = worst === 'warn' ? 'Send anyway'
                    : MODE === 'upload' ? 'Upload' : 'Send';
    $('#stage').textContent = worst === 'bad'
      ? list.find((c) => c.level === 'bad').said
      : 'Ready';
    $('#stage').title = $('#stage').textContent;
    $('#stage').className = worst === 'bad' ? 'note bad' : '';
  }
}

$('#title').textContent = WITH_PRINT_SETUP ? 'Print Preprocessing'
                                           : 'Pretreat the uploaded content';
$('#subtitle').textContent = WITH_PRINT_SETUP ? '?path=4' : '?path=5';

$('#send').onclick = () => {
  sending = true;
  render();
  runSend(model, {
    onStage: ({ step, index, of, pct, sent }) => {
      const overall = Math.round(((index + (pct == null ? 0.5 : pct / 100)) / of) * 100);
      $('#fill').style.width = `${overall}%`;
      $('#pct').textContent = `${overall}%`;
      $('#stage').textContent = step.bytes
        ? `${step.say} — ${(sent / 1048576).toFixed(1)} of ${(JOB.sizeBytes / 1048576).toFixed(1)} MB`
        : step.say;
      $('#stage').className = '';
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
markMockup('C · preflight');
expose(model, { render, opened,
                destinationControls: () => document.querySelectorAll('select.head-pick').length,
                // The mapping lives behind a disclosure by design; say so rather than
                // letting a harness read a collapsed check as a missing control.
                disclosed: true });
