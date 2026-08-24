#!/usr/bin/env python3
"""Extract JSON-RPC call constructions (method + param names) from dart2js output.

dart2js emits Dart map literals as A.x(["k1",v1,"k2",v2,...], KeyType, ValType).
A JSON-RPC envelope therefore appears as:
    A.x(["jsonrpc","2.0","method","<m>","params",A.x([...]),"id",<v>], K, V)
We locate each envelope, then read the nested params map's literal keys.
"""
import re, json, sys

SRC, OUT = sys.argv[1], sys.argv[2]
data = open(SRC, encoding='utf-8', errors='replace').read()

head = re.compile(r'"jsonrpc","2\.0","method","([a-zA-Z_][\w.]*)"')

def balanced(s, i):
    """From index of '(' return index just past its match."""
    d = 0
    while i < len(s):
        if s[i] == '(': d += 1
        elif s[i] == ')':
            d -= 1
            if d == 0: return i + 1
        i += 1
    return -1

out, sites = {}, 0
for m in head.finditer(data):
    method = m.group(1)
    tail = data[m.end(): m.end() + 1200]
    # never run past the *end of this envelope*: dart2js closes the outer A.x([...]
    # right after the "id" entry, so cut at the first '"id",<tok>]' we meet.
    idm = re.search(r'"id",[^,\[\]]{0,40}?\]', tail)
    if idm:
        tail = tail[:idm.end()]
    sites += 1
    e = out.setdefault(method, {"method": method, "params": set(),
                                "param_style": set(), "call_sites": 0})
    e["call_sites"] += 1
    pm = re.search(r'"params",', tail)
    if not pm:
        e["param_style"].add("none"); continue
    after = tail[pm.end():]
    am = re.match(r'A\.x\(\[', after)
    if am:
        end = balanced(after, after.index('('))
        body = after[am.end(): end]
        # flattened k,v list -> keys sit at even positions; take quoted tokens
        # that are immediately preceded by start-or-comma AND followed by comma
        keys = re.findall(r'(?:\A|,)"([^"]*)"\s*,', body)
        # keep alternating: first, third, ... are keys in a flat k,v list
        e["params"].update(k for k in keys if re.fullmatch(r'[A-Za-z_][\w]*', k or ''))
        e["param_style"].add("literal")
    else:
        e["param_style"].add("dynamic")

res = {}
for k, v in out.items():
    res[k] = {"method": k, "call_sites": v["call_sites"],
              "param_style": sorted(v["param_style"]),
              "params": sorted(v["params"])}
json.dump(res, open(OUT, 'w'), indent=1, sort_keys=True)
print(f"envelopes: {sites}   distinct methods: {len(res)}")
for k in sorted(res):
    v = res[k]
    print(f"  {k:48s} {'/'.join(v['param_style']):8s} {', '.join(v['params'])}")
