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


def main():
    src = read_bundle()
    anchor = src.find("Extruder Docking Calibrating")
    if anchor < 0:
        sys.exit("activity switch not found in the bundle")
    start = src.rfind("switch(", 0, anchor - 3000)
    seg = src[start:anchor + 600]

    codes = {}
    for code, text in re.findall(r'case (\d+):return A\.D\("([^"]+)"', seg):
        n = int(code)
        if n < 128:
            continue          # a different enum's case space - see the module docstring
        codes[str(n)] = text

    os.makedirs(DATA, exist_ok=True)
    json.dump({"action_codes": codes}, open(OUT, "w", encoding="utf-8"), indent=1)
    print(f"activity codes: {len(codes)} (>=128) -> {os.path.relpath(OUT, os.getcwd())}")


if __name__ == "__main__":
    main()
