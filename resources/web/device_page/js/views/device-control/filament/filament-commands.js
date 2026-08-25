/*
 * commands/filament.js - Commands the Filament panel issues.
 *
 * Type and colour live in print_task_config - the same object the print-processing popup
 * edits when filaments are assigned to a job.
 *
 * check_coverage.py reads the CMD references out of this file to answer "can a user
 * reach this command", and attributes them to the filament panel because this is the module
 * that panel is handed. That makes the attribution a fact about the imports rather than
 * a promise in a declaration - which is the difference that let a handler nothing called
 * count as implemented for as long as it did.
 */
'use strict';

import { CMD, TASK_CONFIG, cssColor }
  from '../../../../../shared/js/protocol.js';
import { openDialog } from '../../../core/overlay.js';

export function create(deps) {
  // `bridge` is deliberately NOT destructured: it does not exist yet when these are
  // built - boot() decides between the real host and the simulator - so it is reached
  // through deps each time rather than captured as null once.
  const { state, store, pending, session, cmd,
          send, setpoint, setStatus, render } = deps;



  return {
    setFilament: (index, type, color, vendor) => {
      // print_task_config carries these as parallel per-slot arrays. Colour goes back in
      // the form the printer sends: RRGGBBAA, no '#'. Writing CSS here would put a value
      // on the machine that nothing else on it can read.
      const tc = state.taskConfig();
      const types = (tc[TASK_CONFIG.TYPE] || []).slice();
      const vendors = (tc[TASK_CONFIG.VENDOR] || []).slice();
      const rgba = (tc[TASK_CONFIG.COLOR_RGBA] || []).slice();
      const argb = (tc[TASK_CONFIG.COLOR] || []).slice();

      const hex = (cssColor(color) || '#CCCCCC').slice(1).toUpperCase();
      types[index] = type;
      if (vendor !== undefined) vendors[index] = vendor;
      rgba[index] = `${hex}FF`;
      argb[index] = (0xFF000000 | parseInt(hex, 16)) >>> 0;

      const patch = { [TASK_CONFIG.TYPE]: types,
                      [TASK_CONFIG.COLOR]: argb,
                      [TASK_CONFIG.COLOR_RGBA]: rgba };
      if (vendor !== undefined) patch[TASK_CONFIG.VENDOR] = vendors;
      send(CMD.UPDATE_MACHINE_FILAMENT_INFO, patch, 'set filament');
    },

    filamentHelp: () => openDialog({
      title: 'Filament slots',
      build: (b) => {
        const p = document.createElement('p');
        p.style.cssText = 'margin:6px 0 2px;font-size:13px;line-height:1.55;color:#39434F';
        p.textContent = 'Each slot maps to one of the U1\u2019s four toolheads. '
          + 'Type and colour come from print_task_config \u2014 the same object the '
          + 'print-processing popup edits when you assign filaments to a job.';
        b.appendChild(p);
      },
      confirmLabel: 'Close',
      onConfirm: () => true,
    }),
  };
}
