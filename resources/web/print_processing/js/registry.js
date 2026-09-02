/*
 * registry.js - what this dialog is made of.
 *
 * Same contract as the Device page's registry, because it is the same idea: a panel
 * declares itself in one place, and everything one panel is made of lives in one folder.
 * The differences are that this surface has no destinations and no columns - it is a
 * single scrolling column of sections - and that `route` replaces them.
 *
 * Order is the order A.bi3 builds them in, and the spacing between them is the bundle's:
 *
 *     SizedBox(16)              B.aE
 *     Model Information         A.J9
 *     SizedBox(8)               B.aB
 *     Select Printer            A.Vn
 *   [ SizedBox(8)
 *     Edit Filament             A.J8 / A.aiy
 *     SizedBox(8)
 *     Print Preferences         A.Ja
 *     SizedBox(8)
 *     nozzle mismatch banner    A.R5
 *     SizedBox(20)         ]    only on ?path=4
 *     SizedBox(20)              B.eS
 *
 * Every panel declares:
 *
 *   id          unique; also the <section> id
 *   title       the text in the 120..180 title column (B.m4)
 *   route       'both' or 'print' - `print` panels are absent on ?path=5, which is the
 *               whole difference between the two routes
 *   bare        no <section>/title column; the body is the whole thing (the banner)
 *   reads       what this panel renders from, declared because nothing derives it
 *   mount(root) build the body's fixed structure, once
 *   update(root, ctx) patch it, on every frame
 *
 * What a panel can SEND is not declared here: each is handed its own commands module and
 * nothing else, so referencing a command is the only way to claim one and
 * check_coverage.py can read it there.
 */
'use strict';

import modelInfo from './views/model-info/model-info-panel.js';
import printer from './views/printer/printer-panel.js';
import filament from './views/filament/filament-panel.js';
import grouping from './views/grouping/grouping-panel.js';
import preferences from './views/preferences/preferences-panel.js';
import nozzle from './views/nozzle/nozzle-panel.js';

/*
 * `filament` and `grouping` are the SAME slot, and the FILE picks between them: a plate
 * with an `ace_plan` gets the grouping, one without gets the four cards. Both are mounted
 * and app.js hides one, rather than the registry choosing - the plan arrives with the
 * mapping reply, which is after the shell is built, and a panel that has to be built
 * later is a panel that cannot be reconciled.
 *
 * Every plate the slicer can produce on this branch has no plan, so `grouping` is hidden
 * on all of them and nothing about the shipped dialog changes.
 */
export const PANELS = [modelInfo, printer, filament, grouping, preferences, nozzle];

/** The panels this route draws, in order. */
export function panelsFor(route) {
  return PANELS.filter((p) => p.route === 'both' || p.route === route);
}
