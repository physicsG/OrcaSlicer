/*
 * filament-view.js - Edit Filament.
 *
 * A Wrap of 80 x 100 cards, spacing 12 both ways, one per file filament (`A.aiy` ->
 * `A.A0`). Each card is a colour block over a toolhead picker, split flex 3 / a 1px rule
 * / flex 4. The block carries the filament's TYPE and its weight in the ink that stays
 * legible on it; the picker carries a 28px disc with the chosen toolhead's 1-based
 * number, or `!` when nothing is chosen yet.
 *
 * That last one is the section's only affordance for "you still have to decide", and it
 * comes with a warning-coloured card border. Both are the bundle's.
 *
 * Cards are reconciled by key rather than rebuilt: a card whose menu is open must not be
 * replaced under the pointer, and the state stream pushes about once a second.
 */
'use strict';

import { el } from '../../../../shared/js/dom.js';
import { keyedList, text, data } from '../../../../shared/js/render.js';
import { paintFilament, makeDisc, updateDisc } from '../../widgets/art.js';
import { openPicker, closePicker, isPickerOpen } from '../../widgets/picker.js';
import { grams0, inkOn } from '../../widgets/format.js';
import { matchOf } from '../../core/session.js';

/* The bundle's own two strings for the two ways a toolhead can be refused. They are
   localisation keys with no English entry in the bundle, so they render as themselves -
   which is what the shipped dialog shows too. */
const TIP_NONE = 'dialog_filament_type_none_tips';
const TIP_MISMATCH = 'dialog_filament_type_not_match_tips';

export function mount(root) {
  root.appendChild(el('div', 'fil-grid'));
}

export function update(root, model, ctx) {
  const { filaments, toolheads, assignment } = model;
  const grid = root.querySelector('.fil-grid');

  keyedList(grid, filaments, {
    key: (f) => f.key,
    create: (f) => buildCard(f),
    update: (node, f) => paintCard(node, f, toolheads, assignment, ctx),
  });

  // `B.aya` - an invisible 80x100 box holds the row open when there is nothing to draw,
  // so the section does not collapse to its title while the mapping is still arriving.
  data(grid, 'empty', filaments.length ? null : '1');
}

function buildCard(f) {
  const card = el('div', 'fil-card');

  const block = el('div', 'fil-block');
  block.appendChild(el('div', 'fil-type'));
  block.appendChild(el('div', 'fil-used'));
  card.appendChild(block);

  card.appendChild(el('div', 'fil-rule'));

  const pick = el('button', 'fil-pick');
  pick.type = 'button';
  pick.setAttribute('aria-haspopup', 'listbox');
  pick.setAttribute('aria-expanded', 'false');
  pick.setAttribute('aria-label', `Toolhead for filament ${f.index + 1}`);
  pick.appendChild(makeDisc());
  pick.appendChild(el('span', 'fil-caret'));
  card.appendChild(pick);

  return card;
}

function paintCard(card, f, toolheads, assignment, ctx) {
  const block = card.querySelector('.fil-block');
  paintFilament(block, f.colors, f.colorMode);
  const ink = inkOn(f.colors[0]);
  const type = card.querySelector('.fil-type');
  const used = card.querySelector('.fil-used');
  text(type, f.type);
  text(used, grams0(f.used));
  type.style.color = ink;
  used.style.color = ink;

  const at = assignment[f.key];
  const head = at == null ? null : toolheads[at];
  const unset = !head;
  card.classList.toggle('unset', unset);

  updateDisc(card.querySelector('.disc'), {
    colors: head ? head.colors : [],
    mode: head ? head.colorMode : 0,
    // `s ? ""+(a2+1) : "!"` - the 1-based toolhead number, or the mark for undecided.
    label: head ? String(head.index + 1) : '!',
    ink: head ? inkOn(head.colors[0]) : '',
    unset,
  });

  const pick = card.querySelector('.fil-pick');
  pick.onclick = () => {
    if (isPickerOpen(pick)) { closePicker(); return; }
    openPicker({
      trigger: pick,
      kind: 'head',
      within: ctx.dialog(),
      value: at,
      items: toolheads.map((h) => {
        const m = matchOf(f, h);
        return {
          value: h.index,
          // The bundle passes this as the DropdownMenuItem's `enabled` flag. A toolhead
          // whose type or nozzle does not match the file filament is not merely
          // discouraged - it cannot be chosen at all.
          enabled: m.ok,
          title: m.ok ? '' : (m.reason === 'none' ? TIP_NONE : TIP_MISMATCH),
          build: (node) => {
            const d = makeDisc('disc-menu');
            updateDisc(d, { colors: h.colors, mode: h.colorMode,
                            label: String(h.index + 1), ink: inkOn(h.colors[0]) });
            node.appendChild(d);
            const label = el('span', 'menu-type', h.filamentType);
            if (!m.ok) label.classList.add('bad');
            node.appendChild(label);
            if (h.index === at) node.appendChild(el('span', 'menu-tick'));
            if (!m.ok) node.appendChild(el('span', 'menu-warn'));
          },
        };
      }),
      onPick: (v) => ctx.assign(f, Number(v)),
    });
  };
}
