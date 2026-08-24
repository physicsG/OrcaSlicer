#!/usr/bin/env python3
"""Conformance test: do the shared constants match the reverse-engineered evidence?

The highest-risk part of both reconstructions is the hand-transcribed constant
tables in resources/web/shared/js/protocol.js. This test re-derives them from the
extraction output under docs/u1-webui/data/ and asserts they agree exactly.

It guards BOTH surfaces, because both import the same shared module.

Run:  python3 resources/web/shared/tests/conformance_test.py
Exit: 0 on success, 1 on any mismatch.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.dirname(HERE)                       # resources/web/shared
WEB = os.path.dirname(SHARED)                        # resources/web
ROOT = os.path.dirname(os.path.dirname(WEB))         # repo root
DATA = os.path.join(ROOT, "docs", "u1-webui", "data")
PROTO = os.path.join(SHARED, "js", "protocol.js")
SSWCP = os.path.join(SHARED, "js", "sswcp.js")
MOCK = os.path.join(SHARED, "js", "mockhost.js")

fails, checks = [], 0
def check(name, cond, detail=""):
    global checks
    checks += 1
    if cond:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}" + (f"\n          {detail}" if detail else ""))
        fails.append(name)

# ---------------------------------------------------------------- helpers
def js_block(src, name):
    """Extract `export const <name> = { ... };` and return the brace body."""
    m = re.search(r'export const ' + re.escape(name) + r'\s*=\s*\{', src)
    if not m:
        return None
    i = src.index('{', m.start())
    d = 0
    for k in range(i, len(src)):
        if src[k] == '{': d += 1
        elif src[k] == '}':
            d -= 1
            if d == 0:
                return src[i:k+1]
    return None

def js_array(src, name):
    m = re.search(r'export const ' + re.escape(name) + r'\s*=\s*\[(.*?)\];', src, re.S)
    return re.findall(r"'([^']*)'|\"([^\"]*)\"", m.group(1)) if m else None

def to_pairs(body, extruder_fields):
    """Parse the SUBSCRIBE_OBJECTS object literal into {name: [fields]|None}."""
    out = {}
    # entries look like:  'name': [ 'a','b' ],   or   'name': null,   or 'name': EXTRUDER_FIELDS,
    for m in re.finditer(r"'([^']+)'\s*:\s*(EXTRUDER_FIELDS|null|\[)", body):
        key, kind = m.group(1), m.group(2)
        if kind == 'EXTRUDER_FIELDS':
            out[key] = list(extruder_fields)
        elif kind == 'null':
            out[key] = None
        else:
            j = body.index('[', m.end() - 1)
            d = 0
            for k in range(j, len(body)):
                if body[k] == '[': d += 1
                elif body[k] == ']':
                    d -= 1
                    if d == 0:
                        seg = body[j:k+1]; break
            out[key] = [a or b for a, b in re.findall(r"'([^']*)'|\"([^\"]*)\"", seg)]
    return out

# ---------------------------------------------------------------- load
if not os.path.exists(PROTO):
    sys.exit(f"missing {PROTO}")
src = open(PROTO, encoding='utf-8').read()
model = json.load(open(os.path.join(DATA, "state-model.json"), encoding='utf-8'))

print("\n== state model ==")
ex = [a or b for a, b in (js_array(src, "EXTRUDER_FIELDS") or [])]
check("EXTRUDER_FIELDS matches bundle",
      ex == model["extruder_default_fields"],
      f"page={ex}\n          bundle={model['extruder_default_fields']}")

body = js_block(src, "SUBSCRIBE_OBJECTS")
check("SUBSCRIBE_OBJECTS block found", body is not None)
ours = to_pairs(body or "", ex)

want_names = set(model["subscription_list"])
have_names = set(ours)
check("subscription list has all 24 bundle objects",
      want_names <= have_names, f"missing={sorted(want_names - have_names)}")
check("subscription list adds nothing extra",
      have_names <= want_names, f"extra={sorted(have_names - want_names)}")

ff = model["field_filter"]
mismatch = []
for name, fields in ours.items():
    if name not in ff:
        continue                      # falls through the bundle's default arm
    want = ff[name]
    if want is None:
        if fields is not None:
            mismatch.append(f"{name}: page={fields} bundle=null(all)")
    elif fields != want:
        mismatch.append(f"{name}: page={fields} bundle={want}")
check("per-object field filters match the bundle",
      not mismatch, "\n          ".join(mismatch))

# extruders use the substring rule, so they must carry EXTRUDER_FIELDS
check("all four toolheads carry the extruder field list",
      all(ours.get(k) == ex for k in ["extruder", "extruder1", "extruder2", "extruder3"]))

print("\n== bridge commands ==")
cmds = json.load(open(os.path.join(DATA, "sswcp-commands.json"), encoding='utf-8'))
used = set(re.findall(r"'(sw_[A-Za-z0-9_]+)'", src))
unknown = sorted(c for c in used if c not in cmds)
check("every command we send exists in Orca's dispatch",
      not unknown, f"unknown={unknown}")

# params we send must be accepted by the C++ handler.
# Both surfaces are scanned, since both issue control/state commands.
app = ""
for surface in ("device_page", "print_processing"):
    f = os.path.join(WEB, surface, "js", "app.js")
    if os.path.exists(f):
        app += open(f, encoding='utf-8').read()
PARAM_EXPECT = {
    "sw_ControlBedTemp":      {"temp"},
    "sw_ControlExtruderTemp": {"temp", "index", "map"},
    "sw_ControlMainFan":      {"speed"},
    "sw_ControlGenericFan":   {"name", "speed"},
    "sw_ControlLed":          {"name", "white"},
    "sw_ControlPrintSpeed":   {"percentage"},
    "sw_GetMachineState":     {"objects"},
    "sw_SetSubscribeFilter":  {"objects"},
}
bad = []
for cmd, expect in PARAM_EXPECT.items():
    known = set(cmds.get(cmd, {}).get("params", []))
    if known and not expect <= known:
        bad.append(f"{cmd}: we send {sorted(expect)}, handler reads {sorted(known)}")
check("control params are the ones the C++ handlers read",
      not bad, "\n          ".join(bad))

print("\n== success code ==")
# The bridge's success code is 200, not 0. A client that accepts only 0 rejects
# every real response from Orca, so pin it here in the guard that ties code to
# evidence. See docs/u1-webui/04-bridge-wcp/01-envelope.md
sswcp_src = open(SSWCP, encoding='utf-8').read()
mock_src = open(MOCK, encoding='utf-8').read()
check("OK_CODE is 200",
      re.search(r"export const OK_CODE\s*=\s*200\b", sswcp_src) is not None)
check("isOk() accepts 200",
      re.search(r"function isOk\([^)]*\)\s*\{[^}]*OK_CODE", sswcp_src) is not None)
check("the mock host replies with OK_CODE, not a literal 0",
      "OK_CODE" in mock_src and not re.search(r"payload:\s*\{\s*code:\s*0\b", mock_src),
      "a mock that replies 0 passes its own tests and fails against real Orca")

print("\n== device record ==")
# DeviceInfo's wire field names come from the C++ struct's serialiser, not from
# anything a JS client would guess. sw_GetLocalDevices returns a BARE ARRAY of
# these, and sw_GetConnectedMachine returns one (or {} when nothing is connected).
APPCFG = os.path.join(ROOT, "src", "libslic3r", "AppConfig.hpp")
dev_fields = set()
if os.path.exists(APPCFG):
    m = re.search(r"NLOHMANN_DEFINE_TYPE_INTRUSIVE\(DeviceInfo,(.*?)\)",
                  open(APPCFG, encoding='utf-8').read(), re.S)
    if m:
        dev_fields = {f.strip() for f in m.group(1).split(",") if f.strip()}
check("DeviceInfo field list recovered from AppConfig.hpp", bool(dev_fields),
      "could not parse NLOHMANN_DEFINE_TYPE_INTRUSIVE(DeviceInfo, ...)")

declared = dict(re.findall(r"^\s*(NAME|MODEL|SN|IP|CONNECTED|ID|PRESET|NOZZLES):\s*'([^']+)'",
                           src, re.M))
unknown = sorted(v for v in declared.values() if dev_fields and v not in dev_fields)
check("every DEVICE.* name is a real DeviceInfo field",
      not unknown, f"not in the C++ struct: {unknown}")
check("DEVICE.NAME is dev_name, not a camelCase guess",
      declared.get("NAME") == "dev_name", f"got {declared.get('NAME')!r}")
check("the mock replies to sw_GetLocalDevices with a bare array",
      re.search(r"case 'sw_GetLocalDevices':\s*\n(?:\s*//[^\n]*\n)*\s*return ok\(printer\.devices\)",
                mock_src) is not None,
      "real Orca sends `m_res_data = devices` - an array, not {devices: [...]}")

print("\n== command coverage ==")
# Every command the host dispatches and the bundle references must be either
# implemented or explicitly excluded with a reason. This is the guard that stops
# a gap being found by a person instead of by the build.
import subprocess
cov = subprocess.run([sys.executable,
                      os.path.join(ROOT, "docs", "u1-webui", "tools", "check_coverage.py"),
                      "--quiet"], capture_output=True, text=True)
check("every bridge command is classified (implemented or excluded with a reason)",
      cov.returncode == 0, cov.stdout.strip() or cov.stderr.strip())

print("\n== connection sequence ==")
# The connect path is only correct if the params match what the C++ handlers
# actually read. Each handler rejects a missing/mistyped param explicitly, so the
# required set can be recovered from the guards themselves.
SSWCP_CPP = os.path.join(ROOT, "src", "slic3r", "GUI", "SSWCP.cpp")
cpp = open(SSWCP_CPP, encoding='utf-8').read() if os.path.exists(SSWCP_CPP) else ""
check("SSWCP.cpp readable", bool(cpp))

conn_src = ""
cfile = os.path.join(WEB, "device_page", "js", "connection.js")
if os.path.exists(cfile):
    conn_src = open(cfile, encoding='utf-8').read()
check("connection.js exists", bool(conn_src))

def required_params(handler):
    """Params the C++ handler refuses to run without."""
    m = re.search(r"void SSWCP_\w+::" + handler + r"\(\)\s*\{(.*?)\n\}", cpp, re.S)
    if not m:
        return set()
    return set(re.findall(r'm_param_data\.count\("(\w+)"\)[^;]*?handle_general_fail', m.group(1)))

for handler, sends in (
    ("sw_create_mqtt_client", {"server_address", "clientId"}),
    ("sw_mqtt_connect", {"id"}),
    ("sw_mqtt_publish", {"id", "topic", "qos", "payload"}),
):
    need = required_params(handler)
    missing = sorted(need - sends)
    check(f"{handler}: we send every param it requires",
          not missing, f"handler also requires {missing}")

check("create_mqtt_client is given server_address and clientId",
      "server_address:" in conn_src and "clientId" in conn_src)
check("set_engine is given engine_id, ip, port and sn",
      all(k in conn_src for k in ("engine_id:", "ip,", "port,", "sn,")))
check("pairing uses port 1884, not the TLS port",
      re.search(r"PAIR_PORT\s*=\s*1884", src) is not None)
check("set_engine passes need_reload:false",
      "need_reload: false" in conn_src,
      "otherwise the host reloads the Device webview mid-sequence")

print("\n== limits ==")
check("bed temp limit is 0..100 (from dialog_..._heated_bed_temperature_tips)",
      re.search(r"bedTemp:\s*\{\s*min:\s*0,\s*max:\s*100", src) is not None)
check("print speed limit is 50..150 (from dialog_..._print_speed_tips)",
      re.search(r"printSpeed:\s*\{\s*min:\s*50,\s*max:\s*150", src) is not None)

print("\n== enum wire values ==")
we = json.load(open(os.path.join(DATA, "wire-enums.json"), encoding='utf-8'))
want_ps = set(we["PrintState"]["values"])
body_ps = js_block(src, "PRINT_STATE") or ""
have_ps = set(re.findall(r":\s*'([a-z]+)'", body_ps))
check("PRINT_STATE matches the bundle's wire values",
      have_ps == want_ps,
      f"page={sorted(have_ps)}\n          bundle={sorted(want_ps)}")
check("PRINT_STATE uses 'complete', not 'completed' (the enum-member trap)",
      "complete" in have_ps and "completed" not in have_ps)

print("\n== error catalogue ==")
cat = json.load(open(os.path.join(DATA, "error-catalog.json"), encoding='utf-8'))
subs_js = dict(re.findall(r"'(\d{4})':\s*'([^']*)'", js_block(src, "SUBSYSTEMS") or ""))
check("subsystem table matches the generated catalogue",
      subs_js == cat["subsystems"],
      f"page={sorted(subs_js)}\n          data={sorted(cat['subsystems'])}")

# spot-check the decoder against real catalogue entries
sample = [c for c in cat["codes"] if c.startswith("0002052300")][:4]
ok = True
for code in sample:
    rec = cat["codes"][code]
    if rec["subsystem"] != "0523" or rec["unit_index"] != int(code[8:12], 16):
        ok = False
check("catalogue codes decode consistently with our scheme", ok,
      f"sampled {sample}")

print(f"\n{checks - len(fails)}/{checks} checks passed")
sys.exit(1 if fails else 0)
