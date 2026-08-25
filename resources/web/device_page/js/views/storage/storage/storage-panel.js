/*
 * Storage: one grid for everything the printer is holding.
 *
 * Time-lapses, finished prints, print files and logs were four shapes behind three tabs
 * on two panels. They are all "things on the machine you might want to look at", so they
 * get one view, one picker and one card - normalised in app.js rather than kept in step
 * by hand across four renderers.
 */
'use strict';

import { renderStorage } from './storage-view.js';

export const KINDS = [
  { value: 'timelapses', icon: 'videoCall',           title: 'Time-lapses' },
  { value: 'prints',     icon: 'printHistory',        title: 'Prints' },
  { value: 'gcodes',     icon: 'iconFile',            title: 'Print files' },
  { value: 'logs',       icon: 'iconModelFileFolder', title: 'Logs and other files' },
];

export default {
  id: 'storage',
  title: 'Storage',
  view: 'storage',
  sectionId: 'storage',
  panelClass: 'storage',
  bodyId: 'storage-body',
  bodyClass: 'storage-body',

  header: [
    { kind: 'sep' },
    { kind: 'tabs', group: 'kind', cls: 'tab', items: KINDS,
      active: (ctx) => ctx.store.storageKind,
      on: (ctx, v) => ctx.handlers.openStorage(v) },
    { kind: 'spacer' },
    { kind: 'icon', id: 'storage-refresh', cls: 'icon-btn', icon: 'refresh',
      title: 'Re-read this folder', on: (ctx) => ctx.handlers.reloadStorage() },
  ],

  reads: ['store.cam.timelapses', 'store.history', 'store.files'],

  update(root, ctx) {
    renderStorage(root, ctx.store.storageKind, ctx.handlers.storageData(),
                     ctx.handlers, ctx.store.device);
  },
};
