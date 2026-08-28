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
import { ACE_MODES, ACE_MODE_LABELS, DRY_TEMPS, DRY_HOURS, DRY_LIMITS,
         DRY_MINUTES_PER_HOUR, AUTO_DRY_THRESHOLDS, NOT_DECLARED,
         aceBadge, aceGlyphSquare, aceBayAddr, humidityLevel, mergeAceBays,
         aceVerbs, channelStep, channelWord, headOccupied }
  from '../../../../../shared/js/multiACE.js';
import { keyedList, rebuildOn } from '../../../core/render.js';
import { openDialog, closeDialog, openMenu } from '../../../core/overlay.js';

/** The toolhead artwork, at half. 64x140 becomes 32x70, which is what fits twice over. */
const HEAD_SCALE = 0.5;



/**
 * What the head is holding, in words.
 *
 * It used to carry the field name alongside - `channel_action_state: load_finish` - on
 * the reasoning that naming the source was honest. It is honest and it is ours: a field
 * name says where the page READ something, which is not what a hover is for. Which field
 * answers this, and the measurement that picked it, is multiACE.js's headOccupied().
 */
const SENSOR = { at: 'Filament loaded', none: 'No filament loaded', err: 'Feed error' };

/**
 * Where a bay's name came from, and therefore what may be done to it.
 *
 * A spool that identified itself over RFID carries vendor, type, colour and its own
 * temperatures, and none of that is ours to overwrite - so it gets an EYE. A value typed
 * in, or a bay that is occupied and unnamed, gets a PENCIL. Bambu draws exactly this
 * distinction on its own slots and `.slot` already ships the pencil.
 */
const PROV = {
  rfid:     { glyph: 'eye',    word: 'spool tag · read only' },
  override: { glyph: 'pencil', word: 'named in multiACE' },
  derived:  { glyph: 'pencil', word: 'from the loaded filament' },
  typed:    { glyph: 'pencil', word: 'typed in' },
  unknown:  { glyph: 'pencil', word: 'not named' },
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
      // A spool that identified itself is worth distinguishing from one typed in by
      // hand, and the mark has to agree with what the click does: a tagged spool opens
      // read-only, so it wears the EYE. Every slot wore the pencil, tagged or not.
      if (f.tag) slot.appendChild(el('span', 'slot-tag', 'RFID'));
      const mark = f.tag ? glyph('eye') : icon('iconFilamentEdit', 'pencil');
      mark.classList.add('pencil');
      slot.appendChild(mark);
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
    h.bay, sensorOf(slots[i], headLoaded(ace, slots, i)),
    // The field occupancy is actually decided by. It is NOT `channelState` below: that
    // one settles back to `wait_insert` after an unload, so a signature holding only it
    // never changed when the head emptied - which is the repaint half of the same bug.
    (slots[i] && slots[i].feed && slots[i].feed.actionState) || '',
    // What the machine is doing to this head. It is in the signature because the card
    // DRAWS it - the step bar beside the toolhead - and a card whose signature omits
    // something it draws simply never repaints for it. The sensor mark above buckets
    // four positions into one word, so it cannot stand in for this: a whole swap runs
    // with `filament_at_extruder` unchanged.
    (slots[i] && slots[i].feed && slots[i].feed.channelState) || '',
    ace.bgHeads.join(','),
    sp ? [sp.material || sp.type, sp.subType, sp.vendor, sp.color].join(',') : '-',
    u ? [u.id, u.model, u.humidity, u.temperature, u.dryer.running,
         u.dryer.doneMin, u.dryer.totalMin,
         mergeAceBays(u, overrides)
           .map((b) => [b.occupied ? 1 : 0, b.material, b.color, b.source].join('')).join('/'),
        ].join(':') : '-',
    pending.resolve(`ace-load-${i}`, h.bay == null ? '' : aceBayAddr(h.unitIndex, h.bay)).state,
  ].join('|');
}

/**
 * Whether a head is holding filament. One question, one answer, and it lives in
 * multiACE.js beside the state table it is read from - see headOccupied() there for the
 * measurement that settled which field answers it.
 *
 * It has been wrong twice. `filaments()[i].loaded` is `print_task_config`, the slicer's
 * ASSIGNMENT to that slot, which a physical unload does not clear - so an emptied head
 * went on offering `Unload`. Reading `filament_at_extruder` instead fixed the simulator
 * and not the printer: that field was still true on both heads that had been emptied.
 *
 * Three places decided this independently before, and one of them had forgotten the
 * feeder case entirely. Deciding it once is most of the fix - and it is why the second
 * wrong answer was one line to correct.
 */
