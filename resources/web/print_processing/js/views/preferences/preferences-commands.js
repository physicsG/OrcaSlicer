/*
 * What Print Preferences can ask for.
 *
 * `SET_PRINT_PREFERENCES`, one bare `KEY=value` per change, upper-cased from the
 * `print_task_config` field name - and Auto Leveling is the exception that makes the
 * translation worth having a table for: the machine REPORTS it as `auto_bed_leveling`
 * and ACCEPTS it as `BED_LEVEL`. Sending `AUTO_BED_LEVELING=` is an argument the macro
 * does not have, which a G-code macro answers `ok` to and then ignores. That is what
 * `arg` in PRINT_PREFERENCES is for; `key` reads, `arg` writes.
 *
 * This is also not `sw_UpdateMachineFilamentInfo`, for the same reason as the filament
 * mapping: that command writes Orca's record and never reaches the printer.
 */
'use strict';

import { CMD, PRINT_PREFERENCES, prefsLine } from '../../../../shared/js/protocol.js';

export function writePreference(bridge, key, value) {
  const pref = PRINT_PREFERENCES.find((p) => p.key === key);
  if (!pref) return Promise.reject(new Error(`unknown preference ${key}`));
  return bridge.request(CMD.SEND_GCODES, { script: prefsLine({ [pref.arg]: value }) });
}
