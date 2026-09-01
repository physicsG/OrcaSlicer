/*
 * ui.js - rendering for the print-processing popup.
 *
 * Section order and labels follow the shipped Flutter popup exactly:
 *   Model Information / Select Printer / Edit Filament / Print Preferences
 * then a send bar carrying upload progress and the Send button.
 * See docs/u1-webui/03-print-processing/01-overview.md
 */
'use strict';

import { PRINT_PREFERENCES } from '../../shared/js/protocol.js';

export const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function section(root, title, extraHead) {
  root.innerHTML = '';
  const head = el('div', 'card-head');
  head.appendChild(el('h2', null, title));
  if (extraHead) head.appendChild(extraHead);
  root.appendChild(head);
  const body = el('div', 'card-body');
  root.appendChild(body);
  return body;
}

/** Seconds -> "1 h 12 min", the popup's own granularity. */
export function humanDuration(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return 'N/A';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function humanGrams(g) {
  const n = Number(g);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(1)} g` : 'N/A';
}

/* ---- Model Information -------------------------------------------- */
export function renderModel(root, file) {
  const b = section(root, 'Model Information');
  const row = el('div', 'model-row');

  const thumb = el('div', 'thumb');
  thumb.appendChild(el('span', 'thumb-tag', 'G-code'));
  row.appendChild(thumb);

  const facts = el('dl', 'facts');
  const add = (k, v) => {
    facts.appendChild(el('dt', null, k));
    facts.appendChild(el('dd', null, v));
  };
  add('Filename', file.filename || 'N/A');
  add('Estimated Time', humanDuration(file.predictionTime));
  add('Estimated Materials', humanGrams(file.weight));
  row.appendChild(facts);

  b.appendChild(row);
}

/* ---- Select Printer ------------------------------------------------ */
export function renderPrinter(root, device, legal, handlers) {
  const b = section(root, 'Select Printer');
  const row = el('div', 'model-row');
  row.appendChild(el('div', 'thumb printer-thumb'));

  const pick = el('div', 'picker');
  const sel = el('button', 'select');
  sel.type = 'button';
  sel.textContent = device
    ? (device.name || device.deviceName || device.model_name || device.sn)
    : 'Click to select printer';
  sel.onclick = () => handlers.pickPrinter && handlers.pickPrinter();
  pick.appendChild(sel);

  if (device && legal && legal.legal === false) {
    // sw_GetPrintLegal compares the edited printer preset against the machine
    // actually connected; a mismatch is what blocks the send.
    const w = el('p', 'warn-line',
      `This plate was sliced for ${legal.preset_model || 'another model'}, `
      + 'which does not match the connected printer.');
    pick.appendChild(w);
  }
  row.appendChild(pick);
  b.appendChild(row);
}

/* ---- Edit Filament ------------------------------------------------- */
export function renderFilament(root, mapping, taskConfig, handlers) {
  const refresh = el('button', 'icon-btn', '⟳');
  refresh.title = 'Re-read the filament mapping';
  refresh.onclick = () => handlers.refreshFilament && handlers.refreshFilament();

  const b = section(root, 'Edit Filament', refresh);

  const rows = (mapping && mapping.filaments) || [];
  if (!rows.length) {
    b.appendChild(el('p', 'empty', 'No filament requirements read from this file yet.'));
    return;
  }

  const types = taskConfig.filament_type || [];
  const colors = taskConfig.filament_color || [];

  const grid = el('div', 'fil-grid');
  rows.forEach((f, i) => {
    const card = el('div', 'fil-row');

    const chip = el('span', 'chip');
    chip.style.background = f.color || colors[i] || '#888';
    card.appendChild(chip);

    const meta = el('div', 'fil-meta');
    meta.appendChild(el('span', 'fil-name', `Filament ${i + 1} · ${f.type || types[i] || '—'}`));
    meta.appendChild(el('span', 'fil-sub', `${Number(f.used_g || 0).toFixed(1)} g`));
    card.appendChild(meta);

    card.appendChild(el('span', 'arrow', '→'));

    // Which physical toolhead this filament is assigned to. The popup writes
    // this back as print_task_config.extruder_map_table.
    const sel = el('select', 'slot');
    for (let t = 0; t < 4; t++) {
      const o = el('option', null, `Toolhead ${t + 1}`);
      o.value = String(t);
      if (Number(f.extruder) === t) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => handlers.assignSlot && handlers.assignSlot(i, Number(sel.value));
    card.appendChild(sel);

    grid.appendChild(card);
  });
  b.appendChild(grid);
}

/* ---- Print Preferences --------------------------------------------- */
export function renderPreferences(root, taskConfig, handlers) {
  const b = section(root, 'Print Preferences');
  const list = el('div', 'prefs');

  PRINT_PREFERENCES.forEach(({ key, label }) => {
    const row = el('label', 'pref-row');
    row.appendChild(el('span', 'pref-label', label));
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!taskConfig[key];
    box.onchange = () => handlers.setPreference && handlers.setPreference(key, box.checked);
    row.appendChild(box);
    list.appendChild(row);
  });

  b.appendChild(list);
}

/* ---- send bar ------------------------------------------------------- */
export function renderSend(pct, enabled, label) {
  const fill = $('#progress-fill');
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  fill.style.width = `${p}%`;
  $('#progress-pct').textContent = `${p}%`;
  const btn = $('#send');
  btn.disabled = !enabled;
  if (label) btn.textContent = label;
}

/* ---- trace ---------------------------------------------------------- */
export function makeTrace(pane) {
  return (kind, packet) => {
    if (!pane || pane.dataset.paused === '1') return;
    const line = el('div', `t t-${kind}`);
    const cmd = (packet && packet.payload && packet.payload.cmd)
      || (packet && packet.header && packet.header.event_id ? 'push' : '');
    line.textContent = `${kind.padEnd(9)} ${cmd}`;
    line.title = JSON.stringify(packet);
    pane.appendChild(line);
    while (pane.childElementCount > 200) pane.removeChild(pane.firstChild);
    pane.scrollTop = pane.scrollHeight;
  };
}
