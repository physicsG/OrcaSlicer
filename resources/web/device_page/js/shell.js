/*
 * shell.js - build the page from the registry, then keep it painted.
 *
 * The panel chrome - the <section>, the 40px header, the title, the buttons in the bar -
 * used to be hand-written in index.html and wired by id in wireChrome(). Six panels
 * meant six copies of the same four elements and six places to keep in step; adding one
 * meant remembering all of it. Here the shape is written once and the differences are
 * data, in registry.js.
 *
 * Header vocabulary, all of it:
 *
 *   { kind: 'gap' }                             a 36px hole
 *   { kind: 'spacer' }                          push what follows to the right edge
 *   { kind: 'sep' }                             the vertical rule
 *   { kind: 'icon',  id, cls, icon, title, on } an icon button
 *   { kind: 'pill',  id, cls, label, chev, on, enabled?, title? }  the Print
 *                                               Preferences pill. `label` may be a
 *                                               function, and is then kept in sync
 *   { kind: 'tabs',  group, cls, items, active, on }   one-of-N picker
 *   { kind: 'status', id, cls, text, state, title }    a live label, no click
 *
 * `on` is called with the live context; for `tabs` it also gets the value clicked.
 */
'use strict';

import { $, el, icon } from './core/dom.js';
import { text, data } from './core/render.js';
import { repaintPopover } from './core/overlay.js';
import { PANELS, VIEWS } from './registry.js';

/* ---- header controls ------------------------------------------------- */

function iconBtn(spec, ctx) {
  const b = el('button', spec.cls || 'tab');
  if (spec.id) b.id = spec.id;
  if (spec.title) b.title = spec.title;
  const im = icon(spec.icon);
  im.alt = spec.alt != null ? spec.alt : (spec.title || '');
  b.appendChild(im);
  b.onclick = () => spec.on(ctx);
  return b;
}

/**
 * The Print Preferences pill.
 *
 * `label` may be a string or a function of the context. A function is synced through
 * `headerSync` for the same reason a tab is: a header has no renderer, so a pill that
 * reports something - the ACE mode - would otherwise draw the value it was built with
 * for ever. `enabled` is synced alongside it, because a control for hardware that is
 * not attached should say so rather than send a macro the machine would refuse.
 */
function pillBtn(spec, ctx) {
  const b = el('button', spec.cls || 'pref-pill');
  if (spec.id) b.id = spec.id;
  const label = document.createTextNode('');
  b.appendChild(label);
  if (spec.chev) b.appendChild(icon(spec.chev, 'chev'));
  b.onclick = () => spec.on(ctx);
  if (typeof spec.label === 'function' || spec.enabled || spec.title) {
    const sync = () => {
      label.nodeValue = `${typeof spec.label === 'function' ? spec.label(ctx) : spec.label} `;
      if (spec.enabled) b.disabled = !spec.enabled(ctx);
      if (spec.title) b.title = spec.title(ctx);
    };
    sync();
    headerSync.push(sync);
  } else {
    label.nodeValue = `${spec.label} `;
  }
  return b;
}

/**
 * A one-of-N picker.
 *
 * `is-active` follows the state rather than the click. Moving it in the click handler
 * was almost right and quietly wrong: anything that changed the selection *without* a
 * click left the wrong tab lit. The job card's "choose a file to print" does exactly
 * that - it opens Storage on another kind - and the header went on highlighting
 * time-lapses over a grid of something else.
 */
function tabGroup(spec, ctx, into) {
  const made = [];
  const group = spec.group || 'value';
  spec.items.forEach((it) => {
    const b = el('button', spec.cls || 'tab');
    b.dataset[group] = it.value;
    if (it.title) b.title = it.title;
    const im = icon(it.icon);
    im.alt = it.title || '';
    b.appendChild(im);
    b.onclick = () => spec.on(ctx, it.value);
    made.push(b);
    into.appendChild(b);
  });
  const sync = () => {
    const cur = String(spec.active ? spec.active(ctx) : '');
    const hit = made.some((b) => b.dataset[group] === cur);
    made.forEach((b, i) => b.classList.toggle(
      'is-active', hit ? b.dataset[group] === cur : i === 0));
  };
  sync();
  headerSync.push(sync);
}

