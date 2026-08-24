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
         cssColor, isDarkColor, PURIFIER_MODES }
  from '../../shared/js/protocol.js';
import { openDialog, numberField, openPopover, closePopover } from './overlay.js';
import { lookupFault } from '../../shared/js/errors.js';

export const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function icon(name, cls) {
  const i = el('img', cls);
  i.src = `icons/${name}.svg`;
  i.alt = '';
  return i;
}

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

export function renderCamera(root, connected, cam, handlers) {
  // deliberately not keyed on the frame: the <img> is reused and its src is
  // re-pointed in place, so a new frame must not rebuild the panel under it.
  const key = `${connected ? 'on' : 'off'}:${cam.mode}:${cam.streaming ? 1 : 0}:`
            + `${cam.frameUrl || ''}:${(cam.timelapses || []).length}`;
  if (root.dataset.state === key) return;
  root.dataset.state = key;
  root.innerHTML = '';

  if (cam.mode === 'timelapse') {
    const list = cam.timelapses || [];
    if (!list.length) {
      const wrap = el('div');
      wrap.style.textAlign = 'center';
      illustration(wrap);
      wrap.appendChild(el('div', 'cam-msg', cam.error || 'No time-lapse recordings'));
      root.appendChild(wrap);
      return;
    }
    const grid = el('div', 'tl-grid');
    list.forEach((t) => {
      const card = el('button', 'tl-card');
      // thumbnail_base64 is what the printer sends, and it arrives as a full data:
      // URI already - but only when the request asked for thumbnail_direct.
      const thumb = t.thumbnail_base64 || t.thumbnail || t.thumb || '';
      if (thumb) {
        const im = el('img');
        im.src = thumb.startsWith('data:') ? thumb : `data:image/jpeg;base64,${thumb}`;
        card.appendChild(im);
      }
      card.appendChild(el('span', 'tl-name',
                          t.gcode_name || t.name || t.filename || 'recording'));
      card.onclick = () => handlers.openTimelapse(t);
      grid.appendChild(card);
    });
    root.appendChild(grid);
    return;
  }

  // live view - one <img>, re-pointed by the frame pump in app.js.
  // The controls have to be rendered on THIS branch too: returning early here is
  // what left a running camera with no way to stop it.
  if (cam.streaming && cam.frameUrl) {
    const im = el('img', 'cam-frame');
    im.id = 'cam-live';
    im.src = cam.frameUrl;
    im.alt = 'Live view';
    im.onerror = () => { im.dataset.failed = '1'; };
    root.appendChild(im);

    const bar = el('div', 'cam-controls');
    const stop = el('button', 'btn', 'Stop');
    stop.onclick = () => handlers.stopCamera();
    bar.appendChild(stop);
    const snap = el('button', 'btn', 'Refresh');
    snap.onclick = () => { const t = $('#cam-live'); if (t) t.src = `${cam.frameUrl}?t=${Date.now()}`; };
    bar.appendChild(snap);
    root.appendChild(bar);
    return;
  }

  const wrap = el('div');
  wrap.style.textAlign = 'center';
  illustration(wrap);
  if (connected) {
    const msg = el('div', 'cam-msg', cam.error || (cam.streaming ? 'Waiting for video…' : 'Camera is off'));
    wrap.appendChild(msg);
    const b = el('button', 'btn', cam.streaming ? 'Stop' : 'Start live view');
    b.style.marginTop = '10px';
    b.onclick = () => (cam.streaming ? handlers.stopCamera() : handlers.startCamera());
    wrap.appendChild(b);
  }
  root.appendChild(wrap);
}

/* ---- control: left status card -------------------------------------- */

// Print speed moves in whole 50% steps: 50 / 100 / 150 across LIMITS.printSpeed.
const SPEED_STEP = 50;

/**
 * A row is an icon and a reading. No label: the shipped icons carry the identity -
 * iconExtruder1..4 are numbered - and the label was costing the width the numbers need.
 *
 * The target edits in place. It is a real <input type="number"> so it brings the I-beam,
 * keyboard, selection and min/max validation with it, styled to look like text until the
 * row is hovered. Committing on Enter or blur rather than on every keystroke, because
 * each commit is a G-code round trip to the machine.
 */
