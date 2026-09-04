/*
 * grouping-view.js - what the slicer grouped onto each toolhead, and what is in the way.
 *
 * The panel a plate sliced onto an ACE gets instead of Edit Filament. Its shape is
 * option G's, settled in resources/web/print_processing/mockups/ and written up in
 * docs/u1-webui/03-print-processing/06-multiace.md.
 *
 * WHAT IT IS FOR, AND WHY IT HAS NO PICKER
 *
 * Edit Filament asks "which toolhead does this filament print from". An ACE plate cannot
 * be asked that: the file already decided, and its `ACE_SWAP_HEAD HEAD=n` names the head
 * directly, so a picker here would offer a way to desynchronise the swaps from the tool
 * changes and print the plate on the wrong heads. What is left is RECONCILIATION - the
 * file says which bay each filament comes from, the machine says what is in it, and the
 * panel says what to move.
 *
 * FOUR PARTS
 *
 *   the mode      `SET_ACE_MODE`'s three-way switch, stated and not offered. It decides
 *                 what an address MEANS, so nothing below it is legible without it.
 *   the band      the units, in multi and normal - where no head is wired to a cabinet,
 *                 so nothing about one belongs on a head's box
 *   the heads     one box each: what feeds it, and the filaments it runs in order
 *   the verdict   per bay, three-valued, and the limit stated rather than papered over
 */
'use strict';

import { el } from '../../../../shared/js/dom.js';
import { text, keyedList } from '../../../../shared/js/render.js';
import { aceBadge, aceBayAddr, ACE_MODE_LABELS } from '../../../../shared/js/multiACE.js';
import { inkOn, grams1 } from '../../widgets/format.js';
import { openPicker, closePicker, isPickerOpen } from '../../widgets/picker.js';

/* `dom.js` builds HTML elements; one mark on this panel is an SVG and needs the other
   namespace. Local because it is the only user on this surface. */
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVGNS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

/*
 * What each mode means, in words. The machine's own three words are `normal`, `multi` and
 * `head`; these are what they mean for the thing on screen, which is what a label is for.
 */
const MODE_SAY = {
  head: 'Each toolhead is its own feeder, or wired to one ACE.',
  multi: 'Bay 1 of every ACE feeds toolhead 1, bay 2 feeds toolhead 2, and so on.',
  normal: 'Stock feeders only — no ACE is feeding a toolhead.',
};

export function mount(root) {
  root.appendChild(el('div', 'g-mode'));
  root.appendChild(el('div', 'g-band'));
  root.appendChild(el('div', 'g-heads'));
  root.appendChild(el('div', 'g-fix'));
  root.appendChild(el('div', 'g-note'));
  root.appendChild(el('div', 'g-cost'));
}

export function update(root, model, ctx) {
  const { plan, ace, check, filaments } = model;
  if (!plan) return;                       // hidden by app.js; nothing to draw

  const mode = ace && ace.present ? (ace.mode || 'head') : null;
  paintMode(root.querySelector('.g-mode'), mode);

  /* The band is the PANEL's row of units, and it exists only where a head has no cabinet
     of its own to carry one: above the grid in multi, below it in normal. That placement
     is the Device page's, and its reason is that an idle cabinet in normal mode is a
     footnote while a lane's cabinets in multi are the subject. */
  const band = root.querySelector('.g-band');
  const wantBand = mode === 'multi' || mode === 'normal';
  band.hidden = !wantBand;
  if (wantBand) paintBand(band, ace);
  root.classList.toggle('band-below', mode === 'normal');

  paintHeads(root.querySelector('.g-heads'), plan, ace, check, filaments, mode, ctx);
  paintFix(root.querySelector('.g-fix'), model, ctx);
  paintNote(root.querySelector('.g-note'), plan, check);
  paintCost(root.querySelector('.g-cost'), plan);
}

/* ---- the mode ---------------------------------------------------------- */

function paintMode(row, mode) {
  row.textContent = '';
  if (!mode) {
    row.appendChild(el('span', 'g-pill dim', 'No ACE'));
    row.appendChild(el('span', 'g-say', 'This printer reports no ACE unit.'));
    return;
  }
  row.appendChild(el('span', 'g-pill', `ACE mode · ${ACE_MODE_LABELS[mode] || mode}`));
  row.appendChild(el('span', 'g-say', MODE_SAY[mode] || ''));
}

