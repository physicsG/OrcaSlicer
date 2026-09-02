/*
 * overlay.js - anchored menus and popovers for the Device tab.
 *
 * The shipped page opens a small anchored menu from the device selector, and popovers
 * that follow the state they draw. Both are this surface's.
 *
 * The MODAL SHEET moved to shared/js/dialog.js when the print dialog needed one: a
 * second scrim and a second Escape handler is not a thing to have two of. The menus
 * stayed, because the print dialog's pickers are a different widget - value lists with
 * a per-item enabled flag - and not a variant of this one.
 */
'use strict';

import { el } from '../../../shared/js/dom.js';
import { closeDialog } from '../../../shared/js/dialog.js';

let openMenuEl = null;

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
  // Dialogs bring their own Escape handling with them - see shared/js/dialog.js.
  if (e.key === 'Escape') { closeMenu(); closePopover(); }
});

/**
 * Open a menu under `anchor`.
 *
 * items: [{label, icon, glyph, onClick, muted, cmd, title}] - a null entry draws a
 * divider. `glyph` is a node built by the caller, for a drawing that has no icon file -
 * the ACE's own, which is geometry from a visual standard rather than an asset.
 * `cmd` prints the macro or object behind the item, right-aligned; `title` is the
 * hover text, and defaults to `cmd`.
 *
 * `head` names the menu's scope. The Filament panel has two `...` a few pixels apart -
 * one about the printer, one about a single toolhead - and two identical glyphs meaning
 * two different things is a real ambiguity. Saying which costs a line that was going to
 * be there anyway, so it is worth having wherever a page grows a second menu.
 */
export function openMenu(anchor, items, { head = null } = {}) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  const m = el('div', 'menu');
  m.style.left = `${Math.round(r.left + 16)}px`;
  m.style.top = `${Math.round(r.bottom - 8)}px`;

  if (head) m.appendChild(el('div', 'menu-head', head));
  items.forEach((it) => {
    if (!it) { m.appendChild(el('div', 'menu-sep')); return; }
    const row = el('button', 'menu-item' + (it.muted ? ' is-muted' : ''));
    if (it.glyph) {
      row.appendChild(it.glyph);
    } else if (it.icon) {
      const i = el('img');
      i.src = `icons/${it.icon}.svg`;
      i.alt = '';
      row.appendChild(i);
    }
    row.appendChild(el('span', null, it.label));
    if (it.cmd) row.appendChild(el('span', 'mcmd', String(it.cmd).split(' ')[0]));
    if (it.title || it.cmd) row.title = it.title || it.cmd;
    row.onclick = (ev) => { ev.stopPropagation(); closeMenu(); it.onClick && it.onClick(); };
    m.appendChild(row);
  });

  document.body.appendChild(m);
  openMenuEl = m;
  // A control that opened a menu IS a menu anchor, and the document listener above needs
  // to know: without this the click that opened the menu goes on bubbling to document,
  // which closes it again in the same tick. Only the device selector had the attribute
  // written on it by hand, so every menu added since would have opened and shut.
  anchor.setAttribute('data-menu-anchor', '');

  // A menu opened from the right-hand edge of a panel would otherwise hang off the
  // window; the anchor is often 20px from it.
  const box = m.getBoundingClientRect();
  if (box.right > window.innerWidth - 8) {
    m.style.left = `${Math.round(Math.max(8, window.innerWidth - box.width - 8))}px`;
  }
  if (box.bottom > window.innerHeight - 8) {
    m.style.top = `${Math.round(Math.max(8, window.innerHeight - box.height - 8))}px`;
  }
  return m;
}

/* ---- anchored popover ------------------------------------------------ */

let openPopEl = null;
let openPopAnchor = null;
let openPopBuild = null;
let openPopSig = null;
let openPopSeen = null;

export function closePopover() {
  if (openPopAnchor) openPopAnchor.removeAttribute('aria-expanded');
  if (openPopEl) openPopEl.remove();
  openPopEl = null;
  openPopAnchor = null;
  openPopBuild = null;
  openPopSig = null;
  openPopSeen = null;
}

/**
 * Re-run an open popover's `build` when what it draws has changed.
 *
 * A popover lives on `document.body`, outside every panel, so `paint()` never reaches
 * it: it was built once from the state at the moment it opened and then went stale. That
 * is invisible for a slider, whose thumb carries its own position - which is why the
 * Control panel's four never showed it - and plainly broken for anything with a
 * selected-state marker. The camera's settings shipped that way: clicking a view or a
 * transport did the thing and left the tick where it was until the panel was reopened.
 *
 * Signature-guarded, and the signature is the caller's, because rebuilding on every
 * frame is the bug `render.js` exists to prevent - it would take focus, hover and a
 * slider mid-drag with it. A popover that passes no `sig` is never rebuilt, so the
 * existing four behave exactly as they did.
 */
export function repaintPopover() {
  if (!openPopEl || !openPopSig || !openPopBuild) return;
  const now = String(openPopSig());
  if (now === openPopSeen) return;
  openPopSeen = now;
  const body = openPopEl.querySelector('.popover-body');
  if (!body) return;
  body.innerHTML = '';
  openPopBuild(body);
}

/**
 * A panel anchored under the control that opened it.
 *
 * The anchor keeps its place and takes `aria-expanded`, which is what the highlight
 * hangs off: without it a floating box reads as belonging to the page rather than to
 * the thing that was clicked. One at a time, because two open panels have no way to
 * say which control each came from.
 *
 * Placement is measured against the viewport rather than assumed: the panel is wider
 * than the 126px column it usually hangs from, so it is clamped to stay on screen, and
 * it flips above the anchor when there is no room below.
 */
export function openPopover(anchor, { title, build, width = 320, sig = null }) {
  const reopening = openPopAnchor === anchor;
  closePopover();
  closeMenu();
  if (reopening) return null;          // clicking the open control closes it

  const pop = el('div', 'popover');
  pop.style.width = `${width}px`;

  const head = el('div', 'popover-head');
  head.appendChild(el('span', 'popover-title', title));
  const x = el('button', 'popover-x', '\u00D7');
  x.setAttribute('aria-label', 'Close');
  x.onclick = closePopover;
  head.appendChild(x);
  pop.appendChild(head);

  const body = el('div', 'popover-body');
  build(body);
  pop.appendChild(body);

  document.body.appendChild(pop);

  const a = anchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const margin = 8;
  let left = a.left;
  left = Math.min(left, window.innerWidth - p.width - margin);
  left = Math.max(margin, left);
  let top = a.bottom + 6;
  if (top + p.height > window.innerHeight - margin) {
    const above = a.top - p.height - 6;
    if (above > margin) top = above;
    else top = Math.max(margin, window.innerHeight - p.height - margin);
  }
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  // the caret points back at the anchor, so it has to track the clamped position
  pop.style.setProperty('--caret', `${Math.round(a.left - left + Math.min(22, a.width / 2))}px`);

  anchor.setAttribute('aria-expanded', 'true');
  openPopEl = pop;
  openPopAnchor = anchor;
  openPopBuild = build;
  openPopSig = sig;
  openPopSeen = sig ? String(sig()) : null;
  return pop;
}

document.addEventListener('click', (e) => {
  if (!openPopEl) return;
  if (openPopEl.contains(e.target)) return;
  if (openPopAnchor && openPopAnchor.contains(e.target)) return;
  closePopover();
}, true);

window.addEventListener('resize', closePopover);
