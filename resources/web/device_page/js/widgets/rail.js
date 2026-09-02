/*
 * rail.js - the left rail's device selector: which machine, and whether it answers.
 */
'use strict';

import { $ } from '../../../shared/js/dom.js';
import { DEVICE, deviceLabel } from '../../../shared/js/protocol.js';
import { data } from '../../../shared/js/render.js';

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
