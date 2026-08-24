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
import { openDialog, numberField } from './overlay.js';
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

/** Edit a temperature target through a modal, with the shipped page's limits. */
function editTemp(title, limit, current, hint, apply) {
  let input;
  openDialog({
    title,
    build: (b) => {
      input = numberField(b, {
        label: 'Target temperature', value: Math.round(current || 0),
        min: limit.min, max: limit.max, unit: limit.unit, hint,
      });
    },
    confirmLabel: 'Set',
    onConfirm: () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < limit.min || v > limit.max) {
        input.focus();
        return false;   // out of range: keep the dialog open
      }
      apply(v);
      return true;
    },
  });
}

export function renderStatusCard(root, toolheads, bed, led, fans, purifier,
                                 speed, handlers) {
  root.innerHTML = '';

  toolheads.forEach((t, i) => {
    const row = el('div', 'status-row');
    row.appendChild(icon(`iconExtruder${i + 1}`));
    row.appendChild(el('span', 'val', temps(t.temperature, t.target)));
    row.title = `Toolhead ${i + 1} — click to set target`;
    row.onclick = () => editTemp(
      `Toolhead ${i + 1} temperature`, LIMITS.nozzleTemp, t.target,
      `Between ${LIMITS.nozzleTemp.min}°C and ${LIMITS.nozzleTemp.max}°C`,
      (v) => handlers.setExtruderTemp(i, v));
    root.appendChild(row);
  });

  const bedRow = el('div', 'status-row');
  bedRow.appendChild(icon('iconHotBedTemperature'));
  bedRow.appendChild(el('span', 'val', temps(bed.temperature, bed.target)));
  bedRow.title = 'Heated bed — click to set target';
  bedRow.onclick = () => editTemp(
    'Heated bed temperature', LIMITS.bedTemp, bed.target,
    // verbatim from the bundle's own validation string
    `Heated bed temperature must be set between ${LIMITS.bedTemp.min}°C `
    + `and ${LIMITS.bedTemp.max}°C`,
    (v) => handlers.setBedTemp(v));
  root.appendChild(bedRow);

  const ledRow = el('div', 'status-row');
  ledRow.appendChild(icon('iconLed'));
  const sw = el('button', 'switch');
  sw.setAttribute('aria-checked', led.on ? 'true' : 'false');
  sw.setAttribute('role', 'switch');
  sw.title = 'Chamber light';
  sw.onclick = (e) => { e.stopPropagation(); handlers.setLed(!led.on); };
  ledRow.appendChild(sw);
  root.appendChild(ledRow);

  const fanRow = el('div', 'status-row');
  fanRow.appendChild(icon('iconFan'));
  fanRow.appendChild(el('span', 'val', `${fans.main}%`));
  fanRow.appendChild(el('span', 'go', '›'));
  fanRow.title = 'Cooling fans';
  fanRow.onclick = () => {
    let main, cavity;
    openDialog({
      title: 'Cooling',
      build: (b) => {
        main = numberField(b, { label: 'Main cooling fan', value: fans.main,
                                min: 0, max: 100, unit: '%' });
        cavity = numberField(b, { label: 'Assist cooling fan', value: fans.cavity,
                                  min: 0, max: 100, unit: '%' });
      },
      confirmLabel: 'Apply',
      onConfirm: () => {
        handlers.setMainFan(Number(main.value));
        handlers.setCavityFan(Number(cavity.value));
      },
    });
  };
  root.appendChild(fanRow);

  const purRow = el('div', 'status-row');
  purRow.appendChild(icon('iconPurifier'));
  purRow.appendChild(el('span', 'val',
    purifier.present ? (purifier.modeName || String(purifier.mode ?? '_')) : '_'));
  purRow.appendChild(el('span', 'go', '›'));
  purRow.title = 'Air purifier';
  purRow.onclick = () => {
    let sel;
    openDialog({
      title: 'Air purifier',
      build: (b) => {
        const wrap = el('label', 'field');
        wrap.appendChild(el('span', 'field-label', 'Mode'));
        sel = document.createElement('select');
        sel.className = 'field-row';
        // Integers, not names: the wire value is a number (see PURIFIER_MODES).
        Object.entries(PURIFIER_MODES).forEach(([v, t]) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = t;
          if (String(purifier.mode) === String(v)) o.selected = true;
          sel.appendChild(o);
        });
        wrap.appendChild(sel);
        b.appendChild(wrap);
      },
      confirmLabel: 'Apply',
      onConfirm: () => handlers.setPurifierMode(sel.value),
    });
  };
  root.appendChild(purRow);

  // Print speed lives at the foot of the left column and opens a sheet, the same way
  // the fan and purifier rows do - a row of buttons inline made it the one setting you
  // could change by brushing past it.
  const cur = speed && speed.factorPct != null ? speed.factorPct : 100;
  const spRow = el('div', 'status-row');
  spRow.appendChild(icon('iconSpeed'));
  spRow.appendChild(el('span', 'val', `${cur}%`));
  spRow.appendChild(el('span', 'go', '\u203A'));
  spRow.title = 'Print speed';
  spRow.onclick = () => {
    let chosen = cur;
    openDialog({
      title: 'Print speed',
      build: (b) => {
        b.appendChild(el('p', 'ms-note',
          `Whole ${SPEED_STEP}% steps, between ${LIMITS.printSpeed.min}% and `
          + `${LIMITS.printSpeed.max}% \u2014 the rates the printer accepts.`));
        const seg = el('div', 'seg speeds wide');
        for (let v = LIMITS.printSpeed.min; v <= LIMITS.printSpeed.max; v += SPEED_STEP) {
          const btn = el('button', v === chosen ? 'is-active' : null, `${v}%`);
          btn.onclick = () => {
            chosen = v;
            seg.querySelectorAll('button').forEach((x) => x.classList.remove('is-active'));
            btn.classList.add('is-active');
          };
          seg.appendChild(btn);
        }
        b.appendChild(seg);
      },
      confirmLabel: 'Apply',
      onConfirm: () => handlers.setSpeed(chosen),
    });
  };
  root.appendChild(spRow);
}

