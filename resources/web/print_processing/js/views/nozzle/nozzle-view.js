/*
 * nozzle-view.js - the fifth section, and the one no screenshot ever showed.
 *
 * `A.R5`: a warning banner under Print Preferences, drawn only when the plate's set of
 * nozzle diameters is not contained in the machine's. It is `bare` - no title column, no
 * card - and it carries a localisation key the bundle has no English entry for, so it
 * renders as `nozzle_mismatch_tip` in the shipped dialog too.
 *
 * The comparison (`A.c8l`) is deliberately silent at both edges: an empty machine list
 * means no banner, so a dialog that has not heard from the printer yet does not accuse
 * it of anything.
 */
'use strict';

import { el } from '../../../../shared/js/dom.js';

export function mount(root) {
  const b = el('div', 'nozzle-warn');
  b.appendChild(el('span', 'nozzle-icon'));
  b.appendChild(el('span', 'nozzle-text', 'nozzle_mismatch_tip'));
  root.appendChild(b);
}

export function update(root, { nozzleMismatch }) {
  root.hidden = !nozzleMismatch;
}
