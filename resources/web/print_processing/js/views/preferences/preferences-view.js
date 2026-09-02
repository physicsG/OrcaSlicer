/*
 * preferences-view.js - Print Preferences.
 *
 * Three rows in a Wrap with runSpacing 12 and spacing 170 (`A.Ja`), each row a
 * ConstrainedBox of 152..220 by 20 (`B.VS`). At this dialog's width the 170 gutter is
 * what puts them one per line; the numbers are kept rather than replaced with a column,
 * because the wrap is what decides the layout at any other width.
 *
 * The toggle is an 18px ROUND CHECKBOX, not a switch: `A.a3(..., 18, ..., 18)` with
 * radius 9, a 2px border, and `B.fx` green with a 14px white check when on.
 *
 * Only the first carries a help control, and it opens a real dialog rather than a
 * tooltip - `A.rB(...)` with an OK button.
 */
'use strict';

import { el } from '../../../../shared/js/dom.js';
import { attr } from '../../../../shared/js/render.js';
import { PRINT_PREFERENCES } from '../../../../shared/js/protocol.js';

/* The bundle's own help text, verbatim, for the one preference that has any. */
export const FLOW_HELP = {
  title: 'Extrusion Flow Calibration',
  body: 'When enabled, the printer will automatically calibrate flow compensation '
      + 'before printing. Recommended after each filament change.',
};

export function mount(root, ctx) {
  const wrap = el('div', 'prefs');
  PRINT_PREFERENCES.forEach(({ key, label }) => {
    const row = el('button', 'pref');
    row.type = 'button';
    row.dataset.key = key;
    row.setAttribute('role', 'switch');
    row.appendChild(el('span', 'pref-label', label));
    if (key === PRINT_PREFERENCES[0].key) {
      const help = el('span', 'pref-help');
      help.setAttribute('role', 'button');
      help.tabIndex = 0;
      help.title = FLOW_HELP.title;
      const ask = (e) => { e.stopPropagation(); ctx.explain(FLOW_HELP); };
      help.onclick = ask;
      help.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') ask(e); };
      row.appendChild(help);
    }
    row.appendChild(el('span', 'pref-box'));
    row.onclick = () => ctx.togglePreference(key, !ctx.prefValue(key));
    wrap.appendChild(row);
  });
  root.appendChild(wrap);
}

export function update(root, { prefs }) {
  root.querySelectorAll('.pref').forEach((row) => {
    attr(row, 'aria-checked', String(!!prefs[row.dataset.key]));
  });
}