/**
 * A label in the header that follows the state.
 *
 * The Printing Task card carried its own status - a badge on a row of its own, above a
 * second row repeating the machine's name that the rail already shows. Both rows were
 * furniture around one word. The word belongs in the header, beside the panel's title,
 * where a panel says what it is and what it is doing in the same line.
 *
 * It syncs through `headerSync` for the same reason a tab does: a header has no
 * renderer, so without this nothing would ever change it except a click, and this one
 * has no click at all.
 */
function statusChip(spec, ctx) {
  const n = el('span', spec.cls || 'head-status');
  if (spec.id) n.id = spec.id;
  const sync = () => {
    text(n, spec.text(ctx));
    if (spec.state) data(n, 'state', String(spec.state(ctx)));
    if (spec.title) n.title = spec.title(ctx);
  };
  sync();
  headerSync.push(sync);
  return n;
}

function headerItem(spec, ctx, into) {
  switch (spec.kind) {
    case 'gap':    into.appendChild(el('span', 'gap-36')); return;
    case 'spacer': into.appendChild(el('span', 'spacer')); return;
    case 'sep':    into.appendChild(el('span', 'sep', '|')); return;
    case 'icon':   into.appendChild(iconBtn(spec, ctx)); return;
    case 'pill':   into.appendChild(pillBtn(spec, ctx)); return;
    case 'tabs':   tabGroup(spec, ctx, into); return;
    case 'status': into.appendChild(statusChip(spec, ctx)); return;
    default: throw new Error(`shell: unknown header item "${spec.kind}"`);
  }
}

/* ---- panels ----------------------------------------------------------- */

function buildPanel(panel, ctx) {
  const body = el('div', panel.bare ? panel.bodyClass
                                    : `panel-body ${panel.bodyClass || ''}`.trim());
  body.id = panel.bodyId || `${panel.id}-body`;
  if (panel.hiddenAtRest) body.hidden = true;
  if (panel.mount) panel.mount(body, ctx);
  if (panel.bare) return body;

  const section = el('section', `panel ${panel.panelClass || ''}`.trim());
  if (panel.sectionId) section.id = panel.sectionId;
  const head = el('header', 'panel-head');
  head.appendChild(el('span', 'panel-title', panel.title));
  (panel.header || []).forEach((spec) => headerItem(spec, ctx, head));
  section.appendChild(head);
  section.appendChild(body);
  return section;
}

/* ---- the page ---------------------------------------------------------- */

/**
 * Fill `.content` and the rail's nav from the registry.
 *
 * `#view-control` and `#view-storage` stay direct children of `.content`, and the fault
 * banner stays their sibling: `.content:has(> #view-storage:not([hidden]))` depends on
 * exactly that nesting.
 *
 * A destination that declares `columns` (see registry.js) gets `.view-cols` holding one
 * `.view-col` each, and every panel lands in the one it names. `#view-control` used to
 * be `display: contents` so its panels were direct children of a 2x2 grid; it is a real
 * box again now, because the two columns have to distribute height independently -
 * Control shrinking to its cluster is what gives Filament the room to grow.
 */
