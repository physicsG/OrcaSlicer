#!/usr/bin/env python3
"""Recover original Dart class names + field names from dart2js output.

dart2js minifies identifiers but NOT string literals. Dart's conventional
`toString()` embeds the class name and its field names as a literal, e.g.

    j(a){return"RequestPayload(cmd: "+this.a+", eventId: "+A.b(this.b)+...}

so every class with a generated/hand-written toString leaks its real name and
field list. Likewise `A.x(["k1",v1,...])` inside a `O()` (toJson) method leaks
the wire field names. This recovers both and pairs them by minified symbol.

Usage: extract_dart_classes.py <main.dart.js> <out.json>
"""
import re, json, sys, collections

SRC, OUT = sys.argv[1], sys.argv[2]
d = open(SRC, encoding='utf-8', errors='replace').read()

# Each minified class body: A.<sym>.prototype={ ... }
proto = re.compile(r'A\.([A-Za-z0-9_$]+)\.prototype=\{')
# toString: j(a){ ... return"Name(field: "...
tostr = re.compile(r'\bj\(a\)\{(?:[^{}]|\{[^{}]*\})*?return"([A-Z][A-Za-z0-9_]*)\(')
# toJson-ish: O(){return A.x(["a",..,"b",..],
tojson = re.compile(r'\bO\(\)\{return (?:[A-Za-z0-9_.$]+\()?A\.x\(\[(.*?)\]', re.S)

classes = {}
starts = [(m.start(), m.group(1)) for m in proto.finditer(d)]
for idx, (pos, sym) in enumerate(starts):
    end = starts[idx+1][0] if idx+1 < len(starts) else min(len(d), pos+8000)
    body = d[pos:end]
    rec = {"symbol": sym}
    tm = tostr.search(body)
    if tm:
        rec["name"] = tm.group(1)
        # field labels look like  `field: ` inside the concatenation
        seg = body[tm.start():tm.start()+1400]
        rec["tostring_fields"] = list(dict.fromkeys(re.findall(r'[",]\s*([a-zA-Z_][\w]*):\s"', seg)))
    jm = tojson.search(body)
    if jm:
        keys = re.findall(r'(?:\A|,)"([^"]*)"\s*,', jm.group(1))
        rec["json_keys"] = [k for k in keys if re.fullmatch(r'[A-Za-z_][\w]*', k or '')]
    if "name" in rec or "json_keys" in rec:
        classes[sym] = rec

named = {v["name"]: v for v in classes.values() if "name" in v}
json.dump({"by_symbol": classes, "by_name": named}, open(OUT,'w'), indent=1, sort_keys=True)
print(f"classes with a recovered name: {len(named)}")
print(f"classes with wire (toJson) keys: {sum(1 for v in classes.values() if v.get('json_keys'))}")
