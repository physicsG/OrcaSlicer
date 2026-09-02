/*
 * picker.js - the dropdown all three of this dialog's value pickers use.
 *
 * Named a picker rather than a menu on purpose. The Device page has an `openMenu` in
 * core/overlay.js and it is a different widget: a list of ACTIONS positioned against the
 * window, every row clickable. This one is a list of VALUES with a per-item enabled flag,
 * three geometry presets and an anchor relative to the dialog. Two rectangles that do
 * different jobs; giving them one name is how the wrong one gets reached for.
 *
 * DropdownButton2, as the bundle configures it: an item height and padding
 * (MenuItemStyleData) and a surface with its own width, maximum height, elevation,
 * radius and offset (DropdownStyleData). The three call sites differ only in those
 * numbers, so there is one implementation and three sets of them:
 *
 *   menu       item h   item pad          width    maxH   elev   offset      radius
 *   printer    50       LTRB(16,0,16,0)   300      -      0      (0,0)       0
 *   toolhead   48       LTRB(16,0,16,0)   200      300    8      (-50,0)     8
 *   plate      80       LTRB(8,6,8,6)     button   480    4      (0,-2)      0/0/4/4
 *
 * from B.aqV / B.aqU / B.aqW and each `bEo(...)` call. The geometry lives in CSS, keyed
 * by the `kind` below; this module owns opening, placing, keyboard and the one rule that
 * matters - **a disabled item cannot be chosen**, which is the toolhead menu's whole
 * behaviour and not a decoration.
 */
'use strict';

import { el } from '../../../shared/js/dom.js';

const KINDS = {
  printer: { dx: 0, dy: 0, matchWidth: false },
  head: { dx: -50, dy: 0, matchWidth: false },
  plate: { dx: 0, dy: -2, matchWidth: true },
};

let open = null;   // { menu, trigger, onClose }

/** Close whatever is open. Safe to call when nothing is. */
export function closePicker() {
  if (!open) return;
  const { menu, trigger, onClose } = open;
  open = null;
  menu.remove();
  if (trigger && trigger.isConnected) trigger.setAttribute('aria-expanded', 'false');
  if (onClose) onClose();
}

export const isPickerOpen = (trigger) => !!open && open.trigger === trigger;

/**
 * Open a menu under `trigger`.
 *
 * `items` are `{ value, enabled, title, build(node) }`. `enabled` defaults to true; a
 * false one is rendered, kept in the tab order as `aria-disabled`, and refuses to fire
 * `onPick` - the bundle passes exactly this flag to the DropdownMenuItem and the item
 * is unselectable, which is what stops a filament being assigned to a toolhead that
 * cannot print it.
 */
export function openPicker({ trigger, kind, items, value, onPick, onClose, within }) {
  closePicker();
  const spec = KINDS[kind] || KINDS.printer;
  const menu = el('div', `menu menu-${kind}`);
  menu.setAttribute('role', 'listbox');

  items.forEach((it) => {
    const row = el('button', 'menu-item');
    row.type = 'button';
    row.setAttribute('role', 'option');
    const enabled = it.enabled !== false;
    row.setAttribute('aria-selected', String(it.value === value));
    if (!enabled) row.setAttribute('aria-disabled', 'true');
    if (it.title) row.title = it.title;
    it.build(row);
    row.onclick = () => {
      if (!enabled) return;          // the flag, enforced
      closePicker();
      if (onPick) onPick(it.value);
    };
    menu.appendChild(row);
  });

  const host = within || document.body;
  host.appendChild(menu);

  const hb = host.getBoundingClientRect();
  const tb = trigger.getBoundingClientRect();
  if (spec.matchWidth) menu.style.width = `${tb.width}px`;
  const mb = menu.getBoundingClientRect();

  let left = tb.left - hb.left + spec.dx;
  let top = tb.bottom - hb.top + spec.dy;
  // A real menu is constrained to the screen; this one to the dialog, which is the same
  // rule and the reason a menu anchored to the last filament card does not vanish.
  left = Math.max(4, Math.min(left, hb.width - mb.width - 4));
  if (top + mb.height > hb.height - 4) {
    top = Math.max(4, tb.top - hb.top - mb.height - spec.dy);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  trigger.setAttribute('aria-expanded', 'true');
  open = { menu, trigger, onClose };

  const sel = menu.querySelector('[aria-selected="true"]:not([aria-disabled])')
           || menu.querySelector('.menu-item:not([aria-disabled])');
  if (sel) sel.focus();
  return menu;
}

/* One listener for the lot: a click outside closes, Escape closes. Registered once at
   module scope rather than per-open, because a listener added on open and removed on
   close is a listener leaked whenever something else closes the menu first. */
document.addEventListener('pointerdown', (e) => {
  if (!open) return;
  if (open.menu.contains(e.target) || open.trigger.contains(e.target)) return;
  closePicker();
}, true);

document.addEventListener('keydown', (e) => {
  if (!open) return;
  if (e.key === 'Escape') { const t = open.trigger; closePicker(); t.focus(); }
});
