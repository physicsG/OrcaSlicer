'use strict';

import * as view from './printer-view.js';

export default {
  id: 'printer',
  title: 'Select Printer',
  route: 'both',
  reads: ['devices', 'device', 'legal'],
  mount: view.mount,
  update: view.update,
};
