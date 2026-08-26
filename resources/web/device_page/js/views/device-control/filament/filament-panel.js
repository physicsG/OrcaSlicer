/*
 * The Filament panel: one card per toolhead, and what feeds it.
 *
 * Which shape the body takes is decided by the machine - see filament-view.js. A U1
 * without the multiACE plugin reports no `ace` object and gets the four slots the page
 * always drew; one with it gets four toolhead cards in two columns.
 *
 * The header carries the two things that are about the MACHINE rather than about any one
 * toolhead: the ACE mode, which decides whether a head may be wired to a unit at all,
 * and the settings a person sets once. Everything that changes daily is on the cards.
 */
'use strict';

import { renderFilament, openAceSettings, openAceModeMenu, aceStatus, aceModeLabel }
  from './filament-view.js';

export default {
  id: 'filament',
  title: 'Filament',
  view: 'control',
  column: 'side',
  grow: true,
  bodyId: 'filament',
  bodyClass: 'filament-body',

  header: [
    { kind: 'gap' },
    { kind: 'icon', id: 'filament-refresh', cls: 'tab wide is-active', icon: 'refresh',
      title: 'Refresh', on: (ctx) => ctx.handlers.refreshAll() },
    { kind: 'sep' },
    // `label` is a function, so the pill reports the mode instead of drawing the one it
    // was built with. Disabled rather than hidden when there is no ACE: a control that
    // vanishes leaves no way to find out why it is not there.
    { kind: 'pill', id: 'filament-mode', cls: 'pref-pill', chev: 'keyboardArrowDropDown',
      label: aceModeLabel,
      enabled: (ctx) => ctx.state.ace().present,
      title: (ctx) => (ctx.state.ace().present
        ? 'SET_ACE_MODE MODE=normal|multi|head — head mode is the one that wires a '
          + 'toolhead to a unit'
        : 'This printer reports no ACE'),
      on: (ctx) => openAceModeMenu(document.getElementById('filament-mode'), ctx) },
    { kind: 'spacer' },
    { kind: 'status', id: 'filament-ace', text: aceStatus,
      title: (ctx) => {
        const a = ctx.state.ace();
        // multiACE is a plugin someone installs on the U1, not firmware. Naming it, and
        // the contract version it claims, is what makes "why is this panel different on
        // my machine" answerable.
        return a.present
          ? `multiACE${a.apiVersion ? ` (api_version ${a.apiVersion})` : ''} — read from `
            + 'the `ace` Klipper object, on its own rather than on the stream'
          : 'No `ace` object in machine state — multiACE is not installed on this printer';
      } },
    { kind: 'gap' },
    { kind: 'icon', id: 'filament-settings', cls: 'icon-only', icon: 'settings',
      title: 'Unload all, flush length, confirmations, Spoolman',
      on: (ctx) => openAceSettings(document.getElementById('filament-settings'), ctx) },
    { kind: 'icon', id: 'filament-help', cls: 'icon-only', icon: 'help',
      title: 'About filament sources', on: (ctx) => ctx.handlers.filamentHelp() },
  ],

  reads: ['filaments', 'ace'],

  update(root, ctx) {
    renderFilament(root, ctx);
  },
};
