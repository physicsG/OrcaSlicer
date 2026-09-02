/*
 * Model Information - the first section, on both routes.
 *
 * Sends nothing: it is the one panel that only reads.
 */
'use strict';

import * as view from './model-info-view.js';

export default {
  id: 'model-info',
  title: 'Model Information',
  route: 'both',
  reads: ['mapping', 'file', 'filaments'],
  mount: view.mount,
  update: view.update,
};
