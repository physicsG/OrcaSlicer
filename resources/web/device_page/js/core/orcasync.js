/*
 * orcasync.js - the one thing this page owes ORCA rather than the printer.
 *
 * Every other command on this page asks the machine something. This one tells Orca what
 * the machine is carrying, and it exists because the Device page is the only thing that
 * ever told it.
 *
 * `sw_UpdateMachineFilamentInfo` does not reach the printer at all - `bridge-methods.json`
 * has it as "answered inside Orca", and what it does there is
 * `SSWCP_Instance::update_filament_info()`: fill `preset_bundle->machine_filaments` and
 * `m_connect_machine_info_list`, then `load_current_presets()`. Those two containers are
 * what the sidebar's filament combo boxes are built from (`PresetComboBoxes.cpp:330`,
 * `:1396`, `:1968`) and they have exactly one writer. So with nothing calling this, the
 * Prepare page's filament rows never learn what is in the printer - the shipped Device
 * page was doing it, and switching the tab to the reconstruction switched it off.
 *
 * Three things about the payload, all of them read out of the C++ rather than guessed,
 * and all three fatal to get wrong because `handle_web_message` does not catch:
 *
 *   `objects: [{ key, value }]`   key is the SERIAL, value is a JSON **string**. Both are
 *                                type-checked; a flat patch object - which is what the
 *                                two panels here used to send - fails at the first `if`
 *                                and the whole call does nothing.
 *   the SN must be CONNECTED     `get_device_info(sn)` then `info.connected`, else
 *                                "sn does not exist!" / "The machine is not connected!".
 *                                Not pre-checked here: `DeviceInfo.connected` is
 *                                force-cleared on every config save and set from a
 *                                CallAfter that lands after the connect reply, so a page
 *                                that gates on it declines for as long as the race lasts
 *                                and says nothing. Orca's answer is the answer.
 *   the arrays must line up      the loop runs over `filament_official.size()` and
 *                                indexes every other array with the same `i`, including
 *                                `nozzle_diameters` and `filament_color_rgba`. A short
 *                                array is an out-of-range throw inside a wxWidgets event
 *                                handler, not an error reply.
 *
 * The key set is the shipped page's own `PrintTaskConfig.O()`, recovered verbatim from
 * `main.dart.js` - see docs/u1-webui/02-device-page/12-orca-integration.md. Sending the
 * same keys is what makes this a like-for-like substitute rather than a fresh guess at
 * what Orca will accept.
 */
'use strict';

import { CMD, DEVICE } from '../../../shared/js/protocol.js';

/**
 * How many slots to describe.
 *
 * `filament_official` decides it on the C++ side, so it decides it here: whatever the
 * machine reported, the arrays are cut or padded to that one length.
 */
function slotCount(tc) {
  const lens = ['filament_official', 'filament_type', 'filament_vendor', 'filament_exist']
    .map((k) => (Array.isArray(tc[k]) ? tc[k].length : 0));
  return Math.max(0, ...lens);
}

/** `v` as an array of exactly `n` entries, each passed through `cast`. */
function fixed(v, n, cast, fill) {
  const src = Array.isArray(v) ? v : [];
  return Array.from({ length: n }, (_, i) => (i < src.length ? cast(src[i]) : fill));
}

const asStr = (v) => (v == null ? '' : String(v));
const asBool = (v) => v === true;
const asInt = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; };

/** How long to leave a refused push alone before trying the same inventory again. */
const RETRY_MS = 15000;

