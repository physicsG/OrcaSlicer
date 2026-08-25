/*
 * The Camera panel.
 *
 * Frames are polled, not pushed: `camera.start_monitor` returns a URL and the printer
 * then rewrites that one file at the monitor interval. See 08-function-gap-analysis.md.
 */
'use strict';

import { CMD } from '../../../shared/js/protocol.js';
import * as ui from '../ui.js';

export default {
  id: 'camera',
  title: 'Camera',
  view: 'control',
  bodyId: 'camera',
  bodyClass: 'camera-body',

  reads: ['store.cam', 'reachable'],
  sends: [CMD.CAMERA_START, CMD.CAMERA_STOP],

  update(root, ctx) {
    ui.renderCamera(root, ctx.reachable, ctx.cam, ctx.handlers);
  },
};