function headLoaded(ace, slots, i) {
  return headOccupied(slots[i] && slots[i].feed, ace.heads[i],
                      slots[i] && slots[i].loaded);
}

/**
 * The mark on the artwork, which says the same thing the verbs do.
 *
 * It used to read `filament_at_extruder` straight, so it drew "filament at the extruder"
 * on a head the panel was simultaneously offering `Load`. A card must not contradict
 * itself: occupancy is decided once, above, and this only picks the word for it.
 */
function sensorOf(f, occupied) {
  const feed = f && f.feed;
  if (feed && feed.error) return 'err';
  return occupied ? 'at' : 'none';
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
  body.appendChild(head(slots[i], i, unit, ctx, headLoaded(ace, slots, i)));

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
  sel.title = off ? `Head mode only — the machine is in ${ace.mode} mode`
          : src.state === 'sent' ? 'Waiting for the machine'
          : 'What feeds this toolhead';
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
    + (u.connected ? '' : ' · not answering')
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
  p.title = `${num(u.humidity, '%')} RH · ${num(u.temperature, '°C')} inside ACE ${u.id}`
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
    : `Dry ACE ${u.id}`
      + (u.autoDry.enabled ? ` · automatic above ${u.autoDry.rhStart} %` : '');
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
  n.title = manual ? 'Hand-fed' : 'Automatic Filament Feeder Module';
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
          + ` · ${(PROV[b.source] || PROV.unknown).word}`
        : `${b.addr}: occupied, not named`)
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
  node.onclick = () => baySheet(ctx, i, u, b);
  return node;
}

function provMark(b) {
  const p = PROV[b.source] || PROV.typed;
  const w = el('span', 'ace-prov');
  w.appendChild(glyph(p.glyph));
  w.title = `${[b.material, b.vendor].filter(Boolean).join(' · ') || b.addr || ''} · ${p.word}`;
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
function head(f, i, unit, ctx, occupied) {
  const wrap = el('div', 'ace-toolwrap');
  const st = sensorOf(f, occupied);
  const t = el('div', 'ace-tool is-target');
  t.style.setProperty('--s', HEAD_SCALE);
  // Every one of these macros addresses `HEAD=n`, so the head is what they are ABOUT -
  // and it is the one target on the card that is the same size at every panel width,
  // where a bay is 62 px and shrinking. It wears the bay's own traced edge under the
  // pointer, because two things you can click on one card should not answer differently.
  t.title = `Toolhead ${i + 1} — ${SENSOR[st]}`;
  t.setAttribute('aria-label', t.title);
  t.setAttribute('role', 'button');
  t.tabIndex = 0;
  t.onclick = () => headSheet(ctx, i, unit);
  t.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); } };
  const m = el('span', `ace-sensor is-${st}`);
  m.title = SENSOR[st];
  t.appendChild(m);
  const line = flightLine(f, i, unit);
  if (line) wrap.appendChild(line);
  wrap.appendChild(t);
  return wrap;
}

/**
 * What the machine is doing to this head, in the machine's own words.
 *
 * `channel_state` is the U1's, not multiACE's - `filament_feed left|right` -> the head's
 * own record, already on the subscription and already parsed by `feedChannels()`. So this
 * costs no request; it was simply never drawn.
 *
 * It lives in the GUTTER beside the artwork, and that is the whole reason it can exist:
 * a row under the box measures 479 against a 456 budget and `.panel-body` is
 * `overflow: hidden`, so it would have been clipped rather than seen. The head is 32 px
 * wide in a 371 px cell, which leaves two empty columns and one of them is free.
 *
 * The bar is DETERMINATE, and an earlier draft argued it could not be. That was right
 * about `swap_phase`, which is a word, and wrong about the machine: `channel_state` names
 * which of a KNOWN list the printer is in, so step 4 of 6 is a real quantity. What is
 * still not derivable is a fraction WITHIN a step, and none is drawn.
 */
