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
# PRINTER_BACKED classifies REPLY SHAPES; it is not a list of commands we send, and it
# is derived from handler definitions in SSWCP.cpp - which include the ~15 dispatched
# through header macros that map_sswcp.py cannot see. Scanning it here would report
# those as "unknown commands" when the client never sends them.
src_cmds = re.sub(r"export const PRINTER_BACKED = new Set\(\[.*?\]\);", "", src, flags=re.S)
used = set(re.findall(r"'(sw_[A-Za-z0-9_]+)'", src_cmds))
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

print("\n== hardware-measured shapes ==")
# These come from a real printer (docs/u1-webui/tools/u1_probe.py), because they are
# pass-throughs whose field names appear in no bundle and no C++ literal. The file is
# the evidence; the point of these checks is that the client cannot drift away from it
# without going red.
HW = os.path.join(DATA, "hardware-shapes.json")
hw = json.load(open(HW, encoding="utf-8"))
app_js = open(os.path.join(WEB, "device_page", "js", "app.js"), encoding="utf-8").read()
ui_js = open(os.path.join(WEB, "device_page", "js", "ui.js"), encoding="utf-8").read()

def js_const(name, source=src):
    m = re.search(r"export const " + re.escape(name) + r"\s*=\s*([^;]+);", source)
    return m.group(1).strip().strip("'\"") if m else None

cam = hw["camera"]
check("CAMERA_DOMAIN is the value the printer accepted",
      js_const("CAMERA_DOMAIN") == cam["domain_accepted"],
      f"page={js_const('CAMERA_DOMAIN')!r} printer accepted={cam['domain_accepted']!r}")
check("CAMERA_DOMAIN is not the value the printer refused",
      js_const("CAMERA_DOMAIN") != cam["domain_rejected"]["value"])
check("the frame is addressed on Moonraker's port, not the web UI's",
      js_const("MOONRAKER_HTTP_PORT") == str(cam["frame_http"]["port"]),
      f"page={js_const('MOONRAKER_HTTP_PORT')} verified={cam['frame_http']['port']}")
check("frame root and filename match the verified URL",
      js_const("CAMERA_FRAME_ROOT") == cam["frame_http"]["root"]
      and js_const("CAMERA_FRAME_FILE") == cam["frame_http"]["file"])
check("the client does not wait for an MQTT frame push",
      not cam["frames_pushed_over_mqtt"] and "pickFrame" not in ui_js,
      "pickFrame() sniffed base64 out of a push that never arrives")
check("cameraFrameUrl builds the HTTP URL instead",
      "cameraFrameUrl" in ui_js and "/server/files/" in ui_js)

th = hw["thumbnails"]
b64_cmd, path_cmd = "FILE_THUMBS_B64", "FILE_THUMBNAILS"
i_b64, i_path = app_js.find("CMD." + b64_cmd), app_js.find("CMD." + path_cmd)
check("the thumbnail command that returns bytes is asked first",
      0 <= i_b64 < i_path,
      "server.files.thumbnails succeeds while returning only paths, so asking it "
      "first means the catch-fallback never fires and no image is ever shown")
check("pickThumb looks for the field the printer actually fills",
      th["server.files.thumbnails_base64"]["image_field"] in
      re.search(r"for \(const k of \[([^\]]*)\]", app_js).group(1))
check("pickThumb knows the timelapse spelling too",
      hw["timelapse"]["thumbnail_direct_adds"] in app_js)
check("the timelapse listing is read by its real field name",
      "instances" in app_js and hw["timelapse"]["thumbnail_direct_adds"] in ui_js)

check("the simulator refuses the domain the printer refuses",
      str(cam["domain_rejected"]["code"]) in open(MOCK, encoding="utf-8").read(),
      "the mock accepted anything, so it could not have caught this")

print("\n== response shapes vs the wire ==")
# The class of bug this section exists for: the simulator used to answer with what the
# CLIENT expected instead of what the PRINTER sends, so every mismatch passed the browser
# suite and failed on hardware. These re-derive the wire contract from SSWCP.cpp and from
# the captured payloads, so a client that drifts back goes red.
SRC_CPP = os.path.join(ROOT, "src", "slic3r", "GUI", "SSWCP.cpp")
cpp = open(SRC_CPP, encoding="utf-8", errors="replace").read()

