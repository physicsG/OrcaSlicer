/*
 * diag.js - the diagnostics beacon.
 *
 * Per-command tracing is opt-in (?diag=1) because it is far too chatty for normal use.
 *
 * It beacons to a local collector as well as to Orca's log, and that is not redundancy:
 * sw_FileLog travels over the very bridge being diagnosed, so when that stalls the
 * evidence disappears exactly when it is needed.
 *
 * Never log the logging command. sw_FileLog tracing its own traffic is a live feedback
 * loop, not a theoretical one - it filled the sink in under a second.
 */
'use strict';

import { CMD } from '../../../shared/js/protocol.js';

/** A plain HTTP POST that shares nothing with SSWCP. Harmless with no collector. */
const DIAG_URL = 'http://127.0.0.1:8799/';

/** Per-command tracing is opt-in (?diag=1): it is far too chatty for normal use. */
export const DIAG = new URLSearchParams(location.search).get('diag') === '1';

/**
 * @param bridge () => the live client, or null. A getter: diagnostics start before the
 *        bridge does, and the first thing worth logging is often that it never arrived.
 */
export function createLog(bridge) {
  return function hostLog(text, level = 'warning') {
    if (DIAG) {
      try { navigator.sendBeacon(DIAG_URL, `${level}: ${text}`); } catch { /* no sink */ }
    }
    try {
      bridge().request(CMD.FILE_LOG,
                       { level, content: `[rebuilt-device] ${text}` }).catch(() => {});
    } catch { /* no bridge yet */ }
  };
}
