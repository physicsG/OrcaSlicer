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
import { DEVICE } from '../../../../shared/js/protocol.js';

const ADD_DEVICE = '__add_device__';

const deviceId = (d) => String(d[DEVICE.ID] || d[DEVICE.SN] || d[DEVICE.IP]
                               || d[DEVICE.NAME] || '');
const deviceName = (d) => d[DEVICE.NAME] || d.name || d[DEVICE.MODEL] || deviceId(d);
const isLan = (d) => d[DEVICE.LINK_MODE] === 'lan' || d.protocol === 1;

/**
 * The line under a device's name.
 *
 * **This is a deliberate departure from the shipped dialog**, which draws a device as a
 * cover, a name, a "Lan Mode" label and a check - and nothing else. Two saved records
 * with the same name are then two identical rows, which is not a hypothetical: Orca's
 * config routinely holds a stale record beside a live one, and the machine this was
 * built against has exactly that. Picking the wrong one connects to nothing and the
 * dialog can only say the printer did not answer.
 *
 * The address is on the record already - `connection.js` refuses to connect without it -
 * so showing it costs a line that the row had room for.
 *
 * The serial only appears when it is the thing that TELLS TWO ROWS APART. On the machine
 * above both records carry the same name AND the same address and differ only by SN
 * (`811002511261022618B3` against a `moonraker` placeholder), so the address alone would
 * have left the ambiguity exactly where it was. Where a name and an address are already
 * unique the serial is noise, and it is not drawn.
 */
export function deviceMeta(d, all) {
  const bits = [];
  if (isLan(d)) bits.push('Lan Mode');
  const ip = d[DEVICE.IP];
  if (ip) bits.push(ip);
  /*
   * Compared by IDENTITY KEY, not by object identity. The selected device is usually a
   * DIFFERENT OBJECT from its entry in the list - `sw_GetConnectedMachine` answers with
   * its own copy - so `o !== d` counted a device as its own twin and printed the serial
   * on a machine that had nothing to be told apart from.
   */
  const twin = (all || []).some(
    (o) => deviceId(o) !== deviceId(d)
        && deviceName(o) === deviceName(d) && o[DEVICE.IP] === ip);
  if (twin && d[DEVICE.SN]) bits.push(d[DEVICE.SN]);
  return bits.join(' · ');
}

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
        const t = el('span', 'dev-text');
        t.appendChild(el('span', 'dev-name', deviceName(d)));
        const meta = deviceMeta(d, rows);
        if (meta) {
          const m = el('span', 'dev-meta', meta);
          m.title = meta;
          t.appendChild(m);
        }
        node.appendChild(t);
        // No spacer: `.dev-text` is the flexible child and pushes the tick right on its
        // own. Keeping the old `menu-grow` beside it left TWO `flex: 1` children sharing
        // the row, so the address was ellipsised to "Lan Mode · 19..." with half the
        // menu standing empty next to it.
        if (d[DEVICE.CONNECTED]) node.appendChild(el('span', 'menu-tick'));
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

export function update(root, { device, legal, devices }) {
  const body = root.querySelector('.picker-body');
  body.innerHTML = '';
  if (device) {
    body.appendChild(el('span', 'menu-cover'));
    const t = el('span', 'dev-text');
    t.appendChild(el('span', 'dev-name', deviceName(device)));
    // The closed picker says the same thing the open one does. Choosing between two
    // rows only to be shown a name that matches both of them is half an answer.
    const meta = deviceMeta(device, devices);
    if (meta) {
      const m = el('span', 'dev-meta', meta);
      m.title = meta;
      t.appendChild(m);
    }
    body.appendChild(t);
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
