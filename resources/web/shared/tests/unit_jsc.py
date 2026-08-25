#!/usr/bin/env python3
"""Run the pure logic against real captured payloads, in a real JS engine.

There is no node and no playwright here, and the vendored chromium will not start for
want of libnspr4/libnss3 - so the 28 browser checks cannot run. JavaScriptCore *is*
present, because WebKitGTK is what Orca's own webview uses, and PyGObject can drive it.
That is enough to execute the functions that decide whether a real printer's payload
renders: the colour normaliser and the JSON-RPC unwrapper.

The inputs are the captured values in docs/u1-webui/data/hardware-shapes.json, not
invented ones. This is the check that would have caught the whole class of bug: the
simulator agreed with the client, and neither agreed with the printer.

    python3 resources/web/shared/tests/unit_jsc.py
"""
import json
import os
import re
import sys

import gi
gi.require_version("JavaScriptCore", "4.1")
from gi.repository import JavaScriptCore as JSC       # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.dirname(HERE)
WEB = os.path.dirname(SHARED)
ROOT = os.path.dirname(os.path.dirname(WEB))
DATA = os.path.join(ROOT, "docs", "u1-webui", "data")

fails, checks = [], 0


def check(name, cond, detail=""):
    global checks
    checks += 1
    if cond:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}" + (f"\n          {detail}" if detail else ""))
        fails.append(name)


def module_source(path):
    """Strip ES module syntax so the body can run in a bare JSC context."""
    src = open(path, encoding="utf-8").read()
    src = re.sub(r"^\s*import\s.*?;\s*$", "", src, flags=re.M | re.S)
    src = re.sub(r"^\s*export\s+(?=(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class))",
                 "", src, flags=re.M)
    src = re.sub(r"^\s*export\s*\{[^}]*\}\s*;?\s*$", "", src, flags=re.M)
    return src


def new_ctx(*paths):
    ctx = JSC.Context.new()
    for p in paths:
        ctx.evaluate(module_source(p), -1)
        exc = ctx.get_exception()
        if exc:
            raise RuntimeError(f"{os.path.basename(p)}: {exc.get_message()}")
    return ctx


def js(ctx, expr):
    v = ctx.evaluate(expr, -1)
    exc = ctx.get_exception()
    if exc:
        ctx.clear_exception()
        raise RuntimeError(f"{expr[:60]}: {exc.get_message()}")
    return v


