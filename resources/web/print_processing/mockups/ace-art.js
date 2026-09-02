/*
 * ace-art.js - how a machine with an ACE is drawn, in a 714px dialog.
 *
 * There is already one way to draw this, in three places, and this is the fourth: the
 * Device page's Filament panel, the Prepare tab's Printer section, and - behind both -
 * Bambu Studio's AMS display, which is where the vocabulary comes from. A print dialog
 * that invented a fifth would be asking the operator to learn the same machine twice.
 *
 * WHAT IS BORROWED, AND FROM WHERE
 *
 *   the ACE badge                  shared/js/multiACE.js `aceBadge()`, unchanged. The
 *                                  Prepare tab's `AceBadge` C++ widget draws the same
 *                                  44x26 from the same ACE_ART numbers.
 *   the cabinet and the feeder     device_page/css/device.css `.ace-cab` / `.ace-feed`:
 *                                  a hard colour stop at `5px + disc/2` so the seam runs
 *                                  through the middle of every roll, #EEEEEE over
 *                                  #CECECE for an ACE and #FFFFFF over #1F1F1F for
 *                                  Snapmaker's feeder module, which is a different
 *                                  device and should say so at a glance.
 *   a bay                          a 36px disc carrying its ADDRESS over a 58x19 name
 *                                  chip, 6px apart, with the eye/pencil mark at the
 *                                  roll's bottom-right and the green tag mark mirrored
 *                                  to its left. Bambu's AMS display is the same object:
 *                                  an `A1` badge over a colour-filled bay.
 *   the tubes                      every bay drops to a manifold and the manifold runs
 *                                  to the head's inlet, drawn BEHIND the cabinet,
 *                                  because filament inside a machine is not drawn over
 *                                  the machine.
 *   the corner tick                the Prepare tab's `SyncMarkBox`: a green wedge in a
 *                                  box's top-right meaning THIS AGREES WITH THE MACHINE.
 *                                  #00AE42, and absent - never grey - when nothing has
 *                                  been read.
 *
 * WHAT IS NEW, AND WHY
 *
 * One thing: a place can carry what the PLATE wants of it, as a second disc behind the
 * first. The Device page never needs that - it draws a machine, not a machine against a
 * file - and it is the only mark here that is not already somewhere else.
 */
'use strict';

import { ACE_ART, aceBadge } from '../../shared/js/multiACE.js';

const SVGNS = 'http://www.w3.org/2000/svg';

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVGNS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

/** Readable ink on a filled disc. The same rule the Device page's `isDarkColor` uses. */
export function inkOn(hex) {
  if (!hex) return '#333';
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c.slice(0, 6), 16);
  if (!Number.isFinite(n)) return '#333';
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#333' : '#fff';
}

/**
 * A file filament's badge: its number on its own colour.
 *
 * The identity the Prepare sidebar already gave it, carried through to the print - so the
 * thing the operator numbered in Prepare is the thing they see here. Four options drew
 * this and three of them had their own copy; `data-fil` is on it so a check can ask "is
 * filament 5 on screen" rather than infer it from the text, which stopped working the
 * moment a design legitimately drew three marks that read the same.
 */
export function fnum(i, colour, title, small = false) {
  const n = el('span', 'fnum' + (small ? ' sm' : ''), String(i + 1));
  n.dataset.fil = String(i);
  n.style.background = colour;
  n.style.color = inkOn(colour);
  n.title = title ? `Filament ${i + 1} · ${title}` : `Filament ${i + 1}`;
  return n;
}

/* ---- marks --------------------------------------------------------------- */

/**
 * The Prepare tab's corner tick. Green wedge, top-right, radius-matched to the box.
 *
 * It means one thing: what this box says is what the machine says. A box nobody has read
 * gets NO tick rather than a grey one - `SyncMarkBox` is drawn only when
 * `m_ace_read` is true, and the absence is the honest answer.
 */
