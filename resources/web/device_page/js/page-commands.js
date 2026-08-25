/*
 * commands/page.js - Commands that belong to no single panel: refreshing everything, and moving
 * between the rail's destinations.
 *
 * Small on purpose. Anything that lands here is something two panels share, and that is
 * worth noticing rather than letting it spread.
 *
 * check_coverage.py reads the CMD references out of this file to answer "can a user
 * reach this command", and attributes them to the page panel because this is the module
 * that panel is handed. That makes the attribution a fact about the imports rather than
 * a promise in a declaration - which is the difference that let a handler nothing called
 * count as implemented for as long as it did.
 */
'use strict';

import { CMD, asDeviceList, DEVICE }
  from '../../shared/js/protocol.js';

export function create(deps) {
  // `bridge` is deliberately NOT destructured: it does not exist yet when these are
  // built - boot() decides between the real host and the simulator - so it is reached
  // through deps each time rather than captured as null once.
  const { state, store, pending, session, cmd,
          send, setpoint, setStatus, render } = deps;

  /**
   * Re-read everything the page shows. This is what the header refresh buttons do.
   *
   * Measured by clicking the shipped page's own refresh pill and watching what left it:
   * it re-subscribes, re-declares the field filter, takes a fresh snapshot, then re-reads
   * the system info, the file status, the store.exception state and the file roots. Both of its
   * pills - Control and Filament - send the identical set.
   *
   * The rebuild's buttons used to call `refresh()`, which re-reads Orca's DEVICE BOOK:
   * two commands that say nothing about the machine, so pressing refresh changed nothing
   * a user could see.
   */
  async function refreshAll() {
    await refresh();                       // the device list, as it always did
    if (!state.lastUpdate && !session.engineId) return;   // nothing to re-read yet
    await session.startStateStream('refresh');     // filter + snapshot + subscription, and it
                                           // re-reads homed_axes on its own way out
    cmd.queryException();
    deps.bridge.request(CMD.GET_MACHINE_SYSTEM_INFO, {}).catch(() => {});
    deps.bridge.request(CMD.FILE_STATUS, {}).catch(() => {});
    deps.bridge.request(CMD.FILES_ROOTS, {}).catch(() => {});
    render();
  }

  async function refresh() {
    try {
      store.devices = asDeviceList(await deps.bridge.request(CMD.GET_LOCAL_DEVICES, {}));
      const c = await deps.bridge.request(CMD.GET_CONNECTED_MACHINE, {});
      store.device = (c && Object.keys(c).length) ? c
             : (store.devices.find((d) => d[DEVICE.CONNECTED]) || store.devices[0] || null);
    } catch (e) {
      setStatus(`refresh failed: ${e.message}`, 'err');
    }
    render();
  }

  function showView(next) {
    store.view = next;
    render();
    if (next === 'storage') cmd.openStorage(store.storageKind);
  }

  return {
    refreshAll: () => refreshAll(),
    /** Orca's device list. session.js needs it too, on a reconnect. */
    refresh: () => refresh(),

    showView: (v) => showView(v),

  };
}