def main():
    hw = json.load(open(os.path.join(DATA, "hardware-shapes.json"), encoding="utf-8"))

    # --- every shared module must at least parse -------------------------
    print("== modules parse as ES modules ==")
    # check_syntax on the UNMODIFIED source, in module mode: this validates the real
    # file including its import/export, and does not need a DOM. Executing these would
    # only prove that `document` is missing in a headless engine.
    mods = []
    for d in ("shared", "device_page", "print_processing"):
        jsdir = os.path.join(WEB, d, "js")
        if not os.path.isdir(jsdir):
            continue
        mods += [(f"{d}/js/{n}", os.path.join(jsdir, n))
                 for n in sorted(os.listdir(jsdir)) if n.endswith(".js")]
    for label, path in mods:
        raw = open(path, encoding="utf-8").read()
        res, exc = JSC.Context.new().check_syntax(
            raw, -1, JSC.CheckSyntaxMode.MODULE, label, 1)
        check(label, res == JSC.CheckSyntaxResult.SUCCESS,
              exc.get_message() if exc else str(res))

    ctx = new_ctx(os.path.join(SHARED, "js", "protocol.js"))

    # --- colours, against the captured values ----------------------------
    print("\n== filament colour, from the real wire values ==")
    argb = [4294198070, 4294967260, 4294967295, 4284689452]
    rgba = ["F44336FF", "FFFFDCFF", "FFFFFFFF", "632C2CFF"]
    for i, (n, h) in enumerate(zip(argb, rgba)):
        want = "#" + h[:6].upper()
        got_i = js(ctx, f"cssColor({n})").to_string()
        got_h = js(ctx, f"cssColor('{h}')").to_string()
        check(f"slot {i + 1}: ARGB {n} -> {want}", got_i == want, f"got {got_i}")
        check(f"slot {i + 1}: rgba '{h}' -> {want}", got_h == want, f"got {got_h}")

    check("the two independent wire fields agree for every slot",
          all(js(ctx, f"cssColor({n})").to_string()
              == js(ctx, f"cssColor('{h}')").to_string() for n, h in zip(argb, rgba)))

    check("a '#'-prefixed value still works (the simulator's old form)",
          js(ctx, "cssColor('#E03131FF')").to_string() == "#E03131")
    check("junk yields null rather than an invalid CSS colour",
          js(ctx, "cssColor('NONE') === null").to_boolean()
          and js(ctx, "cssColor(null) === null").to_boolean())
    check("dark filament gets light text",
          js(ctx, "isDarkColor(4284689452)").to_boolean()          # 632C2C
          and not js(ctx, "isDarkColor('FFFFDCFF')").to_boolean())  # near-white

    # --- the envelope ----------------------------------------------------
    print("\n== JSON-RPC envelope ==")
    ctx2 = new_ctx(os.path.join(SHARED, "js", "sswcp.js"))
    tl = {"jsonrpc": "2.0", "result": {"count": 2, "instances": [{"a": 1}, {"a": 2}]},
          "id": 7, "cli_time": 1, "dev_time": -1}
    check("a printer reply is unwrapped to its result",
          js(ctx2, f"JSON.stringify(unwrapRpc({json.dumps(tl)}).instances)").to_string()
          == '[{"a":1},{"a":2}]')
    check("an Orca-answered payload is left alone",
          js(ctx2, "JSON.stringify(unwrapRpc({dev_name:'U1',sn:'X'}))").to_string()
          == '{"dev_name":"U1","sn":"X"}')
    check("a bare array (sw_GetLocalDevices) is left alone",
          js(ctx2, "JSON.stringify(unwrapRpc([{sn:'A'}]))").to_string() == '[{"sn":"A"}]')
    check("an error envelope is passed through, not silently emptied",
          js(ctx2, "JSON.stringify(unwrapRpc("
                   "{jsonrpc:'2.0',error:{code:-32000,message:'x'},id:1}))").to_string()
          == '{"jsonrpc":"2.0","error":{"code":-32000,"message":"x"},"id":1}')
    # Inverted: this asserted that a {data, method} push is left alone, which encoded
    # the belief that Orca passes payloads through untouched. It reshapes them - the
    # push and the command reply have the SAME shape, and both unwrap here.
    check("a status push is unwrapped to the objects it carries",
          js(ctx2, "JSON.stringify(unwrapRpc({data:{extruder:{temperature:27}},"
                   "method:'notify_status_update'}))").to_string()
          == '{"extruder":{"temperature":27}}',
          "unwrapStatus then passes it through unchanged, having nothing left to strip")
    check("and Klipper's array form survives it",
          js(ctx2, "JSON.stringify(unwrapRpc({data:[{extruder:{temperature:27}},1.5],"
                   "method:'notify_status_update'}))").to_string()
          == '[{"extruder":{"temperature":27}},1.5]',
          "notify_status_update sends [ {objects}, eventtime ]; unwrapStatus takes [0]")

    # A timeout is not a refusal, and there are two clocks that produce one.
    check("the client's own timeout is recognised",
          js(ctx2, "isTimeout(new Error('sw_SendGCodes timed out after 15000ms'))")
          .to_boolean())
    check("and Orca's, which is worded differently",
          js(ctx2, "isTimeout({code: -2, message: 'time out'})").to_boolean(),
          "handle_general_fail(-2, 'time out') - note the space")
    check("Orca's code alone is enough, whatever the message says",
          js(ctx2, "isTimeout({code: -2, message: ''})").to_boolean())
    check("a real refusal is still a refusal",
          not js(ctx2, "isTimeout(new SswcpError(-1, 'unknown command', 'sw_X'))")
          .to_boolean()
          and not js(ctx2, "isTimeout(null)").to_boolean(),
          "this is the check that decides whether the user is told to retry")

    # The shape Orca actually delivers, which is NOT the raw envelope: only a
    # `passthrough` response target gets that.
    check("Orca's reshaped reply is unwrapped to the result",
          js(ctx2, "JSON.stringify(unwrapRpc({method:'', data:{count:5,jobs:[1,2]}}))")
          .to_string() == '{"count":5,"jobs":[1,2]}',
          "on_response_arrived builds {data: result, method}; reading r.jobs off that "
          "returns undefined, which is how the timelapse list was silently empty")
    check("an error reply is left whole, so the caller is owed the detail",
          js(ctx2, "JSON.stringify(unwrapRpc({method:'', error:{code:-32601}}))")
          .to_string() == '{"method":"","error":{"code":-32601}}')
    check("a payload that merely has a data key is left alone",
          js(ctx2, "JSON.stringify(unwrapRpc({data:'x', other:1}))").to_string()
          == '{"data":"x","other":1}',
          "the pair is the signature, not the data key on its own")

    # the shape the file browser actually receives
    fl = {"jsonrpc": "2.0", "id": 3,
          "result": {"files": [{"filename": "a.gcode"}], "dirs": [],
                     "disk_usage": {"free": 1}, "root_info": {"name": "gcodes"}}}
    check("the file listing survives unwrapping as an array",
          js(ctx2, f"(function(){{var d=unwrapRpc({json.dumps(fl)});"
                   f"return Array.isArray(d.files)&&d.files.length===1;}})()").to_boolean(),
          "this is the read that returned [] on hardware")

    # --- state model against a captured object map ------------------------
    print("\n== state model, on captured objects ==")
    ctx3 = new_ctx(os.path.join(SHARED, "js", "protocol.js"),
                   os.path.join(SHARED, "js", "state.js"))
    objs = {
        "extruder": {"temperature": 27.0, "state": "PARKED"},
        "extruder1": {"temperature": 26.0, "state": "PARKED"},
        "extruder2": {"temperature": 26.0, "state": "PARKED"},
        "extruder3": {"temperature": 26.0, "state": "ACTIVATE"},
        "motion_report": {"live_position": [105.5844, 108.2527, 10.0, 0.0]},
        "purifier": {"mode": 0, "exhaust_fan": {"speed": 0.0, "delay": 180},
                     "inner_fan": {"speed": 0.0, "delay": 180}, "power_detected": False},
        "print_task_config": {
            "filament_type": ["PLA", "PLA", "NONE", "PETG"],
            "filament_vendor": ["Jayo", "Forshape", "NONE", "Generic"],
            "filament_color_rgba": rgba,
            "filament_color": argb,
            "filament_exist": [True, True, False, True]},
    }
    js(ctx3, f"var st=new MachineState(); st.apply({json.dumps(objs)});")
    check("the active toolhead is the one reporting ACTIVATE",
          js(ctx3, "st.toolhead().activeIndex").to_int32() == 3,
          f"got {js(ctx3, 'st.toolhead().activeIndex').to_int32()}")
    check("the axis readout reads motion_report.live_position",
          abs(js(ctx3, "st.toolhead().x").to_double() - 105.5844) < 1e-6)
    check("unknown homing is not reported as 'not homed'",
          js(ctx3, "st.toolhead().allHomed === null").to_boolean())
    check("purifier mode 0 renders as a name, not a bare 0",
          js(ctx3, "st.purifier().modeName").to_string() == "Off")
    check("an object-valued fan is read as a percentage, not NaN",
          js(ctx3, "st.purifier().exhaustFan").to_int32() == 0)
    check("the empty slot is the one the printer says is absent",
          js(ctx3, "JSON.stringify(st.filaments().map(f=>f.loaded))").to_string()
          == "[true,true,false,true]")
    check("slot colours normalise to CSS",
          js(ctx3, "JSON.stringify(st.filaments().map(f=>cssColor(f.color)))").to_string()
          == '["#F44336","#FFFFDC","#FFFFFF","#632C2C"]')

    # --- which toolhead is live -------------------------------------------
    print("\n== the active toolhead follows the live stream ==")
    parked = {("extruder" if i == 0 else f"extruder{i}"): {"state": "PARKED"}
              for i in range(4)}

    def active(objs):
        js(ctx3, f"var t=new MachineState(); t.apply({json.dumps(objs)});")
        return js(ctx3, "String(t.toolhead().activeIndex)").to_string()

    check("a live ACTIVATE is reported",
          active({**parked, "extruder3": {"state": "ACTIVATE"},
                  "toolhead": {"extruder": "extruder3"}}) == "3")
    # the bug: `toolhead` is fetched once at connect, so it goes stale on every change
    check("a tool change is seen even though `toolhead` is stale",
          active({**parked, "extruder1": {"state": "ACTIVATE"},
                  "toolhead": {"extruder": "extruder3"}}) == "1",
          "preferring toolhead.extruder froze the active tool at connect, so pickTool "
          "waited for a change it could not see and timed out having actually worked")
    check("parking is seen: no extruder ACTIVATE means none live",
          active({**parked, "toolhead": {"extruder": "extruder3"}}) == "null",
          "parkTool waits for null, which a stale toolhead never produced")
    # This test previously asserted the opposite, and encoded the bug.
    check("toolhead.extruder is not treated as evidence that a head is engaged",
          active({**parked, "toolhead": {"extruder": "extruder"}}) == "null",
          "measured: it reads 'extruder' while all four report PARKED - it names the "
          "last head used, not the one docked. Trusting it made the panel offer to "
          "park nothing, which no-ops instantly and then times out")
    check("with no extruder states at all the answer is 'nothing engaged'",
          active({"toolhead": {"extruder": "extruder2"}}) == "null",
          "a wrong answer here is worse than none: it drives a park that cannot work")

    # --- what the machine says it is doing --------------------------------
    print("\n== activity, at both granularities ==")
    ctx4 = new_ctx(os.path.join(SHARED, "js", "activity.js"))

    def act(main_state, action_code):
        return js(ctx4, f"String(machineActivity({{mainState:{main_state},"
                        f"actionCode:{action_code}}}))").to_string()

    def busy(main_state, action_code):
        return js(ctx4, f"isBusy({{mainState:{main_state},"
                        f"actionCode:{action_code}}})").to_boolean()

    check("an idle machine reports nothing", act(0, 0) == "null" and not busy(0, 0))
    # the case that mattered: a toolchange's calibration shows up in main_state only
    check("an XY calibration is reported even though action_code is 0",
          act(2, 0) == "XYZ calibrating" and busy(2, 0),
          "reading only action_code left the wait silent for the very thing that "
          "makes a toolchange take minutes")
    check("a docking calibration is reported the same way",
          act(12, 0) == "Docking Coordinate Calibrating" and busy(12, 0))
    check("the finer action_code wins when both are set",
          act(1, 770) == "Checking Extruder Pick...")
    check("plain 'Working' is not shown to someone already waiting on an operation",
          act(1, 0) == "null",
          "it says nothing the caller did not know, and would mask nothing useful")
    check("the two tables are not merged",
          js(ctx4, "String(ACTION_LABELS[1])").to_string() == "undefined",
          "1 is Working in one table and Homing in the other")

    # --- homed, not homed, and not known ----------------------------------
    print("\n== homing state ==")

    def homed(objs):
        js(ctx3, f"var h=new MachineState(); h.apply({json.dumps(objs)});")
        return (js(ctx3, "String(h.toolhead().allHomed)").to_string(),
                js(ctx3, "String(h.toolhead().isHomed('z'))").to_string())

    check("a cold machine reports not homed, not unknown",
          homed({"toolhead": {"homed_axes": ""}}) == ("false", "false"),
          "an empty homed_axes is a plain answer; reading it as unknown let every Z "
          "jog through to a printer that refuses it, so the bed buttons looked dead")
    check("a homed machine reports homed", homed({"toolhead": {"homed_axes": "xyz"}})
          == ("true", "true"))
    check("a partly homed machine is not all homed",
          homed({"toolhead": {"homed_axes": "xy"}}) == ("false", "false"))
    check("with no snapshot at all the answer is unknown, and nothing is blocked",
          homed({}) == ("null", "true"),
          "before the first query, refusing everything would be worse than allowing it")

    # --- why the machine is busy, replayed from a real toolchange ---------
    print("\n== the captured toolchange, step by step ==")
    tl = hw["toolchange"]["timeline"]

    js(ctx3, "var m = new MachineState();")

    def step(objs):
        js(ctx3, f"m.apply({json.dumps(objs)});")
        return json.loads(js(ctx3, "JSON.stringify(m.busyReason())").to_string())

    r = step({"toolhead": {"homed_axes": "z"}, "idle_timeout": {"state": "Printing"}})
    check("0.7s - homing starts, and says so without an axis-by-axis account",
          r["busy"] and r["label"] == "Homing axes\u2026",
          "Klipper clears homed_axes as it re-homes, so naming the axes done reported "
          "Z and then dropped it - the machine looked like it was going backwards")
    r = step({"toolhead": {"homed_axes": "y"}})
    check("4.7s - and stays one step while the axes come in",
          r["busy"] and r["label"] == "Homing axes\u2026",
          "this is the phase a user reads as 'XY calibration'")
    r = step({"toolhead": {"homed_axes": "xy"}})
    check("14.7s - still the one step",
          r["busy"] and r["label"] == "Homing axes\u2026")
    r = step({"extruder": {"activating_move": True}})
    check("28.7s - the grab is named separately from the homing",
          r["busy"] and r["label"] == "Engaging toolhead 1\u2026")
    r = step({"extruder": {"activating_move": False, "state": "ACTIVATE"},
              "toolhead": {"homed_axes": "xyz"}})
    check("30.7s - the head is live", js(ctx3, "String(m.toolhead().activeIndex)")
          .to_string() == "0")
    r = step({"idle_timeout": {"state": "Ready"}})
    check("32.7s - and the machine goes quiet",
          not r["busy"] and r["label"] is None)

    # A printer that has gone away stops speaking, which is indistinguishable from one
    # with nothing to say unless the question is asked about *now*.
    print("\n== is anything still there ==")
    js(ctx3, "var a = new MachineState();")
    check("a store nothing has ever reached is infinitely old",
          js(ctx3, "a.age() === Infinity").to_boolean(),
          "lastUpdate of 0 read as 'connected' for the rest of the session")
    js(ctx3, "a.apply({extruder: {temperature: 26}}); a.lastUpdate = 1000000;")
    check("and one that just heard something is new",
          js(ctx3, "a.age(1000500)").to_double() == 500.0)
    check("a store that stopped hearing ages",
          js(ctx3, "a.age(1060000)").to_double() == 60000.0,
          "this is what a rebooting printer looks like from the page")

    # the two sources that were trusted before, and reported nothing at all
    silent = hw["toolchange"]["silent_throughout"]
    js(ctx3, "var q = new MachineState();")
    js(ctx3, f"q.apply({json.dumps({'machine_state_manager': silent['machine_state_manager'], 'extruder_offset_calibration': {'calibration_step': 'idle'}})});")
    check("machine_state_manager and calibration_step say nothing for a toolchange",
          js(ctx3, "String(q.busyReason().label)").to_string() == "null"
          and not js(ctx3, "q.busyReason().busy").to_boolean(),
          "which is why the dialog had nothing to show - both were measured silent "
          "across the whole 31s operation")

    # --- the temperature row, against a stubbed DOM ----------------------
    # These are the two faults a user hit on real hardware: a target of 0 sitting in the
    # field so it had to be deleted before anything could be typed, and a value that had
    # just been sent vanishing when the next state push landed a second later, before the
    # printer had reported the change.
    print("\n== the temperature row ==")
    ctx4 = new_ctx(os.path.join(WEB, "device_page", "js", "ui.js"))
    # ui.js is written against a DOM there is none of here. The row functions touch four
    # things - a dataset, an input value, one style width, and document.activeElement -
    # so those four are all that is stubbed. Date.now is stubbed too, because one of the
    # behaviours under test is a timeout.
    js(ctx4, """
      var document = { activeElement: null };
      var NOW = 1000000;
      Date.now = function () { return NOW; };
      function row() {
        var parts = { '.cur':  { textContent: '' },
                      '.heat': { style: { width: '0' } },
                      '.tgt':  { value: '', dataset: { target: '0' } } };
        return { dataset: { name: 'Toolhead 1' }, title: '',
                 querySelector: function (s) { return parts[s]; } };
      }
      var r = row(), t = r.querySelector('.tgt');
    """)

    js(ctx4, "updateTempRow(r, 24, 0);")
    check("a heater that is off leaves the field empty, so the dash shows through",
          js(ctx4, "t.value").to_string() == "",
          "a literal 0 has to be deleted before a temperature can be typed")
    check("an off row says so",
          js(ctx4, "r.title").to_string() == "Toolhead 1 — off")

    js(ctx4, "updateTempRow(r, 24, 200);")
    check("a target the machine reports lands in the field",
          js(ctx4, "t.value").to_string() == "200")
    check("and the row says it is heating",
          js(ctx4, "r.dataset.heat").to_string() == "heating"
          and js(ctx4, "r.title").to_string() == "Toolhead 1 — heating to 200 °C")

    js(ctx4, "document.activeElement = t; t.value = '55'; updateTempRow(r, 24, 200);")
    check("a focused field is never overwritten by an incoming reading",
          js(ctx4, "t.value").to_string() == "55")
    js(ctx4, "document.activeElement = null;")

    # the vanishing value, exactly as it happened
    js(ctx4, "r = row(); t = r.querySelector('.tgt'); updateTempRow(r, 24, 0);"
             "pend(r, 200); t.value = '200';"
             "updateTempRow(r, 24, 0);")
    check("a sent target survives the push that still reports the old one",
          js(ctx4, "t.value").to_string() == "200"
          and js(ctx4, "r.dataset.pend").to_string() == "1",
          "this is the bug: the machine's 0 was written back over the value just sent")
    check("and the row says it is waiting on the printer",
          "waiting for the printer" in js(ctx4, "r.title").to_string())

    js(ctx4, "updateTempRow(r, 25, 200);")
    check("the machine echoing the target ends the wait",
          js(ctx4, "String(r.dataset.pend)").to_string() == "undefined"
          and js(ctx4, "t.value").to_string() == "200")

    # a setpoint the printer accepted and then ignored
    js(ctx4, "r = row(); t = r.querySelector('.tgt'); updateTempRow(r, 24, 0);"
             "pend(r, 200); t.value = '200'; NOW += 11000; updateTempRow(r, 24, 0);")
    check("a target the machine never echoes is given up on, not left standing",
          js(ctx4, "r.dataset.pend").to_string() == "lost"
          and js(ctx4, "t.value").to_string() == "",
          "a value the printer never took must not keep sitting there looking applied")
    check("and the row names the value that did not take",
          js(ctx4, "r.title").to_string()
          == "Toolhead 1 — the printer did not take 200 °C")
    js(ctx4, "NOW += 9000; updateTempRow(r, 24, 0);")
    check("the warning clears itself",
          js(ctx4, "String(r.dataset.pend)").to_string() == "undefined")

    # the bar: how far along the ramp, from where it started when the target was set
    js(ctx4, "r = row(); updateTempRow(r, 24, 0); updateTempRow(r, 24, 200);")
    check("the heat bar starts empty at the foot of the ramp",
          js(ctx4, "r.querySelector('.heat').style.width").to_string() == "0.0%")
    js(ctx4, "updateTempRow(r, 112, 200);")
    check("and tracks the climb",
          js(ctx4, "r.querySelector('.heat').style.width").to_string() == "50.0%")
    js(ctx4, "updateTempRow(r, 199, 200);")
    check("arriving is a state of its own, and the bar stops",
          js(ctx4, "r.dataset.heat").to_string() == "ready"
          and js(ctx4, "r.querySelector('.heat').style.width").to_string() == "0")

    js(ctx4, "r = row(); updateTempRow(r, 200, 200); updateTempRow(r, 200, 0);"
             "updateTempRow(r, 120, 0);")
    check("cooling is shown while the hardware is still hot",
          js(ctx4, "r.dataset.heat").to_string() == "cooling"
          and js(ctx4, "r.querySelector('.heat').style.width").to_string() == "40.0%",
          "a nozzle at 120 with the heater off is not the same as an idle one")
    # measured on hardware: asked for 40, the nozzle went to 48
    js(ctx4, "r = row(); updateTempRow(r, 26, 0); updateTempRow(r, 26, 40);"
             "updateTempRow(r, 33, 40); updateTempRow(r, 48, 40);")
    check("an overshoot restarts the ramp instead of leaving the bar full",
          js(ctx4, "r.dataset.heat").to_string() == "cooling"
          and js(ctx4, "r.querySelector('.heat').style.width").to_string() == "0.0%",
          "the bar was still measuring the climb, so it read 100% while falling")
    js(ctx4, "updateTempRow(r, 44, 40);")
    check("and then measures the fall",
          js(ctx4, "r.querySelector('.heat').style.width").to_string() == "50.0%")

    js(ctx4, "updateTempRow(r, 30, 0);")
    check("and stops once it is cool enough to touch",
          js(ctx4, "r.dataset.heat").to_string() == ""
          and js(ctx4, "r.title").to_string() == "Toolhead 1 — off")

    print(f"\n{checks - len(fails)}/{checks} checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
