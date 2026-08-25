/*
 * session.js - keeping a printer on the other end of the bridge.
 *
 * Everything about *having* a connection rather than about showing one: the connect
 * path, whether the machine is still there, reconnecting when it is not, the heartbeat,
 * and the state stream that feeds MachineState. No panel reads any of it, which is
 * exactly why it can leave app.js.
 *
 * Three facts here were expensive to learn and are load-bearing:
 *
 *  1. DeviceInfo.connected says nothing about reachability - AppConfig force-clears it
 *     for every device on each config save (AppConfig.cpp:887). Live machine state is
 *     the only evidence, which is what isLive() is.
 *  2. sw_mqtt_set_engine does not connect anything: SSWCP.cpp:6643 hardcodes
 *     "bool res = true;", so the host expects an already-connected mTLS engine and the
 *     page has to build one itself.
 *  3. Certificates are never persisted - SSWCP.cpp blanks them - so every start re-runs
 *     the key exchange.
 *
 * Dependencies are injected rather than imported, because they run the other way: the
 * session asks the page to repaint and to say things, and a module that imported app.js
 * to do it would be a cycle.
 */
'use strict';

import { CMD, SUBSCRIBE_OBJECTS, DEVICE, deviceLabel, hasTlsMaterial }
  from '../../../shared/js/protocol.js';
import { openDialog } from './overlay.js';
import { connect as connectDevice, disconnect as disconnectDevice } from './connection.js';

/**
 * @param bridge     () => the live Sswcp client. A getter, because the session is built
 *                   before the bridge is and outlives any one of them.
 * @param state      MachineState - the mirror this fills.
 * @param store      page state; the session writes device, devices and reachable.
 * @param setStatus  the one-line host status in the dev aids.
 * @param render     ask for a repaint.
 * @param refresh    re-read Orca's device list.
 * @param hostLog    the diagnostics beacon; see diag.js.
 * @param handlers   the command bag, for the page-level actions a reconnect implies.
 */
