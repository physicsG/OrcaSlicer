/*
 * The Camera panel.
 *
 * Two printers behind one panel. A stock U1 gives half a frame per second through
 * `camera.start_monitor`; one running the extended firmware gives 14 fps from either of
 * two real cameras, and the difference is DETECTED rather than configured - see
 * camera-commands.js. Everything the user can change about that lives behind the gear,
 * anchored under it, so the picture stays up while it is being changed.
 */
'use strict';

import { renderCamera, openCameraSettings } from './camera-view.js';

export default {
  id: 'camera',
  title: 'Camera',
  view: 'control',
  column: 'main',
  grow: true,
  bodyId: 'camera',
  bodyClass: 'camera-body',

  header: [
    { kind: 'spacer' },
    { kind: 'icon', id: 'camera-settings', cls: 'icon-only', icon: 'settings',
      title: 'Camera settings',
      on: (ctx) => openCameraSettings(document.getElementById('camera-settings'),
                                      ctx.store.cam, ctx.handlers) },
  ],

  reads: ['store.cam', 'store.device', 'reachable'],

  update(root, ctx) {
    renderCamera(root, ctx.store.reachable, ctx.store.cam, ctx.handlers, ctx.store.device);
  },
};
