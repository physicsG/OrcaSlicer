/*
 * mock.js - the print-processing popup's simulated host.
 *
 * Reuses the shared U1 simulation and adds only the commands this surface
 * issues. The filament mapping it returns is derived from the SAME
 * print_task_config the Device tab reads, which is the point: one model, two
 * surfaces, one reading it and one editing it.
 */
'use strict';

import { installMockHost } from '../../shared/js/mockhost.js';
import { MAPPING_STATUS } from '../../shared/js/protocol.js';

const FILE = {
  filename: 'mock_multicolor_benchy.gcode',
  prediction_time: 3182,
  weight: 31.4,
};

export function installMock({ log = () => {}, onClose = () => {} } = {}) {
  let mapping = null;

  const handlers = {
    sw_GetActiveFile: () => ({ filename: FILE.filename }),

    // The preset the plate was sliced for vs the machine actually connected.
    sw_GetPrintLegal: (params) => ({
      preset_model: 'Snapmaker U1',
      legal: !params.connected_model || params.connected_model === 'Snapmaker U1',
    }),

    // Built from print_task_config so both surfaces agree on the filament set.
    sw_GetFileFilamentMapping: (_params, ctx) => {
      const tc = ctx.printer.snapshot().print_task_config;
      mapping = {
        filename: FILE.filename,
        prediction_time: FILE.prediction_time,
        weight: FILE.weight,
        filaments: (tc.filament_type || []).map((type, i) => ({
          id: i,
          type,
          color: (tc.filament_color || [])[i] || '#888888',
          vendor: (tc.filament_vendor || [])[i] || '',
          used_g: [12.4, 9.1, 6.7, 3.2][i] ?? 0,
          extruder: (tc.extruders_used || [])[i] ?? i,
        })),
      };
      return mapping;
    },

    sw_UpdateMachineFilamentInfo: (params, ctx) => {
      // Mirror the edit into print_task_config, exactly as the real flow does.
      const tc = ctx.printer.taskConfigOverride || (ctx.printer.taskConfigOverride = {});
      if (Array.isArray(params.extruder_map_table)) {
        tc.extruder_map_table = params.extruder_map_table;
      }
      Object.assign(tc, params);
      return {};
    },

    sw_GetPrintZip: () => ({ name: FILE.filename.replace(/\.gcode$/, '.zip'), content: '' }),
    sw_StartLocalPrint: () => ({ task_id: 'mock-task-1' }),
    sw_StartCloudPrint: () => ({ task_id: 'mock-task-1' }),

    // The two-step close: record the outcome, then end the dialog.
    sw_SetFilamentMappingComplete: (params) => {
      mockState.finish = params.status === MAPPING_STATUS.SUCCESS;
      return {};
    },
    sw_FinishPreprint: (params) => {
      mockState.preprintStatus = params.status || null;
      return {};
    },
    sw_FinishFilamentMapping: () => {
      mockState.closed = true;
      onClose(mockState.finish);
      return {};
    },
  };

  const host = installMockHost({ log, handlers });
  if (!host) return null;

  const mockState = { finish: false, closed: false, preprintStatus: null,
                      get mapping() { return mapping; } };
  host.state = mockState;
  return host;
}
