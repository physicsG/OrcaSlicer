'use strict';

import * as view from './preferences-view.js';

export default {
  id: 'preferences',
  title: 'Print Preferences',
  route: 'print',
  reads: ['prefs'],
  mount: view.mount,
  update: view.update,
};
