/*
 * activity.js - what the machine says it is doing. GENERATED, do not edit.
 *   python3 docs/u1-webui/tools/gen_activity_module.py
 *
 * Two tables, because the printer reports at two granularities and they are not
 * interchangeable:
 *
 *   machine_state_manager.main_state   coarse - "XYZ calibrating", "Docking Coordinate
 *                                      Calibrating" - the thing that makes a toolchange
 *                                      take minutes
 *   machine_state_manager.action_code  fine - "Checking Extruder Pick...", and only
 *                                      populated for some operations
 *
 * They must stay keyed apart: their case spaces overlap, so 1 is "Working" in one and
 * "Homing" in the other. Merging them would be wrong wherever it is ambiguous.
 *
 * This is not decoration. A toolchange can trigger a calibration that runs far longer
 * than the bridge's 15s request timeout, so without these a client cannot tell a slow
 * success from a failure - it only sees its own request give up.
 */
'use strict';

export const ACTION_LABELS = {
  128: "Resuming printing...",
  129: "Paused",
  130: "Resuming print...",
  131: "Auto-reloading filament...",
  132: "Checking toolheads...",
  133: "Auto-loading filament...",
  134: "Pre-extruding...",
  135: "Auto-unloading filament...",
  136: "Bed detecting...",
  192: "Cleaning Nozzle 1 (1/4)",
  193: "Cleaning Nozzle 2 (2/4)",
  194: "Cleaning Nozzle 3 (3/4)",
  195: "Cleaning Nozzle 4 (4/4)",
  196: "Calibrating Toolhead 1...",
  197: "Calibrating Toolhead 2...",
  198: "Calibrating Toolhead 3...",
  199: "Calibrating Toolhead 4...",
  200: "Wiping Nozzle...",
  201: "Cooling Nozzle...",
  256: "Leveling progress...",
  320: "Toolhead 1 Calibrating extrusion flow",
  321: "Toolhead 2 Calibrating extrusion flow",
  322: "Toolhead 3 Calibrating extrusion flow",
  323: "Toolhead 4 Calibrating extrusion flow",
  384: "Calibrating vibration compensation...",
  512: "Reset to Initial Position",
  513: "Sampling to Calculate Reference Height",
  514: "Adjust Leveling Wheels",
  515: "Re-checking reference points...",
  576: "Auto Loading",
  640: "Unloading",
  704: "Manual Loading",
  768: "Extruder Docking Calibrating...",
  769: "Checking Extruder Park...",
  770: "Checking Extruder Pick...",
  832: "Homing Calibration...",
};

export const MAIN_STATE_LABELS = {
  0: "Idle",
  1: "Working",
  2: "XYZ calibrating",
  3: "Heated bed Calibrating",
  4: "Flow Calibrating",
  5: "Vibration Compensation Calibrating",
  6: "Updating",
  7: "Error",
  8: "Manual Adjusting Spring Screw",
  9: "Auto Loading",
  10: "Unloading",
  11: "Manual Loading",
  12: "Docking Coordinate Calibrating",
  13: "Homing Calibration...",
  14: "Offline",
};

/* Idle says nothing, and Working says nothing a caller waiting on a specific operation
 * did not already know. Everything else is worth showing. */
const UNINFORMATIVE_MAIN_STATES = new Set([0, 1]);

/** Text for an action code, or null when idle or silent. */
export function activityLabel(code) {
  if (code == null) return null;
  const n = Number(code);
  if (!Number.isFinite(n) || n === 0) return null;
  return ACTION_LABELS[n] || `Working (code ${n})`;
}

/** Text for a main_state, or null when it carries no information. */
export function mainStateLabel(state) {
  if (state == null) return null;
  const n = Number(state);
  if (!Number.isFinite(n) || UNINFORMATIVE_MAIN_STATES.has(n)) return null;
  return MAIN_STATE_LABELS[n] || null;
}

/**
 * The best sentence available for what the machine is doing.
 *
 * action_code first because it is the more specific of the two, then main_state, which
 * is where a calibration triggered by a toolchange actually shows up.
 */
export function machineActivity(activity) {
  if (!activity) return null;
  return activityLabel(activity.actionCode) || mainStateLabel(activity.mainState);
}

/** Is the machine reporting that it is busy with anything at all? */
export function isBusy(activity) {
  if (!activity) return false;
  const a = Number(activity.actionCode);
  if (Number.isFinite(a) && a !== 0) return true;
  const m = Number(activity.mainState);
  return Number.isFinite(m) && !UNINFORMATIVE_MAIN_STATES.has(m) && m !== 14;
}