/* ---- control: right cluster ----------------------------------------- */
const STEPS = ['10mm', '1mm', '0.1mm'];
let activeTool = 0;
let activeStep = 0;
let head = {};          // last `toolhead` snapshot, for the readouts and homing state

/*
 * Two different things, kept apart.
 *
 * `activeTool` is which toolhead the jog and extrude controls address - a UI choice,
 * local, instant, and harmless. Picking it must NOT move the machine: that was wrong,
 * and it made an idle click into a mechanical operation.
 *
 * Actually changing the live toolhead is a separate, deliberate action behind its own
 * button, and it blocks the surface while it runs - the gantry is moving and a second
 * command sent into that window is not what anyone meant. `machineTool` is what the
 * machine reports, and it is never inferred from a click.
 */
export function renderControlMain(root, toolheads, handlers, th) {
  root.innerHTML = '';
  if (th) head = th;

  const machineTool = head.activeIndex != null ? head.activeIndex : null;

  const top = el('div', 'control-top');

  // Four buttons regardless: a toolhead that has not reported yet is still a toolhead,
  // and building this from a possibly-empty state array left the row blank.
  const count = Math.max(toolheads.length, 4);
  const tools = el('div', 'seg tools');
  for (let i = 0; i < count; i++) {
    const b = el('button', i === activeTool ? 'is-active' : null, `Tool${i + 1}`);
    if (i === machineTool) b.dataset.live = '1';
    b.title = i === machineTool
      ? `Toolhead ${i + 1} — target for jog and extrude, and live on the machine`
      : `Target jog and extrude at toolhead ${i + 1} (does not change the tool)`;
    b.onclick = () => { activeTool = i; renderControlMain(root, toolheads, handlers); };
    tools.appendChild(b);
  }
  top.appendChild(tools);

  const steps = el('div', 'seg steps');
  STEPS.forEach((s, i) => {
    const b = el('button', i === activeStep ? 'is-active' : null, s);
    b.onclick = () => { activeStep = i; renderControlMain(root, toolheads, handlers); };
    steps.appendChild(b);
  });
  top.appendChild(steps);

  // Changing the live toolhead is its own action, not a side effect of selection.
  const pick = el('button', 'home-btn pick-btn');
  pick.title = machineTool != null
    ? `Change the live toolhead (currently ${machineTool + 1})`
    : 'Change the live toolhead';
  pick.appendChild(icon('iconExtruderHead'));
  pick.onclick = () => pickExtruder(toolheads, machineTool, handlers);
  top.appendChild(pick);

  const home = el('button', 'home-btn');
  home.title = 'Home all axes';
  home.appendChild(icon('deviceActionHome'));
  home.onclick = () => handlers.home();
  top.appendChild(home);

  root.appendChild(top);

  // jog: an extruder column, the XY rosette, and the Z column
  const jog = el('div', 'jog');
  jog.appendChild(axisColumn('E', handlers));
  jog.appendChild(rosette(handlers));
  jog.appendChild(axisColumn('Z', handlers));
  root.appendChild(jog);

  root.appendChild(el('div', 'extrude-bar', '--------'));
}

