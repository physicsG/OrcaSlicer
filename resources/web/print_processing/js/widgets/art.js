/*
 * art.js - the two things this dialog paints a filament colour into.
 *
 * A filament's colour is not one colour. `A.abX` (the card's block) and `A.a6K` (the
 * round target disc) both switch on `filamentColorMulti.mode`:
 *
 *   0 colours   nothing
 *   1 colour    solid - unless its alpha is ZERO, which is an absence and draws a hatch
 *   many, mode 0  equal vertical bands, one per colour
 *   many, mode 1  a left-to-right linear gradient
 *   many, mode 2  the first colour, solid            (disc only)
 *
 * The alpha-zero case is not a curiosity: multiACE wipes a stock-feeder head's identity
 * with `FILAMENT_COLOR_RGBA=00000000` when the machine enters head mode, and the spool is
 * still physically in the head while it happens. Drawing that black would be a lie about
 * the machine; the hatch says "no colour recorded".
 */
'use strict';

import { el } from '../../../shared/js/dom.js';

/**
 * Paint `node` with a filament's colours.
 *
 * Bands are real child elements rather than a `repeating-linear-gradient` because the
 * bundle builds them as flex children, and because a band has to be able to carry a
 * border when the colour is near-white - see the disc below.
 */
export function paintFilament(node, colors, mode = 0) {
  node.classList.remove('sw-hatch', 'sw-banded');
  node.style.background = '';
  node.style.backgroundImage = '';
  Array.from(node.querySelectorAll('.sw-band')).forEach((n) => n.remove());

  const list = (colors || []).filter(Boolean);
  if (!list.length) { node.classList.add('sw-hatch'); return; }
  if (list.length === 1) { node.style.background = list[0]; return; }

  if (Number(mode) === 1) {
    node.style.backgroundImage = `linear-gradient(90deg, ${list.join(', ')})`;
    return;
  }
  if (Number(mode) === 2) { node.style.background = list[0]; return; }

  node.classList.add('sw-banded');
  list.forEach((c) => {
    const b = el('span', 'sw-band');
    b.style.background = c;
    node.appendChild(b);
  });
}

/**
 * The 28px target disc, with the toolhead's 1-based number on it.
 *
 * `!` rather than a number is the bundle's own mark for an unassigned filament
 * (`s ? ""+(a2+1) : "!"`), and it is drawn in the warning colour along with the card's
 * border. Nothing else on this surface says "you have not chosen yet".
 */
export function makeDisc(cls = '') {
  const d = el('div', `disc ${cls}`.trim());
  d.appendChild(el('span', 'disc-n'));
  return d;
}

export function updateDisc(disc, { colors, mode, label, ink, unset }) {
  paintFilament(disc, colors, mode);
  disc.classList.toggle('unset', !!unset);
  const n = disc.querySelector('.disc-n');
  const want = label == null ? '' : String(label);
  if (n.textContent !== want) n.textContent = want;
  n.style.color = ink || '';
}