/* ---- the unit band ----------------------------------------------------- */

function paintBand(band, ace) {
  band.textContent = '';
  const units = (ace && ace.units) || [];
  if (!units.length) {
    band.appendChild(el('span', 'g-say', 'No ACE unit reported.'));
    return;
  }
  units.forEach((u) => {
    const one = el('div', 'g-unit');
    const badge = aceBadge(u.bays, 20 / 26);
    badge.setAttribute('aria-hidden', 'true');
    one.appendChild(badge);
    one.appendChild(el('b', null, `ACE ${u.id}`));
    if (u.model) one.appendChild(el('span', 'g-dim', u.model));
    if (u.humidity != null) one.appendChild(el('span', 'g-hum', `${u.humidity}%`));
    one.title = `ACE ${u.id}${u.model ? ` · ${u.model}` : ''}`;
    band.appendChild(one);
  });
}

/* ---- the heads --------------------------------------------------------- */

function paintHeads(grid, plan, ace, check, filaments, mode, ctx) {
  keyedList(grid, plan.heads, {
    key: (h) => String(h.head),
    create: () => buildHead(),
    update: (node, h) => paintHead(node, h, ace, check, filaments, mode, ctx, plan),
  });
}

function buildHead() {
  const box = el('div', 'g-head');
  const head = el('div', 'g-hrow');
  head.appendChild(el('h4', null, ''));
  head.appendChild(el('span', 'g-spacer'));
  head.appendChild(el('div', 'g-src'));
  box.appendChild(head);
  box.appendChild(el('div', 'g-chips'));
  box.appendChild(el('div', 'g-verdict'));
  return box;
}

function paintHead(box, h, ace, check, filaments, mode, ctx, plan) {
  text(box.querySelector('h4'), `Toolhead ${h.head + 1}`);
  box.classList.toggle('is-idle', !h.run.length);

  paintSource(box.querySelector('.g-src'), h, ace, mode);

  const rows = check.rows.filter((r) => r.head === h.head);
  const chips = box.querySelector('.g-chips');
  keyedList(chips, h.run, {
    key: (s) => String(s.filament),
    create: () => buildChip(),
    update: (node, s) => paintChip(node, s, h, filaments, rows, ctx, plan, ace),
  });

  paintVerdict(box.querySelector('.g-verdict'), h, rows);
}

/**
 * What feeds this head, drawn beside its name.
 *
 * In `head` mode that is ONE unit, and the badge - filled with that cabinet's own four
 * bay colours - is drawn once here rather than on every chip, because which unit feeds a
 * head is a property of the head: `ACE_SET_HEAD_ACE HEAD=n ACE=a` binds one to one, and
 * the Prepare tab's per-head `ACE` row is the same fact in the same place.
 *
 * In `multi` there is no unit to name. Bay `i` of EVERY cabinet is plumbed to head `i`,
 * so the head has a LANE and its label is the bays in it; one badge there would name one
 * cabinet out of a set and be wrong about the rest.
 *
 * A stock feeder gets the feeder module's own mark and never a small ACE - a different
 * device with one bay, and at this size the ACE's outline is the same picture.
 */
function paintSource(host, h, ace, mode) {
  host.textContent = '';
  if (!h.run.length) return;

  if (h.feeder) {
    host.appendChild(feederMark());
    host.appendChild(el('span', 'g-srcname', 'Stock feeder'));
    return;
  }

  const units = (ace && ace.units) || [];

  if (mode === 'multi') {
    const lane = h.lane != null ? h.lane : h.head;
    const ids = units.map((u) => aceBayAddr(u.index, lane));
    host.classList.add('is-lane');
    host.appendChild(el('span', 'g-srcname mono',
      ids.length ? `Lane · ${ids.join(' · ')}` : `Lane ${lane + 1}`));
    return;
  }
  host.classList.remove('is-lane');

  const unit = units.find((u) => u.index === h.unit);
  if (!unit) {
    host.appendChild(el('span', 'g-srcname dim', 'No ACE reported'));
    return;
  }
  const badge = aceBadge(unit.bays, 20 / 26);
  badge.setAttribute('aria-hidden', 'true');
  host.appendChild(badge);
  const name = el('span', 'g-srcname', `ACE ${unit.id}`);
  name.title = `ACE ${unit.id}${unit.model ? ` · ${unit.model}` : ''}`
    + (unit.humidity != null ? ` · ${unit.humidity}% RH` : '');
  host.appendChild(name);
}

