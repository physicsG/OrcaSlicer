/*
 * The Control panel's DOM: readings, quick settings, toolhead picker and motion.
 *
 * The biggest of the six by a distance, and where the measurements live - the 126px
 * reading column, the three-digit reserve, the jog wheel's bands. See
 * docs/u1-webui/02-device-page/05-visual-reference.md
 */
'use strict';

import { $, el, icon } from '../../../../../shared/js/dom.js';
import { LIMITS, PURIFIER_MODES } from '../../../../../shared/js/protocol.js';
import { openPopover, closePopover } from '../../../core/overlay.js';
import { placeholder } from '../../../widgets/art.js';
import { rebuildOn, text, data } from '../../../../../shared/js/render.js';

// Print speed moves in whole 50% steps: 50 / 100 / 150 across LIMITS.printSpeed.
const SPEED_STEP = 50;
// Granularity and labelling are different questions. The fans are continuous - step 1,
// so any value is reachable - but labelling every step printed 101 ticks across the
// panel. These are the marks that get drawn; `step` is only what the knob snaps to.

// Granularity and labelling are different questions. The fans are continuous - step 1,
// so any value is reachable - but labelling every step printed 101 ticks across the
// panel. These are the marks that get drawn; `step` is only what the knob snaps to.
const FAN_TICKS = [0, 25, 50, 75, 100];
/** Speed is labelled at exactly the values the machine accepts - there are only three. */

/** Speed is labelled at exactly the values the machine accepts - there are only three. */
function speedTicks() {
  const out = [];
  for (let v = LIMITS.printSpeed.min; v <= LIMITS.printSpeed.max; v += SPEED_STEP) out.push(v);
  return out;
}

/*
 * Heat states, read off the two numbers the machine already sends.
 *
 * `power` would say directly whether a heater is being driven, but only the extruders
 * report it - `heater_bed` is subscribed for `temperature` and `target` alone - so the
 * comparison below is the one question both can answer.
 */

/*
 * Heat states, read off the two numbers the machine already sends.
 *
 * `power` would say directly whether a heater is being driven, but only the extruders
 * report it - `heater_bed` is subscribed for `temperature` and `target` alone - so the
 * comparison below is the one question both can answer.
 */
const TEMP_TOL  = 2;    // within this of the target counts as arrived

const TEMP_WARM = 40;   // above this the hardware is still hot to the touch

function heatState(cur, target) {
  if (!Number.isFinite(cur)) return '';
  if (target > 0 && cur < target - TEMP_TOL) return 'heating';
  if (target > 0 && Math.abs(cur - target) <= TEMP_TOL) return 'ready';
  // Cooling is only worth saying while the part is still hot enough to matter.
  if (cur > target + TEMP_TOL && cur > TEMP_WARM) return 'cooling';
  return '';
}

/** How far along the ramp from where it started to where it is going. */

/** How far along the ramp from where it started to where it is going. */
function rampProgress(start, cur, target) {
  if (!Number.isFinite(start) || !Number.isFinite(cur)) return 0;
  const span = target - start;
  if (Math.abs(span) < 1) return 1;
  return Math.min(1, Math.max(0, (cur - start) / span));
}

/**
 * A row is an icon and a reading. No label: the shipped icons carry the identity -
 * iconExtruder1..4 are numbered - and the label was costing the width the numbers need.
 *
 * The target edits in place. It is a real <input type="number"> so it brings the I-beam,
 * keyboard, selection and min/max validation with it, styled to look like text until the
 * row is hovered. Committing on Enter or blur rather than on every keystroke, because
 * each commit is a G-code round trip to the machine.
 *
 * A target of zero is a heater that is off, and it shows as an empty field over a dash
 * rather than as `0`. The zero was never information - every idle row carried one - and
 * it had to be deleted before a number could be typed. Focus selects whatever is there
 * for the same reason: this field is replaced far more often than it is edited.
 */