function tempRow(iconName, cur, target, limit, title, apply) {
  const row = el('div', 'status-row');
  row.title = title;
  row.appendChild(icon(iconName));

  row.appendChild(el('span', 'cur', fmtTemp(cur)));
  row.appendChild(el('span', 'sl', '/'));

  const tgt = document.createElement('input');
  tgt.className = 'tgt';
  tgt.type = 'number';
  tgt.value = String(Math.round(target || 0));
  tgt.min = String(limit.min);
  tgt.max = String(limit.max);
  tgt.setAttribute('aria-label', title);
  const commit = () => {
    const v = Number(tgt.value);
    if (!Number.isFinite(v) || v < limit.min || v > limit.max) {
      tgt.value = String(Math.round(target || 0));   // refuse rather than clamp silently
      return;
    }
    if (v !== Math.round(target || 0)) apply(v);
  };
  tgt.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); tgt.blur(); }
    if (e.key === 'Escape') { tgt.value = String(Math.round(target || 0)); tgt.blur(); }
  };
  tgt.onblur = commit;
  row.appendChild(tgt);

  row.appendChild(el('span', 'unit', '\u00B0C'));
  return row;
}

function fmtTemp(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n)) : '_';
}

/** One quick-setting tile: icon over a value, opening its own panel underneath. */
function tile(iconName, value, title, onOpen, opts = {}) {
  const b = el('button', 'qtile');
  b.title = title;
  b.appendChild(icon(iconName));
  if (opts.absent) b.dataset.absent = '1';
  if (opts.control) {
    b.appendChild(opts.control);
  } else {
    b.appendChild(el('b', null, value));
  }
  if (onOpen) b.onclick = () => onOpen(b);
  return b;
}

