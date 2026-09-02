/*
 * What Select Printer can ask for.
 *
 * Choosing a saved device is the PAGE's own bookkeeping - which record the rest of the
 * dialog reads - and reaches no host. Adding one is not: `sw_AddDevice` opens Orca's own
 * dialog, the same way the Device page's rail asks for the login dialog rather than
 * offering a form. There is nothing to add a printer with here, and inventing one would
 * be inventing a pairing flow.
 */
'use strict';

import { CMD } from '../../../../shared/js/protocol.js';

export function addDevice(bridge) {
  return bridge.request(CMD.ADD_DEVICE, {});
}
