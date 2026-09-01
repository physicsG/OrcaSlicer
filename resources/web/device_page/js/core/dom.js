/*
 * dom.js - the three primitives every panel builds with.
 *
 * These lived inside the one big ui.js, where only that file could reach them. Every
 * panel's view needs the same three, and a second copy is how two spellings of `icon()`
 * start.
 */
'use strict';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** An icon from this surface's own set. Paths are relative to the page, not to js/. */
export function icon(name, cls) {
  const i = el('img', cls);
  i.src = `icons/${name}.svg`;
  i.alt = '';
  return i;
}
