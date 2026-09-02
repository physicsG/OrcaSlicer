/*
 * What Edit Filament can ask for.
 *
 * The mapping is written with G-CODE MACROS, not with `sw_UpdateMachineFilamentInfo`.
 * That command's name reads like the write and is not one: it writes ORCA's own
 * per-device filament record and never reaches the printer, which is why two panels on
 * the Device page sent it and did nothing at all on a real machine, silently, because
 * neither awaited its own request. See device_page/js/core/orcasync.js.
 *
 * The two macros are the shipped bundle's, recovered from `setPrePrintConfiguration`:
 * it emits them in one script, so they are joined the same way here.
 *
 *   SET_PRINT_EXTRUDER_MAP    CONFIG_EXTRUDER=<file filament>  MAP_EXTRUDER=<toolhead>
 *   SET_PRINT_USED_EXTRUDERS  EXTRUDERS=<comma-joined toolheads>
 *
 * Bare `KEY=value`, not quoted: only SET_PRINT_FILAMENT_CONFIG goes through the quoting
 * map, and passing these through it would send `CONFIG_EXTRUDER='0'`.
 *
 * `EXTRUDERS` is the set of TOOLHEADS in use, de-duplicated - two filaments can share
 * one head - and not the file's filament indices. On the machine `extruders_used` is one
 * flag per toolhead.
 */
'use strict';

import { CMD, PRINT_TASK, plainLine } from '../../../../shared/js/protocol.js';

export function writeAssignment(bridge, { fileIndex, toolhead, allToolheads }) {
  const heads = [...new Set(allToolheads.map((n) => Number(n) || 0))].sort((a, b) => a - b);
  const script = [
    plainLine(PRINT_TASK.EXTRUDER_MAP,
              { CONFIG_EXTRUDER: fileIndex, MAP_EXTRUDER: Number(toolhead) || 0 }),
    plainLine(PRINT_TASK.USED_EXTRUDERS, { EXTRUDERS: heads.join(',') }),
  ].join('\n');
  return bridge.request(CMD.SEND_GCODES, { script });
}

/** `A.b9R` - the refresh button re-reads the file's filaments, debounced by the bundle. */
export function refreshMapping(bridge, filename) {
  return bridge.request(CMD.GET_FILE_FILAMENT_MAPPING, { filename: filename || '' });
}
