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
    codes = json.load(open(os.path.join(DATA, "activity-codes.json"),
                           encoding="utf-8"))["action_codes"]
    rows = "\n".join(f"  {k}: {json.dumps(v)}," for k, v in
                     sorted(codes.items(), key=lambda kv: int(kv[0])))
    js = f'''/*
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

export const ACTION_LABELS = {{
{rows}
}};

/** Human text for an action code, or null when the machine is idle or silent. */
export function activityLabel(code) {{
  if (code == null) return null;
  const n = Number(code);
  if (!Number.isFinite(n) || n === 0) return null;
  return ACTION_LABELS[n] || `Working (code ${{n}})`;
}}

/** Is the machine reporting that it is busy with something? */
export function isBusy(code) {{
  const n = Number(code);
  return Number.isFinite(n) && n !== 0;
}}
'''
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    print(f"activity module: {len(codes)} codes -> {os.path.relpath(OUT, os.getcwd())}")


if __name__ == "__main__":
    main()