export function createSession({ bridge, state, store, setStatus, render, refresh,
                                hostLog, handlers }) {
  // The session's own internals. Nothing outside reads them: a socket, a subscription id
  // and two timer handles are not state a panel can have an opinion about.
  let engineId = null;     // the MQTT engine this page created
  let subscription = null;
  let connecting = false;
  let heartbeat = null;

  /**
   * How long the machine may say nothing before the page stops vouching for it.
   *
   * Measured on an idle U1: **2 status pushes in 30 seconds**, gaps of 4s to 14s across
   * runs. Klipper only pushes fields that change and a machine doing nothing changes
   * almost nothing, so this has to be several times the idle gap or a quiet printer
   * would flicker as if it had gone away. 45s is about 3x the widest gap seen, and the
   * heartbeat's own 30s covers a machine that has genuinely nothing to say.
   */
  const STALE_MS = 45000;
  /** When the printer last answered a heartbeat. Its own evidence, not the stream's. */
  let lastPong = 0;
  /**
   * Are we talking to a printer *now*?
   *
   * `state.lastUpdate > 0` used to stand in for this, which is a claim about the past:
   * once anything had arrived the page went on saying "connected" for the rest of the
   * session, and a rebooting printer kept its last snapshot on screen as if current.
   *
   * Two independent pieces of evidence, either sufficient: something arrived on the
   * stream recently, or the printer answered a heartbeat recently.
   */
  function isLive(now = Date.now()) {
    if (!Object.keys(state.objects).length) return false;
    return state.age(now) < STALE_MS || now - lastPong < STALE_MS;
  }
  /**
   * How long to wait between attempts, backing off and then holding.
   *
   * A printer that is off is off for minutes, not milliseconds, and a failed attempt
   * costs a 15s TCP connect - so the ladder starts short enough to feel immediate when
   * someone flips the switch and settles somewhere that is not a poll loop.
   */
  const RETRY_MS = [5000, 10000, 20000, 30000];
  let retryAt = 0;
  let retryStep = 0;
  /** A manual attempt starts over: the user knows something the backoff does not. */
  function resetBackoff() {
    retryAt = 0;
    retryStep = 0;
  }
  /**
   * Keep the session up, and repaint when it is not.
   *
   * Two jobs on one clock, because both need the same thing - something that ticks when
   * nothing is arriving:
   *
   *  1. Repaint on the flip. Every other repaint here is triggered by a message, which
   *     is exactly what a printer that has gone away stops sending, so the page would
   *     otherwise hold its last frame forever.
   *  2. Reconnect. The page used to make ONE attempt, at boot, and only if nothing had
   *     ever arrived. Start the app before the printer and it stayed dark until a
   *     reload; reboot the printer and it never came back. Both are the ordinary way
   *     this hardware gets used.
   */
  function superviseConnection() {
    let was = null;
    setInterval(() => {
      const live = isLive();
      if (live !== was) {
        was = live;
        if (!live && store.device) {
          setStatus(`${deviceLabel(store.device)} \u2014 not responding`, 'warn');
        }
        render();
      }
      if (live) { resetBackoff(); return; }
      if (connecting || !store.device) return;
      // Pairing needs a human reading a code off the machine, so a device that cannot
      // authorise itself is not something to retry at.
      if (!store.device[DEVICE.IP] || !store.device[DEVICE.SN]) return;
      if (Date.now() < retryAt) return;
      // Schedule the next attempt before starting this one: a failing connect can take
      // 15s by itself, and the interval is between attempts, not between failures.
      retryStep = Math.min(retryStep + 1, RETRY_MS.length);
      retryAt = Date.now() + RETRY_MS[retryStep - 1];
      reconnect();
    }, 2000);
  }
  /**
   * Bring the session back.
   *
   * The dead engine is dropped first. It still holds a socket at the host, and the next
   * connect makes a new one - a printer rebooted a few times would otherwise leave a
   * line of them behind, all subscribed to topics nothing will publish.
   */
  function reconnect() {
    if (engineId) {
      const dead = engineId;
      engineId = null;
      disconnectDevice(bridge(), dead).catch(() => { /* already gone; that was the point */ });
    }
    return doConnect(store.device, { silent: true, retrying: true });
  }
  /** Ask the user for the code the printer is displaying. */
  function askForPin() {
    return new Promise((resolve) => {
      let input;
      let settled = false;
      openDialog({
        title: 'Pairing code',
        build: (b) => {
          const p = document.createElement('p');
          p.style.cssText = 'margin:4px 0 14px;font-size:13px;line-height:1.55;color:#39434F';
          p.textContent = 'The printer is showing a code on its screen. Enter it here to '
            + 'finish pairing. Orca stores the keys it receives, so this is only needed once.';
          b.appendChild(p);
          const f = document.createElement('label');
          f.className = 'field';
          const lab = document.createElement('span');
          lab.className = 'field-label';
          lab.textContent = 'Code';
          f.appendChild(lab);
          const row = document.createElement('div');
          row.className = 'field-row';
          input = document.createElement('input');
          input.setAttribute('inputmode', 'numeric');
          input.autocomplete = 'off';
          row.appendChild(input);
          f.appendChild(row);
          b.appendChild(f);
        },
        confirmLabel: 'Pair',
        onConfirm: () => {
          const v = input.value.trim();
          if (!v) { input.focus(); return false; }
          settled = true;
          resolve(v);
          return true;
        },
      });
      // Cancelling the dialog resolves empty, which connection.js treats as a cancel.
      const scrim = document.querySelector('.scrim');
      if (scrim) {
        const obs = new MutationObserver(() => {
          if (!document.body.contains(scrim)) {
            obs.disconnect();
            if (!settled) resolve('');
          }
        });
        obs.observe(document.body, { childList: true });
      }
    });
  }
  async function doConnect(target, opts = {}) {
    if (connecting) return;
    connecting = true;
    render();
    hostLog(`connect start: sn=${target[DEVICE.SN]} ip=${target[DEVICE.IP]} `
          + `port=${target[DEVICE.PORT]} link=${target[DEVICE.LINK_MODE]} `
          + `clientId=${target[DEVICE.CLIENT_ID] || '(none)'} `
          + `hasKeys=${hasTlsMaterial(target)} token=${!!store.loginUser.token} `
          + `silent=${!!opts.silent}`);
    try {
      const res = await connectDevice(bridge(), target, {
        // An automatic attempt never prompts; pairing is a deliberate action.
        requestPin: opts.silent ? null : askForPin,
        user: store.loginUser,
        onStep: (t) => { setStatus(t); hostLog(t); },
        trace: (t) => hostLog(t, 'warning'),
      });
      engineId = res.engineId;
      hostLog(`connected to ${deviceLabel(target)} (engine ${res.engineId})`);
      setStatus(`${deviceLabel(target)} — connected`, 'ok');
      await refresh();
      // The session only exists now, so this is the first point the state
      // commands can succeed.
      await startStateStream('after connect');
      startHeartbeat();
      handlers.queryException();
    } catch (e) {
      // ConnectError names the step that failed, which is the useful half.
      if (opts.silent) {
        // Time left on the clock, not the interval it was set to: the attempt that just
        // failed may have taken longer than the gap it was scheduled with.
        const left = Math.max(0, Math.round((retryAt - Date.now()) / 1000));
        const again = opts.retrying
          ? (left ? ` — trying again in ${left}s` : ' — trying again') : '';
        setStatus(`${deviceLabel(target)} — not connected (${e.message})${again}`, 'warn');
      } else {
        setStatus(`connect failed — ${e.message}`, 'err');
      }
      hostLog(`connect failed at step "${e.step || '?'}": ${e.message}`, 'error');
      console.error('[app] connect', e);
    } finally {
      connecting = false;
      render();
    }
  }
  async function doDisconnect() {
    if (!engineId) {
      setStatus('this session was not opened by the page — nothing to disconnect', 'warn');
      return;
    }
    await disconnectDevice(bridge(), engineId);
    engineId = null;
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    store.exception = null;
    await refresh();
    setStatus('disconnected', 'warn');
  }
  /** Keep the session warm while we hold one, as the shipped page does. */
  function startHeartbeat() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      // Not fire-and-forget any more: this round trip is the only evidence a machine
      // with nothing to report is still there, and its failure is evidence it is not.
      bridge().request(CMD.HEARTBEAT, {})
        .then(() => { lastPong = Date.now(); })
        .catch(() => { /* the staleness window decides; nothing to record */ })
        .then(() => render());
    }, 30000);
  }
  /**
   * Declare the field filter, take a snapshot, and open the live stream.
   *
   * All three must run *after* a session exists — sw_GetMachineState and
   * sw_SubscribeMachineState both need `get_connect_host`, so at boot with no
   * host they fail and the page is left with no data and no subscription. Running
   * only a snapshot after connecting is not enough either: the UI would show one
   * frozen frame and never update.
   */
  /**
   * Fetch `toolhead` once, outside the subscription.
   *
   * `homed_axes` lives only on that object and the shipped page does not subscribe it, so
   * the stream never carries it. It only changes when the machine homes, which makes a
   * one-shot query at connect and after G28 sufficient - and keeps the subscription list
   * byte-identical to the bundle's, which the conformance suite enforces.
   */
  async function refreshToolhead() {
    return refreshWaitState();
  }
  /**
   * Re-read the objects a wait depends on that the stream does not carry.
   *
   * `toolhead` holds `homed_axes`, and `extruder_offset_calibration` holds the docking
   * calibration step that makes a toolchange slow. Neither is subscribed - the shipped
   * page does not subscribe them and the object list is pinned to the bundle's - so they
   * are fetched explicitly. One query for both, because a wait needs them together.
   */
  async function refreshWaitState() {
    try {
      const snap = await bridge().request(CMD.GET_MACHINE_STATE, {
        objects: {
          // `homed_axes` is the toolchange's real progress signal - it walks
          // "" -> z -> "" -> y -> xy across the long homing phase - and `toolhead` is not
          // subscribed, so it has to be asked for.
          toolhead: ['extruder', 'position', 'homed_axes'],
          // `activating_move` marks the moment the head is being grabbed. It is on an
          // object the page does subscribe, but not among EXTRUDER_FIELDS, and that list
          // is pinned to the bundle's - so it is fetched rather than subscribed.
          extruder: ['state', 'activating_move'],
          extruder1: ['state', 'activating_move'],
          extruder2: ['state', 'activating_move'],
          extruder3: ['state', 'activating_move'],
          extruder_offset_calibration: null,
        },
      });
      state.applyPayload(snap);
    } catch (e) {
      /* a wait must not fail because a status read did; it just learns nothing */
    }
  }
  async function startStateStream(reason) {
    // The three calls are independent and must not be chained. sw_SetSubscribeFilter
    // forwards `printer.objects.setSubscribeFilter` to the printer and waits for a
    // reply; against a real U1 that reply does not always come, and awaiting it
    // starved the two calls that actually matter. It is only an optimisation —
    // query and subscribe both carry their own object map — so fire it and move on.
    bridge().request(CMD.SET_SUBSCRIBE_FILTER, { objects: SUBSCRIBE_OBJECTS })
      .then(() => hostLog(`filter accepted (${reason})`))
      .catch((e) => hostLog(`filter skipped (${reason}): ${e.message}`));

    let ok = false;
    try {
      const snap = await bridge().request(CMD.GET_MACHINE_STATE, { objects: SUBSCRIBE_OBJECTS });
      state.applyPayload(snap);
      hostLog(`snapshot ok (${reason}): ${Object.keys(state.objects).length} objects`);
      ok = Object.keys(state.objects).length > 0;
      refreshToolhead();          // homed_axes is not in the subscribed set
    } catch (e) {
      hostLog(`snapshot failed (${reason}): ${e.message}`, 'error');
    }

    try {
      if (subscription && subscription.cancel) subscription.cancel();
      subscription = await bridge().subscribe(CMD.SUBSCRIBE_MACHINE_STATE, {}, (d) => {
        state.applyPayload(d);
      });
      hostLog(`subscribed (${reason})`);
    } catch (e) {
      hostLog(`subscribe failed (${reason}): ${e.message}`, 'error');
    }

    render();
    return ok;
  }
  return {
    isLive,
    connect: doConnect,
    disconnect: doDisconnect,
    reconnect,
    resetBackoff,
    supervise: superviseConnection,
    startStateStream,
    startHeartbeat,
    refreshToolhead,
    refreshWaitState,
    /** Whether this page brought the session up, and can therefore take it down. */
    get engineId() { return engineId; },
  };
}
