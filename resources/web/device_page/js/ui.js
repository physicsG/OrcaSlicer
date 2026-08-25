/*
 * ui.js - rendering for the Device tab.
 *
 * The layout mirrors the shipped Flutter page: a left rail, then a column of
 * three panels (Camera / Control / Printing Task), each a 40px header bar over
 * a white body. Measurements and colours come from the real page - see
 * docs/u1-webui/02-device-page/05-visual-reference.md
 */
'use strict';

import { LIMITS, PRINT_STATE, TASK_CONFIG, DEVICE, deviceLabel,
         MOONRAKER_HTTP_PORT, CAMERA_FRAME_ROOT, CAMERA_FRAME_FILE,
         cssColor, isDarkColor, PURIFIER_MODES, jobThumbUrl }
  from '../../shared/js/protocol.js';
import { openDialog, numberField, openPopover, closePopover } from './overlay.js';
import { lookupFault } from '../../shared/js/errors.js';
import { $, el, icon } from './dom.js';
import { rebuildOn, keyedList, text, attr, data } from './render.js';

// app.js still reaches the page through ui.$; re-exported so that stays one name.
export { $ };


/** "_ /_ °C" is what the shipped page shows before any reading arrives. */
function temps(cur, target) {
  const f = (v) => (Number.isFinite(v) && v > 0 ? v.toFixed(1) : '_');
  return `${f(cur)} /${f(target)}°C`;
}

/* ---- rail ----------------------------------------------------------- */

/**
 * The selector names the machine even when it is not connected — Orca keeps
 * saved printers in app_config whether or not a session is up, and showing
 * "Unconnected" for a machine the user has configured just hides it.
 */
export function renderRail(device, connection, devices = [], reachable = false) {
  const nameEl = $('#dev-name');
  const dot = $('#dev-state');

  if (!device) {
    nameEl.textContent = devices.length ? 'Select a printer' : 'Unconnected';
    nameEl.title = devices.length ? `${devices.length} saved` : 'No printer configured';
    dot.dataset.state = 'none';
    return;
  }

  const label = deviceLabel(device);
  // Live state beats the persisted flag - see the note in app.js render().
  const linked = reachable || !!device[DEVICE.CONNECTED];
  nameEl.textContent = label;
  nameEl.title = [
    label,
    device[DEVICE.MODEL],
    device[DEVICE.SN] ? `SN ${device[DEVICE.SN]}` : '',
    device[DEVICE.IP] || '',
    linked ? 'connected' : 'not connected',
    connection && connection.message ? connection.message : '',
  ].filter(Boolean).join('\n');
  dot.dataset.state = linked ? 'on' : 'off';
}

/* ---- camera --------------------------------------------------------- */

/**
 * `cam` is { mode, streaming, frameUrl, timelapses[], error }.
 *
 * Where a frame comes from, measured rather than guessed. `camera.start_monitor`
 * replies `{ state, url }` and then sends nothing further - there is no frame push to
 * wait for. The printer rewrites one file at the monitor interval and the image is
 * fetched over HTTP; see CAMERA_* in protocol.js for the whole finding.
 *
 * The reply's own `url` is relative to the printer's :80 web UI, which answers that
 * path with its SPA shell rather than an image, so it is used only when it is already
 * absolute - which is how the simulator hands back a data: URI. Otherwise the frame is
 * addressed on Moonraker's file server, keeping the filename the printer named.
 */
export function cameraFrameUrl(payload, device) {
  const d = payload && payload.data !== undefined ? payload.data : payload;
  const raw = d && (d.url || d.path || d.frame_url);
  if (typeof raw === 'string' && /^(data:|blob:|https?:)/i.test(raw)) return raw;

  const ip = device && device[DEVICE.IP];
  if (!ip) return null;
  const name = (typeof raw === 'string' && raw.split('/').filter(Boolean).pop())
             || CAMERA_FRAME_FILE;
  return `http://${ip}:${MOONRAKER_HTTP_PORT}`
       + `/server/files/${CAMERA_FRAME_ROOT}/${encodeURIComponent(name)}`;
}

