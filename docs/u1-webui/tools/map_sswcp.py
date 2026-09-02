#!/usr/bin/env python3
"""Map sw_* commands -> C++ handler -> param/response keys from SSWCP.cpp.

Careful with the dispatch chain: SSWCP.hpp defines 15 commands as macros
(`#define GET_DEVICEDATA_STORAGESPACE "sw_GetDeviceDataStorageSpace"`) and the
.cpp compares against the macro, not the literal. Matching only `m_cmd == "sw_*"`
therefore drops those commands from the map and makes them look unimplemented.

Usage: map_sswcp.py <repo-root> <out.json>
"""
import re, json, os, sys, collections

# Both arguments are required. Defaulting the output to sys.argv[-1] means a bare
# `python3 map_sswcp.py` writes the JSON over THIS FILE - which is exactly what
# happened once. Fail loudly instead.
if len(sys.argv) != 3:
    sys.exit(f"usage: {sys.argv[0]} <repo-root> <output.json>\n"
             f"       (run via tools/run_all.py, which passes both)")

ROOT = sys.argv[1]
OUT = sys.argv[2]
if os.path.abspath(OUT) == os.path.abspath(__file__):
    sys.exit("refusing to write output over the script itself")
SRC = f"{ROOT}/src/slic3r/GUI/SSWCP.cpp"
lines = open(SRC, encoding='utf-8', errors='replace').read().split('\n')
text = '\n'.join(lines)

# 1) dispatch: `if/else if (m_cmd == "sw_X") {  <body until next else if> }`
disp = {}
# name -> "sw_*" for every macro the header defines
try:
    _hpp = open(SRC[:-4] + ".hpp", encoding="utf-8", errors="replace").read()
except OSError:
    _hpp = ""
MACROS = dict(re.findall(r'^#define\s+(\w+)\s+"(sw_[A-Za-z0-9_]+)"', _hpp, re.M))

# `m_cmd == "sw_Foo"` or `m_cmd == SOME_MACRO`
cmd_re = re.compile(r'm_cmd\s*==\s*(?:"(sw_[A-Za-z0-9_]+)"|([A-Z][A-Z0-9_]{2,}))')
for i, ln in enumerate(lines):
    for m in cmd_re.finditer(ln):
        cmd = m.group(1) or MACROS.get(m.group(2))
        if not cmd:
            continue
        # look ahead up to 6 lines for a call like  this->foo(  / foo(
        body = []
        for j in range(i, min(i+7, len(lines))):
            body.append(lines[j])
            if j > i and cmd_re.search(lines[j]):
                body.pop(); break
        blob = ' '.join(body)
        calls = re.findall(r'(?:this->)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(', blob)
        skip = {'if','else','while','for','switch','get','count','json','std','return','sizeof'}
        calls = [c for c in calls if c not in skip]
        disp.setdefault(cmd, set()).update(calls)

# 2) handler bodies: find `RetType Class::method(args) {` and capture until matching brace
fn_re = re.compile(r'^[A-Za-z_][\w:<>,\s\*&]*\b(SSWCP\w*)::(\w+)\s*\([^;{]*\)\s*(?:const\s*)?\{', re.M)
bodies = {}
for m in fn_re.finditer(text):
    cls, meth = m.group(1), m.group(2)
    start = m.end()-1
    depth, k = 0, start
    while k < len(text):
        if text[k] == '{': depth += 1
        elif text[k] == '}':
            depth -= 1
            if depth == 0: break
        k += 1
    bodies.setdefault(meth, []).append((cls, text[start:k]))

def keys_in(body, var):
    ks = set()
    ks.update(re.findall(re.escape(var) + r'\["([^"]+)"\]', body))
    ks.update(re.findall(re.escape(var) + r'\.count\("([^"]+)"\)', body))
    ks.update(re.findall(re.escape(var) + r'\.contains\("([^"]+)"\)', body))
    return ks

out = {}
for cmd, calls in sorted(disp.items()):
    entry = {"handlers": [], "params": set(), "response": set(), "rpc": set()}
    for c in sorted(calls):
        if c in bodies:
            entry["handlers"].append(c)
            for cls, body in bodies[c]:
                entry["params"] |= keys_in(body, "m_param_data")
                entry["response"] |= keys_in(body, "m_res_data")
                entry["rpc"] |= set(re.findall(r'"((?:printer|server|machine|access)\.[a-z_.]+)"', body))
    out[cmd] = {"handlers": entry["handlers"],
                "params": sorted(entry["params"]),
                "response": sorted(entry["response"]),
                "rpc": sorted(entry["rpc"])}

json.dump(out, open(OUT, 'w'), indent=1)
n_h = sum(1 for v in out.values() if v["handlers"])
print(f"commands in dispatch: {len(out)}; with resolved handler: {n_h}")
print(f"with rpc method: {sum(1 for v in out.values() if v['rpc'])}")
