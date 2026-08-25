/*
 * The Filament panel's DOM: one slot per toolhead, and the slot editor.
 */
'use strict';

import { $, el, icon } from '../../../core/dom.js';
import { cssColor, isDarkColor } from '../../../../../shared/js/protocol.js';
import { keyedList } from '../../../core/render.js';
import { openDialog } from '../../../core/overlay.js';

/**
 * Four slots, drawn on the bundle's own extruder artwork.
 *
 * Values come from `print_task_config` - the same object the print-processing
 * popup edits. See docs/u1-webui/00-shared/01-shared-models.md
 */
export function renderFilament(root, slots, handlers) {
  keyedList(root, slots, {
    key: (f, i) => i,
    // What the card DRAWS, and only that. `f.tag` is the RFID record, an object, and
    // it went into the signature whole - where it stringified to "[object Object]" for
    // every tagged spool alike, so swapping one tagged spool for another would not have
    // rebuilt the card. All the card shows of it is that there is one.
    sig: (f) => [f.loaded ? 1 : 0, f.type, f.subType, f.vendor, f.color,
                 f.tag ? 1 : 0].join(':'),
    create: (f, i) => {
      const css = cssColor(f.color);
      const slot = el('button', 'slot');
      slot.title = f.loaded
        ? `Slot ${i + 1}: ${[f.vendor, f.type, f.subType].filter(Boolean).join(' ')}`
        : `Slot ${i + 1}: empty`;

      const dot = el('div', 'dot', String(i + 1));
      if (f.loaded) {
        dot.dataset.loaded = '1';
        dot.style.background = css || '#C4C4C4';
        // keep the number legible on dark filament
        dot.style.color = isDarkColor(f.color) ? '#fff' : '#333';
      }
      slot.appendChild(dot);
      slot.appendChild(el('div', 'bar', f.loaded ? f.type : '/'));
      // a spool that identified itself is worth distinguishing from one typed in by hand
      if (f.tag) slot.appendChild(el('span', 'slot-tag', 'RFID'));
      slot.appendChild(icon('iconFilamentEdit', 'pencil'));
      slot.onclick = () => editSlot(i, f, handlers);
      return slot;
    },
  });
}

/**
 * Filament slot editor.
 *
 * Laid out after Bambu Studio's "Materials Setting": what the filament IS at the top,
 * then what the machine knows about how to run it. The lower half is read-only on
 * purpose - nozzle limits come off the spool's RFID tag and pressure advance is
 * Klipper's own calibration, so presenting them as editable would be a lie. Slots
 * without a tag simply omit that block rather than showing a grid of zeros.
 */

/**
 * Filament slot editor.
 *
 * Laid out after Bambu Studio's "Materials Setting": what the filament IS at the top,
 * then what the machine knows about how to run it. The lower half is read-only on
 * purpose - nozzle limits come off the spool's RFID tag and pressure advance is
 * Klipper's own calibration, so presenting them as editable would be a lie. Slots
 * without a tag simply omit that block rather than showing a grid of zeros.
 */
