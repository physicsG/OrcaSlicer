/*
 * filament-view.js - the Filament panel's DOM.
 *
 * The panel has two shapes, and which one it draws is decided by the machine rather
 * than by a setting:
 *
 *   no `ace` object   the four slots the page always drew, on the bundle's own extruder
 *                     artwork. A U1 without the multiACE plugin has no ACE to describe
 *                     and no macro to send, so it gets the panel it had.
 *   an `ace` object   four toolhead cards in two columns, each with its own header
 *                     choosing what feeds that head, the source drawn under it, and a
 *                     tube from the bay to the head's inlet.
 *
 * The card is settled in docs/u1-webui/02-device-page/10-multiace-filament.md, decided
 * across five interactive studies. What is worth carrying here rather than looking up:
 *
 *   The toolhead carries no filament identity. No colour, no material name, no pencil on
 *   the artwork - filament belongs to the SOURCE, and the head's copy of it was the one
 *   that could go stale. What the head has of its own is a sensor marker, which the
 *   printer reports properly in four positions along the path plus a fault.
 *
 *   A bay is drawn as a head: `.slot`'s own 36px disc over its 58x19 name pill. It is
 *   the same statement about the same substance at the other end of one tube.
 *
 *   The cabinet is two halves - #EEEEEE over #CECECE, Orca's own AMS neutrals - with the
 *   seam running THROUGH the roll as a hard stop. Splitting the bay across the halves is
 *   what made the shipped bay affordable: with both in the upper half the box was 71px
 *   and a bay had to shrink to 26/52.
 *
 *   Everything sits on one centred axis, so the tube that matters is vertical. That is
 *   asserted arithmetically in run_webkit.py, not looked at: an inherited
 *   `align-items: flex-start` once left every card silently left-aligned and no
 *   screenshot said so.
 *
 * The body must fit 456px at 1920x1080 - measured, not estimated - and `.panel-body` is
 * `overflow: hidden`, so a body past it is clipped in silence. The layout below measures
 * 455.
 */
'use strict';

import { el, icon } from '../../../core/dom.js';
import { cssColor, isDarkColor } from '../../../../../shared/js/protocol.js';
// Everything about the ACE comes from one module - see shared/js/multiACE.js for why.
import { ACE, ACE_MODES, ACE_MODE_LABELS, DRY_TEMPS, DRY_HOURS, DRY_LIMITS,
         DRY_MINUTES_PER_HOUR, AUTO_DRY_THRESHOLDS,
         aceBayAddr, humidityLevel, mergeAceBays }
  from '../../../../../shared/js/multiACE.js';
import { keyedList, rebuildOn } from '../../../core/render.js';
import { openDialog, openMenu } from '../../../core/overlay.js';

/** The toolhead artwork, at half. 64x140 becomes 32x70, which is what fits twice over. */
const HEAD_SCALE = 0.5;

/**
 * What the head's own sensor says, and the field it says it with.
 *
 * `filament_feed left|right` -> `extruder0..3` gives four positions along the path plus
 * a fault, parsed in state.js's feedChannels() and shown, until now, nowhere but a
 * dialog.
 */
const SENSOR = {
  at:   ['Filament at the extruder', 'filament_at_extruder: true'],
  tube: ['Filament in the tube', 'filament_in_toolhead: true, filament_at_extruder: false'],
  none: ['No filament detected', 'filament_detected: false'],
  err:  ['Feed error', 'channel_error'],
};

/**
 * Where a bay's name came from, and therefore what may be done to it.
 *
 * A spool that identified itself over RFID carries vendor, type, colour and its own
 * temperatures, and none of that is ours to overwrite - so it gets an EYE. A value typed
 * in, or a bay that is occupied and unnamed, gets a PENCIL. Bambu draws exactly this
 * distinction on its own slots and `.slot` already ships the pencil.
 */
const PROV = {
  rfid:     { glyph: 'eye',    word: 'from the spool tag — read only' },
  override: { glyph: 'pencil', word: 'named in multiACE — edit it there' },
  derived:  { glyph: 'pencil', word: 'from what is loaded in the head — name it' },
  typed:    { glyph: 'pencil', word: 'typed in — edit' },
  unknown:  { glyph: 'pencil', word: 'occupied, not named — name it' },
};

/* ---------------------------------------------------------------- *
 * the panel body
 * ---------------------------------------------------------------- */

export function renderFilament(root, ctx) {
  const ace = ctx.state.ace();
  const slots = ctx.state.filaments();
  // One guard, and it is the one render.js provides: the two shapes share no children,
  // so switching between them has to clear rather than reconcile.
  rebuildOn(root, ace.present ? 'ace' : 'slots', (r) => {
    r.appendChild(el('div', ace.present ? 'ace-grid' : 'slot-row'));
  });
  const host = root.firstElementChild;
  if (!ace.present) { renderSlots(host, slots, ctx.handlers); return; }
  renderCards(host, ace, slots, ctx);
}

/* ---------------------------------------------------------------- *
 * no ACE: the four slots, exactly as they were
 * ---------------------------------------------------------------- */

/**
 * Four slots, drawn on the bundle's own extruder artwork.
 *
 * Values come from `print_task_config` - the same object the print-processing
 * popup edits. See docs/u1-webui/00-shared/01-shared-models.md
 */
function renderSlots(root, slots, handlers) {
  keyedList(root, slots, {
    key: (f, i) => i,
    // What the card DRAWS, and only that. `f.tag` is the RFID record, an object, and
    // it went into the signature whole - where it stringified to "[object Object]" for
    // every tagged spool alike, so swapping one tagged spool for another would not have
    // rebuilt the card. All the card shows of it is that there is one.
    sig: (f) => [f.loaded ? 1 : 0, f.type, f.subType, f.vendor, f.color,
                 f.tag ? 1 : 0].join(':'),
    create: (f, i) => {
      const css = cssColor(f.color);
      const slot = el('button', 'slot');
      slot.title = f.loaded
        ? `Slot ${i + 1}: ${[f.vendor, f.type, f.subType].filter(Boolean).join(' ')}`
        : `Slot ${i + 1}: empty`;

      const dot = el('div', 'dot', String(i + 1));
      if (f.loaded) {
        dot.dataset.loaded = '1';
        dot.style.background = css || '#C4C4C4';
        // keep the number legible on dark filament
        dot.style.color = isDarkColor(f.color) ? '#fff' : '#333';
      }
      slot.appendChild(dot);
      slot.appendChild(el('div', 'bar', f.loaded ? f.type : '/'));
      // a spool that identified itself is worth distinguishing from one typed in by hand
      if (f.tag) slot.appendChild(el('span', 'slot-tag', 'RFID'));
      slot.appendChild(icon('iconFilamentEdit', 'pencil'));
      slot.onclick = () => editSlot(i, f, handlers);
      return slot;
    },
  });
}

