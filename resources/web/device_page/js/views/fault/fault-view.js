/*
 * The fault banner's DOM.
 */
'use strict';

import { $, el, icon } from '../../core/dom.js';
import { lookupFault } from '../../../../shared/js/errors.js';
import { rebuildOn, data } from '../../core/render.js';

/**
 * `machine_state_manager.action_code` carries the active fault. Decode it
 * against the 442-code catalogue shipped in the bundle rather than showing a
 * bare number - see shared/js/errors.js, which is generated from it.
 */
export function renderFault(root, activity, exception, handlers) {
  const code = (exception && (exception.code || exception.action_code))
            || activity.actionCode;
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
    if (!fault.known) bits.push('not in the shipped catalogue');
    body.appendChild(el('div', 'fault-code', bits.join(' \u00B7 ')));
    root.appendChild(body);

    const again = el('button', 'btn', 'Re-check');
    again.onclick = () => handlers.queryException();
    root.appendChild(again);
  });
}
