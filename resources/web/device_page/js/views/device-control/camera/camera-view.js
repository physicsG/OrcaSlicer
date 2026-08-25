/*
 * The Camera panel's DOM.
 *
 * One viewport holding one to four tiles. A tile is an <img> that a poller in
 * camera-commands.js re-points; nothing here fetches anything.
 *
 * The panel used to be a single black box with one round play button in it, which is
 * what the shipped page shows. That is still what it looks like with one camera and
 * nothing playing - the extra machinery only appears when there is something to choose
 * between.
 */
'use strict';

import { $, el } from '../../../core/dom.js';
import { DEVICE, MOONRAKER_HTTP_PORT, CAMERA_FRAME_ROOT, CAMERA_FRAME_FILE,
         CAMERA_TRANSPORT, CAMERA_TRANSPORT_ORDER, CAMERA_TRANSPORT_TEXT,
         CAMERA_VIEW, CAMERA_VIEW_TILES, CAMERA_FPS_CHOICES,
         transportUsable, cameraLabel, snapshotUrl }
  from '../../../../../shared/js/protocol.js';
import { illustration } from '../../../widgets/art.js';
import { rebuildOn, text } from '../../../core/render.js';
import { openPopover } from '../../../core/overlay.js';

/**
 * Where a MONITOR frame comes from, measured rather than guessed.
 *
 * `camera.start_monitor` replies `{ state, url }` and then sends nothing further - there
 * is no frame push to wait for. The printer rewrites one file at the monitor interval
 * and the image is fetched over HTTP; see CAMERA_* in protocol.js for the whole finding.
 *
 * The reply's own `url` is relative to the printer's :80 web UI, which answers that path
 * with its SPA shell rather than an image, so it is used only when it is already
 * absolute - which is how the simulator hands back a data: URI. Otherwise the frame is
 * addressed on Moonraker's file server, keeping the filename the printer named.
 *
 * This is the STOCK path. A printer with the extended firmware's camera service never
 * comes through here: its stills are addressed by `snapshotUrl()` instead.
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

/** The <img> a poller re-points. Addressed by camera name so a repaint cannot orphan it. */
export function tileImage(name) {
  return $(`.cam-tile[data-cam="${CSS.escape(String(name))}"] img.cam-frame`);
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
  noFourth: 'No fourth camera',
};

