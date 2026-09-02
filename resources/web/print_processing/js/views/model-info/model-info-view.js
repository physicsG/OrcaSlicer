/*
 * model-info-view.js - the plate, and what is known about it.
 *
 * `A.J9` has two layouts and picks between them on whether the file has `partitions`:
 *
 *   aFq   no partitions: a 100x100 thumbnail and three text facts
 *   aFv   partitions:    the same thumbnail, then a 90-tall plate row - or a dropdown of
 *                        them - carrying name, time, weight, nozzle and filament chips
 *
 * Only the first is drawn here, and deliberately: `sw_GetFileFilamentMapping` as Orca
 * implements it has no `partitions` key at all, so the second layout is unreachable
 * through this host. It is recovered and specified in the mockup; building a branch that
 * cannot be entered would be building it blind.
 */
'use strict';

import { el } from '../../../../shared/js/dom.js';
import { text } from '../../../../shared/js/render.js';
import { duration, grams2 } from '../../widgets/format.js';

export function mount(root) {
  const row = el('div', 'mi');

  // `thumbnails[0].url` - a data: PNG of the sliced plate, in the reply all along. The
  // shipped popup draws a grey `gcodeCover.png` here whether or not one arrived.
  const img = el('img', 'mi-thumb');
  img.alt = '';
  img.width = 100;
  img.height = 100;
  row.appendChild(img);
  row.appendChild(el('div', 'gap-20'));

  const facts = el('div', 'mi-facts');
  facts.appendChild(el('div', 'sp-13'));
  facts.appendChild(el('div', 'mi-fact', ''));   // Filename
  facts.appendChild(el('div', 'sp-10'));
  facts.appendChild(el('div', 'mi-fact', ''));   // Estimated Time
  facts.appendChild(el('div', 'sp-10'));
  facts.appendChild(el('div', 'mi-fact', ''));   // Estimated Materials
  row.appendChild(facts);

  root.appendChild(row);
}

export function update(root, { mapping, file }) {
  const img = root.querySelector('.mi-thumb');
  const thumb = mapping && Array.isArray(mapping.thumbnails) && mapping.thumbnails[0];
  const url = thumb && thumb.url;
  if (url) {
    if (img.getAttribute('src') !== url) img.src = url;
    img.classList.remove('empty');
  } else {
    // No thumbnail is a state, not an error: a plate sliced without them, or a host that
    // has not answered yet. The placeholder is CSS, so there is no broken-image icon.
    if (img.hasAttribute('src')) img.removeAttribute('src');
    img.classList.add('empty');
  }

  const facts = root.querySelectorAll('.mi-fact');
  const name = (mapping && mapping.filename)
            || (file && file.filename)
            || 'N/A';
  text(facts[0], `Filename: ${name}`);
  text(facts[1], `Estimated Time: ${mapping ? duration(mapping.estimated_time) : 'N/A'}`);
  // toStringAsFixed(2) - "31.40 g", not "31.4 g".
  text(facts[2], `Estimated Materials: ${
    mapping ? grams2(mapping.filament_weight_total) : 'N/A'}`);
}