/* ---------------------------------------------------------------- *
 * an ACE: four toolhead cards
 * ---------------------------------------------------------------- */

/** What feeds head `i`, with anything asked for and not yet confirmed showing instead. */
function askedSource(ace, pending, i) {
  const h = ace.heads[i];
  const mirror = h.source === 'ace' ? `ace:${h.unitIndex}` : h.source;
  return pending.resolve(`ace-src-${i}`, mirror);
}

/** Which heads a unit feeds. One unit may feed several; the reverse is not reported. */
const usersOf = (ace, u) =>
  ace.heads.filter((h) => h.source === 'ace' && h.unitIndex === u).map((h) => h.index);

function renderCards(grid, ace, slots, ctx) {
  keyedList(grid, ace.heads, {
    key: (h) => h.index,
    sig: (h) => cardSig(ace, slots, ctx.pending, h.index, ctx.store.aceBays),
    create: (h) => card(ace, slots, ctx, h.index),
  });
  drawTubes(grid);
}

/**
 * Everything the card draws, and only that.
 *
 * It has to include the resolved source rather than the machine's, or a switch flipped
 * by the user would not repaint until the printer agreed - which for a load is minutes.
 */
function cardSig(ace, slots, pending, i, overrides) {
  const src = askedSource(ace, pending, i);
  const h = ace.heads[i];
  const u = h.source === 'ace' ? ace.units[h.unitIndex] : null;
  const sp = h.loaded || slots[i];
  return [
    ace.mode, ace.unitCount, src.value, src.state,
    usersOf(ace, h.unitIndex).join('-'),
    h.bay, sensorOf(slots[i]),
    sp ? [sp.material || sp.type, sp.subType, sp.vendor, sp.color].join(',') : '-',
    u ? [u.id, u.model, u.humidity, u.temperature, u.dryer.running,
         u.dryer.doneMin, u.dryer.totalMin,
         mergeAceBays(u, overrides)
           .map((b) => [b.occupied ? 1 : 0, b.material, b.color, b.source].join('')).join('/'),
        ].join(':') : '-',
    pending.resolve(`ace-load-${i}`, h.bay == null ? '' : aceBayAddr(h.unitIndex, h.bay)).state,
  ].join('|');
}

function sensorOf(f) {
  const feed = f && f.feed;
  if (!feed) return f && f.loaded ? 'at' : 'none';
  if (feed.error) return 'err';
  if (feed.atExtruder) return 'at';
  if (feed.inToolhead || feed.inAce) return 'tube';
  return 'none';
}

function card(ace, slots, ctx, i) {
  const h = ace.heads[i];
  const src = askedSource(ace, ctx.pending, i);
  const onAce = String(src.value).startsWith('ace:');
  const unit = onAce ? ace.units[Number(String(src.value).slice(4))] : null;
  const shared = unit ? usersOf(ace, unit.index).filter((x) => x !== i) : [];

  const bays = unit ? mergeAceBays(unit, ctx.store.aceBays) : null;

  const c = el('div', 'ace-card');
  if (unit) c.classList.add('is-ace');
  if (shared.length) c.classList.add('is-shared');
  c.appendChild(cardHead(ace, ctx, i, src, unit, shared, bays));

  const body = el('div', 'ace-body');
  const spool = unit ? h.loaded : slots[i];
  body.appendChild(unit ? cabinet(ctx, i, unit, bays, h.bay) : feeder(ctx, i, src.value, spool));
  body.appendChild(el('div', 'ace-lane'));
  body.appendChild(head(slots[i], i));

  // The tube layer paints BEHIND the cabinet and is appended last, so it also paints
  // over the toolhead's inlet - which is where it is meant to land.
  const wire = svg('svg', { class: 'ace-wire', 'aria-hidden': 'true' });
  const core = spool ? cssColor(spool.color) : null;
  if (core) wire.dataset.core = core;
  if (src.value === 'manual') wire.dataset.none = '1';
  body.appendChild(wire);
  c.appendChild(body);
  return c;
}

/**
 * Two lines: the toolhead and what feeds it, then the unit itself.
 *
 * The second line exists because the first has no room for the three things that are
 * not optional information - which ACE it is, how wet it is, and whether it is drying -
 * and a card with no ACE names its module there instead of holding an empty spacer,
 * which alignment required anyway.
 */
function cardHead(ace, ctx, i, src, unit, shared, bays) {
  const hd = el('div', 'ace-head');
  const r1 = el('div', 'ace-hrow');
  r1.appendChild(el('span', 'ace-name', `Toolhead ${i + 1}`));
  r1.appendChild(el('span', 'spacer'));
  r1.appendChild(sourceSelect(ace, ctx, i, src));
  const more = el('button', 'icon-only ace-more', '⋯');
  more.type = 'button';
  more.title = unit ? 'Load, unload, swap, edit' : 'Load, unload, edit';
  more.onclick = (e) => { e.stopPropagation(); openHeadMenu(more, ace, ctx, i, unit); };
  r1.appendChild(more);
  hd.appendChild(r1);
  hd.appendChild(unit ? unitStrip(ctx, unit, shared, bays) : feederStrip(i, src.value));
  return hd;
}

/**
 * A list, not an icon switch.
 *
 * The first study gave each head a feeder/ACE/manual icon triple: 102px wide, and unable
 * to name WHICH ACE. With four units the question has six answers, so it is a list.
 */
function sourceSelect(ace, ctx, i, src) {
  const sel = el('select', 'ace-src');
  const opts = [['feeder', 'Default feeder']];
  ace.units.forEach((u) => opts.push([`ace:${u.index}`, `ACE ${u.id}`]));
  opts.push(['manual', 'Manual']);
  opts.forEach(([v, t]) => {
    const o = el('option', null, t);
    o.value = v;
    if (v === src.value) o.selected = true;
    sel.appendChild(o);
  });
  // Documented "head mode only". Disabled with the reason showing, never hidden: a
  // control that vanishes leaves no way to find out why it is not there.
  const off = ace.mode !== 'head';
  sel.disabled = off;
  sel.title = off
    ? `${ACE.SET_HEAD_FEEDER} and ${ACE.SET_HEAD_ACE} are documented "head mode only". `
      + `The machine is in ${ace.mode} mode.`
    : (src.state === 'sent' ? `Waiting for the machine to confirm ${src.asked}`
                            : 'What feeds this toolhead');
  if (src.state) sel.dataset.pend = src.state;
  sel.setAttribute('aria-label', `Source for Toolhead ${i + 1}`);
  sel.onchange = () => ctx.handlers.setSource(i, sel.value);
  return sel;
}

