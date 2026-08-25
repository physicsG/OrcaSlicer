/*
 * The Camera panel's DOM.
 */
'use strict';

import { $, el } from '../../../core/dom.js';
import { LIMITS, DEVICE, MOONRAKER_HTTP_PORT, CAMERA_FRAME_ROOT, CAMERA_FRAME_FILE } from '../../../../../shared/js/protocol.js';
import { illustration } from '../../../widgets/art.js';
import { rebuildOn, text, data } from '../../../core/render.js';

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
