/*
 * commands/control.js - Commands the Control panel issues: heaters, fans, light, purifier, speed,
 * motion, and which toolhead is live.
 *
 * Two of them are not simple sends. A setpoint is held until the machine echoes it (see
 * pending.js), and a toolhead action waits on the MACHINE rather than on its own request
 * - sw_SendGCodes does not return until Klipper has finished the move, and the bridge
 * gives up at 15s while a cold toolchange measured 31s.
 *
 * check_coverage.py reads the CMD references out of this file to answer "can a user
 * reach this command", and attributes them to the control panel because this is the module
 * that panel is handed. That makes the attribution a fact about the imports rather than
 * a promise in a declaration - which is the difference that let a handler nothing called
 * count as implemented for as long as it did.
 */
'use strict';

import { CMD, NAMED, LIMITS, PRINT_PREFERENCES }
  from '../../../../../shared/js/protocol.js';
import { openDialog, openBlockingDialog, toggleField } from '../../../core/overlay.js';
import { isTimeout } from '../../../../../shared/js/sswcp.js';
import { machineActivity, isBusy } from '../../../../../shared/js/activity.js';

export function create(deps) {
  // `bridge` is deliberately NOT destructured: it does not exist yet when these are
  // built - boot() decides between the real host and the simulator - so it is reached
  // through deps each time rather than captured as null once.
  const { state, store, pending, session, cmd,
          send, setpoint, setStatus, render } = deps;

  const clampTo = (lim, v) => Math.min(lim.max, Math.max(lim.min, Math.round(v)));

  // A toolchange is mechanical. 60s is what the printer's own UI allows: its handler
  // raises an "Extruder N operating..." overlay with a 60 timeout before dispatching.
  const TOOL_CHANGE_TIMEOUT_MS = 60000;

  /**
   * Fire a toolhead command and wait for the machine, not for the request.
   *
   * Three things make the obvious `await deps.bridge.request(...)` wrong here:
   *
   *  1. `sw_SendGCodes` does not return until Klipper has finished the move, but the
   *     bridge gives up after 15s (TIMEOUT_MS in sswcp.js). A toolchange that triggers an
   *     XY calibration runs far longer than that, so the request rejects while the printer
   *     is still working. Treating that rejection as failure told the user to retry
   *     something already in progress.
   *  2. The G-code ack only says the command was queued. The machine's own state is the
   *     only thing that says it worked.
   *  3. The machine says what it is doing: `machine_state_manager.action_code` reports
   *     "Extruder Docking Calibrating...", "Checking Extruder Pick..." and the rest. So
   *     the wait can show the real reason it is taking a while, and - more usefully - can
   *     keep waiting for as long as the machine claims to be busy.
   *
   * The shipped page does none of this. It raises an overlay with a flat 60s auto-dismiss
   * and reports "Request timeout, please try again later" when its own request gives up,
   * whether or not the printer is still moving.
   */
  const TOOL_ACTION_HARD_CAP_MS = 10 * 60 * 1000;

  /**
   * `done` is OPTIONAL, and homing is why.
   *
   * An action with a goal the machine reports - a toolchange, a park - ends when that
   * field says so, and waiting past it would only be waiting. An action with no such
   * field ends on the one thing every action has: the machine having been working and
   * having stopped. That is the `sawBusy` branch below, and for those actions it is not
   * a fallback but the whole signal.
   *
   * Passing a `done` that is not really one is worse than passing none, because it wins
   * the race: it is tested first, so a field that is already true closes the dialog
   * before the machine has moved. That is exactly what `home` did with `homed_axes`.
   */
  function runToolAction({ title, script, waiting, done, gaveUp, settle }) {
    const dlg = openBlockingDialog({ title, message: waiting });
    let refused = null;
    // deliberately not awaited - see (1)
    deps.bridge.request(CMD.SEND_GCODES, { script }).catch((e) => {
      // A timeout is not a refusal - the machine is still moving. Which clock ran out
      // is isTimeout's business; see the note on it in sswcp.js.
      if (!isTimeout(e)) refused = e;
    });

    const started = Date.now();
    let quietDeadline = started + TOOL_CHANGE_TIMEOUT_MS;
    let lastLabel = null;

    return (async () => {
      let sawBusy = false;
      let lastPoll = 0;
      for (;;) {
        // Every source that answers, not just machine_state_manager - which reads
        // {main_state: 0, action_code: 0} straight through a manual toolchange on this
        // firmware, so a wait that trusted it alone saw silence and gave up on work that
        // was going fine. busyReason() adds the calibration step, the macro's own message
        // and physical motion.
        const act = state.activity();
        const reason = state.busyReason();

        if (done && done()) {
          if (settle) await settle();
          dlg.close(); render(); return;
        }
        if (refused) { dlg.fail(`The printer refused the command: ${refused.message}`); return; }

        // The action's own line is the more useful one when all the machine will say is
        // that it is busy - see `vague` in busyReason().
        const label = machineActivity(act) || (reason.vague ? null : reason.label);
        if (label) {
          if (label !== lastLabel) { dlg.update(label); lastLabel = label; }
        } else if (lastLabel) {
          dlg.update(waiting);
          lastLabel = null;
        }
        // keep waiting for as long as anything says it is doing something
        if (isBusy(act) || reason.busy) {
          sawBusy = true;
          quietDeadline = Date.now() + TOOL_CHANGE_TIMEOUT_MS;
        } else if (sawBusy) {
          // It was working and has stopped. `sawBusy` is what keeps this from firing in
          // the seconds before the machine picks the command up: idle_timeout was still
          // "Ready" for the first 1.6s of the measured G28, and closing there would be
          // the same bug from the other end.
          if (settle) await settle();
          dlg.close(); render(); return;
        }

        // re-read the unsubscribed objects roughly once a second
        if (Date.now() - lastPoll > 1000) { lastPoll = Date.now(); await session.refreshWaitState(); }

        if (Date.now() > quietDeadline) { dlg.fail(gaveUp); return; }
        if (Date.now() - started > TOOL_ACTION_HARD_CAP_MS) {
          dlg.fail(`${gaveUp} Giving up after ten minutes.`);
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    })();
  }

  return {
    setSpeed: (v) =>
      send(CMD.CONTROL_PRINT_SPEED, { percentage: clampTo(LIMITS.printSpeed, v) }, 'set speed'),

    setBedTemp: (v) => {
      const t = clampTo(LIMITS.bedTemp, v);
      return setpoint(CMD.CONTROL_BED_TEMP, { temp: t }, 'set bed temp',
                      t > 0 ? `Heated bed \u2192 ${t} \u00B0C` : 'Heated bed off');
    },

    setExtruderTemp: (index, v) => {
      const t = clampTo(LIMITS.nozzleTemp, v);
      return setpoint(CMD.CONTROL_EXTRUDER_TEMP, { temp: t, index, map: index },
                      'set nozzle temp',
                      t > 0 ? `Toolhead ${index + 1} \u2192 ${t} \u00B0C`
                            : `Toolhead ${index + 1} off`);
    },

    setMainFan: (v) =>
      send(CMD.CONTROL_MAIN_FAN, { speed: clampTo(LIMITS.fanSpeed, v) }, 'set main fan'),

    setCavityFan: (v) =>
      send(CMD.CONTROL_GENERIC_FAN,
           { name: NAMED.cavityFan, speed: clampTo(LIMITS.fanSpeed, v) }, 'set assist fan'),

    // Held until the printer echoes it, like a setpoint: measured at 236ms, 2029ms and
    // 620ms across three runs, and the switch reverted under the mirror in two of them.

    setLed: (on) =>
      pending.track('led', !!on,
        send(CMD.CONTROL_LED, { name: NAMED.cavityLed, white: on ? 1 : 0 }, 'set led')),

    // mode is an integer on the wire; the page used to send 'inner'/'exhaust' strings.

    setPurifierMode: (mode) =>
      send(CMD.CONTROL_PURIFIER, { mode: Number(mode) }, 'set purifier mode'),

    /** Aim jog and extrude at a head. Selection only - it does not change the tool. */

    selectTool: (i) => { store.activeTool = Number(i) || 0; render(); },

    // Motion has no dedicated bridge command - the shipped page sends G-code, so
    // this does too. G28 homes; G91/G0/G90 makes one relative step.
    /**
     * Home, then re-read what got homed.
     *
     * `homed_axes` lives only on the `toolhead` object, which the shipped page does not
     * subscribe - so nothing on the stream reports that homing finished. G28 also runs far
     * longer than the bridge's 15s timeout, so this waits on the machine the same way a
     * toolchange does, then refreshes the one field that cannot arrive on its own.
     */

    /**
     * Homing has no goal field, and `homed_axes` is not one.
     *
     * It looked like one, and this wait used it twice - first alone, then guarded by a
     * stillness check - and closed early both times. A real G28 was watched end to end
     * on 811002511261022618B3 (2026-09-01, 42 s, sampled every 200 ms) and settles it:
     *
     *       0.0s  homed_axes "xyz"   idle_timeout "Ready"     vel 0     <- G28 sent
     *       1.6s  homed_axes "xyz"   idle_timeout "Printing"  vel 0
     *       5.5s  homed_axes "xyz"                            vel 40
     *      27.6s  homed_axes "xyz"                            vel 0     z 309
     *      41.7s  homed_axes "xyz"   idle_timeout "Ready"     vel 0     <- done
     *
     * `homed_axes` NEVER MOVED. It read "xyz" for the whole procedure, because the
     * machine was already homed and this firmware's G28 does not clear it - so the
     * predicate was true on the first poll and the dialog shut over a machine that had
     * not started. (The toolchange trace in state.js's busyReason does show it clearing;
     * that is `G28 X Y` under a homing_override, and it is a different path.)
     *
     * `live_velocity` cannot patch it either: it reads exactly 0 for two seconds at a
     * time between the homing moves, eight times across those 42 seconds. Any stillness
     * window short enough to be responsive fits inside one of those gaps.
     *
     * `idle_timeout` bracketed the operation exactly - Ready, Printing for forty
     * seconds, Ready - and `busyReason()` already reads it. So the answer is to pass no
     * done() at all and let the wait end where the evidence is: the machine having been
     * working and having stopped.
     */
    home: () => runToolAction({
      title: 'Homing',
      script: 'G28',
      waiting: 'Homing all axes\u2026',
      // One more read on the way out: the wait polls `toolhead` about once a second, and
      // what the jog guard needs is `homed_axes` as it stands when the machine stopped.
      settle: () => session.refreshToolhead(),
      gaveUp: 'Homing did not finish in time.',
    }),

    /**
     * Change the live toolhead, or park it. See runToolAction for why this does not
     * simply await the command.
     */

    pickTool: (i) => {
      const idx = Number(i) || 0;
      return runToolAction({
        title: `Switching to toolhead ${idx + 1}`,
        // `T<n> A0` is what the printer's own UI sends, recovered from the shipped bundle.
        // The A0 is not decoration - the firmware's SM_PRINT_CHECK_SWITCH_EXTRUDER passes
        // it too. Neither this nor PARK_EXTRUDER appears in printer.gcode.help, because
        // both register without help strings, as T0..T3 do.
        script: `T${idx} A0`,
        waiting: `Waiting for toolhead ${idx + 1}\u2026`,
        done: () => state.toolhead().activeIndex === idx,
        gaveUp: `Toolhead ${idx + 1} did not report active. The printer may still be `
              + 'working, or the change may have failed.',
      });
    },

    parkTool: (i) => {
      const live = state.toolhead().activeIndex;
      const idx = i == null ? live : Number(i);
      if (live == null || idx !== live) {
        setStatus(live == null ? 'No toolhead is engaged'
                               : `Toolhead ${live + 1} is the one engaged`, 'warn');
        return Promise.resolve();
      }
      return runToolAction({
        title: `Parking toolhead ${idx + 1}`,
        script: `PARK_EXTRUDER${idx === 0 ? '' : idx}`,
        waiting: 'Waiting for the printer to park\u2026',
        done: () => state.toolhead().activeIndex == null,
        gaveUp: 'The printer did not report a parked toolhead.',
      });
    },

    // chrome, from the registry's header declarations

    jog: (axis, deltaMm, toolIndex) => {
      const d = Number(deltaMm);
      if (!Number.isFinite(d) || d === 0) return;
      if (axis === 'E') {
        // Extrusion is per-toolhead, so select the tool first.
        const t = Number(toolIndex) || 0;
        return send(CMD.SEND_GCODES,
                    { script: `T${t}\nG91\nG0 E${d} F300\nG90` }, 'extrude');
      }
      // Klipper refuses a move on an unhomed axis and the failure is silent from here,
      // so say so rather than letting the press look like a dead button.
      if (state.toolhead().allHomed === false) {
        setStatus('Home the axes before jogging', 'warn');
        return;
      }
      const feed = axis === 'Z' ? 600 : 3000;
      return send(CMD.SEND_GCODES,
                  { script: `G91\nG0 ${axis}${d} F${feed}\nG90` }, `jog ${axis}`);
    },

    printPrefs: () => {
      const tc = state.taskConfig();
      const boxes = [];
      openDialog({
        title: 'Print Preferences',
        build: (b) => PRINT_PREFERENCES.forEach(({ key, label }) => {
          boxes.push([key, toggleField(b, { label, checked: !!tc[key] })]);
        }),
        confirmLabel: 'Apply',
        onConfirm: () => {
          const patch = {};
          boxes.forEach(([k, input]) => { patch[k] = input.checked; });
          send(CMD.UPDATE_MACHINE_FILAMENT_INFO, patch, 'set print preferences');
        },
      });
    },
  };
}