export function createOrcaSync({ bridge, state, store, hostLog }) {
  // What was last accepted. Compared, not counted: the state stream pushes roughly twice
  // in thirty seconds on an idle machine and re-sending an unchanged inventory would run
  // `load_current_presets()` - which rebuilds every combo box - on each of them.
  let sent = null;
  let busy = false;
  let retryAt = 0;
  let said = '';        // the last thing said about a refusal, so it is said once

  /**
   * The nozzle per slot, as strings.
   *
   * `machine.system_info` -> `product_info.nozzle_diameter` is the only place this
   * firmware publishes it; `print_task_config` has no such key, which is why the shipped
   * page's model defaults it to an empty list. Orca reads each entry with
   * `get<std::string>()`, so a number here is a type_error and not a value it can use.
   */
  function nozzles(n) {
    const info = (store.systemInfo && store.systemInfo.product_info) || {};
    const raw = Array.isArray(info.nozzle_diameter) ? info.nozzle_diameter : [];
    const first = raw.length ? asStr(raw[0]) : '';
    return Array.from({ length: n }, (_, i) => (i < raw.length ? asStr(raw[i]) : first));
  }

  /** The inventory, in the shape `update_filament_info()` parses. */
  function inventory() {
    const tc = state.taskConfig();
    const n = slotCount(tc);
    if (!n) return null;

    // filament_color_multi is per-slot objects, and Orca reaches into `.colors` and
    // `.mode` on each. Anything else in the array would be read as an object and come
    // back empty rather than throw, but pass through only what is actually shaped right.
    const multi = fixed(tc.filament_color_multi, n,
                        (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), {});

    return {
      filament_vendor: fixed(tc.filament_vendor, n, asStr, ''),
      filament_type: fixed(tc.filament_type, n, asStr, ''),
      filament_sub_type: fixed(tc.filament_sub_type, n, asStr, ''),
      filament_color: fixed(tc.filament_color, n, asInt, 0),
      filament_color_rgba: fixed(tc.filament_color_rgba, n, asStr, '00000000'),
      filament_official: fixed(tc.filament_official, n, asBool, false),
      filament_sku: fixed(tc.filament_sku, n, asInt, 0),
      filament_edit: fixed(tc.filament_edit, n, asBool, false),
      filament_exist: fixed(tc.filament_exist, n, asBool, false),
      filament_color_multi: multi,
      // extruder_map_table is 32 long on the machine - one entry per possible tool, not
      // per slot - and Orca only ever indexes the first `n`. Passed as the machine sends
      // it, padded only if it is somehow shorter than the slots it maps.
      extruder_map_table: fixed(tc.extruder_map_table,
                                Math.max(n, Array.isArray(tc.extruder_map_table)
                                            ? tc.extruder_map_table.length : 0),
                                asInt, 0),
      extruders_used: fixed(tc.extruders_used, n, asBool, false),
      time_lapse_camera: asBool(tc.time_lapse_camera),
      auto_bed_leveling: asBool(tc.auto_bed_leveling),
      flow_calibrate: asBool(tc.flow_calibrate),
      shaper_calibrate: asBool(tc.shaper_calibrate),
      auto_replenish_filament: asBool(tc.auto_replenish_filament),
      can_auto_replenish: asBool(tc.can_auto_replenish),
      auto_replenish_index: asInt(tc.auto_replenish_index),
      nozzle_diameters: nozzles(n),
    };
  }

  /**
   * Said once per distinct reason, and only about a state that is not obviously
   * temporary.
   *
   * Worth having at all because every way this can fail is silent: the consequence shows
   * up on ANOTHER TAB, as a filament list that is empty or stale, with nothing on this
   * page to connect the two. "It never ran" and "Orca refused it" look identical from the
   * Prepare page, and they have opposite fixes.
   */
  function decline(why) {
    if (said === why) return false;
    said = why;
    hostLog(`filament sync not sent: ${why}`);
    return false;
  }

  /**
   * Push, if there is anything to push and Orca will take it.
   *
   * Called on every state change - and **not** from render(). It was, inside the
   * repaint's requestAnimationFrame, and in Orca it never ran once: the Device tab's
   * webview is not the composited page at startup, and WebKit does not fire animation
   * frames into a view nobody is looking at. Everything with an on-screen consequence
   * carried on working, because a page nobody can see does not need to repaint. This has
   * its consequence on ANOTHER TAB, so it may not wait for someone to look.
   */
  async function sync(reason) {
    if (busy || Date.now() < retryAt) return false;
    const sn = store.device && store.device[DEVICE.SN];
    if (!sn) return decline('no saved machine to file it under');
    // Live machine state, NOT `DeviceInfo.connected`. That flag is force-cleared on every
    // config save (AppConfig.cpp:887) and is set from a CallAfter that lands some time
    // after the connect reply, so a page that gates on it declines for as long as the
    // race lasts and says nothing. Orca has its own `info.connected` check inside
    // `update_filament_info` and will refuse if it disagrees - which is an answer, and an
    // answer is what this needs. Objects arriving is the evidence that there is a printer.
    if (!state.lastUpdate) return decline('no machine state has arrived yet');

    const inv = inventory();
    if (!inv) return decline('print_task_config reports no filament slots');

    const value = JSON.stringify(inv);
    const key = JSON.stringify([sn, value]);
    if (key === sent) return false;

    busy = true;
    try {
      await bridge().request(CMD.UPDATE_MACHINE_FILAMENT_INFO,
                             { objects: [{ key: sn, value }] });
      sent = key;
      said = '';
      hostLog(`filament inventory synced to Orca (${reason})`);
      return true;
    } catch (e) {
      // Worth saying, because the visible consequence is on ANOTHER TAB: the Prepare
      // page's filament rows go on offering what was loaded before. Said once per
      // distinct reason, and retried on a clock rather than on every repaint - the
      // common refusal is "The machine is not connected!", which is Orca's own device
      // book catching up and resolves itself.
      if (said !== e.message) {
        said = e.message;
        hostLog(`filament sync refused (${reason}): ${e.message}`, 'error');
      }
      retryAt = Date.now() + RETRY_MS;
      return false;
    } finally {
      busy = false;
    }
  }

  /** Read the one object the inventory needs and this page does not otherwise keep. */
  async function readSystemInfo() {
    try {
      const info = await bridge().request(CMD.GET_MACHINE_SYSTEM_INFO, {});
      store.systemInfo = (info && info.system_info) || info || null;
    } catch (e) {
      /* an older firmware, or no printer; nozzle_diameters degrades to empty strings */
    }
  }

  return {
    sync,
    readSystemInfo,
    /** Forget what was sent, so the next state change re-sends. Used on reconnect. */
    forget() { sent = null; retryAt = 0; said = ''; },
    /** For tests: the payload without sending it. */
    inventory,
  };
}