/**
 * Choose the live toolhead.
 *
 * Deliberately a two-step: pick, then confirm. A toolchange parks one head and grabs
 * another, so it is not something to trigger by brushing a segmented control.
 */
function pickExtruder(toolheads, machineTool, handlers) {
  let chosen = machineTool != null ? machineTool : 0;
  openDialog({
    title: 'Pick extruder',
    build: (b) => {
      b.appendChild(el('p', 'ms-note',
        'The printer will park the current toolhead and pick up the one you choose. '
        + 'The controls stay locked until it reports the change.'));
      const list = el('div', 'pick-list');
      const count = Math.max(toolheads.length, 4);
      for (let i = 0; i < count; i++) {
        const t = toolheads[i] || {};
        const row = el('button', 'pick-row');
        if (i === chosen) row.dataset.chosen = '1';
        if (i === machineTool) row.dataset.live = '1';
        const name = el('div', 'pick-name', `Toolhead ${i + 1}`);
        row.appendChild(name);
        const meta = [];
        if (t.nozzleDiameter) meta.push(`${t.nozzleDiameter} mm`);
        if (t.temperature != null) meta.push(`${Math.round(t.temperature)} °C`);
        if (i === machineTool) meta.push('live');
        row.appendChild(el('div', 'pick-meta', meta.join(' · ')));
        row.onclick = () => {
          chosen = i;
          list.querySelectorAll('.pick-row').forEach((r, k) => {
            if (k === i) r.dataset.chosen = '1'; else delete r.dataset.chosen;
          });
        };
        list.appendChild(row);
      }
      b.appendChild(list);
    },
    confirmLabel: 'Change toolhead',
    onConfirm: () => {
      if (chosen === machineTool) return true;   // nothing to do
      handlers.pickTool(chosen);
      return true;
    },
  });
}

function stepMm() { return parseFloat(STEPS[activeStep]); }

function axisReadout(axis) {
  // '------' is the shipped page's placeholder and stays correct when nothing is known.
  if (axis === 'E') return '------';
  const v = head[String(axis).toLowerCase()];
  if (v == null) return '------';
  const homed = head.isHomed ? head.isHomed(axis) : false;
  return `${axis} ${v.toFixed(1)}${homed ? '' : '*'}`;
}

function axisColumn(axis, handlers) {
  const col = el('div', 'axis-col');
  const up = el('button', 'round-btn');
  up.appendChild(el('span', 'tri', '▲'));
  up.onclick = () => handlers.jog(axis, +stepMm(), activeTool);
  const down = el('button', 'round-btn');
  down.appendChild(el('span', 'tri', '▼'));
  down.onclick = () => handlers.jog(axis, -stepMm(), activeTool);
  col.appendChild(up);
  const label = el('div', 'axis-label', axisReadout(axis));
  if (axis !== 'E' && head.isHomed && !head.isHomed(axis)) {
    label.title = `${axis} is not homed - Klipper refuses a move until it is`;
  }
  col.appendChild(label);
  col.appendChild(down);
  return col;
}

function rosette(handlers) {
  const r = el('div', 'rosette');
  const mk = (cls, glyph, ax, sign) => {
    const b = el('button', cls, glyph);
    b.onclick = () => handlers.jog(ax, sign * stepMm(), activeTool);
    return b;
  };
  r.appendChild(mk('up', '▲', 'Y', +1));
  r.appendChild(mk('down', '▼', 'Y', -1));
  r.appendChild(mk('left', '◀', 'X', -1));
  r.appendChild(mk('right', '▶', 'X', +1));
  const hub = el('div', 'hub', 'XY');
  if (head.allHomed === false) {
    hub.title = 'Not homed - home the axes before jogging';
    hub.dataset.warn = '1';
  }
  r.appendChild(hub);
  return r;
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
