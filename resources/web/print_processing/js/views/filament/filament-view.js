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
import { aceBadge, ACE_MODE_LABELS } from '../../../../shared/js/multiACE.js';

/**
 * What feeds a toolhead, in one short phrase, or null when there is nothing to add.
 *
 * `ace.heads[i]` is the Device page's own resolution - manual, then feeder, then ACE -
 * so this surface does not re-derive it. A stock feeder gets nothing: it is the ordinary
 * case and naming it on every row would bury the one row that differs.
 */
function headSource(ace, i) {
  const h = ace && ace.present && (ace.heads || [])[i];
  if (!h) return null;
  if (h.source === 'manual') return 'hand-fed';
  if (h.source !== 'ace') return null;
  return h.bay != null ? `ACE ${h.unitId}${h.bay + 1}` : `ACE ${h.unitId}`;
}

/**
 * The machine's own line: its ACE mode and its units.
 *
 * Drawn from `ace` alone and therefore on EVERY plate, which is the repair - the plan
 * decides whether the mapping is a choice, and the machine decides what feeds each head.
 * Absent on a printer that reports no ACE, so an ordinary U1 sees the dialog it always
 * saw.
 */
function paintMachine(host, ace) {
  const on = !!(ace && ace.present && (ace.units || []).length);
  host.hidden = !on;
  if (!on) return;
  const sig = `${ace.mode}|` + ace.units.map((u) => u.id + u.bays.map(
    (b) => (b.occupied ? (b.material || '?') + (b.color || '') : '-')).join('')).join('|');
  if (host.dataset.sig === sig) return;      // the state stream pushes about once a second
  host.dataset.sig = sig;
  host.textContent = '';

  host.appendChild(el('span', 'fil-mode', `ACE mode · ${ACE_MODE_LABELS[ace.mode] || ace.mode}`));
  ace.units.forEach((u) => {
    const one = el('span', 'fil-unit');
    const badge = aceBadge(u.bays, 17 / 26);
    badge.setAttribute('aria-hidden', 'true');
    one.appendChild(badge);
    one.appendChild(el('span', null, `ACE ${u.id}`));
    one.title = `ACE ${u.id}${u.model ? ` · ${u.model}` : ''}`;
    host.appendChild(one);
  });
  const heads = (ace.heads || []).filter((h) => h.source === 'ace')
    .map((h) => `Toolhead ${h.index + 1}`);
  if (heads.length) {
    host.appendChild(el('span', 'fil-feeds',
      `feeds ${heads.join(', ')}`));
  }
}

/* The bundle's own two strings for the two ways a toolhead can be refused. They are
   localisation keys with no English entry in the bundle, so they render as themselves -
   which is what the shipped dialog shows too. */
const TIP_NONE = 'dialog_filament_type_none_tips';
const TIP_MISMATCH = 'dialog_filament_type_not_match_tips';

export function mount(root) {
  /*
   * The MACHINE, above the cards, when it has an ACE.
   *
   * This panel is the mapping control for a plate that addresses no bays, and that is
   * still the right control - the file made no choice, so the operator's is real. What it
   * could not do was describe an ACE-fed head: it drew `head 4: PLA` for a head whose
   * filament is whichever of three spools the unit last loaded, and said nothing about the
   * other two sitting in the same cabinet.
   *
   * That was the wrong branch. Whether the FILE addresses bays and whether the MACHINE has
   * an ACE are two different facts, and only the first was wired - so on every plate that
   * exists today the ACE was read, merged, and thrown away.
   */
  root.appendChild(el('div', 'fil-machine'));
  root.appendChild(el('div', 'fil-grid'));
}

export function update(root, model, ctx) {
  const { filaments, toolheads, assignment, ace } = model;
  const grid = root.querySelector('.fil-grid');

  paintMachine(root.querySelector('.fil-machine'), ace);

  keyedList(grid, filaments, {
    key: (f) => f.key,
    create: (f) => buildCard(f),
    update: (node, f) => paintCard(node, f, toolheads, assignment, ace, ctx),
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

function paintCard(card, f, toolheads, assignment, ace, ctx) {
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
            /* Where that filament came from, when the machine can say. `head 4: PLA` is
               true and useless on an ACE-fed head - it is whichever of the unit's spools
               was last loaded, and the address is what lets someone go and look. */
            const src = headSource(ace, h.index);
            if (src) node.appendChild(el('span', 'menu-src', src));
            if (h.index === at) node.appendChild(el('span', 'menu-tick'));
            if (!m.ok) node.appendChild(el('span', 'menu-warn'));
          },
        };
      }),
      onPick: (v) => ctx.assign(f, Number(v)),
    });
  };
}
