#!/usr/bin/env python3
"""Extract enum *wire values* from the Flutter bundle.

A Dart enum has two different strings, and confusing them is a real bug source:

  * the **member name** (`PrintState.completed`), recovered from the constant pool
  * the **wire value** the app actually sends or matches (`"complete"`)

For `PrintState` these differ - ordinal 7 is named `completed` but emits `complete`,
which is Klipper's own spelling. A client matching on `completed` never fires.

This targets the wire side: getters shaped

    ga0(a){switch(this.a){case 0:return"..." case 1:return"..." ...}}

Member-name/ordinal recovery for the whole bundle lives in the sibling effort at
docs/u1-webui/ (tools/extract_enums.py); this is deliberately narrow.

Usage: extract_wire_enums.py <main.dart.js> <out.json>
"""
import re, json, sys

SRC, OUT = sys.argv[1], sys.argv[2]
d = open(SRC, encoding='utf-8', errors='replace').read()

getter = re.compile(
    r'\b(\w+)\(a\)\{switch\(this\.a\)\{'
    r'((?:case \d+:return"[^"]*"\s*)+)'
    r'(?:default:return"([^"]*)")?\}\}')

# label a getter by a signature of values we can recognise
SIGNATURES = [
    ({"printing", "paused", "standby"}, "PrintState"),
    ({"dev", "staging", "prod"},        "AppEnvironment"),
    ({"GET", "POST", "PUT"},            "HttpMethod"),
    ({"CN", "US"},                      "Region"),
    ({"en", "zh"},                      "AppLocale"),
]

out = {}
for i, m in enumerate(getter.finditer(d)):
    pairs = re.findall(r'case (\d+):return"([^"]*)"', m.group(2))
    values = {int(k): v for k, v in pairs}
    vset = set(values.values())
    name = next((n for sig, n in SIGNATURES if sig <= vset), None)
    key = name or f"unnamed_{i}"
    out[key] = {
        "getter_symbol": m.group(1),
        "identified": name is not None,
        "default": m.group(3),
        "values": [values[k] for k in sorted(values)],
        "by_ordinal": {str(k): values[k] for k in sorted(values)},
    }

json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False, sort_keys=True)
print(f"wire-value enums: {len(out)}  identified: {sum(1 for v in out.values() if v['identified'])}")
for k, v in sorted(out.items()):
    print(f"  {k:16s} {v['values']}")
