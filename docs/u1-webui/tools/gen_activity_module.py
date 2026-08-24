#!/usr/bin/env python3
"""Emit the activity table as a JS module the Device page imports.

Generated rather than transcribed, for the same reason the fault catalogue is: it comes
from the bundle and there is no value in a hand-copy that can drift from it.

Writes: resources/web/shared/js/activity.js
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import DATA, ROOT  # noqa: E402

OUT = os.path.join(ROOT, "resources", "web", "shared", "js", "activity.js")


def main():
    data = json.load(open(os.path.join(DATA, "activity-codes.json"), encoding="utf-8"))
    def rows(d):
        return "\n".join(f"  {k}: {json.dumps(v)}," for k, v in
                          sorted(d.items(), key=lambda kv: int(kv[0])))
    js = f'''/*
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

export const ACTION_LABELS = {{
{rows(data["action_codes"])}
}};

export const MAIN_STATE_LABELS = {{
{rows(data["main_states"])}
}};

/* Idle says nothing, and Working says nothing a caller waiting on a specific operation
 * did not already know. Everything else is worth showing. */
const UNINFORMATIVE_MAIN_STATES = new Set([0, 1]);

/** Text for an action code, or null when idle or silent. */
export function activityLabel(code) {{
  if (code == null) return null;
  const n = Number(code);
  if (!Number.isFinite(n) || n === 0) return null;
  return ACTION_LABELS[n] || `Working (code ${{n}})`;
}}

/** Text for a main_state, or null when it carries no information. */
export function mainStateLabel(state) {{
  if (state == null) return null;
  const n = Number(state);
  if (!Number.isFinite(n) || UNINFORMATIVE_MAIN_STATES.has(n)) return null;
  return MAIN_STATE_LABELS[n] || null;
}}

/**
 * The best sentence available for what the machine is doing.
 *
 * action_code first because it is the more specific of the two, then main_state, which
 * is where a calibration triggered by a toolchange actually shows up.
 */
export function machineActivity(activity) {{
  if (!activity) return null;
  return activityLabel(activity.actionCode) || mainStateLabel(activity.mainState);
}}

/** Is the machine reporting that it is busy with anything at all? */
export function isBusy(activity) {{
  if (!activity) return false;
  const a = Number(activity.actionCode);
  if (Number.isFinite(a) && a !== 0) return true;
  const m = Number(activity.mainState);
  return Number.isFinite(m) && !UNINFORMATIVE_MAIN_STATES.has(m) && m !== 14;
}}
'''
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    print(f"activity module: {len(data['action_codes'])} action codes, "
          f"{len(data['main_states'])} main states")


if __name__ == "__main__":
    main()
