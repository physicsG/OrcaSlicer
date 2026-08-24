/*
 * overlay.js - menus and modal dialogs for the Device tab.
 *
 * The shipped page opens a small anchored menu from the device selector and
 * modal sheets for editing values. This provides both, so the reconstruction
 * behaves like the original instead of falling back to window.prompt().
 */
'use strict';

let openMenuEl = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function closeMenu() {
  if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
}

document.addEventListener('click', (e) => {
  if (openMenuEl && !openMenuEl.contains(e.target)
      && !(e.target.closest && e.target.closest('[data-menu-anchor]'))) {
    closeMenu();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMenu(); closeDialog(); }
});

/**
 * Open a menu under `anchor`.
 * items: [{label, icon, onClick, muted}] - a null entry draws a divider.
 */
export function openMenu(anchor, items) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  const m = el('div', 'menu');
  m.style.left = `${Math.round(r.left + 16)}px`;
  m.style.top = `${Math.round(r.bottom - 8)}px`;

  items.forEach((it) => {
    if (!it) { m.appendChild(el('div', 'menu-sep')); return; }
    const row = el('button', 'menu-item' + (it.muted ? ' is-muted' : ''));
    if (it.icon) {
      const i = el('img');
      i.src = `icons/${it.icon}.svg`;
      i.alt = '';
      row.appendChild(i);
    }
    row.appendChild(el('span', null, it.label));
    row.onclick = (ev) => { ev.stopPropagation(); closeMenu(); it.onClick && it.onClick(); };
    m.appendChild(row);
  });

  document.body.appendChild(m);
  openMenuEl = m;
  return m;
}

/* ---- modal dialog --------------------------------------------------- */

let openDialogEl = null;

export function closeDialog() {
  if (openDialogEl) { openDialogEl.remove(); openDialogEl = null; }
}

/**
 * Modal sheet. `build(body)` fills the body; `onConfirm()` returning false
 * keeps it open (so a validator can reject).
 */
export function openDialog({ title, build, confirmLabel = 'OK', onConfirm, wide = false }) {
  closeDialog();
  const scrim = el('div', 'scrim');
  const box = el('div', 'dialog' + (wide ? ' wide' : ''));

  const head = el('div', 'dialog-head');
  head.appendChild(el('h3', null, title));
  const x = el('button', 'dialog-x', '×');
  x.onclick = closeDialog;
  head.appendChild(x);
  box.appendChild(head);

  const body = el('div', 'dialog-body');
  build(body);
  box.appendChild(body);

  const foot = el('div', 'dialog-foot');
  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = closeDialog;
  const ok = el('button', 'btn primary', confirmLabel);
  ok.onclick = () => { if (onConfirm() !== false) closeDialog(); };
  foot.appendChild(cancel);
  foot.appendChild(ok);
  box.appendChild(foot);

  scrim.appendChild(box);
  scrim.onclick = (e) => { if (e.target === scrim) closeDialog(); };
  document.body.appendChild(scrim);
  openDialogEl = scrim;

  const first = box.querySelector('input, select, button.primary');
  if (first) first.focus();
  return box;
}

/** A labelled number field, returned with a .value getter. */
export function numberField(parent, { label, value, min, max, unit, hint }) {
  const wrap = el('label', 'field');
  wrap.appendChild(el('span', 'field-label', label));
  const row = el('div', 'field-row');
  const input = el('input');
  input.type = 'number';
  input.value = String(value ?? 0);
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  row.appendChild(input);
  if (unit) row.appendChild(el('span', 'field-unit', unit));
  wrap.appendChild(row);
  if (hint) wrap.appendChild(el('span', 'field-hint', hint));
  parent.appendChild(wrap);
  return input;
}

export function toggleField(parent, { label, checked }) {
  const row = el('label', 'field-toggle');
  row.appendChild(el('span', null, label));
  const input = el('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  row.appendChild(input);
  parent.appendChild(row);
  return input;
}