starts = [(m.group(1), m.end()) for m in
          re.finditer(r"void\s+SSWCP_\w+::(sw_\w+)\s*\([^)]*\)\s*\{", cpp)]
derived = set()
for i, (name, pos) in enumerate(starts):
    end = starts[i + 1][1] if i + 1 < len(starts) else len(cpp)
    if "on_mqtt_msg_arrived" in cpp[pos:end]:
        derived.add(name)

listed = set(re.findall(r"'(sw_\w+)'",
             re.search(r"export const PRINTER_BACKED = new Set\(\[(.*?)\]\);",
                       src, re.S).group(1)))
check("PRINTER_BACKED matches the handlers that pass a printer reply through",
      listed == derived,
      f"only in page={sorted(listed - derived)}\n          only in C++={sorted(derived - listed)}")

check("the client unwraps the JSON-RPC envelope",
      "unwrapRpc" in open(SSWCP, encoding="utf-8").read(),
      "payload.data is the whole {jsonrpc,result,id} for a printer-backed command")

mock_src = open(MOCK, encoding="utf-8").read()
check("the simulator wraps printer replies the way Orca does",
      "PRINTER_BACKED.has(cmd)" in mock_src and "jsonrpc: '2.0'" in mock_src,
      "an unwrapping simulator turns a hardware bug into a passing test")

# colours: the two real forms, cross-checked against each other in the capture
hw_colors = hw.get("_filament_colors") or {}
check("the simulator sends filament colour in the printer's forms, not CSS",
      "filament_color_rgba: ['E03131FF'" in mock_src
      and "filament_color: [0xFFE03131" in mock_src,
      "'#RRGGBBAA' is not what the wire carries")
check("a colour normaliser exists and is used",
      "export function cssColor" in src
      and "cssColor" in open(os.path.join(WEB, "device_page", "js", "ui.js"),
                             encoding="utf-8").read(),
      "assigning an ARGB int to style.background is silently dropped")

# the control panel needs `toolhead`, which was never subscribed
sub_block = js_block(src, "SUBSCRIBE_OBJECTS") or ""
state_src = open(os.path.join(SHARED, "js", "state.js"), encoding="utf-8").read()
check("the subscription list is still the bundle's - `toolhead` is NOT added",
      "'toolhead'" not in sub_block,
      "the shipped page does not subscribe it; adding it drifts from the original")
check("the active tool is derived from the extruder that reports ACTIVATE",
      "'ACTIVATE'" in state_src,
      "the Tool buttons must follow the machine, and this is the subscribed source")
check("the axis readout uses motion_report.live_position",
      "live_position" in state_src,
      "positions are available without subscribing `toolhead`")

ui_src = open(os.path.join(WEB, "device_page", "js", "ui.js"), encoding="utf-8").read()
check("a running camera can be stopped",
      ui_src.count("handlers.stopCamera()") >= 2,
      "the live-view branch returned before the control block was reached")
check("the idle task panel offers something besides an illustration",
      "showFiles" in ui_src,
      "an image with no text and no buttons is not a state")
app_src = open(os.path.join(WEB, "device_page", "js", "app.js"), encoding="utf-8").read()
check("choosing which toolhead to jog does NOT move the machine",
      "handlers.selectTool" not in ui_src,
      "selection is a UI choice; a toolchange must be deliberate, not a side effect")
check("changing the live toolhead is its own action",
      "handlers.pickTool" in ui_src and "pickTool:" in app_src,
      "there must be a dedicated control, not an overloaded segmented button")
check("a toolchange blocks the surface while the gantry moves",
      "openBlockingDialog" in app_src,
      "a second command sent mid-change is not what the user meant")
check("the toolchange is confirmed by the machine, not by the ack",
      "activeIndex === idx" in app_src,
      "the G-code ack only says the command was queued")

print("\n== panel invariants ==")
css = open(os.path.join(WEB, "device_page", "css", "device.css"), encoding="utf-8").read()

# `.fault{display:flex}` is a class rule and beats the UA stylesheet's
# [hidden]{display:none}, so setting .hidden in JS did nothing and an empty banner
# sat above the panels permanently. Any element the page hides by attribute needs this.
check("the fault banner honours [hidden]",
      re.search(r"\.fault\[hidden\]\s*\{[^}]*display:\s*none", css) is not None,
      "display:flex on .fault overrides the UA [hidden] rule")

