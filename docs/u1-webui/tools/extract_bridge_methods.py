#!/usr/bin/env python3
"""Recover which printer method each bridge command turns into.

    python3 docs/u1-webui/tools/extract_bridge_methods.py

Orca's bridge is mostly a thin funnel: `sw_ControlExtruderTemp` reaches the printer as
the JSON-RPC method `printer.control.extruder_temp` with its parameters passed almost
straight through. That mapping is the whole content of the C++ middle layer, and it is
what a host outside Orca needs in order to answer the page itself - see `u1_bridge.py`.

Two hops, both read from source rather than transcribed:

    SSWCP.cpp      m_cmd == "sw_ControlExtruderTemp"  ->  sw_ControlExtruderTemp()
                   sw_ControlExtruderTemp()           ->  host->async_control_extruder_temp(...)
    MoonRaker.cpp  async_control_extruder_temp        ->  method = "printer.control.extruder_temp"
                                                          params["temp"], params["index"], ...

Writes `docs/u1-webui/data/bridge-methods.json`. Anything the join cannot complete is
recorded with a null method and a reason, because a command that quietly vanishes from
the table would look, to the host, exactly like one the printer does not implement.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DATA = os.path.join(os.path.dirname(HERE), "data")
SSWCP = os.path.join(ROOT, "src", "slic3r", "GUI", "SSWCP.cpp")
SSWCP_H = os.path.join(ROOT, "src", "slic3r", "GUI", "SSWCP.hpp")
MOONRAKER = os.path.join(ROOT, "src", "slic3r", "Utils", "MoonRaker.cpp")


def read(path):
    return open(path, encoding="utf-8", errors="replace").read().split("\n")


# A definition line for any member of any class: `void Foo::bar(`, `bool Foo::baz(`.
ANY_DEF = re.compile(r"\w[\w:<>,&\s\*]*\b(\w+)::(\w+)\s*\(")


def member_bodies(lines, cls):
    """(name, body) for every `... Cls::name(` definition in the file.

    A body ends at the first line that is a lone `}` in column one - the convention this
    codebase follows - or at the next definition of ANY class, whichever comes first.
    Ending it at the next definition of the SAME class is not enough and is not a
    theoretical worry: it made `sw_mqtt_publish` swallow every function defined between
    it and the next MqttAgent member, and come out mapped to `machine.system_info`.
    """
    at = [(i, m.group(1), m.group(2)) for i, l in enumerate(lines) if (m := ANY_DEF.match(l))]
    starts = [i for i, _, _ in at]
    for k, (i, owner, name) in enumerate(at):
        if owner != cls:
            continue
        limit = starts[k + 1] if k + 1 < len(starts) else len(lines)
        end = limit
        for j in range(i + 1, limit):
            if lines[j] == "}":
                end = j + 1
                break
        yield name, "\n".join(lines[i:end])


def method_constants(text):
    """`static const std::string METHOD_X = "printer.y";` -> {"METHOD_X": "printer.y"}.

    Not every method name is a literal at the call site. Some are hoisted to a file-scope
    constant and the call reads `send_to_request(METHOD_START_LOCAL_PRINT, ...)`, which a
    search for a quoted string right after the paren cannot see.

    `sw_StartLocalPrint` was the one that mattered: it came out with `method: null` and
    the honest reason "no JSON-RPC method found behind async_start_local_print", so
    u1_bridge refused to forward it and the send path stopped one command short of
    starting a print. The reason was true and the conclusion was wrong - the method is
    `server.files.start_local_print`, three lines above the call.
    """
    return dict(re.findall(
        r'\bconst\s+std::string\s+(\w+)\s*=\s*"([^"]+)"\s*;', text))


def moonraker_methods():
    """async_* -> {method, params, forwarded}."""
    src = read(MOONRAKER)
    consts = method_constants("\n".join(src))
    out = {}
    for name, body in member_bodies(src, "Moonraker_Mqtt"):
        if not name.startswith("async_"):
            continue
        m = (re.search(r'method\s*=\s*"([^"]+)"', body)
             or re.search(r'send_to_request\(\s*"([^"]+)"', body))
        if not m:
            # ...or the method is one of those constants, named rather than quoted.
            named = (re.search(r'\bmethod\s*=\s*(\w+)\s*;', body)
                     or re.search(r'send_to_request\(\s*(\w+)\s*,', body))
            if named and named.group(1) in consts:
                keys = sorted(set(re.findall(r'params\[\s*"([^"]+)"\s*\]', body)))
                cand = {"method": consts[named.group(1)], "params": keys,
                        "forwarded": not keys}
                prev = out.get(name)
                if prev is None or (cand["forwarded"] and not prev["forwarded"]):
                    out[name] = cand
            continue
        keys = sorted(set(re.findall(r'params\[\s*"([^"]+)"\s*\]', body)))
        # `send_to_request(method, params_from_caller, ...)` with no params[...] of its
        # own means the caller's JSON goes out untouched.
        forwarded = not keys
        prev = out.get(name)
        # Some are overloaded; the JSON-forwarding overload is the one SSWCP calls.
        if prev is None or (forwarded and not prev["forwarded"]):
            out[name] = {"method": m.group(1), "params": keys, "forwarded": forwarded}
    return out


def sswcp_dispatch():
    """wire command -> C++ handler name, straight out of the dispatcher chain.

    Half the chain compares against a string literal and half against a `#define`d
    name from SSWCP.hpp. Reading only the literals silently loses the rest - which is
    how `sw_GetDeviceDataStorageSpace` went missing on the first pass.
    """
    src = "\n".join(read(SSWCP))
    defines = dict(re.findall(r'#define\s+(\w+)\s+"(\w+)"', "\n".join(read(SSWCP_H))))
    out = {}
    for m in re.finditer(r'm_cmd\s*==\s*(?:"(\w+)"|(\w+))\s*\)\s*\{\s*(\w+)\s*\(', src):
        cmd = m.group(1) or defines.get(m.group(2))
        if cmd:
            out[cmd] = m.group(3)
    return out


def sswcp_handlers():
    """C++ handler name -> the async_* calls its body makes."""
    lines = read(SSWCP)
    out = {}
    classes = sorted(set(re.findall(r"\b(SSWCP\w*Instance)::\w+\s*\(", "\n".join(lines))))
    for cls in classes:
        for name, body in member_bodies(lines, cls):
            calls = re.findall(r"->\s*(async_\w+)\s*\(", body)
            if calls:
                out.setdefault(name, [])
                out[name] += [c for c in calls if c not in out[name]]
    return out


def main():
    for p in (SSWCP, MOONRAKER):
        if not os.path.exists(p):
            print(f"missing {p}", file=sys.stderr)
            return 1

    methods = moonraker_methods()
    dispatch = sswcp_dispatch()
    handlers = sswcp_handlers()

    table, unresolved = {}, []
    for cmd, handler in sorted(dispatch.items()):
        calls = handlers.get(handler, [])
        hit = next((c for c in calls if c in methods), None)
        if hit:
            entry = dict(methods[hit])
            entry["handler"] = hit
            table[cmd] = entry
        else:
            why = ("the handler makes no async_ call - answered inside Orca"
                   if not calls else
                   f"no JSON-RPC method found behind {', '.join(calls)}")
            table[cmd] = {"method": None, "params": [], "forwarded": False,
                          "handler": calls[0] if calls else None, "why": why}
            unresolved.append(cmd)

    os.makedirs(DATA, exist_ok=True)
    out = os.path.join(DATA, "bridge-methods.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(table, f, indent=1, sort_keys=True)
        f.write("\n")

    mapped = len(table) - len(unresolved)
    print(f"{os.path.relpath(out, ROOT)}")
    print(f"  {len(table)} dispatched commands, {mapped} reach the printer directly")
    print(f"  {len(unresolved)} answered inside Orca (or not through Moonraker_Mqtt)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