function unitStrip(ctx, u, shared, bays) {
  const r = el('div', 'ace-strip');
  r.appendChild(aceBadge(bays || u.bays));
  const n = el('span', 'ace-unit');
  n.appendChild(el('b', null, `ACE ${u.id}`));
  n.appendChild(document.createTextNode(` · ${u.model}`));
  n.title = [u.model, u.firmware].filter(Boolean).join(' ')
    + (u.connected ? '' : ' — not answering')
    + (shared.length ? ` · also feeds ${shared.map((x) => `Toolhead ${x + 1}`).join(', ')}`
                     : '');
  r.appendChild(n);
  r.appendChild(el('span', 'spacer'));
  r.appendChild(humidityPill(u, shared));
  r.appendChild(dryChip(ctx, u));
  return r;
}

/**
 * `AMSHumidity`'s own shape: two readings and one divider.
 *
 * Untinted on purpose. The tinted variant said the same thing as the number and made a
 * reading that is usually fine look like a warning.
 */
function humidityPill(u, shared) {
  const p = el('span', 'ace-hum');
  const lvl = humidityLevel(u.humidity);
  p.title = `ACE ${u.id} · ${num(u.humidity, '%')} RH · ${num(u.temperature, '°C')} inside`
    + (lvl ? ` · hum_level${lvl}` : '')
    + (shared.length ? ` · shared with ${shared.length} other head${shared.length > 1 ? 's' : ''}`
                     : '');
  if (shared.length) {
    const m = el('span', 'ace-share', '⇄');
    p.appendChild(m);
  }
  p.appendChild(el('span', null, num(u.humidity, '%')));
  p.appendChild(el('span', 'ace-sep'));
  p.appendChild(el('span', null, num(u.temperature, '°C')));
  return p;
}

/**
 * The chip offers *Dry* while it is idle and reports elapsed of total while it runs -
 * where you are AND how long it was set for, in 8px more than "2 h 41 m left". It is the
 * only thing that opens the dialog.
 */
function dryChip(ctx, u) {
  const d = u.dryer;
  const asked = ctx.pending.resolve(`ace-dry-${u.index}`, d.running);
  const running = !!asked.value;
  const b = el('button', 'ace-dry' + (running ? ' is-running' : ''));
  b.type = 'button';
  b.appendChild(el('span', null, running ? dryLabel(d) : 'Dry'));
  b.title = running
    ? `Drying${d.target ? ` to ${d.target} °C` : ''}`
      + (d.remainingMin != null ? ` · ${hm(d.remainingMin)} left` : '')
      + (d.status ? ` · status ${d.status}` : '')
      + `. Stop with ${ACE.DRY_STOP} ACE=${u.index}`
    : `${ACE.DRY} ACE=${u.index} TEMP= DURATION= (minutes) — automatic above a humidity `
      + `is ${ACE.SET_AUTO_DRY}`
      + (u.autoDry.enabled ? `, on above ${u.autoDry.rhStart} %` : '');
  b.onclick = (e) => { e.stopPropagation(); openDryer(ctx, u); };
  return b;
}

const dryLabel = (d) => (d.doneMin != null && d.totalMin != null)
  ? `${hm(d.doneMin)} / ${hm(d.totalMin)}`
  : (d.remainingMin != null ? `${hm(d.remainingMin)} left` : 'Drying');

function feederStrip(i, source) {
  const r = el('div', 'ace-strip');
  r.appendChild(moduleBadge());
  const n = el('span', 'ace-unit');
  const manual = source === 'manual';
  n.appendChild(el('b', null, manual ? 'Hand-fed' : 'Feeder'));
  n.appendChild(document.createTextNode(manual ? ' · bypass' : ` · channel ${(i % 2) + 1}`));
  n.title = manual
    ? `${ACE.SET_HEAD_MANUAL} — no ACE feed, retract, assist or RFID`
    : 'Automatic Filament Feeder Module — two channels per module. '
      + `${ACE.SET_HEAD_FEEDER} HEAD=${i} ENABLE=1`;
  r.appendChild(n);
  r.appendChild(el('span', 'spacer'));
  return r;
}

/* ---- the box, its bays, and the head ------------------------------- */

/**
 * The cabinet: two halves, and each half has a job.
 *
 * Spools above, materials named below, with the seam through the middle of every roll as
 * a hard colour stop. The box hugs its four spools rather than filling the card - at four
 * bays, full width was mostly empty grey, and the base drawn wider than the hood is what
 * makes it read as furniture.
 */
function cabinet(ctx, i, u, unitBays, fedBay) {
  const box = el('div', 'ace-box');
  const cab = el('div', 'ace-cab');
  const top = el('div', 'ace-cab-top');
  const bays = el('div', 'ace-bays');
  unitBays.forEach((b) => bays.appendChild(bay(ctx, i, u, b, b.index === fedBay)));
  top.appendChild(bays);
  cab.appendChild(top);
  box.appendChild(cab);
  return box;
}

/**
 * One bay: `.slot`'s own 36px disc over its 58x19 name pill, 6px apart.
 *
 * Nothing is drawn round it at rest. Anything permanent there either hides the seam that
 * runs through the roll or fights it, so the shape appears only under the pointer.
 */
function bay(ctx, i, u, b, fed) {
  const node = el('button', 'ace-bay');
  node.type = 'button';
  if (fed) node.classList.add('is-fed');
  if (b.occupied && !b.known) node.classList.add('is-unknown');
  node.title = b.occupied
    ? (b.known
        ? `${b.addr}: ${[b.material, b.subType].filter(Boolean).join(' ')}`
          + (b.vendor ? ` · ${b.vendor}` : '')
          + (b.sku ? ` · ${b.sku}` : '')
          + ` — ${(PROV[b.source] || PROV.unknown).word}`
        : `${b.addr}: occupied, filament not known — the raw slot carries no material, `
          + 'brand or tag')
    : `${b.addr}: empty`;
  node.setAttribute('aria-label', node.title);

  const col = b.occupied ? (b.known ? cssColor(b.color) : null) : null;
  const disc = el('span', 'ace-disc', b.addr);
  if (col) {
    disc.dataset.loaded = '1';
    disc.style.background = col;
    disc.style.color = isDarkColor(col) ? '#fff' : '#333';
  } else if (b.occupied) {
    // Occupied and unnamed is a solid neutral, never the checkerboard - that is this
    // page's word for EMPTY, and drawing it here would be a lie in the other direction.
    disc.dataset.loaded = '1';
    disc.style.background = '#B7BDC6';
  }
  node.appendChild(disc);
  node.appendChild(el('span', 'ace-chip', b.occupied ? (b.material || '?') : '/'));
  if (b.occupied) node.appendChild(provMark(b));
  node.onclick = () => confirmLoad(ctx, i, u, b);
  return node;
}