/**
 * What the shipped bundle says, recovered from main.dart.js rather than written here.
 * The rebuild had invented "Camera is off"; the original says "Camera not on".
 */
export const CAMERA_TEXT = {
  off: 'Camera not on',
  loading: 'Camera loading failed. Please try again',
  started: 'Camera started successfully',
  failed: 'Camera start failed',
  noTimelapse: 'Time lapse camera is not supported',
};

export function renderCamera(root, connected, cam, handlers) {
  // Deliberately not keyed on the frame: the <img> is reused and its src re-pointed in
  // place by the pump in app.js, so a new frame must not rebuild the panel under it.
  const shape = !connected ? 'off' : 'view';
  const running = !!cam.streaming;

  rebuildOn(root, `${shape}:${running ? 1 : 0}:${cam.frameUrl || ''}`, () => {
    // The body is BLACK and the control is a round play button inside it, which is what
    // the shipped page shows: a viewport that is dark whether or not a frame is in it.
    // The rebuild used to put the not-connected illustration here instead, which answers
    // a different question - "there is no printer" rather than "the camera is off" - and
    // then offered a text button underneath that the original has nothing like.
    if (shape === 'off') {
      const wrap = el('div');
      wrap.style.textAlign = 'center';
      illustration(wrap);
      root.appendChild(wrap);
      return;
    }

    const view = el('div', 'cam-view');
    if (running && cam.frameUrl) {
      const im = el('img', 'cam-frame');
      im.id = 'cam-live';
      im.src = cam.frameUrl;
      im.alt = 'Live view';
      im.onerror = () => { im.dataset.failed = '1'; };
      view.appendChild(im);
    }

    // One control, centred, the way the original has it. While a frame is playing it
    // only appears on hover, because the original shows an unobstructed picture.
    const btn = el('button', 'cam-play');
    btn.type = 'button';
    if (running) btn.dataset.on = '1';
    btn.title = running ? 'Stop the camera' : 'Start the camera';
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = running
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5v11l9-5.5z"/></svg>';
    btn.onclick = () => (running ? handlers.stopCamera() : handlers.startCamera());
    view.appendChild(btn);

    if (!running || !cam.frameUrl) view.appendChild(el('div', 'cam-msg', ''));
    root.appendChild(view);
  });

  // The message is patched rather than keyed on: an error arriving is not a change of
  // shape, and rebuilding for it would take the live <img> with it.
  const msg = root.querySelector('.cam-msg');
  // The bundle's own wording, not ours: CAMERA_TEXT holds every string it uses here.
  if (msg) text(msg, cam.error || (running ? CAMERA_TEXT.loading : CAMERA_TEXT.off));
}

/* ---- control: left status card -------------------------------------- */

// Print speed moves in whole 50% steps: 50 / 100 / 150 across LIMITS.printSpeed.
const SPEED_STEP = 50;
// Granularity and labelling are different questions. The fans are continuous - step 1,
// so any value is reachable - but labelling every step printed 101 ticks across the
// panel. These are the marks that get drawn; `step` is only what the knob snaps to.
const FAN_TICKS = [0, 25, 50, 75, 100];
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