# The quick settings must not share a glyph - sharing one made the purifier read as a
# second fan. The shipped bundle has a distinct icon for each, so use them.
# any icon name the module names, however it is passed - tile(), icon(), sliderRow()
icons = set(re.findall(r"'(icon[A-Z]\w*)'", ui_src))
wanted = {"iconSpeed", "iconMainCooling", "iconAuxiliaryCooling", "iconPurifier", "iconLed"}
check("each quick setting uses its own shipped icon",
      wanted <= icons,
      f"missing {sorted(wanted - icons)}")
for name in sorted(wanted | {f"iconExtruder{i}" for i in range(1, 5)} | {"iconHotBedTemperature"}):
    check(f"icon asset exists: {name}.svg",
          os.path.exists(os.path.join(WEB, "device_page", "icons", f"{name}.svg")))

check("quick settings open an anchored popover, not a centred sheet",
      "openPopover" in ui_src and ui_src.count("openPopover(anchor") >= 3,
      "a modal hides the readings the user is acting on")

# temperature targets edit in place, and the row is the hover target
check("temperature targets are real number inputs with the machine's limits",
      "tgt.type = 'number'" in ui_src and "tgt.min" in ui_src and "tgt.max" in ui_src,
      "an input brings the I-beam, keyboard and validation; a styled span brings none")
check("the whole row reveals the editable target, not just the input",
      ".status-row:hover .tgt" in css,
      "a 30px number is not a target you find by accident")
check("hover paint cannot mask the editing or invalid state",
      ":not(:focus):not(:invalid)" in css,
      "a descendant selector outranks .tgt:focus and .tgt:invalid")

# the wheel: the ring is the step, so there is no separate step selector
check("the jog wheel carries three step bands",
      re.search(r"JOG_STEPS\s*=\s*\[10,\s*1,\s*0\.1\]", ui_src) is not None,
      "the ring is the step size; a separate selector would reintroduce hidden state")
check("a sector is a real annular path, not a box",
      "A${r2" in ui_src or "sector(" in ui_src,
      "rectangles would put the corners in the wrong quadrant")
check("an unhomed axis blocks the jog and says so",
      "data-blocked" in ui_src and "allHomed === false" in app_src,
      "Klipper refuses the move silently, which looks like a dead button")

# absent hardware
check("an absent purifier disables its own modes",
      "purAbsent" in ui_src and 'aria-disabled' in ui_src,
      "a control for hardware that is not attached is a claim the machine would refuse")

# A class the JS emits and the CSS never styles is silent: the element renders, just
# unstyled. `.status-row` shipped as `trow` for a commit and the temperature rows lost
# their layout and grew native number spinners, with nothing failing anywhere.
js_classes = set()
for m in re.finditer(r"el\('\w+',\s*'([a-z0-9 \-]+)'", ui_src):
    js_classes |= set(m.group(1).split())
for m in re.finditer(r"\.className\s*=\s*'([a-z0-9 \-]+)'", ui_src):
    js_classes |= set(m.group(1).split())
css_classes = set(re.findall(r"\.([a-z][a-z0-9\-]+)", css))
unstyled = sorted(c for c in js_classes if c not in css_classes)
check("every class the Device page emits is styled somewhere",
      not unstyled, f"unstyled: {unstyled}")

check("the control row is capped so the gaps cannot drift with panel width",
      re.search(r"\.control-grid\s*\{[^}]*max-width:", css) is not None,
      "space-between hands every extra pixel to the gaps")

# The status card is repainted on every state push - about once a second. Rebuilding it
# destroyed whatever was being typed, which made entering a temperature a race.
check("the status card is not rebuilt on every state push",
      "root.dataset.built" in ui_src,
      "innerHTML='' once a second takes the focused input with it")
check("a focused target is never overwritten by an incoming reading",
      "document.activeElement !== tgt" in ui_src,
      "the machine's value must not land in a field being typed into")
check("the row's target is read from the DOM, not from a closure",
      "tgt.dataset.target" in ui_src,
      "a captured value goes stale as soon as the printer changes it")

# Granularity and labelling are different questions: a step-1 fan labelled at every
# step printed 101 ticks across the panel.
check("slider ticks are chosen separately from the step",
      re.search(r"function sliderRow\([^)]*ticks\)", ui_src) is not None
      and "FAN_TICKS" in ui_src,
      "labelling every step is only right when the steps are few")
