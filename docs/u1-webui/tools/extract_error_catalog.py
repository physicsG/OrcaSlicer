#!/usr/bin/env python3
"""Build the U1 error catalogue from the Flutter i18n table.

The Device page carries two independent error tables:

  * assets/files/deviceError.json - a legacy 8-hex-digit `ecode`/`intro` list
    inherited from the Bambu-derived codebase (it still mentions "Bambu Cloud"
    and "AMS"). Kept for reference only.

  * assets/i10n/<locale>.json - the live U1 table: 442 codes as
    `error_<16 hex>_title` / `error_<16 hex>_desc` pairs.

The 16-digit code decomposes into four 16-bit groups:

    SSSS MMMM UUUU EEEE
    |    |    |    +-- specific error
    |    |    +------- unit index (toolhead 0-3; 0000 = machine-wide)
    |    +------------ subsystem
    +----------------- class / severity

Usage: extract_error_catalog.py <i10n_dir> <out.json>
"""
import json, re, sys, os, collections

I10N, OUT = sys.argv[1], sys.argv[2]

SUBSYSTEM = {
    "0522": "system / motion",
    "0523": "toolhead",
    "0525": "filament",
    "0526": "heated bed",
    "0527": "chamber",
    "0528": "homing / axis",
    "0530": "calibration / detection",
    "0531": "job / storage",
    "0532": "defect detection (vision)",
    "0533": "top cover / chamber",
}

def load(locale):
    p = os.path.join(I10N, f"{locale}.json")
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}

en, zh = load("en"), load("zh-CN")

rows = collections.defaultdict(dict)
for src, tag in ((en, "en"), (zh, "zh")):
    for k, v in src.items():
        if not isinstance(v, str):
            continue
        m = re.match(r'^error_([0-9A-Fa-f]{16})_(title|desc)$', k)
        if m:
            rows[m.group(1)][f"{tag}_{m.group(2)}"] = v

out = {}
for code in sorted(rows):
    s, mo, u, e = (code[0:4], code[4:8], code[8:12], code[12:16])
    rec = dict(rows[code])
    rec.update({
        "code": code,
        "class": s,
        "subsystem": mo,
        "subsystem_name": SUBSYSTEM.get(mo, "unknown"),
        "unit_index": int(u, 16),
        "specific": e,
    })
    out[code] = rec

json.dump({"codes": out, "subsystems": SUBSYSTEM}, open(OUT, 'w'),
          indent=1, ensure_ascii=False, sort_keys=True)

by_sub = collections.Counter(v["subsystem_name"] for v in out.values())
print(f"codes: {len(out)}")
for k, n in by_sub.most_common():
    print(f"  {k:28s} {n}")
