/*
 * The Control panel: readings, toolhead picker, motion.
 *
 * Two renderers share one body because they share one enabled/disabled state - the
 * shipped page fades the whole control surface while the machine is unreachable rather
 * than hiding it, and `.control-grid[data-enabled]` is what does that.
 */
'use strict';

import { CMD } from '../../../shared/js/protocol.js';
import { el } from '../dom.js';
import * as ui from '../ui.js';

export default {
  id: 'control',
  title: 'Control',
  view: 'control',
  bodyClass: 'control-body',

  header: [
    { kind: 'gap' },
    { kind: 'icon', id: 'refresh', cls: 'tab wide is-active', icon: 'refresh',
      title: 'Refresh', on: (ctx) => ctx.handlers.refreshAll() },
    { kind: 'spacer' },
    { kind: 'pill', id: 'print-prefs', cls: 'pref-pill', label: 'Print Preferences',
      chev: 'printPreferenceArrow', on: (ctx) => ctx.handlers.printPrefs() },
  ],

  reads: ['toolheads', 'bed', 'led', 'fans', 'purifier', 'speed', 'toolhead', 'reachable'],
  sends: [CMD.CONTROL_EXTRUDER_TEMP, CMD.CONTROL_BED_TEMP, CMD.CONTROL_PRINT_SPEED,
          CMD.CONTROL_MAIN_FAN, CMD.CONTROL_GENERIC_FAN, CMD.CONTROL_PURIFIER,
          CMD.CONTROL_LED, CMD.SEND_GCODES, CMD.UPDATE_MACHINE_FILAMENT_INFO,
          // this header's Refresh re-reads the whole page, not just this panel.
          // The Filament header's Refresh is the same action.
          CMD.GET_MACHINE_SYSTEM_INFO, CMD.FILE_STATUS, CMD.FILES_ROOTS,
          CMD.EXCEPTION_QUERY],

  mount(root) {
    const grid = el('div', 'control-grid');
    grid.id = 'control-grid';
    grid.dataset.enabled = '0';
    const card = el('div', 'status-card'); card.id = 'status-card';
    const main = el('div', 'control-main'); main.id = 'control-main';
    grid.appendChild(card);
    grid.appendChild(main);
    root.appendChild(grid);
  },

  update(root, ctx) {
    const state = ctx.state;
    // The shipped page renders the whole control surface and fades it while the machine
    // is unreachable, rather than hiding it. Match that.
    root.firstChild.dataset.enabled = ctx.reachable ? '1' : '0';
    ui.renderStatusCard(root.querySelector('#status-card'), state.toolheads(), state.bed(),
                        state.led(), state.fans(), state.purifier(),
                        state.speed(), ctx.handlers);
    ui.renderControlMain(root.querySelector('#control-main'), state.toolheads(),
                         ctx.handlers, state.toolhead());
  },
};
