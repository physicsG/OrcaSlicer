/*
 * The Filament panel: one slot per toolhead.
 *
 * Type and colour come from `print_task_config` - the same object the print-processing
 * popup edits when filaments are assigned to a job.
 */
'use strict';

import { renderFilament } from './filament-view.js';

export default {
  id: 'filament',
  title: 'Filament',
  view: 'control',
  bodyId: 'filament',
  bodyClass: 'filament-body',

  header: [
    { kind: 'gap' },
    { kind: 'icon', id: 'filament-refresh', cls: 'tab wide is-active', icon: 'refresh',
      title: 'Refresh', on: (ctx) => ctx.handlers.refreshAll() },
    { kind: 'spacer' },
    { kind: 'icon', id: 'filament-help', cls: 'icon-only', icon: 'help',
      title: 'About filament slots', on: (ctx) => ctx.handlers.filamentHelp() },
  ],

  reads: ['filaments'],

  update(root, ctx) {
    renderFilament(root, ctx.state.filaments(), ctx.handlers);
  },
};