export function renderCamera(root, connected, cam, handlers, device) {
  const status = handlers.cameraStatus ? handlers.cameraStatus() : null;
  const running = !!cam.streaming;
  const shape = !connected ? 'off' : 'view';

  // The tile set is part of the structure, so it is in the signature: adding a camera or
  // switching from one picture to four is a rebuild, while a new FRAME is not - the
  // <img> is re-pointed in place by the pump and must not be rebuilt under it.
  const names = status ? status.tiles.map((c) => c.name) : [];
  const sig = [shape, running ? 1 : 0, cam.view, names.join(','),
               cam.frameUrl || '', status ? status.transport : ''].join('|');

  rebuildOn(root, sig, () => {
    if (shape === 'off') {
      const wrap = el('div');
      wrap.style.textAlign = 'center';
      illustration(wrap);
      root.appendChild(wrap);
      return;
    }

    // The body is BLACK and the control is a round play button inside it, which is what
    // the shipped page shows: a viewport that is dark whether or not a frame is in it.
    const view = el('div', 'cam-view');
    view.dataset.view = cam.view;

    if (running) {
      const grid = el('div', 'cam-tiles');
      const want = CAMERA_VIEW_TILES[cam.view] || 1;
      const monitor = status && status.transport === CAMERA_TRANSPORT.MONITOR;

      if (monitor) {
        // One file, no camera list, no name to hang a tile off. It is still a tile, so
        // that one piece of markup serves both printers.
        grid.appendChild(tile('__monitor', null, cam.frameUrl, 0, cam, handlers));
      } else {
        status.tiles.forEach((c, i) => grid.appendChild(
          tile(c.name, cameraLabel(c), snapshotUrl(device, c), i, cam, handlers, c)));
        // A 2x2 that draws three cameras leaves one cell. Saying why is better than a
        // three-up layout that reflows the moment a second USB camera is plugged in -
        // and the extended firmware supports exactly that.
        for (let i = status.tiles.length; i < want; i++) {
          const empty = el('div', 'cam-tile is-empty');
          empty.appendChild(el('div', 'cam-tile-msg', CAMERA_TEXT.noFourth));
          grid.appendChild(empty);
        }
      }
      view.appendChild(grid);
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

    if (!running) view.appendChild(el('div', 'cam-msg', ''));
    root.appendChild(view);
  });

  // The message is patched rather than keyed on: an error arriving is not a change of
  // shape, and rebuilding for it would take the live <img> with it.
  const msg = root.querySelector('.cam-msg');
  // The bundle's own wording, not ours: CAMERA_TEXT holds every string it uses here.
  if (msg) text(msg, cam.error || (running ? CAMERA_TEXT.loading : CAMERA_TEXT.off));

  // The overlay chips read the frame rate and the camera name, which change without the
  // structure changing, so they are patched every paint rather than built into the key.
  root.querySelectorAll('.cam-tile[data-cam]').forEach((t) => {
    const i = Number(t.dataset.index || 0);
    t.classList.toggle('is-focus', running && i === cam.focus);
  });
}

/** One picture, its name, and the hit target that makes it the focused one. */
function tile(name, label, url, index, cam, handlers, entry) {
  const t = el('div', 'cam-tile');
  t.dataset.cam = name;
  t.dataset.index = String(index);

  const im = el('img', 'cam-frame');
  im.alt = label ? `${label} camera` : 'Live view';
  // No src here. The poller sets it - starting with one would fetch a frame the pump is
  // about to replace, and on the monitor transport it would fetch the cached one.
  if (url && index === 0 && !entry) im.src = url;
  t.appendChild(im);

  if (label) {
    t.appendChild(el('span', 'cam-tile-name', label));
    // Clicking a tile is how it becomes the one that polls fast. Everything else drops
    // to 1 fps, which is what makes a grid cost 3.5 MB/s instead of 4.7.
    t.tabIndex = 0;
    t.title = `Watch ${label} at full frame rate`;
    const take = () => handlers.focusTile(index);
    t.onclick = take;
    t.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); take(); } };
  }
  return t;
}

/* ---- the settings popover -------------------------------------------- */

/**
 * Anchored under the gear that owns it, and the picture stays up behind it.
 *
 * That is the whole argument for a popover over a settings tab here: the settings are
 * about what the picture looks like, and a sheet that replaces the picture hides the
 * thing being adjusted at exactly the moment it is being adjusted.
 */
