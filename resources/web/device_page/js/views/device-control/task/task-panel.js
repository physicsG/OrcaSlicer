/*
 * The Printing Task card.
 *
 * The thumbnail is fetched once per file rather than per repaint - this card repaints
 * about once a second, and `sw_FilesThumbnailsBase64` is a round trip to the printer.
 *
 * The status word lives in the header rather than in the card. It was a badge on a row
 * of its own, above a second row repeating the machine's name that the rail already
 * shows - two rows of furniture around one word. A panel header is where a panel says
 * what it is; saying what it is DOING in the same line costs nothing and gives the card
 * back 24px plus its margin.
 */
'use strict';

import { renderTask, stateLabel } from './task-view.js';

export default {
  id: 'task',
  title: 'Printing Task',
  view: 'control',
  column: 'main',
  bodyId: 'task',
  bodyClass: 'task-body',

  header: [
    { kind: 'gap' },
    { kind: 'status', id: 'task-state', cls: 'job-badge',
      text: (ctx) => stateLabel(ctx.state.job().state),
      state: (ctx) => ctx.state.job().state,
      // The badge already carries `stateLabel()`, which is the machine's word in words.
      // The hover used to carry the raw one beside it - `print_stats.state: standby` - so
      // that the rename to `idle` "hid nothing"; translating is not hiding, and the field
      // name was the only thing the second copy added.
    },
    { kind: 'spacer' },
  ],

  reads: ['job', 'device', 'store.jobThumb'],

  update(root, ctx) {
    ctx.handlers.refreshJobThumb(ctx.state.job().filename);
    renderTask(root, ctx.state.job(), ctx.handlers, ctx.store.device, ctx.store.jobThumb.data);
  },
};