function illustration(root) {
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
function clock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * The job card, laid out the way the shipped page lays it out.
 *
 * The rebuild used to show an illustration and the words "No active print" when the
 * machine was idle, which is a different card rather than the same card at zero. The
 * original keeps ONE card and zeroes it: status badge, machine name, thumbnail,
 * filename, percentage, layers, time, progress bar, and one round button. An idle
 * printer and a printing one differ in the numbers, not in the furniture.
 */
export function renderTask(root, job, handlers, device, thumb) {
  const active = job.state === PRINT_STATE.PRINTING || job.state === PRINT_STATE.PAUSED;
  const paused = job.state === PRINT_STATE.PAUSED;

  // The card's *shape*: which controls exist and whether there is a thumbnail or a
  // message at all. The numbers move every second and the shape does not, which is the
  // whole point - this used to rebuild the card, the buttons and the image once a
  // second, so a click could land on a node that was about to be replaced.
  rebuildOn(root, `${active ? 1 : 0}:${paused ? 1 : 0}:${thumb ? 1 : 0}:${job.message ? 1 : 0}`,
    () => {
      const wrap = el('div', 'job');

      const head = el('div', 'job-head');
      head.appendChild(el('span', 'job-badge'));
      head.appendChild(el('span', 'job-dev'));
      wrap.appendChild(head);

      const main = el('div', 'job-main');
      const tw = el('div', 'job-thumb');
      if (thumb) {
        tw.appendChild(el('img'));
      } else {
        // The bundle's own empty-box art, not the not-connected device illustration -
        // which answers "there is no printer" rather than "there is no file".
        const ph = el('img', 'job-thumb-ph');
        ph.src = 'icons/empty-box.png';
        ph.alt = '';
        tw.appendChild(ph);
      }
      main.appendChild(tw);

      const info = el('div', 'job-info');
      info.appendChild(el('div', 'job-name'));
      info.appendChild(el('div', 'job-pct'));
      const nums = el('div', 'job-nums');
      // Layers read as a pair; a machine that reports neither shows the pair as zero,
      // which is what the original does rather than hiding the row.
      nums.appendChild(el('span', 'job-layer'));
      nums.appendChild(el('span', 'job-time'));
      info.appendChild(nums);
      main.appendChild(info);
      wrap.appendChild(main);

      const bar = el('div', 'job-bar');
      bar.appendChild(el('div'));
      wrap.appendChild(bar);

      const btns = el('div', 'job-actions');
      // Idle is not a dead end. The card's one useful action with nothing running is to
      // go and find something to print, which is what Storage is for - the button used
      // to be present, disabled, and titled "Nothing to start here".
      const main_btn = roundBtn(
        paused || !active ? 'play' : 'pause',
        paused ? 'Resume the print'
               : (active ? 'Pause the print' : 'Choose a file to print'),
        () => (active ? (paused ? handlers.resume() : handlers.pause())
                      : handlers.showFiles()));
      btns.appendChild(main_btn);
      if (active) {
        btns.appendChild(roundBtn('stop', 'Cancel the print',
                                  () => handlers.confirmCancel()));
      }
      wrap.appendChild(btns);

      if (job.message) wrap.appendChild(el('div', 'job-msg'));
      root.appendChild(wrap);
    });

  // ---- the numbers, which is all that moves ------------------------------
  const st = job.state || PRINT_STATE.STANDBY;
  const badge = root.querySelector('.job-badge');
  // Klipper calls a machine with no job `standby`; the shipped page shows `idle`.
  // The machine's own word stays on the title, so nothing is hidden by the rename.
  text(badge, st === PRINT_STATE.STANDBY ? 'idle' : st);
  badge.title = `print_stats.state: ${st}`;
  data(badge, 'state', st);
  text(root.querySelector('.job-dev'), device ? deviceLabel(device) : '');

  if (thumb) {
    attr(root.querySelector('.job-thumb img'), 'src',
         thumb.startsWith('data:') ? thumb : `data:image/png;base64,${thumb}`);
  }

  const pct = Math.round(job.progress * 100);
  text(root.querySelector('.job-name'),
       job.filename ? (job.filename.split('/').pop() || job.filename) : '\u2014');
  text(root.querySelector('.job-pct'), `${pct}%`);
  text(root.querySelector('.job-layer'), `${job.layer ?? 0}/${job.totalLayer ?? 0}`);
  text(root.querySelector('.job-time'), `\u2014 ${hm(remaining(job))}`);
  root.querySelector('.job-bar > div').style.width = `${pct}%`;
  if (job.message) text(root.querySelector('.job-msg'), job.message);
}

/** `0h 0m`, the way the shipped card writes it - clock() pads the minutes and this
 *  row does not. */
function hm(sec) {
  const t = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`;
}

/** What is left, from what has run and how far it has got. Zero when unknowable. */
function remaining(job) {
  if (!(job.progress > 0) || !(job.printDuration > 0)) return 0;
  return Math.max(0, job.printDuration * (1 - job.progress) / job.progress);
}

/** One round control, the shape the original uses for print actions. */
function roundBtn(kind, title, onClick) {
  const b = el('button', 'job-btn');
  b.type = 'button';
  b.dataset.kind = kind;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5v11l9-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true">'
         + '<rect x="7.5" y="6.5" width="3.5" height="11" rx="1"/>'
         + '<rect x="13" y="6.5" width="3.5" height="11" rx="1"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
  }[kind];
  b.onclick = onClick;
  return b;
}

/* ---- print history --------------------------------------------------- */

/** Klipper's own job outcomes; anything else is shown verbatim. */
const JOB_STATUS = {
  completed: 'Completed', cancelled: 'Cancelled', error: 'Error',
  klippy_shutdown: 'Interrupted', klippy_disconnect: 'Interrupted',
  in_progress: 'In progress', server_exit: 'Interrupted',
};

/* ---- storage ---------------------------------------------------------- */

/**
 * One scrolling grid for everything the printer is holding.
 *
 * Time-lapses, finished prints, print files and logs were four different shapes behind
 * three different tabs on two different panels. They are all "things on the machine you
 * might want to look at", so they get one view, one picker, and one card - normalised
 * here rather than four renderers kept in step by hand.
 *
 * The same rebuild guard as the task lists: this repaints on every state push, and
 * rebuilding threw away the scroll position.
 */
export function renderStorage(root, kind, data, handlers, device) {
  const items = data.items || [];
  // What the body *is*, rather than what it contains: four shapes, and only a change of
  // shape needs the chrome rebuilt. The old guard hashed the item COUNT and so never
  // repainted a list whose contents changed without its length - a print going from
  // in_progress to completed left the old badge on screen.
  const shape = data.loading ? 'loading'
              : data.error ? 'error'
              : items.length ? 'grid' : 'empty';

  rebuildOn(root, `${kind}:${shape}`, () => {
    if (shape === 'loading') {
      root.appendChild(el('div', 'cam-msg', 'Reading the machine\u2026'));
      return;
    }
    if (shape === 'error') {
      const wrap = el('div', 'stor-empty');
      wrap.appendChild(el('div', 'cam-msg', ''));
      const again = el('button', 'btn', 'Try again');
      again.onclick = () => handlers.reloadStorage();
      wrap.appendChild(again);
      root.appendChild(wrap);
      return;
    }
    if (shape === 'empty') {
      const wrap = el('div', 'stor-empty');
      illustration(wrap);
      wrap.appendChild(el('div', 'cam-msg', EMPTY_TEXT[kind] || 'Nothing here'));
      root.appendChild(wrap);
      return;
    }
    const grid = el('div', 'stor-grid');
    grid.dataset.kind = kind;
    root.appendChild(grid);
    const foot = el('div', 'stor-foot');
    foot.appendChild(el('span', null, ''));
    const more = el('button', 'btn', 'Load more');
    more.onclick = () => handlers.loadMoreStorage(root.querySelectorAll('.stor-card').length);
    foot.appendChild(more);
    root.appendChild(foot);
  });

  if (shape === 'error') { text(root.querySelector('.cam-msg'), data.error); return; }
  if (shape !== 'grid') return;

  // The grid is never replaced, so its scroll position needs no saving and restoring -
  // that hand-rolled `at = keep.scrollTop` was paying for the rebuild above it.
  keyedList(root.querySelector('.stor-grid'), items, {
    key: (it, i) => cardKey(it, i),
    sig: (it) => cardSig(kind, it),
    create: (it) => storageCard(kind, it, handlers, device),
  });

  const foot = root.querySelector('.stor-foot');
  foot.hidden = !data.hasMore;
  text(foot.querySelector('span'), `${items.length} shown`);
}

/**
 * What makes two entries the same entry across frames.
 *
 * Falls back to the index, because none of the four sources promises an id: history
 * rows have a filename that repeats across reprints, and a log file has only its path.
 * An index-keyed list still reconciles correctly for the one mutation that happens here
 * - "load more" appending to the end.
 */
function cardKey(it, i) {
  return it.job_id || it.id || it.path || it.filename || it.gcode_name || `#${i}`;
}

/** What has to change before a card is worth rebuilding. */
function cardSig(kind, it) {
  if (kind === 'prints') return `${it.status}:${it.exists}:${it.end_time}`;
  if (kind === 'timelapses') return `${it.video_file_size}:${it.video_duration}`;
  return `${it.size}:${it.modified}`;
}

const EMPTY_TEXT = {
  timelapses: 'No recordings on this printer',
  prints: 'No completed prints on this printer',
  gcodes: 'No print files on this machine',
  logs: 'No files in this folder',
};

/** The empty-box art the shipped page uses where there is nothing to show. */
function placeholder(cls = 'stor-ph') {
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
function storageCard(kind, it, handlers, device) {
  const card = el('div', 'stor-card');
  const shot = el('div', 'stor-shot');
  const body = el('div', 'stor-info');
  const act = el('div', 'stor-actions');

  const withImg = (src, onFail) => {
    const im = el('img');
    im.src = src;
    im.alt = '';
    im.onerror = () => { im.remove(); shot.appendChild(onFail()); };
    shot.appendChild(im);
  };

  if (kind === 'timelapses') {
    const t = it.thumbnail_base64 || it.thumbnail || '';
    if (t) withImg(t.startsWith('data:') ? t : `data:image/jpeg;base64,${t}`,
                   () => el('span', 'tl-none', 'no preview'));
    else shot.appendChild(el('span', 'tl-none', 'no preview'));
    if (it.video_duration) shot.appendChild(el('span', 'tl-dur', it.video_duration));
    body.appendChild(el('span', 'stor-name', it.gcode_name || 'recording'));
    body.appendChild(el('span', 'stor-sub',
      [it.generate_date, it.video_file_size ? fmtSize(it.video_file_size) : '']
        .filter(Boolean).join(' \u00B7 ')));
    const play = el('button', 'btn primary', 'View');
    play.onclick = () => handlers.openTimelapse(it);
    act.appendChild(play);

  } else if (kind === 'prints') {
    const url = jobThumbUrl(device, it);
    if (url) withImg(url, placeholder);
    else shot.appendChild(placeholder());
    const status = String(it.status || '');
    const badge = el('span', 'stor-badge', JOB_STATUS[status] || status || '\u2014');
    badge.dataset.status = status === 'completed' ? 'ok'
                         : (status === 'in_progress' ? 'busy' : 'bad');
    shot.appendChild(badge);
    body.appendChild(el('span', 'stor-name',
                        String(it.filename || '(unnamed)').split('/').pop()));
    const when = it.end_time || it.start_time;
    const bits = [];
    if (when) bits.push(new Date(when * 1000).toLocaleDateString());
    if (it.print_duration) bits.push(clock(it.print_duration));
    const layers = it.metadata && it.metadata.layer_count;
    if (layers) bits.push(`${layers} layers`);
    body.appendChild(el('span', 'stor-sub', bits.join(' \u00B7 ')));
    const again = el('button', 'btn primary', 'Reprint');
    if (it.exists === false) {
      again.disabled = true;
      again.title = 'This file is no longer on the machine';
    } else {
      again.onclick = () => handlers.printFile(it.filename);
    }
    act.appendChild(again);

  } else {
    // gcodes and logs are both plain files; only what you can do with them differs.
    const path = it.path || it.filename || it.name || '';
    shot.appendChild(icon(kind === 'logs' ? 'iconModelFileFolder' : 'iconFile', 'stor-glyph'));
    body.appendChild(el('span', 'stor-name', path.split('/').pop() || path));
    const bits = [];
    if (it.size != null) bits.push(fmtSize(it.size));
    if (it.modified) bits.push(new Date(Number(it.modified) * 1000).toLocaleDateString());
    body.appendChild(el('span', 'stor-sub', bits.join(' \u00B7 ')));
    if (kind === 'gcodes') {
      const print = el('button', 'btn primary', 'Print');
      print.onclick = () => handlers.printFile(path);
      act.appendChild(print);
    }
    const info = el('button', 'btn', 'Details');
    info.onclick = () => handlers.fileDetails(path);
    act.appendChild(info);
  }

  card.appendChild(shot);
  card.appendChild(body);
  card.appendChild(act);
  card.title = it.filename || it.gcode_name || it.path || '';
  return card;
}

/* ---- shared formatting ----------------------------------------------- */

function fmtSize(n) {
  const v = Number(n) || 0;
  if (v > 1024 * 1024) return `${(v / 1048576).toFixed(1)} MB`;
  if (v > 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
}

/* ---- trace ---------------------------------------------------------- */
export function makeTrace(pane) {
  return (kind, packet) => {
    if (!pane || pane.dataset.paused === '1') return;
    const line = el('div', `t t-${kind}`);
    const cmd = (packet && packet.payload && packet.payload.cmd)
      || (packet && packet.header && packet.header.event_id ? 'push' : '');
    line.textContent = `${String(kind).padEnd(9)} ${cmd}`;
    line.title = JSON.stringify(packet);
    pane.appendChild(line);
    while (pane.childElementCount > 200) pane.removeChild(pane.firstChild);
    pane.scrollTop = pane.scrollHeight;
  };
}

/* ---- filament ------------------------------------------------------- */

/**
 * Four slots, drawn on the bundle's own extruder artwork.
 *
 * Values come from `print_task_config` - the same object the print-processing
 * popup edits. See docs/u1-webui/00-shared/01-shared-models.md
 */
export function renderFilament(root, slots, handlers) {
  keyedList(root, slots, {
    key: (f, i) => i,
    sig: (f) => `${f.loaded ? 1 : 0}:${f.type}:${f.subType}:${f.vendor}:${f.color}:${f.tag}`,
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
          'Klipper\u2019s pressure_advance for this toolhead - the same role Bambu\u2019s Factor K plays');
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

/* ---- fault banner ---------------------------------------------------- */

/**
 * `machine_state_manager.action_code` carries the active fault. Decode it
 * against the 442-code catalogue shipped in the bundle rather than showing a
 * bare number - see shared/js/errors.js, which is generated from it.
 */
export function renderFault(root, activity, exception, handlers) {
  const code = (exception && (exception.code || exception.action_code))
            || activity.actionCode;
  const fault = lookupFault(code);

  // Clearing `built` matters: the guard used to be a `data-code` compared on the way in
  // and never reset on the way out, so a fault that cleared and came back matched its
  // own stale key, took the early return, and stayed hidden while the machine was
  // reporting it. A recurring fault is the ordinary case, not an exotic one.
  if (!fault) {
    root.hidden = true;
    root.innerHTML = '';
    delete root.dataset.built;
    return;
  }

  root.hidden = false;
  rebuildOn(root, String(fault.code), () => {
    // class 0003 is advisory in the catalogue's own numbering; anything else stops work
    root.dataset.severity = fault.errorClass === '0003' ? 'warn' : 'error';

    root.appendChild(icon('exclamationMark'));
    const body = el('div', 'fault-body');
    body.appendChild(el('div', 'fault-title', fault.title));
    body.appendChild(el('div', 'fault-desc', fault.description));

    const bits = [`code ${fault.code}`];
    if (fault.subsystemName && fault.subsystemName !== 'unknown') bits.push(fault.subsystemName);
    if (fault.toolhead) bits.push(`toolhead ${fault.toolhead}`);
    if (!fault.known) bits.push('not in the shipped catalogue');
    body.appendChild(el('div', 'fault-code', bits.join(' \u00B7 ')));
    root.appendChild(body);

    const again = el('button', 'btn', 'Re-check');
    again.onclick = () => handlers.queryException();
    root.appendChild(again);
  });
}
