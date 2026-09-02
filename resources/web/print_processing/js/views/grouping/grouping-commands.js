/*
 * What the grouping panel can ask for.
 *
 * ONE command, and it writes the IDENTITY.
 *
 * A `T<n>` in the file is a *logical* tool that the U1 resolves through
 * `print_task_config.extruder_map_table`, and the preprint page rewrites that table
 * immediately before every print. For an ordinary plate a remap is a feature - it lets a
 * file authored for head 0 print from the spool that happens to be in head 2. For an ACE
 * plate it is never right: the gcode's `ACE_SWAP_HEAD HEAD=n` names the physical head, so
 * remapping the tool changes without remapping the swaps prints on one head while the ACE
 * feeds another.
 *
 * So this panel offers no head picker and writes `CONFIG_EXTRUDER=i MAP_EXTRUDER=i` for
 * every filament. That is not a no-op: `extruder_map_table` is machine state that survives
 * a print, and a real U1 has been observed carrying a non-identity map left by an earlier
 * job (`reprint_info.extruder_map_table = [0,1,1,0]`). Sending nothing would inherit it.
 *
 * Same two macros and the same quoting as filament-commands.js - bare `KEY=value`, since
 * only SET_PRINT_FILAMENT_CONFIG goes through the quoting map.
 */
'use strict';

import { CMD, PRINT_TASK, plainLine } from '../../../../shared/js/protocol.js';

/**
 * `SET_PRINT_EXTRUDER_MAP` per filament, then the set of heads in use.
 *
 * `EXTRUDERS` is the set of TOOLHEADS, de-duplicated and sorted - several filaments share
 * one head on an ACE plate, which is the whole point of the plan - and not the file's
 * filament indices. On the machine `extruders_used` is one flag per toolhead.
 */
export function writeIdentityMap(bridge, { plan, filaments }) {
  if (!plan) return Promise.resolve(null);
  const heads = [...new Set(plan.heads.filter((h) => h.run.length).map((h) => h.head))]
    .sort((a, b) => a - b);
  const lines = filaments.map((f) => plainLine(PRINT_TASK.EXTRUDER_MAP,
    { CONFIG_EXTRUDER: f.index, MAP_EXTRUDER: f.index }));
  lines.push(plainLine(PRINT_TASK.USED_EXTRUDERS, { EXTRUDERS: heads.join(',') }));
  return bridge.request(CMD.SEND_GCODES, { script: lines.join('\n') });
}
