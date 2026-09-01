#!/usr/bin/env python3
"""Record the ACE macro surface off a real U1, as evidence.

The Filament panel is built almost entirely out of G-code macros, and `check_coverage.py`
holds every one of them to a decision. That table was written down from a study, and
writing it down is exactly how it came to name `ACE_SET_AUTO_DRY THRESHOLD=` - an
argument the printer accepts, answers `ok` to, and ignores. This asks the machine
instead, and `check_coverage.py` cross-checks the table against what comes back.

Read-only: `printer.gcode.help` and nothing else. It moves nothing and sets nothing.

    python3 docs/u1-webui/tools/ace_macros.py            # -> data/ace-macros.json
    python3 docs/u1-webui/tools/ace_macros.py --ip 192.168.2.242 --sn <SN>

Not part of run_all.py: that regenerates from the shipped bundle, and this needs a
printer with multiACE on it. Re-run it against a firmware update and diff the file.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import DATA                                          # noqa: E402
from u1_probe import Session, device_from_orca_config             # noqa: E402

OUT = os.path.join(DATA, "ace-macros.json")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ip")
    ap.add_argument("--sn")
    ap.add_argument("--client-id")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    dev = device_from_orca_config() or {}
    ip = args.ip or dev.get("ip")
    sn = args.sn or dev.get("sn")
    if not ip or not sn:
        raise SystemExit("no printer: pass --ip and --sn, or pair one in Orca first")
    client_id = args.client_id or dev.get("clientId") or f"orca-{sn}"

    s = Session(ip, sn, client_id, verbose=False)
    s.open(s.request_keys())
    answer, _ = s.call("printer.gcode.help")
    res = (answer or {}).get("result", answer)
    if isinstance(res, dict) and "result" in res:
        res = res["result"]
    if not isinstance(res, dict) or not res:
        raise SystemExit("printer.gcode.help returned nothing")

    # The ACE surface, and SET_ACE_MODE, which is the one control that does not carry the
    # prefix. Everything else on the machine is Klipper's own and not this panel's
    # business.
    keep = {k: v for k, v in res.items()
            if k.upper().startswith("ACE") or k.upper() == "SET_ACE_MODE"}
    out = {"_source": "printer.gcode.help on a U1 running multiACE",
           "_total_macros_on_machine": len(res),
           "macros": dict(sorted(keep.items()))}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"{len(keep)} ACE macros of {len(res)} -> {os.path.relpath(args.out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