function flightLine(f, i, unit) {
  const state = f && f.feed && f.feed.channelState;
  // A swap on an ACE-fed head is one bar with two halves; a feeder head runs one
  // direction at a time and gets that direction's own list.
  const step = channelStep(state, unit ? 'swap' : null);
  if (!step) return null;

  const row = el('div', 'ace-flight' + (step.failed ? ' is-fail' : ''));
  if (step.failed) {
    // A failure is a firmware STATE, not a sentence. Translating it would be this page's
    // opinion of what happened, and it stays until something else happens.
    row.appendChild(el('span', 'ace-flight-at', channelWord(step.state) || step.state));
    return row;
  }
  if (step.done || step.at == null) return null;

  const ticks = el('div', 'ace-steps');
  for (let k = 0; k < step.total; k += 1) {
    const seg = el('i', k < step.at ? 'is-done' : k === step.at ? 'is-now' : null);
    ticks.appendChild(seg);
  }
  row.appendChild(ticks);
  // The heat step reads the nozzle rather than captioning it: "heating" and "here is how
  // far" are different answers, and only the second says whether to wait.
  const label = el('span', 'ace-flight-at', step.label);
  row.appendChild(label);
  row.title = `Step ${step.at + 1} of ${step.total}`;
  row.dataset.heat = step.heat ? '1' : '';
  return row;
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
  const slots = ctx.state.filaments();
  const f = slots[i];
  const loaded = headLoaded(ace, slots, i);
  const spool = loaded ? (unit ? h.loaded || f : f) : null;
  const tagged = !!(spool && (spool.rfid || spool.tag));

  // The same list the bay sheet reads, filtered the other way: the verbs that take no
  // SLOT= have nothing to choose, so they belong here and the slotted ones do not.
  const items = aceVerbs(ace, i, unit ? h.bay : null, loaded)
    .filter((v) => !v.slotted)
    .map((v) => ({
      // The name in the label and the reason in the hover. Spelling the reason in the
      // label took the menu to 532 px against a 391 px card; the macro chip that used to
      // carry it - a muted row reading `ACE_BG_SET_HEAD` - said which refusal this was in
      // G-code, which is a thing the reader has to already know to read.
      label: v.name,
      icon: /nload/.test(v.name) ? 'iconFilamentCheck' : 'refresh',
      title: v.off ? `${v.name} — ${v.off}` : v.name,
      muted: !!v.off,
      onClick: v.off === NOT_DECLARED ? () => ctx.handlers.declareBgHead(i)
             : v.off ? undefined : () => ctx.handlers.runVerb(v),
    }));

  if (unit) {
    // Where the slotted verbs went. Not a control: a sentence saying where to click,
    // because the bay IS the argument and pointing at it is the whole design.
    items.push({ label: 'Swap to another bay…', glyph: aceGlyphSquare(),
                 title: 'Click the toolhead, then the bay',
                 muted: true });
  }
  items.push(null);
  items.push({
    // An EYE for a spool that identified itself and a PENCIL for one that did not, which
    // is the same pair the bay marks carry. The row said "View this filament" beside the
    // edit pencil, so the label and the icon disagreed about which of the two it was.
    label: tagged ? 'View this filament' : 'Edit this filament…',
    glyph: glyph(tagged ? 'eye' : 'pencil'),
    title: tagged ? 'Read only — the spool carries its own record' : null,
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
    openMenu(anchor, [{ label: 'No ACE on this printer',
                        glyph: aceGlyphSquare(), muted: true }],
             { head: 'This printer' });
    return;
  }
  openMenu(anchor, [
    { label: 'Unload every toolhead', glyph: aceGlyphSquare(),
      onClick: () => ctx.handlers.unloadAllHeads() },
    null,
    { label: 'Flush length…', icon: 'settings',
      onClick: () => ctx.handlers.setPurge() },
    { label: 'Confirm before load and unload', icon: 'settings',
      onClick: () => ctx.handlers.setConfirmCommands() },
    { label: 'Spoolman…', icon: 'settings',
      onClick: () => ctx.handlers.setSpoolman() },
    null,
    { label: 'Clear the head→bay bookkeeping', icon: 'delete',
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
    glyph: aceGlyphSquare(),
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
/**
 * A bay's own sheet: what can be done with this filament, and what would be sent.
 *
 * This is the confirmation the panel already opened, grown into the thing the study
 * settled on. Where a verb LIVES was the open question and the answer split along the
 * macros: `ACE_SWAP_HEAD` and `ACE_BG_SWAP` take a `SLOT=`, so the bay is the argument
 * and clicking the argument is a shorter sentence than picking a verb and being asked
 * for it afterwards. The head-level verbs stay in the card's menu, where they were.
 *
 * A swap is minutes of physical work that purges filament, and the bays sit under the
 * pointer while someone reads the card - so nothing here fires on the click that opened
 * it.
 */
/*
 * A bay's own sheet: what is in it, and the one verb a bay is the whole argument for.
 *
 * A SWAP is not offered here. It reads as an operation on the filament - "swap this
 * spool" - when what it does is move a TOOLHEAD from one bay to another, and the toolhead
 * is the thing it addresses (`ACE_SWAP_HEAD HEAD=n`). The toolhead's own sheet brings
 * every bay to it and labels each with what it would do, which is the same choice made
 * where the target is named. Loading an empty head from a bay stays: the bay is the
 * argument and there is no other end to it.
 */
function baySheet(ctx, i, u, b) {
  const ace = ctx.state.ace();
  const loaded = headLoaded(ace, ctx.state.filaments(), i);
  const verbs = aceVerbs(ace, i, b.index, loaded)
    .filter((v) => v.slotted && !/^(Swap|Background swap)/.test(v.name));

  openDialog({
    title: b.addr,
    build: (bd) => {
      bd.appendChild(bayIdentity(b));
      if (!verbs.length) {
        // Not an error and not an empty dialog: say which state this is, because
        // "nothing to do here" is the answer. A head already holding filament is a swap,
        // and a swap is chosen at the toolhead.
        bd.appendChild(el('p', 'ms-note', b.index === (ace.heads[i] || {}).bay
          ? `Already feeding Toolhead ${i + 1}.`
          : `Toolhead ${i + 1} is loaded.`));
        return;
      }
      bd.appendChild(verbList(ctx, verbs, i));
    },
    confirmLabel: 'Close',
    cancel: false,
    onConfirm: () => true,
  });
}

/**
 * The toolhead's own sheet: everything that can be done to THIS head.
 *
 * The head is what every one of these macros addresses, so it is a defensible thing to
 * click - and it is the only target that does not shrink with the panel. What it has to
 * solve that a bay's sheet does not is that two of the verbs take a `SLOT=` and a head is
 * not a slot. So the bays come to the sheet, one button each, and each says what clicking
 * it would do IN THIS STATE: load into an empty head, swap into a loaded one, and nothing
 * at all for the bay that is already feeding.
 */
function headSheet(ctx, i, unit) {
  const ace = ctx.state.ace();
  const h = ace.heads[i];
  const slots = ctx.state.filaments();
  const f = slots[i];
  const loaded = headLoaded(ace, slots, i);
  const spool = loaded ? (unit ? h.loaded || f : f) : null;
  const bays = unit ? mergeAceBays(unit, ctx.store.aceBays) : [];

  openDialog({
    title: `Toolhead ${i + 1}`,
    build: (bd) => {
      bd.appendChild(headIdentity(spool, unit, h));

      if (unit) {
        bd.appendChild(el('p', 'ms-note', h.bay == null ? 'Load from:' : 'Swap to:'));
        const row = el('div', 'pickrow');
        bays.forEach((b, k) => {
          // Each bay's own answer, from the same list the bay sheet reads. A bay that is
          // already feeding is not a verb, so its button says so and does nothing.
          const v = aceVerbs(ace, i, k, loaded).filter((x) => x.slotted && !x.bg)[0];
          const btn = el('button', 'pickbay');
          btn.type = 'button';
          const d = el('span', 'pickdisc', b.addr);
          const col = b.occupied ? (b.known ? cssColor(b.color) : '#B7BDC6') : null;
          if (col) { d.style.background = col; d.style.color = isDarkColor(col) ? '#fff' : '#333'; }
          btn.appendChild(d);
          btn.appendChild(el('span', 'picklab',
            !b.occupied ? 'empty' : v ? v.name : 'feeding'));
          btn.disabled = !v || !!v.off;
          btn.title = v ? (v.off ? `${v.name} — ${v.off}` : `${v.name} from ${b.addr}`)
                        : `${b.addr} is already feeding this toolhead`;
          // Close FIRST: a non-background verb opens a blocking dialog of its own, and
          // closing after would shut the one just opened.
          if (v && !v.off) btn.onclick = () => { closeDialog(); ctx.handlers.runVerb(v); };
          row.appendChild(btn);
        });
        bd.appendChild(row);
      }

      // and the verbs that address the head itself, which take no slot
      const rest = aceVerbs(ace, i, unit ? h.bay : null, loaded).filter((v) => !v.slotted);
      if (rest.length) bd.appendChild(verbList(ctx, rest, i));
    },
    confirmLabel: 'Close',
    cancel: false,
    onConfirm: () => true,
  });
}

/** What the head is holding, and where it comes from. */
function headIdentity(spool, unit, h) {
  const row = el('div', 'verb-id');
  const disc = el('span', 'verb-disc',
    unit && h.bay != null ? aceBayAddr(h.unitIndex, h.bay) : '');
  const col = spool ? cssColor(spool.color || spool.colour) : null;
  if (col) { disc.style.background = col; disc.style.color = isDarkColor(col) ? '#fff' : '#333'; }
  row.appendChild(disc);
  const text = el('div', 'verb-idtext');
  const mat = spool && (spool.material || spool.type);
  text.appendChild(el('div', null, mat
    ? [mat, spool.subType].filter(Boolean).join(' ') : 'Nothing loaded'));
  text.appendChild(el('span', null, spool
    ? [spool.vendor, unit ? `ACE ${unit.id}` : 'stock feeder'].filter(Boolean).join(' · ')
    : (unit ? `ACE ${unit.id}` : 'stock feeder')));
  row.appendChild(text);
  return row;
}

/** What is in the bay, drawn the way the bay draws it. */
function bayIdentity(b) {
  const row = el('div', 'verb-id');
  const disc = el('span', 'verb-disc', b.addr);
  const col = b.occupied ? (b.known ? cssColor(b.color) : '#B7BDC6') : null;
  if (col) { disc.style.background = col; disc.style.color = isDarkColor(col) ? '#fff' : '#333'; }
  row.appendChild(disc);
  const text = el('div', 'verb-idtext');
  text.appendChild(el('div', null, b.occupied
    ? [b.material, b.subType].filter(Boolean).join(' ') || 'Occupied, not named'
    : 'Empty'));
  text.appendChild(el('span', null, [b.vendor, b.sku].filter(Boolean).join(' · ')
    || (b.occupied ? (PROV[b.source] || PROV.unknown).word : 'Nothing to load.')));
  row.appendChild(text);
  return row;
}

/**
 * One row per verb: what it is, and the line it would send.
 *
 * The macro is not an explanation - it is the thing that will go out - which is the one
 * piece of prose this panel's copy rule allows in a dialog. An unavailable verb names the
 * macro that would MAKE it available instead, and offers to send it: that is how a head
 * is declared background-capable on a machine, so it is how it is declared here.
 */
/*
 * A toolhead's verbs. Each row is a name and, when it is refused, the reason.
 *
 * It used to carry the macro line under the name and in the hover. A macro name does say
 * what will be sent - but on this surface it was the only thing under every row, so a
 * dialog for moving filament read as a G-code console. The trace pane is where the wire
 * belongs, and it already has it.
 */
function verbList(ctx, verbs, i) {
  const wrap = el('div', 'verbs');
  verbs.forEach((v) => {
    const row = el('button', 'verb' + (v.off ? ' is-off' : ''));
    row.type = 'button';
    const main = el('div', 'verb-main');
    main.appendChild(el('div', 'verb-name', v.name));
    if (v.off) main.appendChild(el('div', 'verb-cmd', v.off));
    row.appendChild(main);
    row.title = v.off || v.name;
    row.disabled = !!v.off;
    // Close FIRST - see the note in the bay picker above.
    if (!v.off) row.onclick = () => { closeDialog(); ctx.handlers.runVerb(v); };
    if (v.off === NOT_DECLARED) {
      // ACE_BG_SET_HEAD's own help says what declaring a head MEANS physically: its dock
      // is open below, and the cold-pull purges through it. So this is not a convenience
      // - it is the one control on this panel that can cost filament and a bed, and it
      // asks separately rather than being folded into the verb.
      const en = el('button', 'verb-gate', 'Enable for this toolhead');
      en.type = 'button';
      en.onclick = (e) => { e.stopPropagation(); ctx.handlers.declareBgHead(i); closeDialog(); };
      main.appendChild(en);
    }
    wrap.appendChild(row);
  });
  return wrap;
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

  /*
   * What pressing Confirm will DO, restated as the dialog changes.
   *
   * It used to print the macro line, which was the honest thing while the numbers and the
   * wire disagreed - the duration is offered in HOURS and `ACE_DRY` takes MINUTES, and a
   * dialog offering 4 would have dried for four minutes. That is a reason to get the
   * conversion right, which it now is, and not a reason to make the reader check the
   * arithmetic in G-code.
   */
  const summary = () => (running ? 'Stops drying now.'
    : `Dries at ${eff('temp')} °C for ${hm(Math.round(eff('hours') * DRY_MINUTES_PER_HOUR))}`
      + (set.auto ? `, and again automatically above ${set.auto} % RH.`
                  : ', and not automatically.'));

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
      drop.title = `${num(u.humidity, '%')} RH`;
      c1.appendChild(drop);
      // One word, whatever the state. "Drying · 1 h 19 m / 4 h" wraps in this column and
      // grows the block under the droplet, which reads as the droplet having moved.
      c1.appendChild(el('div', 'dry-state', running ? 'Drying' : 'Idle'));
      const reads = el('div', 'dry-reads');
      reads.title = `Inside ACE ${u.id}, not the room`;
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
        cmdLine.textContent = summary();
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
        inp.title = `${min}–${max}${suffix}`;
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
