/*
 * The Control panel: readings, toolhead picker, motion.
 *
 * Two renderers share one body because they share one enabled/disabled state - the
 * shipped page fades the whole control surface while the machine is unreachable rather
 * than hiding it, and `.control-grid[data-enabled]` is what does that.
 */
'use strict';

import { el } from '../../../core/dom.js';
import { renderControlMain, renderStatusCard } from './control-view.js';

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
    // The shipped page renders the whole control surface and fades it while the machine
    // is unreachable, rather than hiding it. Match that.
    root.firstChild.dataset.enabled = ctx.store.reachable ? '1' : '0';
    renderStatusCard(root.querySelector('#status-card'), ctx);
    renderControlMain(root.querySelector('#control-main'), ctx);
  },
};
