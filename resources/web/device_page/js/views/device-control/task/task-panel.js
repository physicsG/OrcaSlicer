/*
 * The Printing Task card.
 *
 * The thumbnail is fetched once per file rather than per repaint - this card repaints
 * about once a second, and `sw_FilesThumbnailsBase64` is a round trip to the printer.
 */
'use strict';

import { renderTask } from './task-view.js';

export default {
  id: 'task',
  title: 'Printing Task',
  view: 'control',
  bodyId: 'task',
  bodyClass: 'task-body',

  reads: ['job', 'device', 'store.jobThumb'],

  update(root, ctx) {
    ctx.handlers.refreshJobThumb(ctx.state.job().filename);
    renderTask(root, ctx.state.job(), ctx.handlers, ctx.store.device, ctx.store.jobThumb.data);
  },
};
