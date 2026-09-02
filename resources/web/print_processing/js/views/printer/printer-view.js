/*
 * printer-view.js - Select Printer.
 *
 * `A.Vn` / `A.bbC`: a 100x100 cover, then a 300x50 dropdown over the saved device list
 * with a synthetic "add device" row appended. Each row carries a 24px cover, the name, a
 * "Lan Mode" label when the record says so, and a green check on the connected one.
 *
 * The list itself is `sw_GetLocalDevices` - Orca's saved records, not the printer's
 * opinion of itself - and the connected one is whichever record says `connected`.
 */
'use strict';

import { el } from '../../../../shared/js/dom.js';
import { text } from '../../../../shared/js/render.js';
import { openPicker, closePicker, isPickerOpen } from '../../widgets/picker.js';

const ADD_DEVICE = '__add_device__';

const deviceId = (d) => String(d.dev_id || d.sn || d.ip || d.dev_name || '');
const deviceName = (d) => d.dev_name || d.name || d.model_name || deviceId(d);
const isLan = (d) => d.link_mode === 'lan' || d.protocol === 1;

export function mount(root, ctx) {
  const row = el('div', 'sp');
  row.appendChild(el('div', 'sp-cover'));
  row.appendChild(el('div', 'gap-20'));

  const pick = el('button', 'picker');
  pick.type = 'button';
  pick.setAttribute('aria-haspopup', 'listbox');
  pick.setAttribute('aria-expanded', 'false');
  pick.appendChild(el('span', 'picker-body'));
  pick.appendChild(el('span', 'picker-caret'));
  row.appendChild(pick);
  root.appendChild(row);

  // The legality line. `sw_GetPrintLegal` compares the EDITED printer preset against the
  // machine that is actually connected; a mismatch is the one thing on this surface that
  // says the plate cannot go where it is being sent.
  root.appendChild(el('p', 'legal-line', ''));

  pick.onclick = () => {
    if (isPickerOpen(pick)) { closePicker(); return; }
    const rows = ctx.get().devices.slice();
    const items = rows.map((d) => ({
      value: deviceId(d),
      build: (node) => {
        node.appendChild(el('span', 'menu-cover'));
        node.appendChild(el('span', 'menu-name', deviceName(d)));
        if (isLan(d)) node.appendChild(el('span', 'menu-lan', 'Lan Mode'));
        node.appendChild(el('span', 'menu-grow'));
        if (d.connected) node.appendChild(el('span', 'menu-tick'));
      },
    }));
    // The bundle appends this row itself, with its own cover art, and treats picking it
    // as "open Orca's add-device dialog" rather than as choosing a machine.
    items.push({
      value: ADD_DEVICE,
      build: (node) => {
        node.appendChild(el('span', 'menu-cover'));
        node.appendChild(el('span', 'menu-name', 'add device'));
      },
    });
    openPicker({
      trigger: pick, kind: 'printer', items,
      value: ctx.get().device ? deviceId(ctx.get().device) : null,
      within: ctx.dialog(),
      onPick: (v) => (v === ADD_DEVICE ? ctx.addDevice() : ctx.chooseDevice(v)),
    });
  };
}

export function update(root, { device, legal }) {
  const body = root.querySelector('.picker-body');
  body.innerHTML = '';
  if (device) {
    body.appendChild(el('span', 'menu-cover'));
    body.appendChild(el('span', 'menu-name', deviceName(device)));
    if (isLan(device)) body.appendChild(el('span', 'menu-lan', 'Lan Mode'));
    body.classList.remove('placeholder');
  } else {
    body.appendChild(el('span', 'picker-hint', 'Click to select printer'));
    body.classList.add('placeholder');
  }

  const line = root.querySelector('.legal-line');
  const bad = legal && legal.legal === false;
  line.hidden = !bad;
  text(line, bad
    ? `This plate was sliced for ${legal.preset_model || 'another model'}, `
      + 'which is not the connected printer.'
    : '');
}
