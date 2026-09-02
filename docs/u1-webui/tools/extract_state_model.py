#!/usr/bin/env python3
"""Extract the U1 machine-state model from the Flutter bundle.

Two artefacts are recovered:

1. The *subscription list* - the array of Klipper/Snapmaker object names the
   Device page asks for. dart2js emits it as a constant string list.

2. The *field filter map* - a Dart function (minified to `bJ3` in v2.3.26)
   containing `switch (objectName) { case "x": map[x] = ["f1","f2"]; ... }`.
   A `null` field list means "subscribe to every field of this object".

Usage: extract_state_model.py <main.dart.js> <out.json>
"""
import re, json, sys

SRC, OUT = sys.argv[1], sys.argv[2]
data = open(SRC, encoding='utf-8', errors='replace').read()

# --- 1. subscription list -------------------------------------------------
# Anchor on a constant list that contains the unmistakable U1 object names.
sub = []
for m in re.finditer(r'A\.a\(s\(\[((?:"[^"]*",?)+)\]\)', data):
    items = re.findall(r'"([^"]*)"', m.group(1))
    if "print_stats" in items and "heater_bed" in items:
        sub = items
        break

# --- 2. field filter map --------------------------------------------------
# Find the switch that maps object name -> field list.
fields, default_extruder = {}, None
anchor = re.search(r'switch\s*\(p\)\s*\{\s*case"configfile"', data)
if anchor:
    body = data[anchor.start(): anchor.start() + 4000]
    # `case"a":case"b":l.l(0,p,A.a([...],r))`  or `l.l(0,p,m)` for "all fields"
    for cm in re.finditer(r'((?:case"[^"]*":\s*)+)l\.l\(0,p,(A\.a\(\[(.*?)\],\w+\)|\w+)\)', body, re.S):
        names = re.findall(r'case"([^"]*)"', cm.group(1))
        if cm.group(3) is not None:
            flist = re.findall(r'"([^"]*)"', cm.group(3))
        else:
            flist = None          # bare variable == null == all fields
        for n in names:
            fields[n] = flist
    # objects matched by substring ("extruder", "extruder1", ...) in the default arm
    dm = re.search(r'iC\(p,"extruder",0\)\)l\.l\(0,p,A\.a\(\[(.*?)\],\w+\)\)', body, re.S)
    if dm:
        default_extruder = re.findall(r'"([^"]*)"', dm.group(1))
    # `case"toolhead":break` style = present but no field map
    for nm in re.findall(r'case"([^"]*)":break', body):
        fields.setdefault(nm, None)

out = {
    "subscription_list": sub,
    "field_filter": fields,
    "extruder_default_fields": default_extruder,
    "notes": {
        "null_fields": "null => subscribe to all fields of that object",
        "extruder_rule": "any object whose name contains 'extruder' uses extruder_default_fields",
    },
}
json.dump(out, open(OUT, 'w'), indent=1, sort_keys=True)
print(f"subscription objects: {len(sub)}")
print(f"explicit field maps : {len(fields)}")
print(f"extruder defaults   : {len(default_extruder or [])}")