export function buildShell(ctx) {
  const content = $('.content');
  const nav = $('.rail nav');

  VIEWS.forEach((v) => {
    const n = el('div', 'nav-item');
    n.id = `nav-${v.id}`;
    n.dataset.view = v.id;
    n.appendChild(icon(v.icon));
    n.appendChild(el('span', null, v.label));
    n.onclick = () => ctx.commandsFor('page').showView(v.id);
    nav.appendChild(n);
  });

  PANELS.filter((p) => p.view === null)
        .forEach((p) => content.appendChild(buildPanel(p, ctxFor(ctx, p.id))));

  VIEWS.forEach((v) => {
    const box = el('div', 'view');
    box.id = `view-${v.id}`;
    const panels = PANELS.filter((p) => p.view === v.id);

    if (v.columns) {
      // A destination with columns gets one wrapper per column inside a row, and the
      // row is a separate element from the destination itself so the development aids
      // below can sit under it rather than beside it.
      //
      // A panel's column comes from its own declaration, not from source order:
      // ordering the four by which column they land in would have made the registry's
      // list - which is also paint order - a statement about layout, and those two
      // stopped being the same thing the moment the columns were unequal.
      const row = el('div', 'view-cols');
      const cols = new Map(v.columns.map((c) => {
        const w = el('div', `view-col col-${c}`);
        row.appendChild(w);
        return [c, w];
      }));
      panels.forEach((p) => {
        const section = buildPanel(p, ctxFor(ctx, p.id));
        if (p.grow) section.classList.add('grows');
        (cols.get(p.column) || row).appendChild(section);
      });
      box.appendChild(row);
    } else {
      panels.forEach((p) => box.appendChild(buildPanel(p, ctxFor(ctx, p.id))));
    }

    content.appendChild(box);
  });

  // Development aids, not part of the shipped page, and deliberately last: a one-line
  // host status and the live WCP trace. They belong to the control destination because
  // that is where the work happens.
  $('#view-control').appendChild(devAids());
  $('#view-control').appendChild(tracePane());
}

function devAids() {
  const line = el('div', 'status-line');
  const s = el('span', null, 'starting…'); s.id = 'status';
  const m = el('span', 'mode', '—'); m.id = 'mode';
  line.appendChild(s);
  line.appendChild(m);
  return line;
}

function tracePane() {
  const d = el('details', 'trace-panel');
  d.appendChild(el('summary', null, 'WCP trace'));
  const t = el('div'); t.id = 'trace'; t.dataset.paused = '0';
  d.appendChild(t);
  return d;
}

/**
 * Header controls that reflect state - the pickers. A header belongs to no renderer, so
 * without this nothing would ever move a tab except the click that made it.
 */
const headerSync = [];

/**
 * What each panel last failed with, so a paint that throws on every frame - which is the
 * usual shape - reports once rather than sixty times a second.
 */
const paintFailed = new Map();

/**
 * The context one panel sees: the shared one, with `handlers` narrowed to that panel's
 * own commands plus the page-level ones.
 *
 * Prototype delegation rather than a copy, so `state`, `store` and `pending` stay the
 * one live object and only `handlers` differs. Built once per panel and held, because
 * header controls and mount-time closures capture it.
 */
const scoped = new Map();
function ctxFor(ctx, id) {
  if (!scoped.has(id)) {
    const c = Object.create(ctx);
    c.handlers = ctx.commandsFor(id);
    scoped.set(id, c);
  }
  return scoped.get(id);
}

/**
 * Repaint. Only the destination on screen is painted - the other one's panels are behind
 * `hidden`, so painting them costs a full rebuild that nothing can see.
 */
export function paint(ctx, view) {
  document.querySelectorAll('.nav-item').forEach(
    (n) => n.classList.toggle('is-active', n.dataset.view === view));

  VIEWS.forEach((v) => { $(`#view-${v.id}`).hidden = v.id !== view; });
  headerSync.forEach((f) => f());
  // A popover is on document.body, so the panel loop below never reaches it. It has its
  // own signature guard; without this call it draws the state it was opened with, for as
  // long as it stays open.
  repaintPopover();

  PANELS.forEach((p) => {
    if (p.view !== null && p.view !== view) return;
    const root = document.getElementById(p.bodyId || `${p.id}-body`);
    if (!root) return;
    try {
      p.update(root, ctxFor(ctx, p.id));
    } catch (e) {
      // One panel's throw used to take the rest of the frame with it, in silence: the
      // whole paint runs inside one requestAnimationFrame callback, so a ReferenceError
      // halfway through left the page half-built with nothing in the console. It
      // happened during this restructure - a renderer kept a reference to a module
      // variable that had moved - and the page simply stopped having a motion column.
      // Now the panel that failed says so and the others still paint.
      if (paintFailed.get(p.id) !== e.message) {
        paintFailed.set(p.id, e.message);
        console.error(`[shell] ${p.id} panel failed to paint:`, e);
      }
      root.dataset.paintError = e.message;
    }
  });
}