function provMark(b) {
  const p = PROV[b.source] || PROV.typed;
  const w = el('span', 'ace-prov');
  w.appendChild(glyph(p.glyph));
  w.title = `${[b.material, b.vendor].filter(Boolean).join(' · ') || b.addr || ''} — ${p.word}`;
  return w;
}

/**
 * The stock feeder, in the module's own black and white.
 *
 * The same drawing as the cabinet - same seam rule, same proportions, same bay - in
 * #FFFFFF over #1F1F1F instead of #EEEEEE over #CECECE, because Snapmaker's Automatic
 * Filament Feeder Module is a different device and one glance should say so. A frame may
 * change horizontal padding and nothing else, or a feeder's spool stops sitting at an
 * ACE bay's exact height.
 */
function feeder(ctx, i, source, spool) {
  const box = el('div', 'ace-box');
  const f = el('div', 'ace-feed');
  const top = el('div', 'ace-feed-top');
  const row = el('div', 'ace-feed-row');
  const b = el('button', 'ace-bay');
  b.type = 'button';
  const what = source === 'manual' ? 'Hand-fed' : 'Stock feeder';
  const col = spool ? cssColor(spool.color) : null;
  const material = spool ? (spool.material || spool.type) : null;
  b.title = material ? `${what}: ${[material, spool.vendor].filter(Boolean).join(' · ')}`
                     : `${what}: nothing detected`;
  b.setAttribute('aria-label', b.title);
  const disc = el('span', 'ace-disc');
  if (col) {
    disc.dataset.loaded = '1';
    disc.style.background = col;
    disc.style.color = isDarkColor(col) ? '#fff' : '#333';
  }
  b.appendChild(disc);
  b.appendChild(el('span', 'ace-chip', material || '/'));
  // The spool at the head gets the same mark a bay does, and for the same reason: a tag
  // can be read and not written. `.slot` already drew the pencil half of this.
  if (material) {
    b.appendChild(provMark({ material, vendor: spool.vendor,
                             source: spool.tag ? 'rfid' : 'typed' }));
  }
  b.onclick = () => editSlot(i, spool || {}, ctx.handlers);
  row.appendChild(b);
  top.appendChild(row);
  f.appendChild(top);
  box.appendChild(f);
  return box;
}

/**
 * The head: artwork, and one marker.
 *
 * The dot is centred on the artwork's BODY - extruderBackground.svg draws that body
 * y=17.4..127.6 of its 64x140, so the middle is (32, 72.5) at whatever scale.
 */
function head(f, i) {
  const wrap = el('div', 'ace-toolwrap');
  const st = sensorOf(f);
  const t = el('div', 'ace-tool');
  t.style.setProperty('--s', HEAD_SCALE);
  t.title = `Toolhead ${i + 1} — ${SENSOR[st][0]}`;
  t.setAttribute('aria-label', t.title);
  const m = el('span', `ace-sensor is-${st}`);
  m.title = SENSOR[st][1];
  t.appendChild(m);
  wrap.appendChild(t);
  return wrap;
}

/* ---- the tube ------------------------------------------------------ *
 * Tubing, not a line: a #C9C9C9 casing with the filament's own colour as a core. The
 * casing is always there and the core only where there is filament, which settles
 * wired-versus-loaded without a second colour.
 *
 * The manifold sits BELOW the cabinet and the layer paints behind it, so a drop from a
 * bay disappears under the box and reappears beneath it - filament inside a machine is
 * not something to draw over the machine. Which bay is feeding stays legible because the
 * coloured core starts at that bay's x on the bar.
 *
 * Geometry is measured, so this runs after layout. It is memoised on the measurement
 * itself rather than on state: the tube moves when the column width does, which no state
 * signature can see, and rewriting four SVGs every frame is the churn render.js exists
 * to avoid.
 */
