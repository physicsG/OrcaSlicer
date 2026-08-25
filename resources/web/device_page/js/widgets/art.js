/*
 * art.js - the two pieces of empty-state art the shipped page uses, shared by the
 * panels that have nothing to show: the not-connected device, and the empty box.
 */
'use strict';

import { el } from '../core/dom.js';

export function illustration(root) {
  const wrap = el('div');
  wrap.style.textAlign = 'center';
  const img = el('img', 'placeholder');
  img.src = 'icons/deviceNotConnected.webp';
  img.alt = '';
  img.onerror = () => img.remove();
  wrap.appendChild(img);
  root.appendChild(wrap);
}

/** hh:mm:ss from seconds, the granularity the shipped page uses for a job. */

/** The empty-box art the shipped page uses where there is nothing to show. */
export function placeholder(cls = 'stor-ph') {
  const im = el('img', cls);
  im.src = 'icons/empty-box.png';
  im.alt = '';
  return im;
}

/**
 * One card, from whichever shape the source hands over.
 *
 * Each kind answers the same four questions - what does it look like, what is it
 * called, what else is worth knowing, and what can be done with it - so the card is
 * built once and the differences live in this switch.
 */