check("the fan is labelled at quarters, not at every percent",
      re.search(r"FAN_TICKS\s*=\s*\[\s*0\s*,\s*25\s*,\s*50\s*,\s*75\s*,\s*100\s*\]", ui_src)
      is not None)

check("the Control panel sizes to its content",
      re.search(r"\.control-body\s*\{[^}]*aspect-ratio:\s*auto", css) is not None,
      "inheriting .panel-body's ratio only bought empty space below the wheel")

# Both commands were recovered from the shipped Flutter bundle, which is the printer's
# own UI. Neither appears in printer.gcode.help - they register without help strings, as
# T0..T3 do - so there is nothing else to check them against. An earlier guess of `T-1`
# for park did nothing at all.
check("picking a toolhead sends T<n> A0, as the printer's own UI does",
      re.search(r"`T\$\{idx\} A0`", app_src) is not None,
      "a bare T<n> is not what the firmware's own macro sends either")
check("parking uses PARK_EXTRUDER, numbered like Klipper's extruders",
      "PARK_EXTRUDER" in app_src and "idx === 0 ? '' : idx" in app_src,
      "PARK_EXTRUDER for 0, PARK_EXTRUDER1..3 above it")
check("park follows the machine, pick follows the selection",
      "state.toolhead().activeIndex" in app_src and "handlers.pickTool(activeTool)" in ui_src,
      "only the live head can be parked; the selection is what the user asked to pick")
check("picking no longer opens a dialog to re-ask the same question",
      "pickExtruder(" not in ui_src,
      "the selection above is already a deliberate click")

# A constant used but never declared is a ReferenceError at the moment the user opens
# the panel, and nothing before that notices: it is valid syntax, so check_syntax passes,
# and it only runs on a click. FAN_TICKS shipped that way for one commit, because the
# edit meant to declare it silently matched nothing.
def _strip_js(src):
    """Remove comments and string/template literals so identifiers can be counted."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            i = src.find("\n", i)
            if i == -1: break
        elif c == "/" and i + 1 < n and src[i + 1] == "*":
            i = src.find("*/", i)
            if i == -1: break
            i += 2
        elif c in "\"'`":
            q, i = c, i + 1
            while i < n and src[i] != q:
                i += 2 if src[i] == "\\" else 1
            i += 1
        else:
            out.append(c); i += 1
    return "".join(out)

for label, path in (("device_page/js/ui.js", os.path.join(WEB, "device_page", "js", "ui.js")),
                    ("device_page/js/app.js", os.path.join(WEB, "device_page", "js", "app.js"))):
    src_js = open(path, encoding="utf-8").read()
    code = _strip_js(src_js)
    declared = set(re.findall(r"(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)", code))
    for m in re.finditer(r"import\s*\{([^}]*)\}", src_js, re.S):
        declared |= {x.strip().split(" as ")[-1].strip()
                     for x in m.group(1).split(",") if x.strip()}
    # not preceded by a dot: CMD.SEND_GCODES is a property of an import,
    # not an identifier this module has to declare
    used = set(re.findall(r"(?<![.\w$])([A-Z][A-Z0-9_]{2,})\b", code))
    JS_GLOBALS = {"JSON", "URL", "NaN", "XML", "HTML", "SVG"}
    undefined = sorted(u for u in used if u not in declared and u not in JS_GLOBALS)
    check(f"{label}: every constant it uses is declared or imported",
          not undefined, f"undefined: {undefined}")

# Which toolhead is live must come from the subscribed stream. `toolhead` is fetched
# once at connect and after homing, so reading it first froze the active tool and made
# every pick and park time out despite having worked.
state_src = open(os.path.join(SHARED, "js", "state.js"), encoding="utf-8").read()
i_sub = state_src.find("'ACTIVATE'")
i_one = state_src.find("o.extruder")
check("the live toolhead is read from the subscribed stream, not the one-shot query",
      i_sub != -1 and i_one != -1 and i_sub < i_one,
      "toolhead.extruder is a cold-start fallback, not the source of truth")
check("the toolchange timeout matches the printer's own UI",
      "TOOL_CHANGE_TIMEOUT_MS = 60000" in app_src,
      "the shipped handler allows 60s before giving up")

print(f"\n{checks - len(fails)}/{checks} checks passed")
sys.exit(1 if fails else 0)