function editSlot(index, f, handlers) {
  let type, vendor, color;
  const tag = f.tag;

  const row = (parent, label, value, hint) => {
    const r = el('div', 'ms-row');
    r.appendChild(el('span', 'ms-key', label));
    const v = el('span', 'ms-val', value);
    if (hint) v.title = hint;
    r.appendChild(v);
    parent.appendChild(r);
    return r;
  };

  openDialog({
    title: 'Materials Setting',
    build: (b) => {
      b.classList.add('materials');

      // --- identity ---
      const id = el('div', 'ms-block');
      const tRow = el('label', 'field');
      tRow.appendChild(el('span', 'field-label', 'Filament'));
      const tWrap = el('div', 'field-row');
      type = document.createElement('input');
      type.value = f.type || '';
      type.placeholder = 'PLA';
      type.setAttribute('list', 'ms-types');
      tWrap.appendChild(type);
      const dl = document.createElement('datalist');
      dl.id = 'ms-types';
      ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PVA', 'HIPS']
        .forEach((v) => { const o = document.createElement('option'); o.value = v; dl.appendChild(o); });
      tWrap.appendChild(dl);
      tRow.appendChild(tWrap);
      id.appendChild(tRow);

      const vRow = el('label', 'field');
      vRow.appendChild(el('span', 'field-label', 'Vendor'));
      const vWrap = el('div', 'field-row');
      vendor = document.createElement('input');
      vendor.value = f.vendor || '';
      vendor.placeholder = 'Generic';
      vWrap.appendChild(vendor);
      vRow.appendChild(vWrap);
      id.appendChild(vRow);

      const cRow = el('label', 'field');
      cRow.appendChild(el('span', 'field-label', 'Color'));
      const cWrap = el('div', 'field-row ms-color');
      color = document.createElement('input');
      color.type = 'color';
      color.value = cssColor(f.color) || '#CCCCCC';
      const swatch = el('span', 'ms-swatch');
      swatch.style.background = color.value;
      color.oninput = () => { swatch.style.background = color.value; };
      cWrap.appendChild(swatch);
      cWrap.appendChild(color);
      cRow.appendChild(cWrap);
      id.appendChild(cRow);
      b.appendChild(id);

      // --- what the spool says about itself ---
      if (tag) {
        b.appendChild(el('h4', 'ms-head', 'From the spool tag'));
        const g = el('div', 'ms-block');
        if (tag.subType) row(g, 'Series', tag.subType);
        row(g, 'Nozzle Temperature',
            (tag.nozzleMin != null && tag.nozzleMax != null)
              ? `${tag.nozzleMin} – ${tag.nozzleMax} °C` : '—',
            'min and max reported by the spool');
        if (tag.bedTemp) row(g, 'Bed Temperature', `${tag.bedTemp} °C`);
        if (tag.dryingTemp) {
          row(g, 'Drying', `${tag.dryingTemp} °C`
            + (tag.dryingTime ? ` · ${tag.dryingTime} h` : ''));
        }
        b.appendChild(g);
      } else if (f.loaded) {
        b.appendChild(el('div', 'ms-note',
          'This spool carries no RFID tag, so temperatures come from the profile.'));
      }

      // --- flow dynamics: Klipper's pressure advance is the K-factor analogue ---
      b.appendChild(el('h4', 'ms-head', 'Flow dynamics'));
      const fd = el('div', 'ms-block');
      row(fd, 'Pressure Advance',
          f.pressureAdvance != null ? f.pressureAdvance.toFixed(4) : '—',
          'Klipper\u2019s pressure_advance for this toolhead - the same role Bambu\u2019s Factor K plays');
      row(fd, 'Smooth Time',
          f.smoothTime != null ? `${f.smoothTime.toFixed(3)} s` : '—');
      b.appendChild(fd);

      // --- ACE feed path ---
      if (f.feed) {
        b.appendChild(el('h4', 'ms-head', 'Feed path'));
        const fp = el('div', 'ms-block');
        row(fp, 'Channel', f.feed.channelState || '—');
        row(fp, 'Detected', f.feed.detected ? 'yes' : 'no');
        row(fp, 'At extruder', f.feed.atExtruder ? 'yes' : 'no');
        if (f.feed.error) {
          const e = row(fp, 'Error', f.feed.error);
          e.dataset.severity = 'error';
        }
        b.appendChild(fp);
      }
    },
    confirmLabel: 'Confirm',
    onConfirm: () => handlers.setFilament(index, type.value.trim(), color.value,
                                          vendor.value.trim()),
  });
}

/* ---- fault banner ---------------------------------------------------- */

/**
 * `machine_state_manager.action_code` carries the active fault. Decode it
 * against the 442-code catalogue shipped in the bundle rather than showing a
 * bare number - see shared/js/errors.js, which is generated from it.
 */
