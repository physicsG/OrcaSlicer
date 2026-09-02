'use strict';

import * as view from './grouping-view.js';

export default {
  id: 'grouping',
  title: 'Filament',
  // ?path=5 drops the print half entirely, exactly as Edit Filament does.
  route: 'print',
  // What this panel renders from. `plan` is the one that decides whether it is drawn at
  // all: with none, `filament` (the four cards) is the panel and this one is hidden.
  reads: ['plan', 'filaments', 'ace', 'check'],
  mount: view.mount,
  update: view.update,
};
