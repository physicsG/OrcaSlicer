/*
 * commands/device.js - Commands the rail's device menu issues.
 *
 * Not a panel: this is the page's relationship to ORCA - which machines are saved, pair,
 * rename, forget, discover - rather than to any one part of the printer, which is why it
 * has no panel to belong to.
 *
 * check_coverage.py reads the CMD references out of this file to answer "can a user
 * reach this command", and attributes them to the device panel because this is the module
 * that panel is handed. That makes the attribution a fact about the imports rather than
 * a promise in a declaration - which is the difference that let a handler nothing called
 * count as implemented for as long as it did.
 */
'use strict';

import { CMD, deviceLabel, DEVICE }
  from '../../../shared/js/protocol.js';
import { openDialog, toggleField, numberField } from '../core/overlay.js';

export function create(deps) {
  // `bridge` is deliberately NOT destructured: it does not exist yet when these are
  // built - boot() decides between the real host and the simulator - so it is reached
  // through deps each time rather than captured as null once.
  const { state, store, pending, session, cmd,
          send, setpoint, setStatus, render } = deps;

  let findSub = null;     // discovery subscription



  return {
    showSystemInfo: async () => {
      const gather = async (cmd, params = {}) => {
        try { return await deps.bridge.request(cmd, params); } catch (e) { return { error: e.message }; }
      };
      const [printer, sys, dev, storage, objects] = await Promise.all([
        gather(CMD.GET_PRINTER_INFO),
        gather(CMD.GET_MACHINE_SYSTEM_INFO),
        gather(CMD.SYSTEM_DEVICE_INFO),
        gather(CMD.STORAGE_SPACE),
        gather(CMD.MACHINE_OBJECTS),
      ]);
      openDialog({
        title: 'Printer information',
        wide: true,
        build: (b) => {
          const dl = document.createElement('dl');
          dl.className = 'info-grid';
          const add = (k, v) => {
            if (v == null || v === '' || typeof v === 'object') return;
            const dt = document.createElement('dt'); dt.textContent = k;
            const dd = document.createElement('dd'); dd.textContent = String(v);
            dl.appendChild(dt); dl.appendChild(dd);
          };
          add('Name', store.device && deviceLabel(store.device));
          add('Model', store.device && store.device[DEVICE.MODEL]);
          add('Serial', store.device && store.device[DEVICE.SN]);
          add('Address', store.device && `${store.device[DEVICE.IP]}:${store.device[DEVICE.PORT] || 8883}`);
          add('State', printer.state);
          add('Host name', printer.hostname);
          add('Firmware', printer.software_version || sys.firmware_version || dev.firmware);
          add('Klipper objects', Array.isArray(objects && objects.objects)
                                 ? objects.objects.length : undefined);
          b.appendChild(dl);

          const free = Number(storage && storage.free_space);
          const total = Number(storage && storage.total_space);
          if (Number.isFinite(free) && Number.isFinite(total) && total > 0) {
            const used = total - free;
            const p = document.createElement('div');
            p.style.cssText = 'margin-top:16px;font-size:12px;color:#5F6B79';
            p.textContent = `Storage — ${used.toFixed(1)} of ${total.toFixed(1)} `
                          + `${storage.units || 'GB'} used`;
            b.appendChild(p);
            const bar = document.createElement('div');
            bar.className = 'bar-mini';
            const fill = document.createElement('div');
            fill.style.width = `${Math.round((used / total) * 100)}%`;
            bar.appendChild(fill);
            b.appendChild(bar);
          }
        },
        confirmLabel: 'Close',
        onConfirm: () => true,
      });
    },

    /** Defect detection is a pass-through to the printer; params are its own. */

    showDefectSettings: async () => {
      let cur = {};
      try { cur = (await deps.bridge.request(CMD.DEFECT_DETECTION, {})) || {}; } catch { /* use defaults */ }
      let enable, sens;
      openDialog({
        title: 'Defect detection',
        build: (b) => {
          enable = toggleField(b, { label: 'Detect first-layer and spaghetti failures',
                                    checked: cur.enable !== false });
          sens = numberField(b, { label: 'Sensitivity', value: cur.sensitivity ?? 1,
                                  min: 0, max: 2,
                                  hint: 'Higher values report more possible defects.' });
        },
        confirmLabel: 'Apply',
        onConfirm: () => {
          send(CMD.DEFECT_DETECTION,
               { enable: enable.checked, sensitivity: Number(sens.value) }, 'defect detection');
        },
      });
    },

    /* ---- discovery ---- */

    findMachines: async () => {
      store.found = [];
      let dlg;
      const paint = () => {
        const host = document.querySelector('#found-host');
        if (!host) return;
        host.innerHTML = '';
        if (!store.found.length) {
          const p = document.createElement('div');
          p.className = 'empty';
          p.textContent = 'Searching the network…';
          host.appendChild(p);
          return;
        }
        store.found.forEach((m) => {
          const row = document.createElement('div');
          row.className = 'found-row';
          const meta = document.createElement('div');
          meta.className = 'found-meta';
          const n = document.createElement('span');
          n.className = 'found-name';
          n.textContent = m.dev_name || m.name || m.sn || m.ip || 'printer';
          const sub = document.createElement('span');
          sub.className = 'found-sub';
          sub.textContent = [m.ip, m.model_name || m.machineType].filter(Boolean).join(' · ');
          meta.appendChild(n); meta.appendChild(sub);
          row.appendChild(meta);
          host.appendChild(row);
        });
      };
      dlg = openDialog({
        title: 'Printers on this network',
        build: (b) => {
          const host = document.createElement('div');
          host.id = 'found-host';
          host.className = 'found-list';
          b.appendChild(host);
          const note = document.createElement('p');
          note.style.cssText = 'margin:12px 0 2px;font-size:12px;color:#9AA3AF';
          note.textContent = 'Adding a printer opens Orca\u2019s own dialog, which owns '
                           + 'that flow.';
          b.appendChild(note);
        },
        confirmLabel: 'Add a printer…',
        onConfirm: () => { cmd.stopFind(); send(CMD.ADD_DEVICE, {}, 'add device'); },
      });
      paint();
      try {
        findSub = await deps.bridge.subscribe(CMD.FIND_START, { last_time: -1 }, (d) => {
          const list = Array.isArray(d) ? d : (d && (d.devices || d.machines)) || [];
          if (list.length) { store.found = list; paint(); }
        });
      } catch (e) {
        setStatus(`discovery failed: ${e.message}`, 'err');
      }
    },

    stopFind: async () => {
      if (findSub && findSub.cancel) findSub.cancel();
      findSub = null;
      try { await deps.bridge.request(CMD.FIND_STOP, {}); } catch { /* already stopped */ }
    },

    connectOther: () => send(CMD.CONNECT_OTHER, {}, 'connect another machine'),

    /* ---- file extras ---- */

    renameDevice: (d) => {
      let input;
      openDialog({
        title: 'Rename printer',
        build: (b) => {
          const f = document.createElement('label');
          f.className = 'field';
          const lab = document.createElement('span');
          lab.className = 'field-label';
          lab.textContent = 'Name';
          f.appendChild(lab);
          const row = document.createElement('div');
          row.className = 'field-row';
          input = document.createElement('input');
          input.value = deviceLabel(d);
          row.appendChild(input);
          f.appendChild(row);
          b.appendChild(f);
        },
        confirmLabel: 'Rename',
        onConfirm: async () => {
          const name = input.value.trim();
          if (!name) return false;
          await send(CMD.RENAME_DEVICE,
                     { dev_id: d[DEVICE.ID] || d[DEVICE.SN], dev_name: name }, 'rename');
          if (d[DEVICE.CONNECTED]) await send(CMD.SET_DEVICE_NAME, { name }, 'set machine name');
          await cmd.refresh();
        },
      });
    },

    forgetDevice: (d) => openDialog({
      title: 'Forget this printer?',
      build: (b) => {
        const p = document.createElement('p');
        p.style.cssText = 'margin:4px 0 6px;font-size:13px;line-height:1.55;color:#39434F';
        p.textContent = `${deviceLabel(d)} will be removed from Orca. Pairing keys are lost, `
          + 'so it has to be paired again.';
        b.appendChild(p);
      },
      confirmLabel: 'Forget',
      onConfirm: async () => {
        await send(CMD.DELETE_DEVICES, { dev_ids: [d[DEVICE.ID] || d[DEVICE.SN]] }, 'forget device');
        await cmd.refresh();
      },
    }),
  };
}
