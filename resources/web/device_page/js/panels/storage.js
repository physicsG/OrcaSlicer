/*
 * Storage: one grid for everything the printer is holding.
 *
 * Time-lapses, finished prints, print files and logs were four shapes behind three tabs
 * on two panels. They are all "things on the machine you might want to look at", so they
 * get one view, one picker and one card - normalised in app.js rather than kept in step
 * by hand across four renderers.
 */
'use strict';

import { CMD } from '../../../shared/js/protocol.js';
import * as ui from '../ui.js';

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
  // No DELETE_MACHINE_FILE: Delete sat a few pixels from a one-click Print and only
  // one of them is reversible, so the card offers view and print only.
  sends: [CMD.TIMELAPSE_LIST, CMD.TIMELAPSE_DELETE, CMD.PRINT_HISTORY,
          CMD.FILES_ROOTS, CMD.FILES_GET_DIRECTORY, CMD.FILE_LIST_PAGE,
          CMD.FILES_METADATA, CMD.FILE_THUMBS_B64, CMD.FILE_THUMBNAILS,
          CMD.PRINT_START, CMD.DOWNLOAD_MACHINE_FILE],

  update(root, ctx) {
    ui.renderStorage(root, ctx.store.storageKind, ctx.storageData(),
                     ctx.handlers, ctx.store.device);
  },
};
