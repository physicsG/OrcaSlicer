/*
 * mock.js - the Device tab's simulated host.
 *
 * Everything this surface needs is already in the shared simulation, so this
 * is a thin adapter. It exists as a named seam: device-only commands (camera,
 * timelapse, file browser) get added here without touching the shared host or
 * the print-processing surface.
 */
'use strict';

import { installMockHost } from '../../../shared/js/mockhost.js';

/** Commands only the Device tab issues. */
const DEVICE_HANDLERS = {
  // sw_exception_query: () => ({ exceptions: [] }),
};

export function installMock({ log = () => {} } = {}) {
  return installMockHost({ log, handlers: DEVICE_HANDLERS });
}
