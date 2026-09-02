#!/usr/bin/env python3
"""Build the printer error-code table from the bundle's shipped asset.

`assets/assets/files/deviceError.json` is a plain, unminified asset: a map of
locale -> [{ecode, intro}]. No extraction cleverness is needed, but the codes are
worth normalising because the leading digits are a *subsystem* identifier and the
rest a fault index, which is what makes the table navigable.

Writes: data/error-codes.json
"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import BUNDLE, DATA  # noqa: E402

# Error codes are 8 hex digits: SSSS S EEE
#
#   digits 1-4  subsystem
#   digit  5    severity  (derived below - see SEVERITY)
#   digits 6-8  fault index within the subsystem
#
# The subsystem labels are derived from the faults actually grouped under each
# prefix, not guessed: 0700-0703 carry an identical nine-fault filament-path set
# repeated four times, which is what identifies them as per-toolhead banks on the
# U1's four toolheads.
SUBSYSTEM = {
    "0300": "printer core - motion, homing, bed and nozzle temperature",
    "0500": "print-job submission and cloud transport",
    "0700": "filament path, toolhead 0",
    "0701": "filament path, toolhead 1",
    "0702": "filament path, toolhead 2",
    "0703": "filament path, toolhead 3",
    "0C00": "defect detection (first layer / spaghetti)",
}

# The fifth hex digit separates hard faults from states the user can act on.
SEVERITY = {
    "4": "error - the job cannot continue",
    "8": "pause / actionable - the user can retry or resume",
    "C": "warning - a possible defect, resume permitted",
}

# Toolhead banks 0700-0703 hold the same nine faults; record the bank index so a
# consumer can collapse them.
TOOLHEAD_BANK = {"0700": 0, "0701": 1, "0702": 2, "0703": 3}

def main():
    src = os.path.join(BUNDLE, "assets", "assets", "files", "deviceError.json")
    with open(src, encoding="utf-8") as f:
        raw = json.load(f)

    locales = sorted(raw)
    en = {e["ecode"]: e["intro"] for e in raw.get("en", [])}

    entries = {}
    for code in sorted(en):
        text = {loc: next((e["intro"] for e in raw[loc] if e["ecode"] == code), None)
                for loc in locales}
        entries[code] = {
            "ecode": code,
            "subsystem_prefix": code[:4],
            "subsystem": SUBSYSTEM.get(code[:4], "unknown"),
            "severity_digit": code[4],
            "severity": SEVERITY.get(code[4], "unknown"),
            "fault_index": code[5:],
            "toolhead": TOOLHEAD_BANK.get(code[:4]),
            "text": text,
            # Two slots ship with an empty string in every locale.
            "placeholder": not any((t or "").strip() for t in text.values()),
        }

    by_prefix = collections.Counter(c[:4] for c in entries)
    by_sev = collections.Counter(c[4] for c in entries)
    placeholders = [c for c, e in entries.items() if e["placeholder"]]
    out = {
        "source_asset": "resources/web/flutter_web/assets/assets/files/deviceError.json",
        "locales": locales,
        "count": len(entries),
        "code_layout": "SSSS S EEE  = subsystem(4) severity(1) fault index(3)",
        "by_subsystem": {p: {"count": n, "label": SUBSYSTEM.get(p, "unknown"),
                             "toolhead": TOOLHEAD_BANK.get(p)}
                         for p, n in sorted(by_prefix.items())},
        "by_severity": {d: {"count": n, "label": SEVERITY.get(d, "unknown")}
                        for d, n in sorted(by_sev.items())},
        "placeholder_codes": sorted(placeholders),
        "errors": entries,
    }

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "error-codes.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)

    print(f"locales     : {', '.join(locales)}")
    print(f"error codes : {len(entries)}")
    for p, n in sorted(by_prefix.items()):
        print(f"  {p}xxxx  {n:4}  {SUBSYSTEM.get(p,'unknown')}")
    print("severity:")
    for d, n in sorted(by_sev.items()):
        print(f"  ....{d}...  {n:4}  {SEVERITY.get(d,'unknown')}")
    if placeholders:
        print(f"placeholder (empty text in every locale): {', '.join(sorted(placeholders))}")


if __name__ == "__main__":
    main()
