/*
 * mock.js - this surface's simulated host.
 *
 * A thin adapter, like the Device tab's, and for the same reason: the U1 AND Orca's own
 * side of the print dialog are both simulated in `shared/js/mockhost.js`, so the two
 * surfaces cannot be shown machines that disagree with each other.
 *
 * That is not a tidiness argument. This dialog's job is to match the FILE's filaments
 * against the MACHINE's, and if a surface-local mock invented both lists the match could
 * never fail - the check would be testing its own fixture. In the shared host the
 * machine half is `printer.filamentType` / `toolheads[].nozzle_diameter`, the file half
 * is `printer.job`, and they start out agreeing; a check that wants a mismatch has to
 * create one.
 *
 * The previous mock for this surface invented `{filaments:[{type,color,used_g}]}` - a
 * shape `sw_GetFileFilamentMapping` has never returned - and agreed with the client that
 * was written from the same head. Both were wrong together, all the way past a real Orca.
 *
 * If a command genuinely belongs to this surface alone, it goes here. Nothing does yet.
 */
'use strict';

import { installMockHost } from '../../../shared/js/mockhost.js';

/** Commands only the print dialog issues, that the shared host does not answer. */
const PREPRINT_HANDLERS = {};

export function installMock({ log = () => {}, onDialogClose = null } = {}) {
  return installMockHost({ log, handlers: PREPRINT_HANDLERS, onDialogClose });
}
