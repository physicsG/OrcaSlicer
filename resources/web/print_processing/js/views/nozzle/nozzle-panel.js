'use strict';

import * as view from './nozzle-view.js';

export default {
  id: 'nozzle',
  title: null,
  route: 'print',
  // No <section> and no title column: A.R5 is a bare banner in the same column.
  bare: true,
  reads: ['nozzleMismatch'],
  mount: view.mount,
  update: view.update,
};
