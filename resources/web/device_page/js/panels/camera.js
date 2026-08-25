/*
 * The Camera panel.
 *
 * Frames are polled, not pushed: `camera.start_monitor` returns a URL and the printer
 * then rewrites that one file at the monitor interval. See 08-function-gap-analysis.md.
 */
'use strict';

import * as ui from '../ui.js';

export default {
  id: 'camera',
  title: 'Camera',
  view: 'control',
  bodyId: 'camera',
  bodyClass: 'camera-body',

  reads: ['store.cam', 'reachable'],

  update(root, ctx) {
    ui.renderCamera(root, ctx.store.reachable, ctx.store.cam, ctx.handlers);
  },
};
