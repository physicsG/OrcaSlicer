/*
 * activity.js - what the machine says it is doing. GENERATED, do not edit.
 *   python3 docs/u1-webui/tools/gen_activity_module.py
 *
 * `machine_state_manager.action_code` is pushed on the state stream. The labels are the
 * bundle's own, recovered by extract_activity.py.
 *
 * This is not decoration. A toolchange can trigger an XY calibration that runs far
 * longer than the bridge's 15s request timeout, so without these a client cannot tell a
 * slow success from a failure - it just sees its own request give up.
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

/** Human text for an action code, or null when the machine is idle or silent. */
export function activityLabel(code) {
  if (code == null) return null;
  const n = Number(code);
  if (!Number.isFinite(n) || n === 0) return null;
  return ACTION_LABELS[n] || `Working (code ${n})`;
}

/** Is the machine reporting that it is busy with something? */
export function isBusy(code) {
  const n = Number(code);
  return Number.isFinite(n) && n !== 0;
}
