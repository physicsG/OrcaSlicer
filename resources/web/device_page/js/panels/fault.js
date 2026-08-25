/*
 * The fault banner.
 *
 * Not a panel: it has no header and no body chrome, and it sits directly in `.content`
 * above both destinations, because a fault is about the machine rather than about
 * whichever view happens to be open.
 */
'use strict';

import { CMD } from '../../../shared/js/protocol.js';
import * as ui from '../ui.js';

export default {
  id: 'fault',
  bare: true,                 // no <section>/<header>; the body element is the whole thing
  view: null,                 // above both destinations
  bodyId: 'fault',
  bodyClass: 'fault',
  hiddenAtRest: true,

  reads: ['activity', 'store.exception'],
  // BEDMESH_ABORT is deliberately absent: handlers.abortBedMesh exists but nothing
  // calls it, so no control on this page can issue it. Declaring it here would hide
  // exactly the gap `sends` is for.
  sends: [CMD.EXCEPTION_QUERY],

  update(root, ctx) {
    ui.renderFault(root, ctx.state.activity(), ctx.exception, ctx.handlers);
  },
};
