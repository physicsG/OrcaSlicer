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
        # Walk, not listdir: the Device page's modules live in core/, widgets/ and
        # views/<destination>/<panel>/ now, and a flat listing quietly stopped checking
        # all but two of them.
        for root, _dirs, fs in os.walk(jsdir):
            rel = os.path.relpath(root, jsdir)
            pre = f"{d}/js" if rel == "." else f"{d}/js/{rel}"
            mods += [(f"{pre}/{n}", os.path.join(root, n))
                     for n in sorted(fs) if n.endswith(".js")]
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

    # --- a transparent colour is an absence, and is not black ---------------
    #
    # multiACE wipes a feeder head's identity when the machine enters head mode:
    #   SET_PRINT_FILAMENT_CONFIG FILAMENT_TYPE="" VENDOR="" FILAMENT_COLOR_RGBA=00000000
    # `00000000` is RRGGBBAA with alpha ZERO. The alpha was being sliced off and thrown
    # away, so it came back "#000000" and four spools were painted black. Reported as
    # "switching between ACE modes switches filaments, blacks them".
    print("\n== a colour the machine did not give ==")
    cc = lambda v: js(ctx3, f"String(cssColor({v}))").to_string()
    check("a fully transparent RRGGBBAA is no colour at all",
          cc('"00000000"') == "null", f'got {cc(chr(34) + "00000000" + chr(34))}')
    check("and so is an ARGB integer with no alpha",
          cc("0") == "null" and cc("0x0000FF00") == "null",
          f'got {cc("0")} and {cc("0x0000FF00")}')
    # The whole point of reading the alpha rather than the RGB: opaque black IS a colour,
    # and black filament is the commonest there is.
    check("opaque black is still black, in both forms",
          cc('"000000FF"') == "#000000" and cc("0xFF000000") == "#000000",
          f'got {cc(chr(34) + "000000FF" + chr(34))} and {cc("0xFF000000")}')
    check("a six-digit value has no alpha to read and is taken as written",
          cc('"000000"') == "#000000" and cc('"8FA7C8"') == "#8FA7C8")
    check("and a partly transparent colour is still that colour",
          cc('"3366CC80"') == "#3366CC", f'got {cc(chr(34) + "3366CC80" + chr(34))}')

    # --- who owns a slot's identity, and who may change it ----------------
    #
    # Both are the PRINTER's answers, per slot, and both were on the subscription and
    # unread while the panel decided the same question off the RFID tag. They are not
    # the same question: the payload below is 811002511261022618B3 as it stood on
    # 2026-08-28, where head 2 carries a decodable tag (`filament_detect` reads Forshape
    # PLA Silk, OFFICIAL, with a CARD_UID) and the machine still says it may be edited,
    # because the record in use has been overridden - `filament_sub_type` there is `""`
    # where the tag says `Silk`.
    print("\n== who may edit a slot, and who decides ==")
    TAGGED = {"MAIN_TYPE": "PLA", "SUB_TYPE": "Silk", "VENDOR": "Forshape",
              "ARGB_COLOR": 4294967260, "CARD_UID": [4, 44, 238, 174],
              "CARD_TYPE": "NTAG", "OFFICIAL": True}
    NOTAG = {"MAIN_TYPE": "NONE", "SUB_TYPE": "NONE", "VENDOR": "NONE"}
    measured = {
        "print_task_config": {
            "filament_type": ["PLA", "PLA", "NONE", "PETG"],
            "filament_vendor": ["Jayo", "Forshape", "NONE", "Kingroon"],
            "filament_sub_type": ["Marble", "", "NONE", "Basic"],
            "filament_color_rgba": ["F44336FF", "FFFFDCFF", "FFFFFFFF", "8FA7C8FF"],
            "filament_exist": [True, True, False, True],
            "filament_official": [True, False, False, False],
            "filament_edit": [False, True, False, True]},
        # Heads 1 AND 2 carry a tag. Only head 1's record is the tag's.
        "filament_detect": {"info": [dict(TAGGED, VENDOR="Jayo", SUB_TYPE="Marble"),
                                     TAGGED, NOTAG, NOTAG]},
    }
    js(ctx3, f"var m=new MachineState(); m.apply({json.dumps(measured)});")
    fl = lambda expr: js(ctx3, f"JSON.stringify(m.filaments().map(f=>{expr}))").to_string()
    check("a tag is read on both heads that carry one",
          fl("!!f.tag") == "[true,true,false,false]", f"got {fl('!!f.tag')}")
    check("but only one of them is the machine's own record",
          fl("f.official") == "[true,false,false,false]", f"got {fl('f.official')}")
    # The machine's own permission, verbatim. Its firmware computes it as
    #     allowed_edit = filament_exist[ch] and not filament_official[ch]
    # and enforces the other half in SET_PRINT_FILAMENT_CONFIG, which raises "official
    # filament, not configurable!" without FORCE=1.
    check("the machine's permission is carried as the machine states it",
          fl("f.allowedEdit") == "[false,true,false,true]",
          f"got {fl('f.allowedEdit')}")
    # And the page is STRICTER than it, deliberately. That permission is a LATCH: the
    # same firmware function sets `filament_official[ch] = False` on every write, so one
    # edit unlocks a tagged spool until the tag is read again. Head 2 is sitting in that
    # state - an NTAG reading Forshape PLA Silk is physically present, print_task_config
    # says sub-type "" - and following the latch alone offers to type over a spool that
    # reverts on its next load.
    check("but a spool that carries a tag is not edited from this page",
          fl("f.editable") == "[false,false,false,true]", f"got {fl('f.editable')}")
    check("the head with a tag and an unlocked latch is the case that separates them",
          js(ctx3, "JSON.stringify([m.filaments()[1].tag !== null,"
                   " m.filaments()[1].allowedEdit, m.filaments()[1].editable])")
            .to_string() == "[true,true,false]",
          "reported from the panel: it has an rfid icon and is still editable")
    # Stricter, never more permissive: the machine's own refusals still stand on their
    # own reason, so an untagged official slot and an empty one stay closed.
    check("and the machine's own refusals are not loosened by that",
          js(ctx3, "m.filaments().every(f => f.editable ? f.allowedEdit : true)")
            .to_boolean())
    check("an empty slot is not editable, because there is nothing there",
          js(ctx3, "m.filaments()[2].editable === false").to_boolean())
    check("the untagged head is the only one this page will edit",
          js(ctx3, "JSON.stringify(m.filaments().map((f,i)=>f.editable?i:null)"
                   ".filter(x=>x!==null))").to_string() == "[3]",
          "the ACE-fed head: no tag, and the machine allows it")

    # A firmware that does not report the field at all must not read as "edit anything".
    js(ctx3, "var n=new MachineState(); n.apply({print_task_config:{"
             "filament_type:['PLA','PLA'],filament_exist:[true,true]},"
             "filament_detect:{info:[" + json.dumps(TAGGED) + ",{MAIN_TYPE:'NONE'}]}});")
    check("with no permission bit reported, the tag is the fallback and is named as one",
          js(ctx3, "JSON.stringify(n.filaments().slice(0,2).map(f=>f.allowedEdit))")
            .to_string() == "[false,true]",
          "an absent `filament_edit` must not read as 'everything is editable'")

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

    # --- multiACE: two sources, one precedence ----------------------------
    # The panel drew three of four bays as `?` on a machine that knew all four, because
    # the `ace` object carries no per-bay identity and the names live in multiACE's own
    # override store. The merge is pure and lives in one module now, so the rule that
    # decides which of the two wins is testable here rather than only on a page.
    print("\n== multiACE: where a bay's identity comes from ==")
    ctxA = new_ctx(os.path.join(SHARED, "js", "protocol.js"),
                   os.path.join(SHARED, "js", "multiACE.js"))

    # As measured: one unit, four occupied bays, every raw slot blank, head 3 fed from
    # bay 2 - so bay 2 is the only one the object itself can name.
    RAW = json.dumps({"ace": {
        "mode": "head", "device_count": 1, "api_version": 1,
        "head_manual": {"0": False, "1": False, "2": False, "3": False},
        "head_feeder": {"0": True, "1": True, "2": True, "3": False},
        "head_ace": {"0": 0, "1": 1, "2": 2, "3": 0},
        "head_source": {"3": {"ace_index": 0, "slot": 2, "type": "PETG",
                              "subtype": "Basic", "color": "632C2C", "brand": "Generic"}},
        "aces": [{"idx": 0, "connected": True, "protocol": "v2", "model": "ACE 2 Pro",
                  "humidity": 38, "temp": 30, "gate_status": [1, 1, 1, 1],
                  "dryer_status": {"status": "stop", "target_temp": 0,
                                   "duration": 0, "remain_time": 0},
                  "slots": [{"index": i, "status": "unknown", "material": "",
                             "brand": "", "subtype": "", "rfid": 0,
                             "color": [0, 0, 0]} for i in range(4)]}]}})
    OVERRIDES = json.dumps({
        "0_0": {"ace": 0, "slot": 0, "material": "PETG", "brand": "Kingroon",
                "subtype": "Basic", "color": "#83AFFF"},
        "0_1": {"ace": 0, "slot": 1, "material": "PLA", "brand": "Jayo",
                "subtype": "", "color": "#1f8a4c"}})

    def bays(overrides="null", raw=RAW):
        return js(ctxA, f"JSON.stringify(mergeAceBays(parseAce({raw}).units[0], "
                        f"{overrides}).map(b => b.source + ':' + (b.material || '-')))"
                  ).to_string()

    check("the ace object alone names only the bay a head is loaded from",
          bays() == '["unknown:-","unknown:-","derived:PETG","unknown:-"]',
          "every raw slot reads material:'' - these spools have no tags")
    check("multiACE's store names the rest",
          bays(OVERRIDES) == '["override:PETG","override:PLA","derived:PETG","unknown:-"]',
          "this is the read the panel was missing, and what Orca's Prepare page already had")
    check("a bay nothing names stays unnamed rather than borrowing a neighbour",
          '"unknown:-"' in bays(OVERRIDES).split(",")[-1],
          "occupied-and-unnamed is true; blank is a lie in the other direction")

    # multiACE's own precedence: a tag beats a name someone typed against the bay.
    tagged = json.loads(RAW)
    tagged["ace"]["aces"][0]["slots"][0] = {"index": 0, "status": "ready", "rfid": 2,
                                           "material": "ABS", "brand": "Snapmaker",
                                           "subtype": "", "color": [15, 111, 209]}
    check("a tag beats the override store",
          bays(OVERRIDES, json.dumps(tagged)).startswith('["rfid:ABS"'),
          "the hardware's own answer outranks a name typed against the bay")
    check("and with no store at all the merge is the identity function",
          bays("null", json.dumps(tagged)).startswith('["rfid:ABS"'),
          "no multiACE web service must mean 'nothing to merge', not an error")

    # The two guesses the printer disagreed with, held to the reading.
    dry = js(ctxA, f"JSON.stringify(parseAce({RAW}).units[0].dryer)").to_string()
    check("an idle dryer is not running and shows no countdown",
          '"running":false' in dry, dry)
    running = json.loads(RAW)
    running["ace"]["aces"][0]["dryer_status"] = {"status": "keeping", "target_temp": 55,
                                                "duration": 14400, "remain_time": 4740}
    d2 = json.loads(js(ctxA, f"JSON.stringify(parseAce({json.dumps(running)})"
                             f".units[0].dryer)").to_string())
    check("`keeping` is the running word, not `running`", d2["running"] is True,
          "measured by running the dryer for ten seconds; it was guessed as 'running'")
    check("and its times are seconds on the wire, minutes on the panel",
          (d2["totalMin"], d2["remainingMin"], d2["doneMin"]) == (240, 79, 161),
          f"got {d2}")

    # --- what the printer said, when it said no ----------------------------
    # `sw_SendGCodes` answers `ok` for a macro that failed. The reason exists in exactly
    # one place - Klipper's `!!` channel, in Moonraker's console history - and reading it
    # is what turned "Nothing started" into "Must home Z axis first".
    STORE = json.dumps({"result": {"gcode_store": [
        {"message": "ACE_SWAP_HEAD HEAD=3 ACE=0 SLOT=3", "type": "command"},
        {"message": "// multiace_event swap_failed head=3 status=error seq=2",
         "type": "response"},
        {"message": "!! Must home Z axis first: 229.300 250.000 277.000 [0.000]",
         "type": "response"},
    ]}})
    check("the printer's own error is read out of the console history",
          js(ctxA, f"lastPrinterError({STORE})").to_string()
          == "Must home Z axis first: 229.300 250.000 277.000 [0.000]",
          "read off 811002511261022618B3 after a swap the page reported as 'nothing "
          "started'")
    check("a `//` note is not an error, however alarming it reads",
          js(ctxA, 'lastPrinterError({result:{gcode_store:['
                   '{message:"// multiace_event swap_failed status=error"}]}})')
            .is_null(),
          "only `!!` is Klipper's error channel")
    check("and nothing to read is null rather than a sentence",
          js(ctxA, "lastPrinterError(null)").is_null(),
          "an unreachable Moonraker must not become the reported fault")

    check("the module says which multiACE it was verified against",
          js(ctxA, "MULTIACE_VERIFIED.apiVersion").to_int32() == 1,
          "a plugin, not firmware - the contract version is part of the evidence")

    # --- what can be done to one filament ---------------------------------
    # The rule is not "which verbs exist" but "which are verbs at all in this state", and
    # it is the half of the panel a screenshot cannot check: a Load offered on a loaded
    # head and a Swap to the bay already feeding are both three-minute no-ops that a
    # drawing looks perfectly happy with.
    print("\n== multiACE: which verbs are verbs, in this state ==")

    def verbs(head, slot, loaded, raw=RAW):
        arg = "null" if slot is None else str(slot)
        out = js(ctxA, f"JSON.stringify(aceVerbs(parseAce({raw}), {head}, {arg},"
                       f" {str(loaded).lower()}).map(v => [v.name, v.off || '', v.cmd]))")
        return json.loads(out.to_string())

    # head 3 is the ACE-fed one and is fed from bay 2.
    names = lambda vs: [v[0] for v in vs]
    check("the bay already feeding the head is not a load and not a swap",
          names(verbs(3, 2, True)) == ["Unload and retract", "Background unload"],
          f"got {names(verbs(3, 2, True))}")
    check("a different bay is a SWAP, because something is already loaded",
          names(verbs(3, 0, True))[0] == "Swap",
          f"got {names(verbs(3, 0, True))}")
    # And a swap is an unload then a load, NOT ACE_SWAP_HEAD.
    #
    # That macro is the print's: it opens with `G91 / G1 Z2 F600 / G90` to lift the nozzle
    # off the part, and Klipper refuses a Z move on an unhomed Z - so a swap from the
    # panel on a machine at `homed_axes: "xy"` answered `ok`, printed
    # `!! Must home Z axis first` and did nothing. Neither half of the pair moves Z, and
    # the pair is what multiACE's own dashboard and HelixScreen both send for this verb.
    check("and it is sent as an unload then a load, which need no homed Z",
          verbs(3, 0, True)[0][2]
          == "ACE_UNLOAD_HEAD HEAD=3\nACE_LOAD_HEAD HEAD=3 ACE=0 SLOT=0",
          f"got {verbs(3, 0, True)[0][2]!r} - ACE_SWAP_HEAD is the print's swap and "
          f"opens with a Z hop")
    # The unload cannot be folded in: ACE_LOAD_HEAD's own guard refuses a head that
    # already holds filament rather than swapping for you.
    check("the unload comes first, because a load alone would be refused",
          verbs(3, 0, True)[0][2].splitlines()[0].startswith("ACE_UNLOAD_HEAD"),
          f"got {verbs(3, 0, True)[0][2]!r}")
    # A load is still one line - only the swap grew a second.
    check("and a load on an empty head is still the one macro",
          verbs(3, 0, False)[0][2] == "ACE_LOAD_HEAD HEAD=3 ACE=0 SLOT=0",
          f"got {verbs(3, 0, False)[0][2]!r}")
    # An ACE head is empty when the OBJECT says so - `head_source` naming no slot for it -
    # not when a caller passes loaded=false. The first cut of this check passed the flag
    # and asserted a Load, and the model was right to answer Swap: the machine still said
    # bay 2 was feeding that head.
    RAW_EMPTY = RAW.replace('"head_source": {"3": {"ace_index": 0, "slot": 2, '
                            '"type": "PETG", "subtype": "Basic", "color": "632C2C", '
                            '"brand": "Generic"}}', '"head_source": {}')
    # And it is empty when the SENSOR says so, not when `head_source` has stopped naming a
    # bay. That record is multiACE's account of the last feed and does not clear because
    # the filament came out - the same trap as `filament_exist` one level down, and the
    # one that let an unloaded head go on offering Unload.
    check("a head whose head_source still names a bay is empty if nothing is in it",
          names(verbs(3, 0, False))[0] == "Load",
          f'got {names(verbs(3, 0, False))} - `fed == null && !loaded` made this a Swap')
    check("and the bay it was last fed from is a load like any other",
          names(verbs(3, 2, False))[0] == "Load", f"got {names(verbs(3, 2, False))}")
    check("and an empty head is a LOAD, because it is not a swap",
          names(verbs(3, 0, False, RAW_EMPTY))[0] == "Load",
          "the panel sent ACE_SWAP_HEAD for both before, on the grounds that it is the "
          f"macro that takes a slot; got {names(verbs(3, 0, False, RAW_EMPTY))}")
    check("an unload on an ACE head retracts into the bay, which a feeder cannot",
          "RETRACT_LENGTH" in verbs(3, 2, True)[0][2],
          f"got {verbs(3, 2, True)[0][2]}")
    # head 0 is on its stock feeder: one verb at a time, and never a swap.
    check("a loaded stock feeder offers unload, alone",
          names(verbs(0, None, True)) == ["Unload"], f"got {names(verbs(0, None, True))}")
    check("and an empty one offers load, alone",
          names(verbs(0, None, False)) == ["Load"], f"got {names(verbs(0, None, False))}")
    bg = [v for v in verbs(3, 0, True) if v[0].startswith("Background")]
    check("with enabled_heads empty, both background verbs are refused",
          all(v[1] for v in bg) and len(bg) == 2, f"got {bg}")
    check("and each names the macro that would lift the refusal, not the one it cannot run",
          all(v[2].startswith("ACE_BG_SET_HEAD") for v in bg), f"got {bg}")
    # the same object with head 3 declared
    RAW_BG = RAW[:-1] + ', "ace_bg_swap": {"version": "v0.9", "enabled_heads": [3],' \
                        ' "busy": [], "state": {}}}'
    bg2 = [v for v in verbs(3, 0, True, RAW_BG) if v[0].startswith("Background")]
    check("declaring the head with ACE_BG_SET_HEAD lifts it",
          not any(v[1] for v in bg2) and bg2[0][2].startswith("ACE_BG_SWAP"),
          f"got {bg2}")

    # --- the three modes, which decide what the same four bays ARE ---------
    # Every measurement behind this panel was taken in `head` mode, and the model was
    # written from those readings. A mode is not a display preference: it is how many
    # heads the ACE drives, and it changes the meaning of three fields at once. The two
    # payloads below are the same machine minutes apart - 811002511261022618B3 on
    # 2026-09-01, switched to multi and back over Moonraker HTTP - so the diff between
    # them is exactly the diff the printer produced, not one composed here.
    print("\n== multiACE: the three modes ==")

    # As measured: switching to multi moved TWO of the 38 keys. head_feeder, head_ace and
    # head_source were left byte-identical, and that is the whole trap.
    MULTI = json.dumps({"ace": {
        "mode": "multi", "device_count": 1, "api_version": 1, "active_device": 0,
        "ace_heads": [0, 1, 2, 3],
        "head_manual": {"0": False, "1": False, "2": False, "3": False},
        "head_feeder": {"0": True, "1": True, "2": True, "3": False},
        "head_ace": {"0": 0, "1": 1, "2": 2, "3": 0},
        "head_source": {"3": {"ace_index": 0, "slot": 1, "type": "PETG",
                              "subtype": "Basic", "color": "8FA7C8", "brand": "Kingroon"}},
        "aces": [{"idx": 0, "connected": True, "protocol": "v2", "model": "ACE 2 Pro",
                  "slots": [{"index": k, "status": "ready", "material": "", "brand": "",
                             "rfid": 0, "color": [0, 0, 0]} for k in range(4)]}],
    }})

    def src(raw, i, field):
        return js(ctxA, f"JSON.stringify(parseAce({raw}).heads[{i}].{field})").to_string()

    check("head mode: head_feeder is the answer, and three heads are on stock feeders",
          [json.loads(src(RAW, i, "source")) for i in range(4)]
          == ["feeder", "feeder", "feeder", "ace"],
          f'got {[json.loads(src(RAW, i, "source")) for i in range(4)]}')
    # The bug this fixes. head_feeder still reads {0,1,2 true} in the multi payload -
    # the switch does not touch it - and the plugin's head_is_feeder() returns False
    # outright outside head mode, so the panel drew three feeders on a machine whose
    # every head is ACE-driven.
    check("multi: ace_heads is read, so every head is ACE-driven despite head_feeder",
          [json.loads(src(MULTI, i, "source")) for i in range(4)] == ["ace"] * 4,
          f'got {[json.loads(src(MULTI, i, "source")) for i in range(4)]}')
    check("and head_feeder really is unchanged in that payload",
          json.loads(MULTI)["ace"]["head_feeder"] == json.loads(RAW)["ace"]["head_feeder"],
          "the two payloads must differ only where the machine differed")
    # head_ace is not the wiring outside head mode: it reads {0:0,1:1,2:2,3:0} with ONE
    # unit, so heads 1 and 2 name units that do not exist. The unit is head_source's
    # where a load has been recorded and the ACTIVE one otherwise, which is what
    # cmd_ACE_LOAD_HEAD's non-head branch defaults ACE= to.
    check("multi: the unit is the recorded one or the active one, never head_ace",
          [json.loads(src(MULTI, i, "unitIndex")) for i in range(4)] == [0, 0, 0, 0],
          f'got {[json.loads(src(MULTI, i, "unitIndex")) for i in range(4)]}')
    check("multi: every head has a LANE, and it is its own index",
          [json.loads(src(MULTI, i, "lane")) for i in range(4)] == [0, 1, 2, 3],
          f'got {[json.loads(src(MULTI, i, "lane")) for i in range(4)]}')
    check("head mode: no head has one, because any bay may feed the one head",
          [json.loads(src(RAW, i, "lane")) for i in range(4)] == [None] * 4,
          f'got {[json.loads(src(RAW, i, "lane")) for i in range(4)]}')
    # head_source survives the switch, so the machine reported a bay feeding a head it is
    # not lane-wired to. The mode is a claim about tubes and nothing verifies it: the
    # panel keeps the record and does not round it to the mode's rule.
    check("multi: a recorded feed off the lane is kept, not tidied to the lane",
          json.loads(src(MULTI, 3, "bay")) == 1 and json.loads(src(MULTI, 3, "lane")) == 3,
          f'got bay {src(MULTI, 3, "bay")} lane {src(MULTI, 3, "lane")}')

    # `normal` is the one mode never observed on hardware, and its list cannot be trusted:
    # head_uses_ace() has NO branch for it - manual is False, head mode tests head_feeder,
    # everything else returns True - so a normal machine would publish ace_heads [0,1,2,3],
    # naming every head in the mode whose definition is that none of them is.
    NORMAL = MULTI.replace('"mode": "multi"', '"mode": "normal"')
    check("normal: the MODE decides, not ace_heads, which would claim all four",
          [json.loads(src(NORMAL, i, "source")) for i in range(4)] == ["feeder"] * 4,
          f'got {[json.loads(src(NORMAL, i, "source")) for i in range(4)]}')

    def mverbs(head, slot, loaded, unit=0, raw=MULTI):
        out = js(ctxA, f"JSON.stringify(aceVerbs(parseAce({raw}), {head}, {slot},"
                       f" {str(loaded).lower()}, {unit}).map(v => [v.name, v.slotted, v.cmd]))")
        return json.loads(out.to_string())

    # A bay is not free to feed any head outside head mode: cmd_ACE_LOAD_HEAD's non-head
    # branch is `slot = gcmd.get_int('SLOT', head)`, and the machine will NOT refuse a
    # SLOT naming somebody else's lane - it will push filament somewhere it is not routed.
    check("multi: a head's own lane is loadable",
          [v[0] for v in mverbs(2, 2, False)] == ["Load"],
          f"got {[v[0] for v in mverbs(2, 2, False)]}")
    check("multi: another head's lane is not a verb at all, not a greyed one",
          [v for v in mverbs(2, 0, False) if v[1]] == [],
          f"got {mverbs(2, 0, False)}")
    # ...but the verbs that address the HEAD survive the question, because they have
    # nothing to do with which bay was asked about. The measured machine reaches exactly
    # that state, so a blanket refusal emptied the menu on its one loaded head.
    check("multi: and the head's own verbs are unaffected by an off-lane bay",
          [v[0] for v in mverbs(3, 1, True)] == ["Unload and retract"],
          f"got {[v[0] for v in mverbs(3, 1, True)]}")
    # ace_bg_swap refuses outside head mode in its own words - "v0 requires head mode
    # (1:1 ACE per head)" - and the gate is the MODE, which ACE_BG_SET_HEAD cannot lift.
    check("multi: no background verb is offered, because none can be made available",
          all("Background" not in v[0]
              for h in range(4) for v in mverbs(h, h, True)),
          "the mode is not a refusal a verb row can lift")
    check("head mode still offers them, refused and naming the macro that declares a head",
          any("Background" in v[0] for v in verbs(3, 0, True)),
          f"got {names(verbs(3, 0, True))}")

    # The switch itself, which is the one control whose success arrives as a failure.
    def change(a, b):
        return json.loads(js(ctxA, f"JSON.stringify(aceModeChange('{a}','{b}'))").to_string())

    check("multi <-> head is live, and needs no unload",
          change("head", "multi")["live"] and change("multi", "head")["live"]
          and not change("head", "multi")["needsEmpty"],
          f'got {change("head", "multi")}')
    check("anything through normal needs every head empty and a restart",
          all(change(a, b)["needsRestart"] and change(a, b)["needsEmpty"]
              for a, b in [("head", "normal"), ("normal", "multi"), ("normal", "head")]),
          "a normal transition swaps three Klipper extras and raises")
    check("the restart is owed exactly while the saved mode and the running one disagree",
          [json.loads(js(ctxA, "JSON.stringify(acePendingMode("
                               f"{{mode:'head',savedMode:{v}}}))").to_string())
           for v in ("'normal'", "'head'", "null")] == ["normal", None, None],
          "ace.mode vs save_variables.ace__mode is the only thing that says so")

    # And the refusal, which the RPC never carries: the guard prints `//` NOTES and
    # returns `ok`. Captured verbatim on 2026-09-01.
    STORE = json.dumps({"result": {"gcode_store": [
        {"message": "SET_ACE_MODE MODE=normal"},
        {"message": "// Cannot switch mode! Filament still loaded in: E0, E1, E3"},
        {"message": "// Please unload all toolheads first, then try again."}]}})
    said = json.loads(js(ctxA, f"JSON.stringify(aceModeRefusal({STORE}))").to_string())
    check("the refusal is read off the note channel, both lines and in order",
          said == ["Cannot switch mode! Filament still loaded in: E0, E1, E3",
                   "Please unload all toolheads first, then try again."],
          f"got {said}")
    check("and a console with no refusal in it says so rather than guessing",
          js(ctxA, 'JSON.stringify(aceModeRefusal({result:{gcode_store:'
                   '[{message:"// Switching to MULTI mode..."}]}}))').to_string() == "null",
          "a note that is not the refusal must not be reported as one")

    # The selector's options are the mode's, because two of the three setters are
    # documented head-mode-only and the third - ACE_SET_HEAD_MANUAL - is not.
    def opts(raw, head=0):
        return json.loads(js(ctxA, f"JSON.stringify(aceSourceOptions(parseAce({raw}), {head})"
                                   ".map(o => o.label))").to_string())

    check("head mode offers the feeder, each unit by name, and the hand",
          opts(RAW) == ["Default feeder", "ACE A", "Hand-fed"], f"got {opts(RAW)}")
    check("multi offers the lane and the hand, because the lane is plumbing",
          opts(MULTI, 1) == ["Bay A2", "Hand-fed"], f"got {opts(MULTI, 1)}")
    check("normal offers the feeder and the hand, and never fully disables",
          opts(NORMAL) == ["Default feeder", "Hand-fed"], f"got {opts(NORMAL)}")
    # With a splitter on the head, slot i of EVERY unit reaches it - so naming one bay of
    # the set was naming one bay of a set. Reported from the two-unit drawing.
    _two = json.loads(MULTI)
    _two["ace"]["device_count"] = 2
    _two["ace"]["aces"] = [_two["ace"]["aces"][0],
                           dict(_two["ace"]["aces"][0], idx=1, model="ACE Pro")]
    TWO = json.dumps(_two)
    check("and with two units the lane option names both bays, not the first",
          opts(TWO, 0) == ["Bay A1 · B1", "Hand-fed"], f"got {opts(TWO, 0)}")

    # --- and what the machine says it is doing about it --------------------
    # `channel_state` is the U1's own and is already on the subscription; `swap_phase` is
    # multiACE's and has never been captured on hardware. The classification below is
    # HelixScreen's, taken rather than re-derived.
    print("\n== multiACE: the steps, from channel_state ==")

    def step(state, kind="swap"):
        out = js(ctxA, f"JSON.stringify(channelStep('{state}', '{kind}'))").to_string()
        return json.loads(out)

    check("a swap is one bar of six, both halves on it",
          step("unload_homing")["total"] == 6 and step("load_flushing")["at"] == 5,
          f"got {step('unload_homing')} / {step('load_flushing')}")
    check("the unload half lands where the unload half is",
          [step(s)["at"] for s in ("unload_homing", "unload_picking",
                                   "unload_heating", "unload_doing")] == [0, 1, 2, 3])
    check("and the load half's own Home/Select/Heat hold rather than jumping back",
          [step(s)["at"] for s in ("load_homing", "load_picking", "load_heating")]
          == [None, None, None],
          "the head is mounted and already hot by then, so they pass straight through")
    check("the heat step is the one that reads the nozzle",
          step("unload_heating")["heat"] is True and step("unload_doing")["heat"] is False)
    check("an unload on its own is four steps, not six",
          step("unload_heating", "unload")["total"] == 4)
    check("a *_fail is a failure, and carries the firmware's own word",
          step("unload_fail")["failed"] is True and step("unload_fail")["state"] == "unload_fail")
    check("a *_finish ends it", step("load_finish")["done"] is True)
    check("idle words draw nothing at all",
          step("none") is None and step("inited") is None and step("") is None)
    # Measured on the machine, everything settled: two heads said `load_finish` and two
    # said `wait_insert`. A terminal state is the RESTING state here - the field holds the
    # last operation's ending rather than returning to a neutral word - so both have to be
    # quiet or an idle panel is never quiet.
    check("and so do the words a settled machine actually reports",
          step("wait_insert") is None and step("load_finish")["done"] is True,
          f'got {step("wait_insert")} / {step("load_finish")}')
    check("an unrecognised state holds the right half rather than resetting the bar",
          step("unload_something_new")["at"] == 0,
          "this is a pre-1.0 plugin on a firmware that has grown states before")

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
    # ---- the primitive, with no DOM at all --------------------------------
    # pending.js exists because this bug has been found in three unrelated controls, so
    # it is worth testing as itself rather than only through one of its customers. It
    # touches nothing but a Map and a clock, so there is nothing to stub but the clock.
    print("\n== pending: request against mirror ==")
    ctxp = new_ctx(os.path.join(WEB, "device_page", "js", "core", "pending.js"))
    js(ctxp, """
      var NOW = 1000000;
      var fired = [];
      var P = new Pending({ now: function () { return NOW; },
                            onChange: function (k) { fired.push(k); } });
    """)

    check("nothing outstanding shows the machine",
          js(ctxp, "P.resolve('t', 60).value").to_double() == 60
          and js(ctxp, "P.resolve('t', 60).state").to_string() == "")

    js(ctxp, "P.set('t', 200);")
    check("a sent value is shown instead of the machine's",
          js(ctxp, "P.resolve('t', 0).value").to_double() == 200
          and js(ctxp, "P.resolve('t', 0).state").to_string() == "sent",
          "the whole bug in one line: the mirror still says 0 and must not win")
    check("and starting a request asks for a repaint",
          js(ctxp, "fired.join(',')").to_string() == "t",
          "nothing on the stream prompts one - that is why the switch sat still")

    check("the machine echoing it ends the wait",
          js(ctxp, "P.resolve('t', 200).state").to_string() == ""
          and js(ctxp, "P.waiting('t')").to_boolean() is False)

    # the wire carries whatever it carries: 200 and "200" are the same answer
    js(ctxp, "P.set('t', 200);")
    check("a string from the wire confirms a number that was sent",
          js(ctxp, "P.resolve('t', '200').state").to_string() == "",
          "Object.is would go on waiting for a value that had already arrived")

    js(ctxp, "P.set('led', true);")
    check("and a truthy mirror confirms a boolean",
          js(ctxp, "P.resolve('led', 1).state").to_string() == "")

    # accepted, and then quietly ignored - an instant ok is indistinguishable from
    # success, which is why this end exists at all
    js(ctxp, "P.set('t', 200); NOW += 11000;")
    check("a value the machine never echoes is given up on",
          js(ctxp, "P.resolve('t', 0).state").to_string() == "lost")
    check("and the machine's own value is shown while it is said",
          js(ctxp, "P.resolve('t', 0).value").to_double() == 0
          and js(ctxp, "P.resolve('t', 0).asked").to_double() == 200,
          "the number on screen must be true even while the message explains it")
    js(ctxp, "NOW += 9000;")
    check("the warning clears itself",
          js(ctxp, "P.resolve('t', 0).state").to_string() == "")

    js(ctxp, "P.set('t', 200); P.fail('t', 200);")
    check("a refused command stops the wait at once, without the timeout",
          js(ctxp, "P.resolve('t', 0).state").to_string() == "lost",
          "there is nothing coming to confirm a command that never left")

    js(ctxp, "P.set('t', 210); P.fail('t', 200);")
    check("but a late refusal cannot overwrite what the user moved on to",
          js(ctxp, "P.resolve('t', 0).state").to_string() == "sent"
          and js(ctxp, "P.resolve('t', 0).value").to_double() == 210)

    print("\n== the temperature row ==")
    # The temperature row is the Control panel's DOM, which lives with the rest of that
    # panel now rather than in one shared ui.js.
    ctx4 = new_ctx(os.path.join(WEB, "device_page", "js", "core", "pending.js"),
                   os.path.join(WEB, "device_page", "js", "views", "device-control",
                                "control", "control-view.js"))
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
        // `k` is how the row names itself to the pending store
        return { dataset: { name: 'Toolhead 1', k: 'e0' }, title: '',
                 querySelector: function (s) { return parts[s]; } };
      }
      // one store per row() so a test cannot inherit the previous one's wait
      var P;
      function fresh() { P = new Pending({ now: function () { return NOW; } }); return row(); }
      var r = fresh(), t = r.querySelector('.tgt');
    """)

    js(ctx4, "updateTempRow(r, 24, 0, P);")
    check("a heater that is off leaves the field empty, so the dash shows through",
          js(ctx4, "t.value").to_string() == "",
          "a literal 0 has to be deleted before a temperature can be typed")
    check("an off row says so",
          js(ctx4, "r.title").to_string() == "Toolhead 1 — off")

    js(ctx4, "updateTempRow(r, 24, 200, P);")
    check("a target the machine reports lands in the field",
          js(ctx4, "t.value").to_string() == "200")
    check("and the row says it is heating",
          js(ctx4, "r.dataset.heat").to_string() == "heating"
          and js(ctx4, "r.title").to_string() == "Toolhead 1 — heating to 200 °C")

    js(ctx4, "document.activeElement = t; t.value = '55'; updateTempRow(r, 24, 200, P);")
    check("a focused field is never overwritten by an incoming reading",
          js(ctx4, "t.value").to_string() == "55")
    js(ctx4, "document.activeElement = null;")

    # the vanishing value, exactly as it happened
    js(ctx4, "r = fresh(); t = r.querySelector('.tgt'); updateTempRow(r, 24, 0, P);"
             "P.set('e0', 200); t.value = '200';"
             "updateTempRow(r, 24, 0, P);")
    check("a sent target survives the push that still reports the old one",
          js(ctx4, "t.value").to_string() == "200"
          and js(ctx4, "r.dataset.pend").to_string() == "1",
          "this is the bug: the machine's 0 was written back over the value just sent")
    check("and the row says it is waiting on the printer",
          "waiting for the printer" in js(ctx4, "r.title").to_string())

    js(ctx4, "updateTempRow(r, 25, 200, P);")
    check("the machine echoing the target ends the wait",
          js(ctx4, "String(r.dataset.pend)").to_string() == "undefined"
          and js(ctx4, "t.value").to_string() == "200")

    # a setpoint the printer accepted and then ignored
    js(ctx4, "r = fresh(); t = r.querySelector('.tgt'); updateTempRow(r, 24, 0, P);"
             "P.set('e0', 200); t.value = '200'; NOW += 11000; updateTempRow(r, 24, 0, P);")
    check("a target the machine never echoes is given up on, not left standing",
          js(ctx4, "r.dataset.pend").to_string() == "lost"
          and js(ctx4, "t.value").to_string() == "",
          "a value the printer never took must not keep sitting there looking applied")
    check("and the row names the value that did not take",
          js(ctx4, "r.title").to_string()
          == "Toolhead 1 — the printer did not take 200 °C")
    js(ctx4, "NOW += 9000; updateTempRow(r, 24, 0, P);")
    check("the warning clears itself",
          js(ctx4, "String(r.dataset.pend)").to_string() == "undefined")

    # the bar: how far along the ramp, from where it started when the target was set
    js(ctx4, "r = fresh(); updateTempRow(r, 24, 0, P); updateTempRow(r, 24, 200, P);")
    check("the heat bar starts empty at the foot of the ramp",
          js(ctx4, "r.querySelector('.heat').style.width").to_string() == "0.0%")
    js(ctx4, "updateTempRow(r, 112, 200, P);")
    check("and tracks the climb",
          js(ctx4, "r.querySelector('.heat').style.width").to_string() == "50.0%")
    js(ctx4, "updateTempRow(r, 199, 200, P);")
    check("arriving is a state of its own, and the bar stops",
          js(ctx4, "r.dataset.heat").to_string() == "ready"
          and js(ctx4, "r.querySelector('.heat').style.width").to_string() == "0")

    js(ctx4, "r = fresh(); updateTempRow(r, 200, 200, P); updateTempRow(r, 200, 0, P);"
             "updateTempRow(r, 120, 0, P);")
    check("cooling is shown while the hardware is still hot",
          js(ctx4, "r.dataset.heat").to_string() == "cooling"
          and js(ctx4, "r.querySelector('.heat').style.width").to_string() == "40.0%",
          "a nozzle at 120 with the heater off is not the same as an idle one")
    # measured on hardware: asked for 40, the nozzle went to 48
    js(ctx4, "r = fresh(); updateTempRow(r, 26, 0, P); updateTempRow(r, 26, 40, P);"
             "updateTempRow(r, 33, 40, P); updateTempRow(r, 48, 40, P);")
    check("an overshoot restarts the ramp instead of leaving the bar full",
          js(ctx4, "r.dataset.heat").to_string() == "cooling"
          and js(ctx4, "r.querySelector('.heat').style.width").to_string() == "0.0%",
          "the bar was still measuring the climb, so it read 100% while falling")
    js(ctx4, "updateTempRow(r, 44, 40, P);")
    check("and then measures the fall",
          js(ctx4, "r.querySelector('.heat').style.width").to_string() == "50.0%")

    js(ctx4, "updateTempRow(r, 30, 0, P);")
    check("and stops once it is cool enough to touch",
          js(ctx4, "r.dataset.heat").to_string() == ""
          and js(ctx4, "r.title").to_string() == "Toolhead 1 — off")

    print(f"\n{checks - len(fails)}/{checks} checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