function drawTubes(grid) {
  grid.querySelectorAll('.ace-card').forEach((c) => {
    const body = c.querySelector('.ace-body');
    const wire = c.querySelector('.ace-wire');
    const tool = c.querySelector('.ace-tool');
    const box = c.querySelector('.ace-box');
    if (!body || !wire || !tool || !box) return;
    const R = body.getBoundingClientRect();
    if (!R.width) return;

    const bays = Array.from(c.querySelectorAll('.ace-bay'));
    const fed = c.querySelector('.ace-bay.is-fed') || bays[0];
    const core = wire.dataset.core || '';
    const tr = tool.getBoundingClientRect();
    const inlet = { x: r1(tr.left + 64 * HEAD_SCALE / 2 - R.left), y: r1(tr.top - R.top) };
    const manY = r1(box.getBoundingClientRect().bottom - R.top + 7);
    const xs = bays.map((b) => {
      const q = b.getBoundingClientRect();
      return r1(q.left + q.width / 2 - R.left);
    });
    const from = fed ? r1(fed.getBoundingClientRect().bottom - R.top) : 0;
    const geom = [wire.dataset.none || '', R.width, R.height, inlet.x, inlet.y,
                  manY, from, core, xs.join(',')].join('|');
    if (wire.dataset.geom === geom) return;
    wire.dataset.geom = geom;
    wire.textContent = '';
    // Hand-fed is the one source with no tube: the spool is at the head and nothing
    // routes it. Drawing one would be inventing hardware.
    if (wire.dataset.none || !fed) return;
    wire.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`);

    const tube = (d, w) => {
      wire.appendChild(svg('path', { d, fill: 'none', stroke: '#C9C9C9', 'stroke-width': w,
                                     'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      wire.appendChild(svg('path', { d, fill: 'none', stroke: '#EFF1F3', 'stroke-width': w - 2,
                                     'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    };
    const lit = (d) => wire.appendChild(svg('path', { d, fill: 'none', stroke: core,
                                                      'stroke-width': 2.6,
                                                      'stroke-linecap': 'round' }));
    const mid = r1((Math.min(...xs) + Math.max(...xs)) / 2);
    if (bays.length > 1) {
      tube(`M${Math.min(...xs)} ${manY} H${Math.max(...xs)}`, 6);
      xs.forEach((x) => tube(`M${x} ${from} V${manY}`, 5));
      if (core) {
        const fx = xs[bays.indexOf(fed)];
        lit(`M${fx} ${from} V${manY}`);
        lit(`M${fx} ${manY} H${mid}`);
      }
    }
    const leg = `M${mid} ${bays.length > 1 ? manY : from} V${inlet.y}`;
    tube(leg, 6);
    if (core) lit(leg);
    wire.appendChild(svg('circle', { cx: inlet.x, cy: inlet.y, r: 3.2,
                                     fill: core || '#C9C9C9' }));
  });
}

/* ---------------------------------------------------------------- *
 * the two menus, and their two scopes
 * ---------------------------------------------------------------- */

/**
 * A toolhead's own menu: load, unload, swap, and the filament's own record.
 *
 * Swap is absent on a stock feeder because there are no other bays to swap to, and
 * Unload is greyed on an empty head rather than offered.
 */
function openHeadMenu(anchor, ace, ctx, i, unit) {
  const h = ace.heads[i];
  // `filaments()` returns a record per slot whether or not anything is in it, so the
  // truthiness of that object says nothing - `loaded` is the field that does. Reading the
  // object left Unload offered on an empty head and every Load labelled Reload.
  const f = ctx.state.filaments()[i];
  const loaded = unit ? h.loaded : (f && f.loaded ? f : null);
  const tagged = !!(loaded && (loaded.rfid || loaded.tag));
  const items = [
    { label: loaded ? 'Reload' : 'Load', icon: 'refresh',
      cmd: `${ACE.LOAD_HEAD} HEAD=${i}${unit ? ` ACE=${unit.index}` : ''}`,
      onClick: () => ctx.handlers.loadHead(i, unit ? unit.index : undefined) },
    { label: 'Unload', icon: 'iconFilamentCheck', muted: !loaded,
      cmd: `${ACE.UNLOAD_HEAD} HEAD=${i}`,
      onClick: () => { if (loaded) ctx.handlers.unloadHead(i); } },
  ];
  if (unit) {
    items.push({ label: 'Swap to another bay…', icon: 'iconFilamentEdit',
                 cmd: `${ACE.SWAP_HEAD} HEAD=${i} ACE=${unit.index} SLOT=<n>`,
                 title: 'Click the bay you want, in the cabinet on this card',
                 muted: true });
  }
  items.push(null);
  items.push({
    label: tagged ? 'View this filament' : 'Edit this filament…',
    icon: 'iconFilamentEdit',
    title: tagged ? 'from the spool tag — read only' : 'print_task_config',
    onClick: () => editSlot(i, ctx.state.filaments()[i], ctx.handlers),
  });
  openMenu(anchor, items, { head: `Toolhead ${i + 1}` });
}

/**
 * The panel's own menu: the settings a person sets once.
 *
 * On the face of the panel these would bury the four things that change daily. Two `...`
 * a few pixels apart mean two different scopes, so each menu names its own on the way
 * open - the cheapest honest fix, and it costs a line that was going to be there anyway.
 */
export function openAceSettings(anchor, ctx) {
  if (!ctx.state.ace().present) {
    openMenu(anchor, [{ label: 'This printer reports no ACE', icon: 'settings',
                        muted: true,
                        title: '`ace` is absent from machine state, so there is no unit '
                             + 'to configure and no macro to send' }],
             { head: 'This printer' });
    return;
  }
  openMenu(anchor, [
    { label: 'Unload every toolhead', icon: 'iconFilamentCheck', cmd: ACE.UNLOAD_ALL,
      onClick: () => ctx.handlers.unloadAllHeads() },
    null,
    { label: 'Flush length…', icon: 'settings',
      cmd: `${ACE.SET_PURGE} LENGTH=<mm> | RESET=1`,
      onClick: () => ctx.handlers.setPurge() },
    { label: 'Confirm before load and unload', icon: 'settings',
      cmd: `${ACE.SET_CONFIRM} ENABLE=0|1`,
      onClick: () => ctx.handlers.setConfirmCommands() },
    { label: 'Spoolman…', icon: 'settings', cmd: `${ACE.SET_SPOOLMAN} URL= AUTO=0|1`,
      onClick: () => ctx.handlers.setSpoolman() },
    null,
    { label: 'Clear the head→bay bookkeeping', icon: 'delete',
      cmd: `${ACE.CLEAR_HEADS} [HEAD=n]`,
      onClick: () => ctx.handlers.clearHeads() },
  ], { head: 'This printer' });
}

/**
 * The three modes, as a list rather than as a control that cycles.
 *
 * Cycling would send SET_ACE_MODE twice to get from normal to head, and a mode change is
 * not a thing to do twice by accident.
 */
export function openAceModeMenu(anchor, ctx) {
  const ace = ctx.state.ace();
  const now = ctx.pending.resolve('ace-mode', ace.mode).value;
  openMenu(anchor, ACE_MODES.map((m) => ({
    label: ACE_MODE_LABELS[m] + (m === now ? '  ✓' : ''),
    icon: 'settings',
    cmd: `${ACE.SET_MODE} MODE=${m}`,
    muted: m === now,
    onClick: () => { if (m !== now) ctx.handlers.setAceMode(m); },
  })), { head: 'ACE mode' });
}

/** What the header reports about the machine, beside the panel's own title. */
export function aceStatus(ctx) {
  const ace = ctx.state.ace();
  if (!ace.present) return 'no ACE';
  const bits = [ace.unitCount === 0 ? 'no ACE unit'
              : ace.unitCount === 1 ? '1 ACE unit'
              : `${ace.unitCount} ACE units · ${ace.unitCount * 4} bays`];
  if (ace.mode && ace.mode !== 'head') bits.push(`${ace.mode} mode`);
  if (ace.swapping) bits.push('swapping');
  return bits.join(' · ');
}

export function aceModeLabel(ctx) {
  const ace = ctx.state.ace();
  const m = ctx.pending.resolve('ace-mode', ace.mode).value;
  return `ACE mode · ${ACE_MODE_LABELS[m] || '—'}`;
}

/* ---------------------------------------------------------------- *
 * loading a bay
 * ---------------------------------------------------------------- */

/**
 * Clicking a bay loads it, behind a confirmation.
 *
 * A swap is a physical operation of about three minutes that purges filament, and the
 * bays sit under the pointer while someone is reading the card. The dialog names the
 * macro and its arguments, so what is about to happen is legible before it happens.
 */
function confirmLoad(ctx, i, u, b) {
  if (!b.occupied) {
    openDialog({
      title: `${b.addr} is empty`,
      build: (bd) => bd.appendChild(el('p', 'ms-note',
        'The gate sensor reports nothing in this bay, so there is nothing to load.')),
      confirmLabel: 'Close',
      onConfirm: () => true,
    });
    return;
  }
  openDialog({
    title: `Load ${b.addr} into Toolhead ${i + 1}?`,
    build: (bd) => {
      bd.appendChild(el('p', 'ms-note',
        `${b.known ? [b.material, b.subType, b.vendor].filter(Boolean).join(' · ')
                   : 'This bay is occupied and the machine does not name what is in it'}.`));
      bd.appendChild(el('p', 'ms-note',
        'The machine unloads whatever is at the head first and purges into the dock. '
        + 'It takes minutes, and the panel will keep showing what was asked for until '
        + 'the machine reports the change.'));
      bd.appendChild(el('div', 'dry-cmd',
        `${ACE.SWAP_HEAD} HEAD=${i} ACE=${u.index} SLOT=${b.index}`));
    },
    confirmLabel: 'Load',
    onConfirm: () => ctx.handlers.loadBay(i, u.index, b.index),
  });
}

/* ---------------------------------------------------------------- *
 * the dryer
 * ---------------------------------------------------------------- */

/**
 * Bambu's *AMS Dryness Control*, rebuilt in this page's own dialog chrome.
 *
 * Taken apart, that dialog answers four questions - how wet is it, is it drying, how
 * hard, for how long - and it answers the first AS A QUANTITY, with a droplet filled to
 * the reading, which is most of why it works.
 *
 * Two things it has not got and the U1 needs: `ACE_SET_AUTO_DRY`, which starts the dryer
 * by itself above a humidity; and each of `ACE_DRY`'s two arguments offered as four
 * presets PLUS one empty field, in the same row, because the macro takes a number and
 * not a menu - a spool whose tag says 65 °C for 8 h should not have to be rounded to the
 * nearest chip. A preset OR a typed value, never both: the moment the field holds a
 * number the preset stops being highlighted, because the preset is no longer what would
 * be sent.
 *
 * The running dialog is the SAME dialog. An amber droplet was tried and taken out - it
 * made the reading you came for change meaning at the moment you came for it.
 */
function openDryer(ctx, u) {
  // Auto-dry opens on the machine's own setting rather than on Off: it is reported, and
  // a control that shows a value the machine does not hold is a control that lies.
  const set = { temp: DRY_TEMPS[1], hours: DRY_HOURS[1], tempCustom: '', hoursCustom: '',
                auto: u.autoDry.enabled ? u.autoDry.rhStart : null };
  const eff = (k) => (set[`${k}Custom`] !== '' ? Number(set[`${k}Custom`]) : set[k]);
  const running = ctx.pending.resolve(`ace-dry-${u.index}`, u.dryer.running).value;
  let cmdLine;

  // What would actually go on the wire, which is not what the panel is showing: the
  // duration is offered in hours and the macro takes minutes.
  const script = () => (running ? `${ACE.DRY_STOP} ACE=${u.index}`
    : `${ACE.DRY} ACE=${u.index} TEMP=${eff('temp')} `
      + `DURATION=${Math.round(eff('hours') * DRY_MINUTES_PER_HOUR)}`
      + (set.auto ? `  ·  ${ACE.SET_AUTO_DRY} ACE=${u.index} ENABLE=1 RH_START=${set.auto}`
                  : `  ·  ${ACE.SET_AUTO_DRY} ACE=${u.index} ENABLE=0`));

  openDialog({
    title: 'Filament drying',
    wide: true,
    build: (b) => {
      b.classList.add('dryer');
      const sub = el('p', 'dry-sub',
        `ACE ${u.id} · ${[u.model, u.firmware].filter(Boolean).join(' ')}`);
      b.appendChild(sub);

      const cols = el('div', 'dry-cols');
      const c1 = el('div', 'dry-c1');
      const drop = el('div', 'dry-drop');
      drop.appendChild(droplet(u.humidity));
      const lvl = humidityLevel(u.humidity);
      drop.title = `${num(u.humidity, '%')} RH${lvl ? ` — hum_level${lvl}` : ''}`;
      c1.appendChild(drop);
      // One word, whatever the state. "Drying · 1 h 19 m / 4 h" wraps in this column and
      // grows the block under the droplet, which reads as the droplet having moved.
      c1.appendChild(el('div', 'dry-state', running ? 'Drying' : 'Idle'));
      const reads = el('div', 'dry-reads');
      reads.title = `${num(u.humidity, '%')} RH and ${num(u.temperature, '°C')} inside `
        + `ACE ${u.id} — not the room`;
      [['Humidity', num(u.humidity, '%')],
       ['Temperature', num(u.temperature, '°C')]].forEach(([k, v]) => {
        const r = el('div', 'dry-read');
        r.appendChild(el('span', 'dry-k', k));
        r.appendChild(el('span', 'dry-v', v));
        reads.appendChild(r);
      });
      c1.appendChild(reads);
      cols.appendChild(c1);

      const c2 = el('div', 'dry-c2');
      const fields = [];
      fields.push(valueField('Temperature', DRY_TEMPS, 'temp', ' °C', DRY_LIMITS.temp));
      fields.push(valueField('Duration', DRY_HOURS, 'hours', ' h', DRY_LIMITS.hours));
      fields.forEach((f) => c2.appendChild(f.node));

      const auto = el('div', 'dry-field');
      auto.appendChild(el('span', 'dry-k', 'Automatically, above'));
      const seg = el('span', 'dry-seg');
      [null].concat(AUTO_DRY_THRESHOLDS).forEach((v) => {
        const o = el('span', 'dry-opt', v == null ? 'Off' : `${v} %`);
        if (v === set.auto) o.classList.add('is-on');
        o.onclick = () => {
          set.auto = v;
          Array.from(seg.children).forEach((x) => x.classList.remove('is-on'));
          o.classList.add('is-on');
          paint();
        };
        seg.appendChild(o);
      });
      auto.appendChild(seg);
      c2.appendChild(auto);
      cols.appendChild(c2);
      b.appendChild(cols);

      if (running && u.dryer.doneMin != null && u.dryer.totalMin != null) {
        b.appendChild(el('p', 'dry-note',
          `${hm(u.dryer.doneMin)} of ${hm(u.dryer.totalMin)}`
          + (u.dryer.target ? `, at ${u.dryer.target} °C.` : '.')));
      }
      cmdLine = el('div', 'dry-cmd');
      b.appendChild(cmdLine);
      paint();

      function paint() {
        fields.forEach((f) => f.paint());
        cmdLine.textContent = script();
      }

      /** Four presets and one empty field, in one row, because it is one choice. */
      function valueField(label, presets, key, suffix, [min, max]) {
        const f = el('div', 'dry-field');
        f.appendChild(el('span', 'dry-k', label));
        const g = el('span', 'dry-seg');
        const opts = presets.map((v) => {
          const o = el('span', 'dry-opt', v + suffix);
          o.onclick = () => { set[key] = v; set[`${key}Custom`] = ''; inp.value = ''; paint(); };
          g.appendChild(o);
          return o;
        });
        const inp = document.createElement('input');
        inp.className = 'dry-custom';
        inp.type = 'number';
        inp.min = String(min);
        inp.max = String(max);
        inp.placeholder = 'Custom';
        inp.setAttribute('aria-label', `${label}, custom value, ${min} to ${max}`);
        inp.title = `${min}–${max}${suffix}. Anything typed here is what gets sent, and `
          + 'the preset stops being highlighted.';
        // Repainted without rebuilding, so the field does not lose focus mid-keystroke -
        // the same reason core/render.js exists on the rest of the page.
        inp.oninput = () => { set[`${key}Custom`] = inp.value.trim(); paint(); };
        inp.onchange = () => {
          if (inp.value.trim() !== '') {
            // Past what the macro takes is clamped on commit, not refused.
            inp.value = String(Math.min(max, Math.max(min, Number(inp.value))));
            set[`${key}Custom`] = inp.value;
          }
          paint();
        };
        g.appendChild(inp);
        f.appendChild(g);
        return {
          node: f,
          paint: () => {
            const custom = set[`${key}Custom`] !== '';
            opts.forEach((o, k) => o.classList.toggle('is-on', !custom && presets[k] === set[key]));
            inp.classList.toggle('is-on', custom);
          },
        };
      }
    },
    confirmLabel: running ? 'Stop' : 'Start',
    onConfirm: () => {
      if (running) { ctx.handlers.stopDrying(u.index); return true; }
      ctx.handlers.startDrying(u.index, eff('temp'), eff('hours'));
      // Only when it differs from what the machine already holds - the dialog opens on
      // its value, so sending it back on every Start would be noise.
      const was = u.autoDry.enabled ? u.autoDry.rhStart : null;
      if (set.auto !== was) ctx.handlers.setAutoDry(u.index, set.auto);
      return true;
    },
  });
}

/**
 * A droplet filled to the reading.
 *
 * Orca buckets the same number into `hum_level1..5` to pick a glyph; this draws it
 * continuously and says the bucket in the title. The fill is a rectangle clipped to the
 * outline, and the clip id is unique per instance: a clipPath id resolves DOCUMENT-wide,
 * and two droplets sharing one had the second point into the first - which clips
 * nothing, so the fill drew as the bare rectangle it is.
 */
let dropSeq = 0;
function droplet(humidity) {
  const s = svg('svg', { width: 88, height: 104, viewBox: '0 0 88 104',
                         'aria-hidden': 'true' });
  const d = 'M44 6 C44 6 12 44 12 66 a32 32 0 0 0 64 0 C76 44 44 6 44 6 Z';
  const cid = `dry-clip-${++dropSeq}`;
  const defs = svg('defs', {});
  const cp = svg('clipPath', { id: cid });
  cp.appendChild(svg('path', { d }));
  defs.appendChild(cp);
  s.appendChild(defs);
  s.appendChild(svg('path', { d, fill: '#F5F6FA', stroke: '#C9CDD2', 'stroke-width': 1.5 }));
  const h = Math.max(0, Math.min(100, Number(humidity) || 0));
  const y = 104 - (h / 100) * 72;
  s.appendChild(svg('rect', { x: 0, y, width: 88, height: 104 - y, fill: '#7FB6E8',
                              'clip-path': `url(#${cid})` }));
  s.appendChild(svg('path', { d, fill: 'none', stroke: '#C9CDD2', 'stroke-width': 1.5 }));
  return s;
}

/* ---------------------------------------------------------------- *
 * the two badges
 * ---------------------------------------------------------------- */

/**
 * The ACE badge, filled with that unit's own bays, so the thing in the header is a
 * picture of the thing in the card. Geometry from docs/ace-mmu/16-ace-visuals.md.
 */
function aceBadge(bays) {
  const s = svg('svg', { width: 26, height: 16, viewBox: '0 0 44 26',
                         'aria-hidden': 'true', class: 'ace-badge' });
  s.appendChild(svg('rect', { x: 2, y: 1, width: 40, height: 20, rx: 3, fill: '#EEEEEE' }));
  bays.forEach((b, i) => s.appendChild(svg('rect', {
    x: 6 + i * 9, y: 4, width: 5, height: 14, rx: 2.5,
    fill: (b.occupied && cssColor(b.color)) || (b.occupied ? '#B7BDC6' : '#FFFFFF') })));
  s.appendChild(svg('rect', { x: 0, y: 20, width: 44, height: 5, rx: 1.5, fill: '#CECECE' }));
  return s;
}

/**
 * The feeder module's badge: the frame at badge size, white over black, on a rounded
 * SQUARE. The ACE's is 44x26 because a cabinet is wide; the module is not a cabinet, and
 * a wide badge for it only ever read as a squashed ACE.
 */
function moduleBadge() {
  const s = svg('svg', { width: 17, height: 17, viewBox: '0 0 24 24',
                         'aria-hidden': 'true', class: 'ace-badge ace-modbadge' });
  s.appendChild(svg('rect', { x: 1, y: 1, width: 22, height: 22, rx: 5, fill: '#FFFFFF' }));
  s.appendChild(svg('path', {
    d: 'M1 13 h22 v5 a5 5 0 0 1 -5 5 h-12 a5 5 0 0 1 -5 -5 Z', fill: '#1F1F1F' }));
  s.appendChild(svg('rect', { x: 1, y: 1, width: 22, height: 22, rx: 5, fill: 'none',
                              stroke: '#D9DDE3', 'stroke-width': 1 }));
  return s;
}

/** The eye and the pencil, inline so they take the mark's own colour on hover. */
function glyph(kind) {
  const s = svg('svg', { width: 13, height: 13, viewBox: '0 0 20 20',
                         'aria-hidden': 'true', class: 'ace-glyph' });
  const g = svg('g', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3,
                       'stroke-linejoin': 'round' });
  if (kind === 'eye') {
    g.appendChild(svg('path', { d: 'M1.8 10S4.7 5.2 10 5.2 18.2 10 18.2 10 15.3 14.8 10 14.8 1.8 10 1.8 10Z' }));
    g.appendChild(svg('circle', { cx: 10, cy: 10, r: 2.4 }));
  } else {
    g.appendChild(svg('path', { d: 'M13.4 3.6l3 3L7.6 15.4l-3.9.9.9-3.9z' }));
  }
  s.appendChild(g);
  return s;
}

/* ---------------------------------------------------------------- *
 * the filament slot editor
 * ---------------------------------------------------------------- */

/**
 * Filament slot editor.
 *
 * Laid out after Bambu Studio's "Materials Setting": what the filament IS at the top,
 * then what the machine knows about how to run it. The lower half is read-only on
 * purpose - nozzle limits come off the spool's RFID tag and pressure advance is
 * Klipper's own calibration, so presenting them as editable would be a lie. Slots
 * without a tag simply omit that block rather than showing a grid of zeros.
 */
function editSlot(index, f, handlers) {
  let type, vendor, color;
  const tag = f.tag;

  const row = (parent, label, value, hint) => {
    const r = el('div', 'ms-row');
    r.appendChild(el('span', 'ms-key', label));
    const v = el('span', 'ms-val', value);
    if (hint) v.title = hint;
    r.appendChild(v);
    parent.appendChild(r);
    return r;
  };

  openDialog({
    title: 'Materials Setting',
    build: (b) => {
      b.classList.add('materials');

      // --- identity ---
      const id = el('div', 'ms-block');
      const tRow = el('label', 'field');
      tRow.appendChild(el('span', 'field-label', 'Filament'));
      const tWrap = el('div', 'field-row');
      type = document.createElement('input');
      type.value = f.type || '';
      type.placeholder = 'PLA';
      type.setAttribute('list', 'ms-types');
      tWrap.appendChild(type);
      const dl = document.createElement('datalist');
      dl.id = 'ms-types';
      ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PVA', 'HIPS']
        .forEach((v) => { const o = document.createElement('option'); o.value = v; dl.appendChild(o); });
      tWrap.appendChild(dl);
      tRow.appendChild(tWrap);
      id.appendChild(tRow);

      const vRow = el('label', 'field');
      vRow.appendChild(el('span', 'field-label', 'Vendor'));
      const vWrap = el('div', 'field-row');
      vendor = document.createElement('input');
      vendor.value = f.vendor || '';
      vendor.placeholder = 'Generic';
      vWrap.appendChild(vendor);
      vRow.appendChild(vWrap);
      id.appendChild(vRow);

      const cRow = el('label', 'field');
      cRow.appendChild(el('span', 'field-label', 'Color'));
      const cWrap = el('div', 'field-row ms-color');
      color = document.createElement('input');
      color.type = 'color';
      color.value = cssColor(f.color) || '#CCCCCC';
      const swatch = el('span', 'ms-swatch');
      swatch.style.background = color.value;
      color.oninput = () => { swatch.style.background = color.value; };
      cWrap.appendChild(swatch);
      cWrap.appendChild(color);
      cRow.appendChild(cWrap);
      id.appendChild(cRow);
      b.appendChild(id);

      // --- what the spool says about itself ---
      if (tag) {
        b.appendChild(el('h4', 'ms-head', 'From the spool tag'));
        const g = el('div', 'ms-block');
        if (tag.subType) row(g, 'Series', tag.subType);
        row(g, 'Nozzle Temperature',
            (tag.nozzleMin != null && tag.nozzleMax != null)
              ? `${tag.nozzleMin} – ${tag.nozzleMax} °C` : '—',
            'min and max reported by the spool');
        if (tag.bedTemp) row(g, 'Bed Temperature', `${tag.bedTemp} °C`);
        if (tag.dryingTemp) {
          row(g, 'Drying', `${tag.dryingTemp} °C`
            + (tag.dryingTime ? ` · ${tag.dryingTime} h` : ''));
        }
        b.appendChild(g);
      } else if (f.loaded) {
        b.appendChild(el('div', 'ms-note',
          'This spool carries no RFID tag, so temperatures come from the profile.'));
      }

      // --- flow dynamics: Klipper's pressure advance is the K-factor analogue ---
      b.appendChild(el('h4', 'ms-head', 'Flow dynamics'));
      const fd = el('div', 'ms-block');
      row(fd, 'Pressure Advance',
          f.pressureAdvance != null ? f.pressureAdvance.toFixed(4) : '—',
          'Klipper’s pressure_advance for this toolhead - the same role Bambu’s Factor K plays');
      row(fd, 'Smooth Time',
          f.smoothTime != null ? `${f.smoothTime.toFixed(3)} s` : '—');
      b.appendChild(fd);

      // --- ACE feed path ---
      if (f.feed) {
        b.appendChild(el('h4', 'ms-head', 'Feed path'));
        const fp = el('div', 'ms-block');
        row(fp, 'Channel', f.feed.channelState || '—');
        row(fp, 'Detected', f.feed.detected ? 'yes' : 'no');
        row(fp, 'At extruder', f.feed.atExtruder ? 'yes' : 'no');
        if (f.feed.error) {
          const e = row(fp, 'Error', f.feed.error);
          e.dataset.severity = 'error';
        }
        b.appendChild(fp);
      }
    },
    confirmLabel: 'Confirm',
    onConfirm: () => handlers.setFilament(index, type.value.trim(), color.value,
                                          vendor.value.trim()),
  });
}

/* ---- small things -------------------------------------------------- */

const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

const r1 = (v) => Math.round(v * 10) / 10;

/** A reading the machine did not send is a dash, never a zero. */
const num = (v, unit) => (v == null ? '—' : `${v} ${unit}`);

/**
 * `2 h 41 m`, `41 m` under the hour, and `4 h` on the hour.
 *
 * The last one is not tidiness: the chip shares a 391px cell with the unit's name, its
 * model and a humidity pill, and `4 h 0 m` costs 26px that pushes the model into an
 * ellipsis for a reading that says nothing.
 */
function hm(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m} m`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${Math.floor(m / 60)} h`;
}
