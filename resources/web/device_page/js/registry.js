/*
 * registry.js - what this page is made of.
 *
 * The Device page grew a panel at a time, and each addition landed in five places:
 * markup in index.html, classes in device.css, a renderer somewhere in one shared
 * ui.js, a render call and a slice of module state in app.js, and a click handler in
 * wireChrome. Nothing tied the five together and nothing listed them, so there was no
 * answer to "what is on this page, and what does each part do" short of reading all
 * of it.
 *
 * This file is that answer, and everything one panel is made of now lives together in
 * js/views/<destination>/<panel>/ :
 *
 *   panel.js     the declaration below, plus mount/update
 *   view.js      its DOM - built once, then patched
 *   commands.js  everything it can ask the machine to do
 *
 * Every panel declares:
 *
 *   id            unique; also the <section> id when `sectionId` is set
 *   title         the text in the panel header
 *   view          which destination it belongs to - 'control', 'storage', or null for
 *                 chrome that sits above both
 *   bodyId        the element a renderer is handed (kept stable: CSS and the test
 *                 harness both address these by id)
 *   bodyClass     the class on that element
 *   panelClass    extra class on the <section>
 *   bare          no <section>/<header> at all; the body element is the whole thing
 *   header        header controls, declared - see shell.js for the vocabulary
 *   column        which column of its destination it sits in, for destinations that
 *                 declare columns. Ignored otherwise
 *   grow          this panel takes the column's leftover height. One per column
 *   reads         which state objects and store slices this panel renders from
 *   mount(root)   build the body's fixed structure, once
 *   update(root)  patch it, on every frame
 *
 * What a panel can SEND is deliberately not here. It was, briefly: a `sends` array per
 * panel, which made ownership a promise - nothing stopped a panel claiming a command it
 * never issued, and one did. Each panel is now handed `js/commands/<id>.js` and nothing
 * else, so the module IS the answer and check_coverage.py reads it there. Referencing a
 * command is the only way to claim it.
 *
 * That closes what 07-parity.md got wrong: it reported the command surface complete on
 * the strength of `CMD.NAME` appearing somewhere in the source, which proves a command
 * is *mentioned* - not that a control exists to issue it. A panel with no button counted
 * every command it would have called.
 *
 * `reads` stays declared, because there is nothing to derive it from.
 *
 * Order is render order and paint order.
 */
'use strict';

import fault from './views/fault/fault-panel.js';
import camera from './views/device-control/camera/camera-panel.js';
import control from './views/device-control/control/control-panel.js';
import task from './views/device-control/task/task-panel.js';
import filament from './views/device-control/filament/filament-panel.js';
import storage from './views/storage/storage/storage-panel.js';

export const PANELS = [fault, camera, control, task, filament, storage];

/**
 * The rail's destinations, in the order they appear in it.
 *
 * `columns` is what makes a destination two columns rather than a grid of equal cells.
 * The four control panels used to sit in a 2x2 grid where every cell was locked to
 * `aspect-ratio: 830/548`, so a wider window bought four wider squares and the camera -
 * the only panel whose content actually scales - gained nothing the others did not.
 *
 * Naming them here rather than in the stylesheet is what lets a panel say which column
 * it belongs to instead of the CSS guessing from source order.
 */
export const VIEWS = [
  { id: 'control', label: 'Device control', icon: 'deviceControl',
    columns: ['main', 'side'] },
  { id: 'storage', label: 'Storage',        icon: 'iconModelFileFolder' },
];

export const panelsIn = (view) => PANELS.filter((p) => p.view === view);
export const bareChrome = () => PANELS.filter((p) => p.view === null);