export function renderStatusCard(root, toolheads, bed, led, fans, purifier,
                                 speed, handlers) {
  root.innerHTML = '';

  toolheads.forEach((t, i) => {
    root.appendChild(tempRow(`iconExtruder${i + 1}`, t.temperature, t.target,
                             LIMITS.nozzleTemp, `Toolhead ${i + 1} temperature`,
                             (v) => handlers.setExtruderTemp(i, v)));
  });
  root.appendChild(tempRow('iconHotBedTemperature', bed.temperature, bed.target,
                           LIMITS.bedTemp, 'Heated bed temperature',
                           (v) => handlers.setBedTemp(v)));

  const tiles = el('div', 'qtiles');

  tiles.appendChild(tile('iconSpeed', `${speed.factorPct == null ? 100 : speed.factorPct}%`,
    'Print speed', (anchor) => openPopover(anchor, {
      title: 'Print speed',
      width: 300,
      build: (b) => {
        // 50/100/150 is the whole of what the machine accepts, so the track snaps
        b.appendChild(sliderRow('iconSpeed', 'Print Speed',
          speed.factorPct == null ? 100 : speed.factorPct,
          LIMITS.printSpeed.min, LIMITS.printSpeed.max, SPEED_STEP,
          (v) => handlers.setSpeed(v)));
      },
    })));

  tiles.appendChild(tile('iconMainCooling', `${fans.main}%`,
    'Fan control', (anchor) => openPopover(anchor, {
      title: 'Fan control',
      width: 330,
      build: (b) => {
        b.appendChild(sliderRow('iconMainCooling', 'Main Cooling Fan Speed',
          fans.main, 0, 100, 1, (v) => handlers.setMainFan(v)));
        b.appendChild(sliderRow('iconAuxiliaryCooling', 'Assist Cooling Fan Speed',
          fans.cavity, 0, 100, 1, (v) => handlers.setCavityFan(v)));
      },
    })));

  // A purifier that is not plugged in cannot be set. The modes stay visible so the
  // panel keeps its shape, but they are plainly out of reach and the panel says why.
  const purAbsent = !purifier.present || !purifier.powerDetected;
  tiles.appendChild(tile('iconPurifier', purAbsent ? '\u2014' : (purifier.modeName || '_'),
    purAbsent ? 'Air purifier - not connected' : 'Air purifier',
    (anchor) => openPopover(anchor, {
      title: 'Air purifier',
      width: 290,
      build: (b) => {
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
    }), { absent: purAbsent }));

  // A binary needs no panel - the switch is the whole control
  const sw = el('button', 'switch');
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', led.on ? 'true' : 'false');
  sw.onclick = (e) => { e.stopPropagation(); handlers.setLed(!led.on); };
  tiles.appendChild(tile('iconLed', null, 'Chamber light', null, { control: sw }));

  root.appendChild(tiles);
}

/**
 * The shipped fan control's own shape: a titled slider with ticks and the value on the
 * right. `step` is what keeps a knob from landing where the machine cannot go.
 */
function sliderRow(iconName, label, value, min, max, step, apply) {
  const wrap = el('div', 'sctl');

  const head = el('div', 'sctl-head');
  head.appendChild(icon(iconName));
  head.appendChild(el('span', 'sctl-title', label));
  const num = el('b', 'sctl-num', `${Math.round(value)}%`);
  head.appendChild(num);
  wrap.appendChild(head);

  const marks = [];
  for (let v = min; v <= max; v += step) marks.push(v);
  const ticks = el('div', 'sl-ticks');
  marks.forEach(() => ticks.appendChild(el('i')));

  const slot = el('div', 'sl-wrap');
  slot.appendChild(ticks);
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

let activeTool = 0;
let head = {};          // last `toolhead` snapshot: active tool, position, homing

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
function jogWheel(handlers) {
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

export function renderControlMain(root, toolheads, handlers, th) {
  root.innerHTML = '';
  if (th) head = th;
  const machineTool = head.activeIndex != null ? head.activeIndex : null;

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
    b.onclick = () => { activeTool = i; renderControlMain(root, toolheads, handlers); };
    boxes.appendChild(b);
  }
  pick.appendChild(boxes);

  const acts = el('div', 'pick-acts');
  const pickBtn = el('button', 'btn primary', 'Pick extruder');
  pickBtn.title = 'Change the live toolhead - blocks while the gantry moves';
  pickBtn.onclick = () => pickExtruder(toolheads, machineTool, handlers);
  const parkBtn = el('button', 'btn', 'Park extruder');
  parkBtn.title = 'Park the live toolhead, leaving none engaged';
  parkBtn.onclick = () => handlers.parkTool();
  acts.appendChild(pickBtn);
  acts.appendChild(parkBtn);
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
  motion.appendChild(jogWheel(handlers));

  // Z moves the bed on this machine, so it is a row that says "Bed" rather than a
  // third axis on a wheel that would imply the toolhead travels.
  const bedRow = el('div', 'bed-row');
  BED_STEPS.forEach((v) => {
    const b = el('button', 'bed-btn', `\u2191 ${v}`);
    b.title = `Move the bed up ${v} mm`;
    b.onclick = () => handlers.jog('Z', +v, activeTool);
    bedRow.appendChild(b);
  });
  bedRow.appendChild(el('span', 'bed-lab', 'Bed'));
  [...BED_STEPS].reverse().forEach((v) => {
    const b = el('button', 'bed-btn', `\u2193 ${v}`);
    b.title = `Move the bed down ${v} mm`;
    b.onclick = () => handlers.jog('Z', -v, activeTool);
    bedRow.appendChild(b);
  });
  motion.appendChild(bedRow);
  root.appendChild(motion);
}

/**
 * Choose the live toolhead: pick, then confirm. A toolchange parks one head and grabs
 * another, so it is not something to trigger by brushing a segmented control.
 */
function pickExtruder(toolheads, machineTool, handlers) {
  let chosen = machineTool != null ? machineTool : 0;
  openDialog({
    title: 'Pick extruder',
    build: (b) => {
      const p = document.createElement('p');
      p.className = 'dlg-note';
      p.textContent = 'The printer will park the current toolhead and pick up the one you '
                    + 'choose. The controls stay locked until it reports the change.';
      b.appendChild(p);
      const list = el('div', 'pick-list');
      const count = Math.max(toolheads.length, 4);
      for (let i = 0; i < count; i++) {
        const t = toolheads[i] || {};
        const row = el('button', 'pick-opt');
        if (i === chosen) row.dataset.chosen = '1';
        if (i === machineTool) row.dataset.live = '1';
        row.appendChild(icon(`iconExtruder${i + 1}`));
        const meta = [];
        if (t.nozzleDiameter) meta.push(`${t.nozzleDiameter} mm`);
        if (t.temperature != null) meta.push(`${Math.round(t.temperature)} \u00B0C`);
        if (i === machineTool) meta.push('live');
        const txt = el('span', 'pick-opt-txt');
        txt.appendChild(el('span', 'pick-opt-name', `Toolhead ${i + 1}`));
        txt.appendChild(el('span', 'pick-opt-meta', meta.join(' \u00B7 ')));
        row.appendChild(txt);
        row.onclick = () => {
          chosen = i;
          list.querySelectorAll('.pick-opt').forEach((r, k) => {
            if (k === i) r.dataset.chosen = '1'; else delete r.dataset.chosen;
          });
        };
        list.appendChild(row);
      }
      b.appendChild(list);
    },
    confirmLabel: 'Change toolhead',
    onConfirm: () => {
      if (chosen !== machineTool) handlers.pickTool(chosen);
      return true;
    },
  });
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

export function renderTask(root, job, tab, files, handlers, history) {
  root.innerHTML = '';
  if (tab === 'files') return renderFiles(root, files, handlers);
  if (tab === 'history') return renderHistory(root, history, handlers);

  const active = job.state === PRINT_STATE.PRINTING || job.state === PRINT_STATE.PAUSED;
  if (!active) {
    // An illustration on its own says nothing and offers nothing. Name the state and
    // give the one action that makes sense from here.
    const wrap = el('div');
    wrap.style.textAlign = 'center';
    illustration(wrap);
    const label = job.state && job.state !== PRINT_STATE.STANDBY
      ? `No active print · ${job.state}` : 'No active print';
    wrap.appendChild(el('div', 'cam-msg', label));
    if (job.filename) {
      wrap.appendChild(el('div', 'job-last', `Last file: ${job.filename}`));
    }
    const btns = el('div', 'job-btns');
    btns.style.justifyContent = 'center';
    const browse = el('button', 'btn primary', 'Browse printer files');
    browse.onclick = () => handlers.showFiles();
    btns.appendChild(browse);
    wrap.appendChild(btns);
    root.appendChild(wrap);
    return;
  }

  const wrap = el('div', 'job');
  wrap.appendChild(el('div', 'job-name', job.filename));

  const pct = Math.round(job.progress * 100);
  const bar = el('div', 'job-bar');
  const fill = el('div');
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);

  const meta = el('div', 'job-meta');
  meta.appendChild(el('span', null, `${pct}%`));
  meta.appendChild(el('span', null, `elapsed ${clock(job.printDuration)}`));
  meta.appendChild(el('span', null, `${(job.filamentUsed / 1000).toFixed(2)} m filament`));
  meta.appendChild(el('span', 'job-state', job.state));
  wrap.appendChild(meta);

  // Print control - the commands existed but had no way to reach them.
  const btns = el('div', 'job-btns');
  const paused = job.state === PRINT_STATE.PAUSED;
  const primary = el('button', 'btn primary', paused ? 'Resume' : 'Pause');
  primary.onclick = () => (paused ? handlers.resume() : handlers.pause());
  const stop = el('button', 'btn', 'Cancel');
  stop.onclick = () => handlers.confirmCancel();
  btns.appendChild(primary);
  btns.appendChild(stop);
  wrap.appendChild(btns);

  root.appendChild(wrap);
}

/* ---- print history --------------------------------------------------- */

/** Klipper's own job outcomes; anything else is shown verbatim. */
const JOB_STATUS = {
  completed: 'Completed', cancelled: 'Cancelled', error: 'Error',
  klippy_shutdown: 'Interrupted', klippy_disconnect: 'Interrupted',
  in_progress: 'In progress', server_exit: 'Interrupted',
};

/** `history` is { loading, error, items[], count }. */
export function renderHistory(root, history, handlers) {
  const h = history || {};
  if (h.loading) { root.appendChild(el('div', 'cam-msg', 'Loading…')); return; }
  if (h.error) {
    const wrap = el('div');
    wrap.style.textAlign = 'center';
    wrap.appendChild(el('div', 'cam-msg', h.error));
    const again = el('button', 'btn', 'Try again');
    again.onclick = () => handlers.loadHistory();
    wrap.appendChild(again);
    root.appendChild(wrap);
    return;
  }
  const items = h.items || [];
  if (!items.length) {
    const wrap = el('div');
    wrap.style.textAlign = 'center';
    illustration(wrap);
    wrap.appendChild(el('div', 'cam-msg', 'No completed prints on this printer'));
    root.appendChild(wrap);
    return;
  }

  const list = el('div', 'hist-list');
  items.forEach((j) => {
    const rowEl = el('div', 'hist-row');
    const status = String(j.status || '');
    rowEl.dataset.status = status === 'completed' ? 'ok'
                         : (status === 'in_progress' ? 'busy' : 'bad');

    const main = el('div', 'hist-main');
    main.appendChild(el('div', 'hist-name', j.filename || '(unnamed)'));
    const when = j.end_time || j.start_time;
    const bits = [];
    if (when) bits.push(new Date(when * 1000).toLocaleString());
    if (j.print_duration) bits.push(clock(j.print_duration));
    if (j.filament_used) bits.push(`${(j.filament_used / 1000).toFixed(2)} m`);
    main.appendChild(el('div', 'hist-meta', bits.join(' · ')));
    rowEl.appendChild(main);

    rowEl.appendChild(el('span', 'hist-status', JOB_STATUS[status] || status || '—'));
    list.appendChild(rowEl);
  });
  root.appendChild(list);

  // The reply carries no total, so the footer counts what is loaded and offers more
  // only while the last page came back full.
  const foot = el('div', 'hist-foot');
  foot.appendChild(el('span', null, `${items.length} shown`));
  if (h.hasMore) {
    const more = el('button', 'btn', 'Load more');
    more.onclick = () => handlers.loadHistory(items.length);
    foot.appendChild(more);
  }
  root.appendChild(foot);
}

/* ---- machine file browser -------------------------------------------- */

function fmtSize(n) {
  const v = Number(n) || 0;
  if (v > 1024 * 1024) return `${(v / 1048576).toFixed(1)} MB`;
  if (v > 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
}

/**
 * `files` is { loading, error, root, roots[], items[] }.
 * Items come from sw_GetFileListPage / sw_MachineFilesGetDirectory, whose
 * results differ between firmware builds, so field lookup is tolerant.
 */
export function renderFiles(root, files, handlers) {
  root.innerHTML = '';
  const wrap = el('div', 'files');

  const bar = el('div', 'files-bar');
  (files.roots || []).forEach((r) => {
    const name = (typeof r === 'string') ? r : (r.name || r.root || '');
    if (!name) return;
    const b = el('button', 'chip' + (name === files.root ? ' is-active' : ''), name);
    b.onclick = () => handlers.openRoot(name);
    bar.appendChild(b);
  });
  const reload = el('button', 'chip', 'Refresh');
  reload.onclick = () => handlers.openRoot(files.root);
  bar.appendChild(reload);
  wrap.appendChild(bar);

  if (files.loading) {
    wrap.appendChild(el('div', 'empty', 'Reading the machine…'));
  } else if (files.error) {
    wrap.appendChild(el('div', 'empty', files.error));
  } else if (!(files.items || []).length) {
    wrap.appendChild(el('div', 'empty', 'No files on this machine'));
  } else {
    const list = el('div', 'file-list');
    files.items.forEach((f) => {
      const path = f.path || f.filename || f.name || '';
      const row = el('div', 'file-row');
      row.appendChild(icon('iconFile'));
      const meta = el('div', 'file-meta');
      meta.appendChild(el('span', 'file-name', path.split('/').pop() || path));
      const sub = [];
      if (f.size != null) sub.push(fmtSize(f.size));
      if (f.modified) sub.push(new Date(Number(f.modified) * 1000).toLocaleString());
      meta.appendChild(el('span', 'file-sub', sub.join(' · ')));
      row.appendChild(meta);

      const info = el('button', 'btn', 'Details');
      info.title = 'Metadata, thumbnail and download';
      info.onclick = () => handlers.fileDetails(path);
      row.appendChild(info);

      const print = el('button', 'btn', 'Print');
      print.onclick = () => handlers.printFile(path);
      row.appendChild(print);

      const del = el('button', 'btn', 'Delete');
      del.onclick = () => handlers.deleteFile(path);
      row.appendChild(del);

      list.appendChild(row);
    });
    wrap.appendChild(list);
  }
  root.appendChild(wrap);
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
  root.innerHTML = '';
  slots.forEach((f, i) => {
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
    root.appendChild(slot);
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
  if (!fault) { root.hidden = true; root.innerHTML = ''; return; }

  const key = String(fault.code);
  if (root.dataset.code === key) return;
  root.dataset.code = key;
  root.hidden = false;
  root.innerHTML = '';
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
  body.appendChild(el('div', 'fault-code', bits.join(' · ')));
  root.appendChild(body);

  const again = el('button', 'btn', 'Re-check');
  again.onclick = () => handlers.queryException();
  root.appendChild(again);
}