/**
 * A row is an icon and a reading. No label: the shipped icons carry the identity -
 * iconExtruder1..4 are numbered - and the label was costing the width the numbers need.
 *
 * The target edits in place. It is a real <input type="number"> so it brings the I-beam,
 * keyboard, selection and min/max validation with it, styled to look like text until the
 * row is hovered. Committing on Enter or blur rather than on every keystroke, because
 * each commit is a G-code round trip to the machine.
 *
 * A target of zero is a heater that is off, and it shows as an empty field over a dash
 * rather than as `0`. The zero was never information - every idle row carried one - and
 * it had to be deleted before a number could be typed. Focus selects whatever is there
 * for the same reason: this field is replaced far more often than it is edited.
 */
function tempRow(key, iconName, limit, title, apply, pending) {
  const row = el('div', 'status-row');
  row.dataset.k = key;
  row.dataset.name = title;
  row.title = title;
  row.appendChild(icon(iconName));

  row.appendChild(el('span', 'cur', '_'));
  row.appendChild(el('span', 'sl', '/'));

  const tgt = document.createElement('input');
  tgt.className = 'tgt';
  tgt.type = 'number';
  tgt.min = String(limit.min);
  tgt.max = String(limit.max);
  tgt.placeholder = '—';
  tgt.setAttribute('aria-label', title);
  // The machine's current target lives on the element, not in a closure: the row is
  // never rebuilt, so a captured value would go stale the moment the printer changed it.
  tgt.dataset.target = '0';
  const revert = () => showTarget(tgt, tgt.dataset.target);
  const commit = () => {
    // An empty field is not an instruction to switch the heater off. It is a cleared
    // field on the way to a number, or a keystroke the browser refused. Off is asked
    // for by typing a zero, which is explicit and cannot happen by walking away.
    const raw = tgt.value.trim();
    if (raw === '') return revert();
    const v = Number(raw);
    if (!Number.isFinite(v) || v < limit.min || v > limit.max) return revert();
    if (v === Number(tgt.dataset.target)) return;
    // Hold the asked-for value on screen until the machine echoes it back. Writing the
    // machine's target straight back in is what made a set temperature vanish: the next
    // state push lands about a second later, before the printer has reported the change,
    // so the field went back to what it said before - usually 0.
    //
    // `track` wires the command's own failure in too, which is the one thing the row
    // cannot see for itself: a command that never left has nothing coming to confirm it.
    pending.track(key, v, apply(v));
    // Reflected here and not left to the next repaint: the pulse is feedback for the
    // keystroke that caused it, and a frame away is the wrong distance from a keypress.
    setPend(row, 'sent');
    row.dataset.pendVal = String(v);
  };
  tgt.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); tgt.blur(); }
    if (e.key === 'Escape') { revert(); tgt.blur(); }
  };
  tgt.onblur = commit;
  // Select on focus, with the guard that pattern needs: on a click, focus fires before
  // mouseup, and mouseup would otherwise collapse the selection focus had just made.
  let claiming = false;
  tgt.onmousedown = () => { claiming = document.activeElement !== tgt; };
  tgt.onmouseup = (e) => { if (claiming) { e.preventDefault(); claiming = false; } };
  tgt.onfocus = () => tgt.select();
  row.appendChild(tgt);

  row.appendChild(el('span', 'unit', '°C'));
  // The heat bar carries no reading of its own - only how far along the ramp the
  // machine is. It is positioned out of flow because the row has no spare width: 126px
  // is the measured column, and a 2px bar under the numbers costs none of it.
  row.appendChild(el('i', 'heat'));
  return row;
}

/** Zero is off, and off shows as the placeholder dash rather than as a digit. */

/** Zero is off, and off shows as the placeholder dash rather than as a digit. */
function showTarget(tgt, t) {
  const n = Number(t);
  tgt.value = Number.isFinite(n) && n > 0 ? String(n) : '';
}

/**
 * Push new readings into a row without touching its DOM.
 *
 * The status card used to be rebuilt on every state push - roughly once a second - which
 * destroyed whatever input the user was typing into. That is what made entering a
 * temperature feel like a race: you had a sub-second window before the field was
 * replaced under you. Values are written in place instead, the target field is left
 * alone entirely while it has focus, and a target that has been sent but not yet echoed
 * back is left alone as well.
 */