/**
 * Snapmaker's Automatic Filament Feeder Module, at mark size: white over black on a
 * rounded square, which is the module's own drawing and not the ACE's.
 */
function feederMark() {
  const s = svg('svg', { width: 15, height: 15, viewBox: '0 0 24 24',
                         'aria-hidden': 'true', class: 'g-feedmark' });
  s.appendChild(svg('rect', { x: 1, y: 1, width: 22, height: 22, rx: 5, fill: '#FFFFFF' }));
  s.appendChild(svg('path', {
    d: 'M1 13 h22 v5 a5 5 0 0 1 -5 5 h-12 a5 5 0 0 1 -5 -5 Z', fill: '#1F1F1F' }));
  s.appendChild(svg('rect', { x: 1, y: 1, width: 22, height: 22, rx: 5, fill: 'none',
                              stroke: '#D9DDE3', 'stroke-width': 1 }));
  return s;
}

/* ---- a chip ------------------------------------------------------------ */

function buildChip() {
  const chip = el('div', 'g-chip');
  chip.appendChild(el('span', 'g-type'));
  chip.appendChild(el('span', 'g-from'));
  return chip;
}

/**
 * One filament, and where it comes from.
 *
 * The material on a bar in the filament's own colour, the source under it. A source the
 * machine disagrees with is MARKED on the chip rather than replaced on it: `A2` is still
 * where the plan looks, and hiding that would make the verdict below unexplainable.
 */
function paintChip(chip, step, h, filaments, rows, ctx, plan, ace) {
  const fil = filaments[step.filament]
           || { index: step.filament, type: '---', colors: [] };
  const colour = fil.colors[0] || '#B7BDC6';
  const type = chip.querySelector('.g-type');
  text(type, fil.type);
  type.style.background = colour;
  type.style.color = inkOn(colour);
  chip.dataset.fil = String(fil.index);

  /* The STEP's unit, never the head's: in multi a head has none, and reading the head's
     produced `bayAddr(undefined, …)`, which renders as `NaN1`. */
  const addr = h.feeder ? 'Feeder'
    : (step.slot != null && step.unit != null ? aceBayAddr(step.unit, step.slot) : '—');
  text(chip.querySelector('.g-from'), addr);

  const row = rows.find((r) => r.want && r.want.index === fil.index);
  chip.classList.toggle('is-bad', !!row && row.verdict === 'differs');
  chip.classList.toggle('is-warn', !!row && row.verdict === 'unsure');
  chip.title = `${fil.type} · ${addr}${row && row.say ? ` · ${row.say}` : ''}`;

  /*
   * The chip is where a filament is sent somewhere else.
   *
   * Edit Filament's toolhead picker is absent on an ACE plate and must stay absent:
   * remapping the tool numbers without remapping the swaps prints on one head while the ACE
   * feeds another. This is not that. It re-runs the rewriter, which writes the tool numbers
   * AND the swaps together, so the two cannot come apart - and it is the only way to say
   * "print these two colours from the ACE and leave that toolhead alone", which the planner
   * will never choose on its own because it costs swaps a free plan does not.
   */
  if (!ctx || !ctx.setSource) return;
  chip.classList.add('is-pick');
  chip.setAttribute('role', 'button');
  chip.tabIndex = 0;
  const open = () => openSource(chip, fil, h, plan, ace, ctx);
  chip.onclick = open;
  chip.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };
}

/**
 * Where this filament can come from, and what each place costs.
 *
 * Two kinds, and every row says which: a bay of THIS head's own unit, which is one argument
 * on each swap line and free; or another toolhead, which is the tool number and re-writes
 * the gcode. Head mode binds one unit to one head, so no other cabinet is reachable from
 * here at any price and none is offered.
 */
