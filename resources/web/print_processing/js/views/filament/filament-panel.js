'use strict';

import * as view from './filament-view.js';

export default {
  id: 'filament',
  title: 'Edit Filament',
  // ?path=5 drops this section entirely - that is the whole difference between routes.
  route: 'print',
  // The refresh control lives in the title column, beside the heading, which is where
  // A.aiy puts it: `Row[title, IconButton(B.nw, 20)]` inside the 120..180 box.
  header: { kind: 'refresh', label: 'Re-read the file’s filaments' },
  reads: ['filaments', 'toolheads', 'assignment', 'ace'],
  mount: view.mount,
  update: view.update,
};