/**
 * Push new readings into a row without touching its DOM.
 *
 * The status card used to be rebuilt on every state push - roughly once a second - which
 * destroyed whatever input the user was typing into. That is what made entering a
 * temperature feel like a race: you had a sub-second window before the field was
 * replaced under you. Values are written in place instead, the target field is left
 * alone entirely while it has focus, and a target that has been sent but not yet echoed
 * back is left alone as well.
 */
function updateTempRow(row, cur, target, pending) {
  const t = Math.round(Number(target) || 0);
  const c = Number(cur);
  const tgt = row.querySelector('.tgt');
  row.querySelector('.cur').textContent = fmtTemp(cur);

  // A new target restarts the ramp the bar is measured against. Whoever set it - this
  // page, the printer's own screen, or the G-code of a running print - the row reports
  // the machine, so the machine's target is what it tracks.
  if (String(t) !== tgt.dataset.target || row.dataset.start == null) {
    tgt.dataset.target = String(t);
    row.dataset.start = String(Number.isFinite(c) ? c : t);
  }

  // Confirm, expire, or go on holding - the same three ends every control has, decided
  // in pending.js rather than in four datasets here.
  const p = pending.resolve(row.dataset.k, t);
  setPend(row, p.state);
  if (p.asked !== undefined) row.dataset.pendVal = String(p.asked);
  else delete row.dataset.pendVal;

  // A focused field is the user's, and a sent value is theirs until the machine answers.
  if (document.activeElement !== tgt && p.state !== 'sent') showTarget(tgt, t);

  const st = heatState(c, t);
  // A ramp restarts when the direction does, not only when the target does. Measured
  // on a real nozzle: asked for 40, it overshot to 48, and the bar - still measuring
  // the climb from 26 - sat at 100% while the temperature was falling.
  if (st !== row.dataset.heat && (st === 'heating' || st === 'cooling')) {
    row.dataset.start = String(Number.isFinite(c) ? c : t);
  }
  row.dataset.heat = st;
  const moving = st === 'heating' || st === 'cooling';
  row.querySelector('.heat').style.width =
    moving ? `${(rampProgress(Number(row.dataset.start), c, t) * 100).toFixed(1)}%` : '0';
  row.title = rowTitle(row, st, t);
}

/** The row says what it is doing in the tooltip, which is where there is room for words. */

/** The row says what it is doing in the tooltip, which is where there is room for words. */
function rowTitle(row, st, target) {
  const name = row.dataset.name || '';
  if (row.dataset.pend === '1') {
    return `${name} — ${row.dataset.pendVal} °C sent, waiting for the printer`;
  }
  if (row.dataset.pend === 'lost') {
    return `${name} — the printer did not take ${row.dataset.pendVal} °C`;
  }
  if (st === 'heating') return `${name} — heating to ${target} °C`;
  if (st === 'cooling') {
    return `${name} — ${target > 0 ? `cooling to ${target} °C` : 'cooling down'}`;
  }
  if (st === 'ready') return `${name} — at ${target} °C`;
  return target > 0 ? `${name} — set to ${target} °C` : `${name} — off`;
}

function fmtTemp(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n)) : '_';
}

/** One quick-setting tile: icon over a value, opening its own panel underneath. */

/** One quick-setting tile: icon over a value, opening its own panel underneath. */
function tile(key, iconName, title, onOpen, control) {
  const b = el('button', 'qtile');
  b.dataset.k = key;
  b.title = title;
  b.appendChild(icon(iconName));
  b.appendChild(control || el('b', null, '_'));
  if (onOpen) b.onclick = () => onOpen(b);
  return b;
}

/**
 * Readings and quick settings.
 *
 * Takes the context rather than seven unpacked values: everything here came from
 * `state` anyway, and the popovers have to read it *live* - they are built once when
 * the tile is wired and opened much later, so a value captured at build time would be
 * whatever the machine said at boot. That used to be paid for with `root.__state`, a
 * snapshot written onto the DOM on every frame for the closures to find. The context
 * is the same idea with one copy instead of one per frame.
 */

