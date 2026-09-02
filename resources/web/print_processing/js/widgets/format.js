/*
 * format.js - the dialog's own number and colour formatting.
 *
 * Each of these is the shipped popup's, not a preference. Where they differ from the
 * obvious choice the bundle is quoted, because "31.4 g" and "31.40 g" are the kind of
 * difference nobody notices until the two surfaces are side by side.
 */
'use strict';

import { isDarkColor } from '../../../shared/js/protocol.js';

// Re-exported so a view imports its formatting from one place; the implementations are
// shared, not this surface's.
export { cssColor, isDarkColor } from '../../../shared/js/protocol.js';

/**
 * `A.aZU(seconds, B.oW)` - the popup's own duration format.
 *
 * Under an hour it drops the hour part entirely; the bundle's plate rows show `33m`,
 * not `0h 33m`.
 */
export function duration(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return 'N/A';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Estimated Materials is `toStringAsFixed(2) + " g"`. Two decimals, not one. */
export function grams2(g) {
  const n = Number(g);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(2)} g` : 'N/A';
}

/** A filament card's own weight is `toStringAsFixed(0) + "g"`. No space, no decimals. */
export function grams0(g) {
  const n = Number(g);
  return `${Number.isFinite(n) ? n.toFixed(0) : 0}g`;
}

/** The upload percentage is `toStringAsFixed(0) + "%"`. */
export const percent0 = (f) => `${Math.round((Number(f) || 0) * 100)}%`;

export const megabytes = (b) => `${(Number(b) / 1048576).toFixed(1)} MB`;

/*
 * Colour is NOT implemented here. `cssColor` and `isDarkColor` are in
 * shared/js/protocol.js, where they already were: the alpha-zero rule - multiACE wipes a
 * head's identity with `00000000` while the spool is still physically in it, so alpha
 * zero is an ABSENCE and not black - is the sort of thing that must have exactly one
 * implementation. A second copy in this file was one spelling away from drawing four
 * black spools again.
 *
 * `inkOn` below is the only colour function this surface adds, because the filament card
 * writes text ON the colour block and has to choose an ink for it. It is `isDarkColor`'s
 * question asked the other way round, and it delegates.
 */
export function inkOn(color) {
  return isDarkColor(color) ? '#ffffff' : '#1b1b1b';
}

/**
 * Nozzle diameters compare as STRINGS in the bundle - `J.p(a) === J.p(b)` - and the two
 * sides spell them differently: the file says "0.4", the extruder object says 0.4. One
 * decimal place, as a string, is the spelling both can be put in.
 */
export function nozzleStr(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : String(v);
}
