/*
 * Storage: one grid for everything the printer is holding.
 *
 * Recordings, finished prints and logs were separate shapes behind separate tabs on two
 * panels. They are all "things on the machine you might want to look at", so they get
 * one view, one picker and one card - normalised in app.js rather than kept in step by
 * hand across a renderer each.
 */
'use strict';

import { renderStorage } from './storage-view.js';

/**
 * The kinds, and the one that went.
 *
 * There was a fourth - "Print files", the gcodes root - and next to Prints it was the
 * same list twice: the same files, the same thumbnails, the same names, one offering
 * Print and the other Reprint. Two tabs that answer the same question with the same
 * rows is a worse page than one, so the history is the one that stayed - it is the list
 * that knows how each of them went.
 *
 * `iconFile` and `iconModelFileFolder` are both folders in the shipped bundle, which is
 * how the last two tabs came to wear the same picture. Logs get a log: `iconLog` is
 * ours, drawn to the bundle's 24px stroke because it has nothing of the kind.
 */
export const KINDS = [
  { value: 'timelapses', icon: 'videoCall',    title: 'Time-lapses' },
  { value: 'prints',     icon: 'printHistory', title: 'Prints' },
  { value: 'logs',       icon: 'iconLog',      title: 'Logs and other files' },
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

  reads: ['store.timelapses', 'store.history', 'store.files', 'store.storageMore'],

  update(root, ctx) {
    renderStorage(root, ctx.store.storageKind, ctx.handlers.storageData(),
                     ctx.handlers, ctx.store.device);
  },
};