/**
 * Readings and quick settings.
 *
 * Takes the context rather than seven unpacked values: everything here came from
 * `state` anyway, and the popovers have to read it *live* - they are built once when
 * the tile is wired and opened much later, so a value captured at build time would be
 * whatever the machine said at boot. That used to be paid for with `root.__state`, a
 * snapshot written onto the DOM on every frame for the closures to find. The context
 * is the same idea with one copy instead of one per frame.
 */
export function renderStatusCard(root, ctx) {
  const st = ctx.state;
  const toolheads = st.toolheads();

  // Rebuild only when the shape changes; otherwise write the new numbers into the DOM
  // that is already there. Beyond keeping focus, this also keeps a tile alive while its
  // popover is anchored to it - replacing the anchor would orphan the panel.
  rebuildOn(root, `${toolheads.length}`, () => buildStatusCard(root, toolheads, ctx));

  const rows = root.querySelectorAll('.status-row');
  toolheads.forEach((t, i) => {
    if (rows[i]) updateTempRow(rows[i], t.temperature, t.target, ctx.pending);
  });
  const bedRow = root.querySelector('.status-row[data-k="bed"]');
  const bed = st.bed();
  if (bedRow) updateTempRow(bedRow, bed.temperature, bed.target, ctx.pending);

  const q = (k) => root.querySelector(`.qtile[data-k="${k}"]`);
  const setVal = (k, v) => { const n = q(k); if (n) n.querySelector('b').textContent = v; };
  const speed = st.speed();
  setVal('speed', `${speed.factorPct == null ? 100 : speed.factorPct}%`);
  setVal('fan', `${st.fans().main}%`);

  const purifier = st.purifier();
  const purAbsent = !purifier.present || !purifier.powerDetected;
  const pur = q('pur');
  if (pur) {
    pur.querySelector('b').textContent = purAbsent ? '\u2014' : (purifier.modeName || '_');
    if (purAbsent) pur.dataset.absent = '1'; else delete pur.dataset.absent;
    pur.title = purAbsent ? 'Air purifier - not connected' : 'Air purifier';
  }

  // The light shows what was asked for until the printer echoes it. Measured over three
  // runs against the machine, the echo took 236ms, 2029ms and 620ms - and with the
  // mirror driving the switch directly it reverted to its old position in two of the
  // three, which is indistinguishable from a click that did nothing.
  const ledTile = q('led');
  if (ledTile) {
    const led = ctx.pending.resolve('led', st.led().on);
    ledTile.querySelector('.switch')
           .setAttribute('aria-checked', led.value ? 'true' : 'false');
    setPend(ledTile, led.state);
    ledTile.title = led.state === 'sent'
      ? 'Chamber light \u2014 sent, waiting for the printer'
      : led.state === 'lost'
        ? `Chamber light \u2014 the printer did not take ${led.asked ? 'on' : 'off'}`
        : 'Chamber light';
  }
}

/**
 * Reflect a pending state onto an element for the stylesheet.
 *
 * The module's vocabulary is 'sent'/'lost'; the DOM's is `data-pend="1"|"lost"`, which
 * the stylesheet and three test suites already key on. This is the one place the two
 * meet, rather than the attribute spelling leaking into the state machine.
 */

/**
 * Reflect a pending state onto an element for the stylesheet.
 *
 * The module's vocabulary is 'sent'/'lost'; the DOM's is `data-pend="1"|"lost"`, which
 * the stylesheet and three test suites already key on. This is the one place the two
 * meet, rather than the attribute spelling leaking into the state machine.
 */
function setPend(node, state) {
  if (!state) { delete node.dataset.pend; return; }
  node.dataset.pend = state === 'sent' ? '1' : 'lost';
}

