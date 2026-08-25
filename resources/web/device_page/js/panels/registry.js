/*
 * registry.js - what this page is made of.
 *
 * The Device page grew a panel at a time, and each addition landed in five places:
 * markup in index.html, classes in device.css, a renderer in ui.js, a render call and a
 * slice of module state in app.js, and a click handler in wireChrome. Nothing tied the
 * five together and nothing listed them, so there was no answer to "what is on this
 * page, what does each part read, and what can each part send" short of reading all of
 * it. This file is that answer.
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

import fault from './fault.js';
import camera from './camera.js';
import control from './control.js';
import task from './task.js';
import filament from './filament.js';
import storage from './storage.js';

export const PANELS = [fault, camera, control, task, filament, storage];

/** The rail's destinations, in the order they appear in it. */
export const VIEWS = [
  { id: 'control', label: 'Device control', icon: 'deviceControl' },
  { id: 'storage', label: 'Storage',        icon: 'iconModelFileFolder' },
];

export const panelsIn = (view) => PANELS.filter((p) => p.view === view);
export const bareChrome = () => PANELS.filter((p) => p.view === null);
