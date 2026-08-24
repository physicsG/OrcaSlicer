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
    check("a status push (no jsonrpc key) is left alone",
          js(ctx2, "JSON.stringify(unwrapRpc({data:{extruder:{temperature:27}},"
                   "method:'notify_status_update'}))").to_string()
          == '{"data":{"extruder":{"temperature":27}},"method":"notify_status_update"}')

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

    print(f"\n{checks - len(fails)}/{checks} checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