function openSource(chip, fil, h, plan, ace, ctx) {
  if (isPickerOpen(chip)) { closePicker(); return; }
  const unit = ((ace && ace.units) || []).find((u) => u.index === h.unit) || null;
  const step = h.run.find((r) => r.filament === fil.index) || {};
  const items = [];

  if (!h.feeder && unit) {
    (unit.bays || []).forEach((bay, i) => {
      const known = bay.known && bay.material;
      const usable = !!bay.occupied && !(known && fil.type && bay.material !== fil.type);
      items.push({
        value: `b:${i}`,
        enabled: usable,
        title: !bay.occupied ? 'This bay is empty — nothing to draw from.'
             : !usable ? `This bay holds ${bay.material}; the plate wants ${fil.type}.` : '',
        build: (node) => {
          const d = el('span', 'menu-place', bay.addr || aceBayAddr(h.unit, i));
          if (bay.occupied) {
            d.style.background = bay.color || '#B7BDC6';
            d.style.color = inkOn(bay.color || '#B7BDC6');
          } else d.classList.add('empty');
          node.appendChild(d);
          const col = el('span', 'menu-col');
          col.appendChild(el('b', null, bay.occupied ? (bay.material || 'Unknown') : 'Empty'));
          col.appendChild(el('span', null, bay.occupied ? (bay.vendor || 'not named') : ''));
          node.appendChild(col);
          if (i === step.slot) node.appendChild(el('span', 'menu-tick'));
          else if (usable) node.appendChild(el('span', 'menu-cost free', 'free'));
          if (!usable) node.appendChild(el('span', 'menu-warn'));
        },
      });
    });
  }

  plan.heads.forEach((other) => {
    if (other.head === h.head) return;
    /* A stock feeder holds one spool and an ACE head as many as its unit has bays. A full
       one is refused here rather than offered and then failed by the host - the widget's
       whole contract is that a disabled row cannot be chosen, and finding out by pressing
       it is what an error message is for, not a menu. */
    const room = other.feeder ? 1 : ((unit && unit.bays && unit.bays.length) || 4);
    const full = other.run.length >= room;
    items.push({
      value: `h:${other.head}`,
      enabled: !full,
      title: full ? (other.feeder
        ? `Toolhead ${other.head + 1} is a stock feeder and already has a filament.`
        : `Toolhead ${other.head + 1} already uses all ${room} bays.`) : '',
      build: (node) => {
        node.appendChild(el('span', 'menu-place', String(other.head + 1)));
        const col = el('span', 'menu-col');
        col.appendChild(el('b', null, `Toolhead ${other.head + 1}`));
        col.appendChild(el('span', null, other.feeder
          ? (other.run.length ? `${other.run.length} filament here` : 'nothing here')
          : `ACE, ${other.run.length} here`));
        node.appendChild(col);
        if (full) node.appendChild(el('span', 'menu-warn'));
        else node.appendChild(el('span', 'menu-cost', 're-export'));
      },
    });
  });

  openPicker({
    trigger: chip, kind: 'head', within: ctx.dialog ? ctx.dialog() : document.body,
    items,
    onPick: (v) => {
      const [kind, num] = String(v).split(':');
      ctx.setSource(fil.index, kind === 'b' ? { slot: Number(num) } : { head: Number(num) });
    },
  });
}

/* ---- the verdict, per head --------------------------------------------- */

/**
 * One line under the box saying where it stands.
 *
 * A head with nothing wrong says what it holds rather than the word "Ready": the absence
 * of a mark has already said ready, and a second copy of it is not information.
 */
function paintVerdict(node, h, rows) {
  node.className = 'g-verdict';
  if (!h.run.length) { text(node, 'Not used by this plate.'); node.classList.add('dim'); return; }

  const bad = rows.find((r) => r.verdict === 'differs');
  if (bad) {
    node.classList.add('bad');
    text(node, `${bad.addr}: ${bad.say}.${bad.fix ? ` ${bad.fix}.` : ''}`);
    return;
  }
  const unsure = rows.find((r) => r.verdict === 'unsure');
  if (unsure) {
    node.classList.add('warn');
    text(node, `${unsure.addr}: ${unsure.say}.`);
    return;
  }
  if (rows.every((r) => r.verdict === 'unchecked')) { text(node, ''); return; }
  node.classList.add('ok');
  text(node, rows.length > 1 ? `All ${rows.length} bays hold the plan.` : rows[0].say);
}

