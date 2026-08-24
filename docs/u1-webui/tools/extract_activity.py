#!/usr/bin/env python3
"""Recover the machine's activity table - what it says it is doing right now.

`machine_state_manager.action_code` is a small integer the printer pushes on the state
stream, and the bundle carries the switch that turns it into a sentence. It matters for
more than a status line: a toolchange can trigger an XY calibration, which takes far
longer than the bridge's own 15s request timeout, so a client that cannot see "Extruder
Docking Calibrating..." has no way to tell a slow success from a failure.

Only codes >= 128 are taken. Below that the bundle has two further switches over small
integers - the main_state enum and a homing enum - and their cases collide with these
(1 is both "Working" and "Homing"), so mixing them would produce a table that is wrong
wherever it is ambiguous.

Writes: docs/u1-webui/data/activity-codes.json
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import DATA, read_bundle  # noqa: E402

OUT = os.path.join(DATA, "activity-codes.json")


def _switch_around(src, needle, before=3000, after=2600):
    """The case list of the switch that owns `needle`."""
    i = src.find(needle)
    if i < 0:
        sys.exit(f"not found in the bundle: {needle}")
    start = src.rfind("switch(", 0, i - before)
    seg = src[start:i + after]
    return re.findall(r'case (\d+):return A\.D\("([^"]+)"', seg)


def main():
    src = read_bundle()

    # Two separate tables, and they must not be merged: their case spaces overlap, so
    # 1 is "Working" in one and "Homing" in the other. Keyed apart, each is exact.
    action = {}
    for code, text in _switch_around(src, "Extruder Docking Calibrating"):
        n = int(code)
        if n >= 128:
            action[str(n)] = text

    main_state = {}
    for code, text in _switch_around(src, "XYZ calibrating"):
        n = int(code)
        if n <= 14:
            main_state.setdefault(str(n), text)   # first wins: later cases are the
                                                  # homing enum bleeding into the window

    os.makedirs(DATA, exist_ok=True)
    json.dump({"action_codes": action, "main_states": main_state},
              open(OUT, "w", encoding="utf-8"), indent=1)
    print(f"activity: {len(action)} action codes (>=128), {len(main_state)} main states")


if __name__ == "__main__":
    main()
