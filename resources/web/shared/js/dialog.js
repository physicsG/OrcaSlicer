/*
 * dialog.js - the modal sheet, shared by both surfaces.
 *
 * It lived in the Device tab's core/overlay.js, next to that page's anchored menus and
 * popovers, which is where it grew: `openDialog` for a sheet with a Cancel and a
 * confirm, `openBlockingDialog` for one the machine has to finish before the operator
 * may leave, and two field helpers so a sheet does not hand-roll an input.
 *
 * The print dialog needs exactly one of these - the help sheet behind Extrusion Flow
 * Calibration, which the bundle opens with `A.rB(...)` and an Ok button - and writing a
 * second one would have been a second scrim, a second Escape handler and a second answer
 * to "what does clicking the backdrop do".
 *
 * The MENUS did not come with it. The Device page's `openMenu` is a list of actions
 * positioned against the window; this dialog's pickers are value lists with a per-item
 * enabled flag, three geometry presets and a dialog-relative anchor. They are two
 * widgets that happen to both be rectangles, and merging them would have made both
 * worse - see print_processing/js/widgets/picker.js.
 */
'use strict';

import { el } from './dom.js';

/* ---- modal dialog --------------------------------------------------- */

let openDialogEl = null;
let blocking = false;      // a blocking dialog ignores Escape, the scrim and the X

export function closeDialog() {
  if (openDialogEl) { openDialogEl.remove(); openDialogEl = null; }
  blocking = false;
}

/**
 * Modal sheet. `build(body)` fills the body; `onConfirm()` returning false
 * keeps it open (so a validator can reject).
 *
 * `cancel: false` drops the Cancel button, for a sheet that only tells you something:
 * offering both Cancel and Close for one dismissal is a choice that is not one.
 */
export function openDialog({ title, build, confirmLabel = 'OK', onConfirm, wide = false,
                             cancel = true }) {
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
  if (cancel) {
    const no = el('button', 'btn', 'Cancel');
    no.onclick = closeDialog;
    foot.appendChild(no);
  }
  const ok = el('button', 'btn primary', confirmLabel);
  ok.onclick = () => { if (onConfirm() !== false) closeDialog(); };
  foot.appendChild(ok);
  box.appendChild(foot);

  scrim.appendChild(box);
  scrim.onclick = (e) => { if (e.target === scrim && !blocking) closeDialog(); };
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

/**
 * A modal that cannot be dismissed, for an operation the machine is in the middle of.
 *
 * The shipped page blocks the surface while a toolchange runs, and it is right to: the
 * gantry is moving, and a second command sent into that window is not something the
 * user meant. No close button, no scrim click, no Escape - it goes away when the caller
 * says the operation is over.
 *
 * Returns { update(text), fail(text), close() }.
 */
export function openBlockingDialog({ title, message }) {
  closeDialog();
  const scrim = el('div', 'scrim');
  const box = el('div', 'dialog blocking');

  const head = el('div', 'dialog-head');
  head.appendChild(el('h3', null, title));
  box.appendChild(head);

  const body = el('div', 'dialog-body');
  const spinner = el('div', 'spinner');
  body.appendChild(spinner);
  const msg = el('p', 'blocking-msg', message || '');
  body.appendChild(msg);
  box.appendChild(body);

  scrim.appendChild(box);
  document.body.appendChild(scrim);
  openDialogEl = scrim;
  blocking = true;

  return {
    update(text) { msg.textContent = text; },
    fail(text) {
      msg.textContent = text;
      spinner.remove();
      blocking = false;                       // let the user out again
      const foot = el('div', 'dialog-foot');
      const ok = el('button', 'btn primary', 'Close');
      ok.onclick = closeDialog;
      foot.appendChild(ok);
      box.appendChild(foot);
    },
    close() { blocking = false; closeDialog(); },
  };
}


/*
 * Escape closes a dialog - unless it is a blocking one, which is the point of those:
 * the machine is mid-procedure and leaving early is not a thing the operator can do.
 * Registered here rather than in a surface, so a page that imports this module gets the
 * behaviour and does not have to remember to.
 */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !blocking) closeDialog();
});