/**
 * The one thing this panel can fix without anybody walking anywhere.
 *
 * A bay that holds another spool is normally an errand: go to the machine, move it. But
 * when every spool the plate wants IS in the machine and merely in another bay, nothing has
 * to move at all - the addresses were chosen at slicing time, before anyone could see the
 * ACE, and re-addressing them is one argument on each swap line. `bayFix` says whether that
 * is the case; the host does it and answers with the new plan.
 *
 * Offered only when it would clear EVERY bay. A button that fixes half of them leaves the
 * plate just as unprintable and the operator with less idea why.
 */
function paintFix(node, model, ctx) {
  node.textContent = '';
  node.hidden = !model.bayFix;
  if (!model.bayFix) return;
  node.appendChild(el('span', 'g-fixsay',
    'Every spool this plate wants is in the ACE, in other bays.'));
  const btn = el('button', 'g-fixbtn', 'Use the bays they are in');
  btn.type = 'button';
  btn.disabled = !!model.busy;
  btn.title = 'Re-addresses the bays. Nothing is re-sliced.';
  if (ctx && ctx.fixBays) btn.addEventListener('click', () => ctx.fixBays());
  node.appendChild(btn);
}

/* ---- the limit, and the cost ------------------------------------------- */

/**
 * Said once, for the whole grid.
 *
 * The ACE reports its own bays and nothing else, so a wrong colour on a stock feeder goes
 * undetected. Stating that is the difference between a check and a claim - and three of
 * this machine's seven places are stock feeders.
 */
function paintNote(node, plan, check) {
  const feeders = plan.heads.filter((h) => h.feeder && h.run.length).length;
  if (!check.checked) {
    text(node, 'This plate was sliced for an ACE and the printer reports none, '
             + 'so none of the bays can be checked.');
    node.className = 'g-note warn';
    return;
  }
  node.className = 'g-note';
  text(node, feeders
    ? `The ACE reports its own bays and nothing else, so the ${feeders} stock `
      + `${feeders === 1 ? 'feeder has' : 'feeders have'} not been checked.`
    : '');
}

/**
 * What the arrangement costs, before Send rather than after.
 *
 * ~300 swaps for seven colours on one four-bay head is inherent, not a defect, and an
 * operator is entitled to it before they start a 4-hour print. `saved_*` is what the
 * grouping bought against the same plate run entirely off the ACE head.
 */
function paintCost(node, plan) {
  node.textContent = '';
  /*
   * Zero is a state, not an absence.
   *
   * A plate whose filaments each have their own toolhead uses the ACE as a plain
   * single-bay feeder: it loads once before the print and never cycles again. Saying so is
   * worth a line - it is the difference between a two-hour print and a two-hour print with
   * three hundred spool changes in it - and the panel used to draw nothing at all here,
   * found on a real four-colour plate whose plan came out at zero swaps.
   */
  const usesAce = plan.heads.some((h) => !h.feeder && h.run.length);
  if (!plan.swaps) {
    if (usesAce) {
      node.appendChild(el('b', null, 'No'));
      node.appendChild(el('span', null, 'ACE swaps — it loads once and stays'));
    }
    return;
  }
  node.appendChild(el('b', null, String(plan.swaps)));
  node.appendChild(el('span', null, 'ACE swaps'));
  /*
   * Only when there IS one. The emitter's own header line carries `swaps:` and
   * `optimal:` and no purge figure - measured on a real multiACE plate - so the page must
   * not draw the clause with an em-dash in it and read "300 ACE swaps — purged".
   */
  if (plan.purgeG > 0) {
    node.appendChild(el('b', null, grams1(plan.purgeG)));
    node.appendChild(el('span', null, 'purged'));
  }
  if (plan.savedSwaps) {
    node.appendChild(el('span', 'g-saved',
      `saves ${plan.savedSwaps} swaps against one spool per head`));
  }
}