function buildStatusCard(root, toolheads, ctx) {
  const handlers = ctx.handlers;
  const st = ctx.state;

  toolheads.forEach((t, i) => {
    root.appendChild(tempRow(`e${i}`, `iconExtruder${i + 1}`, LIMITS.nozzleTemp,
                             `Toolhead ${i + 1} temperature`,
                             (v) => handlers.setExtruderTemp(i, v), ctx.pending));
  });
  root.appendChild(tempRow('bed', 'iconHotBedTemperature', LIMITS.bedTemp,
                           'Heated bed temperature',
                           (v) => handlers.setBedTemp(v), ctx.pending));

  const tiles = el('div', 'qtiles');

  tiles.appendChild(tile('speed', 'iconSpeed', 'Print speed', (anchor) => {
    const speed = st.speed();
    openPopover(anchor, {
      title: 'Print speed', width: 300,
      build: (b) => b.appendChild(sliderRow('iconSpeed', 'Print Speed',
        speed.factorPct == null ? 100 : speed.factorPct,
        LIMITS.printSpeed.min, LIMITS.printSpeed.max, SPEED_STEP,
        (v) => handlers.setSpeed(v), speedTicks())),
    });
  }));

  tiles.appendChild(tile('fan', 'iconMainCooling', 'Fan control', (anchor) => {
    const fans = st.fans();
    openPopover(anchor, {
      title: 'Fan control', width: 330,
      build: (b) => {
        b.appendChild(sliderRow('iconMainCooling', 'Main Cooling Fan Speed',
          fans.main, 0, 100, 1, (v) => handlers.setMainFan(v), FAN_TICKS));
        b.appendChild(sliderRow('iconAuxiliaryCooling', 'Assist Cooling Fan Speed',
          fans.cavity, 0, 100, 1, (v) => handlers.setCavityFan(v), FAN_TICKS));
      },
    });
  }));

  tiles.appendChild(tile('pur', 'iconPurifier', 'Air purifier', (anchor) => {
    const purifier = st.purifier();
    const purAbsent = !purifier.present || !purifier.powerDetected;
    openPopover(anchor, {
      title: 'Air purifier', width: 290,
      build: (b) => {
        // A control for hardware that is not attached is a claim the machine would
        // refuse. The modes stay visible so the panel keeps its shape when one is
        // plugged in, but they are plainly out of reach and the panel says why.
        if (purAbsent) {
          const e = el('div', 'pop-empty');
          e.appendChild(icon('iconPurifier'));
          e.appendChild(el('span', null, 'No air purifier connected'));
          b.appendChild(e);
        }
        const seg = el('div', 'mode-seg');
        if (purAbsent) seg.setAttribute('aria-disabled', 'true');
        Object.entries(PURIFIER_MODES).forEach(([v, label]) => {
          const m = el('button', 'mode', label);
          if (String(purifier.mode) === String(v)) m.classList.add('is-active');
          if (purAbsent) m.disabled = true;
          else m.onclick = () => { handlers.setPurifierMode(Number(v)); closePopover(); };
          seg.appendChild(m);
        });
        b.appendChild(seg);
      },
    });
  }));

  // A binary needs no panel - the switch is the whole control. The click asks for the
  // opposite of what is *shown*, which while a request is outstanding is the request
  // rather than the machine: clicking twice in a second must undo the first click, not
  // re-send it because the printer has not caught up yet.
  const sw = el('button', 'switch');
  sw.setAttribute('role', 'switch');
  sw.onclick = (e) => {
    e.stopPropagation();
    const shown = ctx.pending.resolve('led', st.led().on).value;
    handlers.setLed(!shown);
  };
  tiles.appendChild(tile('led', 'iconLed', 'Chamber light', null, sw));

  root.appendChild(tiles);
}

/**
 * The shipped fan control's own shape: a titled slider with ticks and the value on the
 * right. `step` is what keeps a knob from landing where the machine cannot go.
 */

/**
 * The shipped fan control's own shape: a titled slider with ticks and the value on the
 * right. `step` is what keeps a knob from landing where the machine cannot go.
 */