export function syncTick() {
  const s = svg('svg', { class: 'tick', viewBox: '0 0 18 18', width: 18, height: 18,
                         'aria-hidden': 'true' });
  s.appendChild(svg('path', { d: 'M18 0 V12 A6 6 0 0 1 12 0 Z', fill: '#00AE42' }));
  s.appendChild(svg('path', { d: 'M13.2 5.4 l1.5 1.6 l2.6 -3',
                              fill: 'none', stroke: '#fff', 'stroke-width': 1.4,
                              'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return s;
}

/** An eye for a record that may only be read, a pencil for one that may be typed. */
export function provMark(source) {
  const wrap = el('span', 'ace-prov');
  wrap.title = source === 'rfid' ? 'Read from the spool’s tag' : 'Named by hand';
  const s = svg('svg', { viewBox: '0 0 16 16', width: 11, height: 11, fill: 'none',
                         stroke: 'currentColor', 'stroke-width': 1.5,
                         'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  if (source === 'rfid') {
    s.appendChild(svg('path', { d: 'M1 8s2.6-4.2 7-4.2S15 8 15 8s-2.6 4.2-7 4.2S1 8 1 8Z' }));
    s.appendChild(svg('circle', { cx: 8, cy: 8, r: 1.9 }));
  } else {
    s.appendChild(svg('path', { d: 'M11.2 2.4 13.6 4.8 5.4 13H3v-2.4Z' }));
  }
  wrap.appendChild(s);
  return wrap;
}

/** "This spool identified itself over the air" — a different fact, so a different mark. */
export function tagMark() {
  const wrap = el('span', 'ace-tag');
  wrap.title = 'RFID tag read';
  const s = svg('svg', { viewBox: '0 0 16 16', width: 11, height: 11, fill: 'none',
                         stroke: 'currentColor', 'stroke-width': 1.5,
                         'stroke-linecap': 'round' });
  s.appendChild(svg('path', { d: 'M4.2 10.6a5.4 5.4 0 0 1 0-5.2M6.8 9.4a2.7 2.7 0 0 1 0-2.8' }));
  s.appendChild(svg('circle', { cx: 10.4, cy: 8, r: 1.5, fill: 'currentColor', stroke: 'none' }));
  return (wrap.appendChild(s), wrap);
}

/**
 * The stock feeder module's badge: the frame at badge size, white over black, on a
 * rounded SQUARE.
 *
 * Lifted from the Device page's `moduleBadge()` rather than drawn again, and it is the
 * one mark on this surface that MUST NOT be the ACE's. An ACE is 44x26 because a cabinet
 * is wide; Snapmaker's Automatic Filament Feeder Module is a different device with one
 * bay, and the ACE's glyph on it reads as a squashed ACE - which is exactly what the
 * first draft of option G did, and at 13px the two were indistinguishable. The colours
 * are the feeder box's own, so the mark and the drawing agree.
 */
export function feederBadge(px = 15) {
  const s = svg('svg', { width: px, height: px, viewBox: '0 0 24 24',
                         'aria-hidden': 'true', class: 'feeder-badge' });
  s.appendChild(svg('rect', { x: 1, y: 1, width: 22, height: 22, rx: 5, fill: '#FFFFFF' }));
  s.appendChild(svg('path', {
    d: 'M1 13 h22 v5 a5 5 0 0 1 -5 5 h-12 a5 5 0 0 1 -5 -5 Z', fill: '#1F1F1F' }));
  s.appendChild(svg('rect', { x: 1, y: 1, width: 22, height: 22, rx: 5, fill: 'none',
                              stroke: '#D9DDE3', 'stroke-width': 1 }));
  return s;
}

/* ---- a place ------------------------------------------------------------- */

/**
 * One bay, or one feeder's single spool: a disc over a name chip.
 *
 * `want` is the plate's demand on this place and is what makes it a print-dialog bay
 * rather than a Device-page one. When it disagrees, the wanted colour is drawn as a ring
 * behind the disc, so the two are legible at once without a second row.
 *
 * A bay carries its ADDRESS in the disc (`A2`); a feeder's spool has no address and
 * carries nothing. Empty is the checkerboard, and occupied-but-unnamed is a solid
 * neutral - never the checkerboard, which is this page's word for empty.
 */
export function place({ bay, want, verdict, addr, feeder = false, small = false }) {
  const node = el('div', 'place' + (small ? ' is-small' : '') + (feeder ? ' is-feeder' : ''));
  if (verdict) node.dataset.verdict = verdict;

  const disc = el('span', 'ace-disc', addr || '');
  const known = bay && bay.occupied && bay.known && bay.color;
  if (known) {
    disc.dataset.loaded = '1';
    disc.style.background = bay.color;
    disc.style.color = inkOn(bay.color);
  } else if (bay && bay.occupied) {
    disc.dataset.loaded = '1';
    disc.style.background = '#B7BDC6';
    disc.style.color = '#333';
  }
  node.appendChild(disc);

  /* The plate's demand, when it is not what is there. A ring rather than a swatch: a
     second solid block beside the first reads as two spools, and there is one. */
  if (want && verdict && verdict !== 'agrees' && verdict !== 'unchecked') {
    const ring = el('span', 'place-want');
    ring.style.borderColor = want.color;
    ring.title = `The plate wants ${want.name} ${want.type} here`;
    node.appendChild(ring);
  }

  if (bay && bay.occupied) {
    node.appendChild(provMark(bay.source === 'rfid' ? 'rfid' : 'typed'));
    if (bay.source === 'rfid') node.appendChild(tagMark());
  }

  const chip = el('span', 'ace-chip',
                  bay && bay.occupied ? (bay.material || '?') : '/');
  if (bay && bay.occupied && !bay.known) chip.classList.add('is-unknown');
  node.appendChild(chip);
  return node;
}

/* ---- the boxes ----------------------------------------------------------- */

/**
 * The ACE cabinet: four bays inside one body, the seam through the middle of the rolls.
 *
 * `width: fit-content` and centred, because at four bays a full-width box is mostly
 * empty grey - the Device page settled that and the reasoning holds in a narrower
 * dialog.
 */
export function cabinet(bays) {
  const cab = el('div', 'ace-cab');
  const top = el('div', 'ace-cab-top');
  const row = el('div', 'ace-bays');
  bays.forEach((b) => row.appendChild(b));
  top.appendChild(row);
  cab.appendChild(top);
  return cab;
}

/**
 * Multi mode's lane: one bay from each cabinet, side by side.
 *
 * The Device page's `laneBox`. In multi, bay `i` of EVERY unit is plumbed to head `i`, so
 * a head's places are one bay out of each cabinet rather than one cabinet's four - the
 * same drawing, one bay wide, once per unit. Drawing a head's own four here would be
 * drawing hardware that is not wired that way.
 */
export function laneBoxes(places) {
  const row = el('div', 'ace-lanes');
  places.forEach((node) => row.appendChild(cabinet([node])));
  return row;
}

/**
 * The machine's ACE mode, stated.
 *
 * Every surface that draws a bay address needs it, because the mode is what decides what
 * an address MEANS: in head mode `A2` is the second bay of the cabinet wired to this
 * head; in multi it is one of a lane that spans every cabinet. The words are the Device
 * page's, so the two surfaces call one state one thing.
 *
 * Read-only everywhere. `SET_ACE_MODE` re-plumbs the printer and some of it only takes
 * effect after a restart; a dialog that sends one plate has no business changing it.
 */
export function modeRow(mode, labels) {
  const row = el('div', 'mode-row');
  if (!mode) {
    row.appendChild(el('span', 'mode-pill dim', 'No ACE'));
    row.appendChild(el('span', 'mode-say', 'This printer reports no ACE unit.'));
    return row;
  }
  row.appendChild(el('span', 'mode-pill', `ACE mode · ${labels[mode] || mode}`));
  row.appendChild(el('span', 'mode-say', MODE_SAY[mode] || ''));
  return row;
}

/* Read only by `modeRow` above, so it stays private. */
const MODE_SAY = {
  head: 'Each toolhead is its own feeder, or wired to one ACE.',
  multi: 'Bay 1 of every ACE feeds toolhead 1, bay 2 feeds toolhead 2, and so on.',
  normal: 'Stock feeders only — no ACE is feeding a toolhead.',
};

/** Snapmaker's Automatic Filament Feeder Module: the same drawing, its own black and white. */
export function feederBox(child) {
  const box = el('div', 'ace-feed');
  const top = el('div', 'ace-feed-top');
  const row = el('div', 'ace-bays');
  row.appendChild(child);
  top.appendChild(row);
  box.appendChild(top);
  return box;
}

/** The unit's own line: the badge, its name, humidity, temperature. */
export function unitStrip(unit) {
  const strip = el('div', 'ace-strip');
  strip.appendChild(aceBadge(unit.bays, 17 / 26));
  const name = el('span', 'ace-unit');
  name.appendChild(el('b', null, `ACE ${unit.id}`));
  name.appendChild(document.createTextNode(` · ${unit.model}`));
  strip.appendChild(name);
  strip.appendChild(el('span', 'spacer'));
  if (unit.humidity != null) {
    const hum = el('span', 'ace-hum');
    hum.appendChild(drop(unit.humidity));
    hum.appendChild(el('span', null, `${unit.humidity}%`));
    if (unit.temperature != null) {
      hum.appendChild(el('span', 'ace-sep'));
      hum.appendChild(el('span', null, `${unit.temperature} °C`));
    }
    strip.appendChild(hum);
  }
  return strip;
}

/* Orca's own five humidity buckets: <=20 / <=35 / <=50 / <=65 / above. */
function drop(h) {
  const level = h <= 20 ? 1 : h <= 35 ? 2 : h <= 50 ? 3 : h <= 65 ? 4 : 5;
  const s = svg('svg', { viewBox: '0 0 12 14', width: 10, height: 12, 'aria-hidden': 'true' });
  s.appendChild(svg('path', { d: 'M6 0.6 C6 0.6 11 6.2 11 9 A5 5 0 0 1 1 9 C1 6.2 6 0.6 6 0.6Z',
                              fill: level >= 4 ? '#D79A4F' : '#4FA3D1' }));
  return s;
}

/**
 * The toolhead, at the Device page's own half scale (32x70 of a 64x140 artwork).
 *
 * Drawn rather than loaded: the panel's own artwork is a PNG in the resource tree and a
 * mockup that depends on it fails silently when the path moves. The shape is what
 * carries the meaning - a body, a nozzle, and the inlet the tube arrives at.
 */
export function toolhead(color, label) {
  const wrap = el('div', 'ace-tool');
  const s = svg('svg', { viewBox: '0 0 32 70', width: 32, height: 70, 'aria-hidden': 'true' });
  s.appendChild(svg('rect', { x: 3, y: 6, width: 26, height: 44, rx: 4, fill: '#E4E7EB',
                              stroke: '#C3CAD3' }));
  s.appendChild(svg('rect', { x: 8, y: 0, width: 16, height: 8, rx: 2.5, fill: '#C9CFD7' }));
  s.appendChild(svg('path', { d: 'M11 50 h10 l-2.6 10 h-4.8 Z', fill: '#B9C0C9' }));
  s.appendChild(svg('path', { d: 'M14.2 60 h3.6 l-.9 5 h-1.8 Z', fill: '#8C949E' }));
  if (color) {
    s.appendChild(svg('rect', { x: 9, y: 14, width: 14, height: 26, rx: 3, fill: color }));
  }
  wrap.appendChild(s);
  if (label) wrap.appendChild(el('span', 'ace-tool-label', label));
  return wrap;
}

/* ---- the tubes ----------------------------------------------------------- */

/**
 * Every bay drops to a manifold; the manifold runs to the head's inlet.
 *
 * Measured after layout, not computed from the model, because the tube moves when the
 * column width does and no state signature can see that. Drawn as a grey casing with a
 * lighter core, and the ONE lane that is actually feeding the head gets the filament's
 * own colour laid over it - which is how the Device page says "this is the spool that is
 * in the nozzle right now".
 */
export function drawTubes(host, { inlet, coreColour = null, fedIndex = 0 } = {}) {
  const wire = host.querySelector('.ace-wire');
  const box = host.querySelector('.ace-box');
  const tool = host.querySelector('.ace-tool');
  if (!wire || !box || !tool) return;
  const R = host.getBoundingClientRect();
  if (!R.width) return;

  const places = Array.from(host.querySelectorAll('.place'));
  if (!places.length) return;
  const tr = tool.getBoundingClientRect();
  const inX = inlet != null ? inlet : r1(tr.left + tr.width / 2 - R.left);
  const inY = r1(tr.top - R.top);
  const manY = r1(box.getBoundingClientRect().bottom - R.top + 7);
  const xs = places.map((p) => {
    const q = p.getBoundingClientRect();
    return r1(q.left + q.width / 2 - R.left);
  });
  const from = r1(places[0].getBoundingClientRect().bottom - R.top);

  const geom = [R.width, R.height, inX, inY, manY, from, coreColour, xs.join(',')].join('|');
  if (wire.dataset.geom === geom) return;
  wire.dataset.geom = geom;
  wire.textContent = '';
  wire.setAttribute('viewBox', `0 0 ${r1(R.width)} ${r1(R.height)}`);

  const tube = (d, w) => {
    wire.appendChild(svg('path', { d, fill: 'none', stroke: '#C9C9C9', 'stroke-width': w,
                                   'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    wire.appendChild(svg('path', { d, fill: 'none', stroke: '#EFF1F3', 'stroke-width': w - 2,
                                   'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  };

  const lo = Math.min(...xs), hi = Math.max(...xs);
  if (xs.length > 1) {
    tube(`M${lo} ${manY} H${hi}`, 6);
    xs.forEach((x) => tube(`M${x} ${from} V${manY}`, 5));
  } else {
    tube(`M${xs[0]} ${from} V${manY}`, 5);
  }
  const mid = r1((lo + hi) / 2);
  tube(`M${mid} ${manY} V${manY + 6} H${inX} V${inY}`, 5);

  if (coreColour) {
    const fx = xs[Math.min(fedIndex, xs.length - 1)];
    wire.appendChild(svg('path', {
      d: `M${fx} ${from} V${manY} H${mid} V${manY + 6} H${inX} V${inY}`,
      fill: 'none', stroke: coreColour, 'stroke-width': 2.6, 'stroke-linecap': 'round',
      'stroke-linejoin': 'round' }));
  }
}

const r1 = (n) => Math.round(n * 10) / 10;

/* ---- verdict words ------------------------------------------------------- */

/*
 * One word per verdict, and they are the page's words rather than the model's field
 * names. `unchecked` never says "unchecked" on screen: it says what was not checked.
 */
export const VERDICT = {
  agrees:    { word: 'Ready',        cls: 'ok' },
  differs:   { word: 'Wrong spool',  cls: 'bad' },
  unsure:    { word: 'Not named',    cls: 'warn' },
  unchecked: { word: 'Not reported', cls: 'muted' },
};

export { ACE_ART };
