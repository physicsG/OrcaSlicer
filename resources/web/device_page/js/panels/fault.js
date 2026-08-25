/*
 * The fault banner.
 *
 * Not a panel: it has no header and no body chrome, and it sits directly in `.content`
 * above both destinations, because a fault is about the machine rather than about
 * whichever view happens to be open.
 */
'use strict';

import * as ui from '../ui.js';

export default {
  id: 'fault',
  bare: true,                 // no <section>/<header>; the body element is the whole thing
  view: null,                 // above both destinations
  bodyId: 'fault',
  bodyClass: 'fault',
  hiddenAtRest: true,

  reads: ['activity', 'store.exception'],

  update(root, ctx) {
    ui.renderFault(root, ctx.state.activity(), ctx.store.exception, ctx.handlers);
  },
};
