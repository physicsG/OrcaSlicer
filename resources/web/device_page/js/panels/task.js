/*
 * The Printing Task card.
 *
 * The thumbnail is fetched once per file rather than per repaint - this card repaints
 * about once a second, and `sw_FilesThumbnailsBase64` is a round trip to the printer.
 */
'use strict';

import { CMD } from '../../../shared/js/protocol.js';
import * as ui from '../ui.js';

export default {
  id: 'task',
  title: 'Printing Task',
  view: 'control',
  bodyId: 'task',
  bodyClass: 'task-body',

  reads: ['job', 'device', 'store.jobThumb'],
  sends: [CMD.PRINT_PAUSE, CMD.PRINT_RESUME, CMD.PRINT_CANCEL, CMD.FILE_THUMBS_B64],

  update(root, ctx) {
    ctx.handlers.refreshJobThumb(ctx.state.job().filename);
    ui.renderTask(root, ctx.state.job(), ctx.handlers, ctx.device, ctx.jobThumb);
  },
};