export function openCameraSettings(anchor, cam, handlers) {
  openPopover(anchor, {
    title: 'Camera',
    width: 330,

    // What this panel DRAWS, so `repaintPopover` knows when it has gone stale. Without
    // it the popover is built once and never again: every control here worked and none
    // of them moved their own tick, because the tick is drawn from `store.cam` and a
    // popover sits outside every panel `paint()` walks.
    //
    // Not a repaint-every-frame: this rebuilds the body, which would take focus and
    // hover with it on a tick the user did not cause.
    sig: () => [cam.view, cam.transport, cam.fps, cam.focus,
                cam.picked.join(','), cam.cams.length,
                handlers.cameraStatus().transport].join('|'),

    build: (b) => {
      b.classList.add('cam-set');
      // Read inside build, not outside it: this runs again on every change, and a value
      // captured when the popover opened is exactly the staleness being fixed.
      const st = handlers.cameraStatus();

      group(b, 'Views', (g) => {
        seg(g, [
          [CAMERA_VIEW.SINGLE, 'Single'], [CAMERA_VIEW.SPLIT, 'Split'],
          [CAMERA_VIEW.GRID, 'Grid'],     [CAMERA_VIEW.PIP, 'PiP'],
        ], cam.view, (v) => handlers.setCameraView(v));
      });

      if (st.direct) {
        group(b, 'Cameras', (g) => {
          const row = el('div', 'cam-pick-row');
          st.tiles.forEach((c, i) => {
            const on = i < (CAMERA_VIEW_TILES[cam.view] || 1);
            row.appendChild(camChip(c, on, i === cam.focus,
                                    () => handlers.focusTile(i)));
          });
          cam.cams.filter((c) => !st.tiles.some((t) => t.name === c.name))
            .forEach((c) => row.appendChild(
              camChip(c, false, false, () => handlers.pickCamera(c.name, 0))));
          g.appendChild(row);
        });
      }

      group(b, 'Transport', (g) => {
        const list = el('div', 'cam-modes');
        [CAMERA_TRANSPORT.AUTO, ...CAMERA_TRANSPORT_ORDER].forEach((t) => {
          const usable = t === CAMERA_TRANSPORT.AUTO
                      || transportUsable(t, st.caps, st.direct);
          const chosen = cam.transport === t;
          const r = el('button', 'cam-mode');
          r.type = 'button';
          if (chosen) r.dataset.on = '1';
          if (!usable) r.dataset.off = '1';
          r.disabled = !usable;

          const info = CAMERA_TRANSPORT_TEXT[t];
          r.appendChild(el('span', 'cam-mode-dot'));
          const body = el('div', 'cam-mode-body');
          body.appendChild(el('span', 'cam-mode-name', info.name));
          body.appendChild(el('span', 'cam-mode-hint', info.hint));
          r.appendChild(body);

          // Auto reports what it landed on, so naming the transports is still doing work
          // even for someone who never changes this.
          if (t === CAMERA_TRANSPORT.AUTO && chosen) {
            r.appendChild(el('span', 'cam-mode-tag',
                             CAMERA_TRANSPORT_TEXT[st.transport].name));
          } else if (!usable) {
            // The reason lives next to the greyed thing, not in its name. This is the
            // whole reason the transports are named after transports.
            r.appendChild(el('span', 'cam-mode-tag is-no', info.absent || 'unavailable'));
          }

          if (usable) r.onclick = () => handlers.setCameraTransport(t);
          list.appendChild(r);
        });
        g.appendChild(list);
      });

      group(b, 'Frames per second', (g) => {
        seg(g, CAMERA_FPS_CHOICES.map((n) => [n, String(n)]), cam.fps,
            (n) => handlers.setCameraFps(n));
        const note = el('div', 'cam-note');
        // Both halves measured: the printer's own target_fps is 15, and three tiles of
        // its 226 KB / 87 KB / 710 B frames at 15 is 4.7 MB/s.
        note.textContent = st.direct
          ? `The printer's own limit is 15. Tiles you are not watching drop to 1, `
            + `which is what keeps a grid near 3.5 MB/s instead of 4.7.`
          : 'This printer has no camera service, so the monitor file sets the rate.';
        g.appendChild(note);
      });

      const foot = el('div', 'cam-set-foot');
      const scan = el('button', 'btn', 'Look for cameras again');
      scan.type = 'button';
      scan.onclick = () => handlers.rescanCameras();
      foot.appendChild(scan);
      b.appendChild(foot);
    },
  });
}

function group(parent, label, build) {
  const g = el('div', 'cam-set-group');
  g.appendChild(el('div', 'cam-set-label', label));
  build(g);
  parent.appendChild(g);
  return g;
}

function seg(parent, items, current, on) {
  const s = el('div', 'cam-seg');
  items.forEach(([value, label]) => {
    const b = el('button', 'cam-seg-btn', label);
    b.type = 'button';
    if (String(value) === String(current)) b.dataset.on = '1';
    b.onclick = () => on(value);
    s.appendChild(b);
  });
  parent.appendChild(s);
  return s;
}

function camChip(c, shown, focused, on) {
  const b = el('button', 'cam-chip');
  b.type = 'button';
  if (shown) b.dataset.on = '1';
  if (focused) b.dataset.focus = '1';
  b.appendChild(el('span', 'cam-chip-th'));
  const m = el('div', 'cam-chip-meta');
  m.appendChild(el('span', 'cam-chip-name', cameraLabel(c)));
  // The resolution is the honest way to say which of two cameras this is - the names
  // the printer gives them ("case", "usb") mean nothing to someone looking at a picture.
  const dim = c.extra_data && c.extra_data.resolution;
  m.appendChild(el('span', 'cam-chip-sub', dim || c.service || ''));
  b.appendChild(m);
  b.onclick = on;
  return b;
}