function sliderRow(iconName, label, value, min, max, step, apply, ticks) {
  const wrap = el('div', 'sctl');

  const head = el('div', 'sctl-head');
  head.appendChild(icon(iconName));
  head.appendChild(el('span', 'sctl-title', label));
  const num = el('b', 'sctl-num', `${Math.round(value)}%`);
  head.appendChild(num);
  wrap.appendChild(head);

  // Granularity and labelling are different questions. A fan is continuous - step 1, so
  // any value is reachable - but labelling every step printed 101 of them across the
  // panel. `marks` is what gets drawn; `step` is only what the knob snaps to.
  const marks = ticks && ticks.length ? ticks.slice() : [];
  if (!marks.length) for (let v = min; v <= max; v += step) marks.push(v);

  const tickEls = el('div', 'sl-ticks');
  marks.forEach(() => tickEls.appendChild(el('i')));

  const slot = el('div', 'sl-wrap');
  slot.appendChild(tickEls);
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min); range.max = String(max); range.step = String(step);
  range.value = String(value);
  range.setAttribute('aria-label', label);
  // repaint while dragging, commit once on release: each commit is a round trip
  range.oninput = () => { num.textContent = `${range.value}%`; };
  range.onchange = () => apply(Number(range.value));
  slot.appendChild(range);
  wrap.appendChild(slot);

  const labels = el('div', 'sl-labels');
  marks.forEach((v) => labels.appendChild(el('span', null, `${v}%`)));
  wrap.appendChild(labels);
  return wrap;
}

/* ---- control: motion ------------------------------------------------ */

// The jog wheel's three bands, outermost first. The ring IS the step size, so there is
// no separate selector and no hidden state: the target you click is the distance.

// The jog wheel's three bands, outermost first. The ring IS the step size, so there is
// no separate selector and no hidden state: the target you click is the distance.
const JOG_STEPS = [10, 1, 0.1];

const BED_STEPS = [10, 1, 0.1];

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, String(v)));
  return n;
}

/**
 * The XY pad: four quadrants by three concentric bands.
 *
 * Geometry is computed rather than drawn so the bands keep their taper at any size.
 * Sectors are real annular paths, so each has its own hit area - a CSS approximation
 * with rectangles would put the corners in the wrong quadrant.
 */

/**
 * The XY pad: four quadrants by three concentric bands.
 *
 * Geometry is computed rather than drawn so the bands keep their taper at any size.
 * Sectors are real annular paths, so each has its own hit area - a CSS approximation
 * with rectangles would put the corners in the wrong quadrant.
 */
