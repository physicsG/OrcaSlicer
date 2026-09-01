/*
 * The fault banner's DOM.
 */
'use strict';

import { $, el, icon } from '../../core/dom.js';
import { lookupFault } from '../../../../shared/js/errors.js';
import { rebuildOn, data } from '../../core/render.js';

/**
 * A fault comes from `server.exception.query`, and from nothing else.
 *
 * This used to fall back to `machine_state_manager.action_code`, on the stated belief
 * that it "carries the active fault". It does not: it is the FINE-GRAINED ACTIVITY code,
 * and shared/js/activity.js is generated from the same bundle with its own table for it -
 * 576 is "Auto Loading", 640 "Unloading", 832 "Homing Calibration...". So starting a load
 * raised a red banner reading *Printer fault · code 0000000000000240 · not in the shipped
 * catalogue*, which is `0x240` = 576, padded into a 16-digit fault code that could never
 * match because it never was one.
 *
 * The two tables even overlap in value, which is why activity.js keeps them keyed apart
 * and says so. Decoding an activity code against the fault catalogue is the same
 * category error one level up.
 */
export function renderFault(root, activity, exception, handlers) {
  const code = exception && (exception.code || exception.action_code);
  const fault = lookupFault(code);

  // Clearing `built` matters: the guard used to be a `data-code` compared on the way in
  // and never reset on the way out, so a fault that cleared and came back matched its
  // own stale key, took the early return, and stayed hidden while the machine was
  // reporting it. A recurring fault is the ordinary case, not an exotic one.
  if (!fault) {
    root.hidden = true;
    root.innerHTML = '';
    delete root.dataset.built;
    return;
  }

  root.hidden = false;
  rebuildOn(root, String(fault.code), () => {
    // class 0003 is advisory in the catalogue's own numbering; anything else stops work
    root.dataset.severity = fault.errorClass === '0003' ? 'warn' : 'error';

    root.appendChild(icon('exclamationMark'));
    const body = el('div', 'fault-body');
    body.appendChild(el('div', 'fault-title', fault.title));
    body.appendChild(el('div', 'fault-desc', fault.description));

    const bits = [`code ${fault.code}`];
    if (fault.subsystemName && fault.subsystemName !== 'unknown') bits.push(fault.subsystemName);
    if (fault.toolhead) bits.push(`toolhead ${fault.toolhead}`);
    // "the shipped catalogue" is our name for a file we extracted from the bundle. To a
    // reader it is a code the printer reported and this page has no name for.
    if (!fault.known) bits.push('unrecognised');
    body.appendChild(el('div', 'fault-code', bits.join(' \u00B7 ')));
    root.appendChild(body);

    const again = el('button', 'btn', 'Re-check');
    again.onclick = () => handlers.queryException();
    root.appendChild(again);
  });
}