function jogWheel(handlers, head, activeTool) {
  const R_OUT = 128, SZ = (R_OUT + 8) * 2, C = SZ / 2;
  const home = Math.round(R_OUT * 0.246);
  const span = R_OUT - home;
  const w = [span * 8 / 21, span * 7 / 21, span * 6 / 21];
  const radii = [R_OUT, R_OUT - w[0], R_OUT - w[0] - w[1], R_OUT - w[0] - w[1] - w[2]];

  const pt = (r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  const sector = (a1, a2, r1, r2) => {
    const [x1, y1] = pt(r2, a1), [x2, y2] = pt(r2, a2);
    const [x3, y3] = pt(r1, a2), [x4, y4] = pt(r1, a1);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${r2.toFixed(1)} ${r2.toFixed(1)} 0 0 1 `
         + `${x2.toFixed(1)} ${y2.toFixed(1)}L${x3.toFixed(1)} ${y3.toFixed(1)}`
         + `A${r1.toFixed(1)} ${r1.toFixed(1)} 0 0 0 ${x4.toFixed(1)} ${y4.toFixed(1)}Z`;
  };

  const GAP = 3;
  const DIRS = [
    { a1: -135, a2: -45, axis: 'Y', sign: +1, label: 'Y' },
    { a1: -45, a2: 45, axis: 'X', sign: +1, label: 'X' },
    { a1: 45, a2: 135, axis: 'Y', sign: -1, label: '\u2212Y' },
    { a1: 135, a2: 225, axis: 'X', sign: -1, label: '\u2212X' },
  ];

  const svg = svgEl('svg', { class: 'wheel', viewBox: `0 0 ${SZ} ${SZ}`,
                             role: 'group', 'aria-label': 'XY jog' });
  const homed = head.allHomed;

  DIRS.forEach((d) => {
    JOG_STEPS.forEach((step, band) => {
      const path = svgEl('path', {
        class: `sect ring${band}`,
        d: sector(d.a1 + GAP, d.a2 - GAP, radii[band + 1], radii[band]),
      });
      const t = svgEl('title', {});
      t.textContent = homed === false
        ? `Home the axes before jogging (${d.label} ${step} mm)`
        : `Jog ${d.label} ${step} mm`;
      path.appendChild(t);
      if (homed === false) path.setAttribute('data-blocked', '1');
      else path.addEventListener('click', () => handlers.jog(d.axis, d.sign * step, activeTool));
      svg.appendChild(path);
    });
  });

  // the axis letter belongs inside the band it labels, not floating outside the wheel
  DIRS.forEach((d) => {
    const [x, y] = pt((radii[0] + radii[1]) / 2, (d.a1 + d.a2) / 2);
    const t = svgEl('text', { class: 'axis', x: x.toFixed(0), y: y.toFixed(0) });
    t.textContent = d.label;
    svg.appendChild(t);
  });
  [-45, 135].forEach((ang) => {
    JOG_STEPS.forEach((step, band) => {
      const [x, y] = pt((radii[band] + radii[band + 1]) / 2, ang);
      const t = svgEl('text', { class: 'step', x: x.toFixed(0), y: y.toFixed(0),
                                transform: `rotate(-45 ${x.toFixed(0)} ${y.toFixed(0)})` });
      t.textContent = String(step);
      svg.appendChild(t);
    });
  });

  const hc = svgEl('circle', { class: 'home', cx: C, cy: C, r: home });
  const ht = svgEl('title', {});
  ht.textContent = homed === false ? 'Home all axes (G28) - required before jogging'
                                   : 'Home all axes (G28)';
  hc.appendChild(ht);
  hc.addEventListener('click', () => handlers.home());
  if (homed === false) hc.setAttribute('data-invite', '1');
  svg.appendChild(hc);

  const hs = home * 0.46;
  svg.appendChild(svgEl('path', {
    class: 'homeicon',
    d: `M${C} ${C - hs * 0.82}l-${hs} ${hs * 0.82}v${hs * 1.14}h${hs * 0.64}`
     + `v-${hs * 0.71}h${hs * 0.71}v${hs * 0.71}h${hs * 0.64}v-${hs * 1.14}z`,
  }));
  return svg;
}

/**
 * Toolhead picker and motion.
 *
 * `activeTool` - which head jog and extrude are aimed at - is the user's, not the
 * machine's, so it lives in the page's state and arrives on the context. It used to be
 * a module-level `let` in this file, which meant the renderer held state the rest of
 * the page could not see and re-called itself argument-less to keep it; the `head`
 * snapshot existed only to survive that self-call, and is now read live.
 */

/**
 * Toolhead picker and motion.
 *
 * `activeTool` - which head jog and extrude are aimed at - is the user's, not the
 * machine's, so it lives in the page's state and arrives on the context. It used to be
 * a module-level `let` in this file, which meant the renderer held state the rest of
 * the page could not see and re-called itself argument-less to keep it; the `head`
 * snapshot existed only to survive that self-call, and is now read live.
 */
export function renderControlMain(root, ctx) {
  const handlers = ctx.handlers;
  const toolheads = ctx.state.toolheads();
  const head = ctx.state.toolhead();
  const activeTool = ctx.store.activeTool;
  const machineTool = head.activeIndex != null ? head.activeIndex : null;

  // Everything below is decided by these four, and nothing else in this panel moves -
  // so this is the whole of what a repaint has to react to. It used to rebuild on every
  // frame, which meant the jog wheel's twenty-four SVG sectors were thrown away and
  // recreated about once a second, under whatever the pointer was over.
  const sig = `${toolheads.length}:${activeTool}:${machineTool}:${head.allHomed}`;
  if (!rebuildOn(root, sig, () => build(root, ctx, toolheads, head,
                                        activeTool, machineTool, handlers))) return;
}

function build(root, ctx, toolheads, head, activeTool, machineTool, handlers) {

  /* --- toolhead picker, left of the wheel --- */
  const pick = el('div', 'pick-col');
  const boxes = el('div', 'pick-row');
  const count = Math.max(toolheads.length, 4);
  for (let i = 0; i < count; i++) {
    const b = el('button', 'pick-box');
    if (i === activeTool) b.classList.add('is-active');
    if (i === machineTool) b.dataset.live = '1';
    b.title = i === machineTool
      ? `Toolhead ${i + 1} - target for jog and extrude, and live on the machine`
      : `Target jog and extrude at toolhead ${i + 1} (does not change the tool)`;
    b.appendChild(icon(`iconExtruder${i + 1}`));
    // selection only: changing the live tool is a separate, deliberate action
    b.onclick = () => handlers.selectTool(i);
    boxes.appendChild(b);
  }
  pick.appendChild(boxes);

  // One button, and what it does depends on the toolhead selected above it - exactly
  // what the shipped page does, where each toolhead carries a button reading "Park
  // Extruder" when that head is ACTIVATE and "Pick Extruder" when it is not.
  //
  // Two buttons forced an asymmetry that had to be explained: Pick followed the
  // selection while Park followed the machine, so neither could name its target without
  // a tooltip. With one button the target is always the head you have selected.
  const acts = el('div', 'pick-acts');
  const isLive = activeTool === machineTool;
  const act = el('button', 'btn primary', isLive ? 'Park extruder' : 'Pick extruder');
  act.title = isLive
    ? `Park toolhead ${activeTool + 1}, leaving none engaged`
    : `Make toolhead ${activeTool + 1} live - blocks while the gantry moves`;
  act.onclick = () => (isLive ? handlers.parkTool(activeTool)
                              : handlers.pickTool(activeTool));
  acts.appendChild(act);
  pick.appendChild(acts);

  const ej = el('div', 'ejog');
  const up = el('button', 'ebtn', '\u25B2');
  up.title = `Extrude on toolhead ${activeTool + 1}`;
  up.onclick = () => handlers.jog('E', +1, activeTool);
  const cap = el('span', 'ecap', 'Extrude');
  const dn = el('button', 'ebtn', '\u25BC');
  dn.title = `Retract on toolhead ${activeTool + 1}`;
  dn.onclick = () => handlers.jog('E', -1, activeTool);
  ej.appendChild(up); ej.appendChild(cap); ej.appendChild(dn);
  pick.appendChild(ej);
  root.appendChild(pick);

  /* --- the wheel, and Z under it --- */
  const motion = el('div', 'motion-col');
  motion.appendChild(jogWheel(handlers, head, activeTool));

  // Z moves the bed on this machine, so it is a row that says "Bed" rather than a
  // third axis on a wheel that would imply the toolhead travels.
  const bedRow = el('div', 'bed-row');
  // Klipper refuses a move on an unhomed axis and says nothing this page can see, so a
  // button that looks live and does nothing is worse than one plainly disabled.
  const blocked = head.allHomed === false;

  // On this machine the bed IS the Z axis, and Z measures the nozzle-to-bed gap - so
  // raising the BED is a NEGATIVE Z move. The printer's own config settles it rather
  // than convention: stepper_z homes positive to position_endstop 275, and PRINT_END
  // drives to Z200 to get clearance, both of which only make sense if larger Z means a
  // wider gap. Sending Z+ for an up arrow moved the bed away from the nozzle.
  //
  // dir: +1 raises the bed toward the nozzle, -1 lowers it away.
  const bedBtn = (v, dir) => {
    const b = el('button', 'bed-btn', `${dir > 0 ? '\u2191' : '\u2193'} ${v}`);
    const dz = -dir * v;
    b.disabled = blocked;
    b.title = blocked
      ? 'Home the axes first - the printer refuses a move until Z is homed'
      : `Move the bed ${dir > 0 ? 'up, toward the nozzle' : 'down, away from the nozzle'}`
        + ` by ${v} mm (Z${dz > 0 ? '+' : ''}${dz})`;
    if (!blocked) b.onclick = () => handlers.jog('Z', dz, activeTool);
    return b;
  };
  BED_STEPS.forEach((v) => bedRow.appendChild(bedBtn(v, +1)));
  bedRow.appendChild(el('span', 'bed-lab', 'Bed'));
  [...BED_STEPS].reverse().forEach((v) => bedRow.appendChild(bedBtn(v, -1)));
  motion.appendChild(bedRow);
  root.appendChild(motion);
}

/* ---- printing task -------------------------------------------------- */
