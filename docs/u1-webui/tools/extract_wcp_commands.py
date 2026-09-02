#!/usr/bin/env python3
"""Recover the WcpCmd catalogue: enum value -> wire name -> subscription channel.

The Flutter bundle models every bridge call as a value of the Dart enum `WcpCmd`
(minified to `A.bq`). Two getters on that enum survive dart2js as plain switch
statements over the enum index, and both keep their string literals:

    gaX(){switch(this.a){ case 0:return"sw_StartMachineFind" ... }}   # wire name
    ge2(){switch(this.a){ case 0:return"send_machine_list"   ... }}   # push channel

That makes the bundle - not the C++ - the authoritative list of what the page can
ask for. Cross-referencing against SSWCP.cpp's dispatch then shows, per command,
whether it is implemented by the host, page-only, or host-only.

Writes: data/wcp-commands.json
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import read_bundle, read_cpp, DATA, SSWCP_CPP  # noqa: E402
SSWCP_HPP = SSWCP_CPP[:-4] + ".hpp"


def switch_map(body):
    """`case <int>:return"<str>"` pairs from a lowered Dart switch."""
    return {int(i): s for i, s in re.findall(r'case (\d+):return"([^"]*)"', body)}


def main():
    d = read_bundle()

    # The two getters live inside `A.bq.prototype={...}`; locate by their
    # unmistakable first case rather than by minified getter name, which moves
    # between builds.
    anchor = d.find('gaX(){switch(this.a){case 0:return"sw_StartMachineFind"')
    if anchor < 0:
        sys.exit("WcpCmd wire-name switch not found - bundle layout changed")
    wire = switch_map(d[anchor:d.find("default:", anchor)])

    a2 = d.find('ge2(){switch(this.a){', anchor)
    channel = switch_map(d[a2:d.find("default:", a2)]) if a2 > 0 else {}

    # Enum value names, from the constant pool (see extract_enums.py).
    names = {}
    for m in re.finditer(r'B\.\w+\s*=\s*new A\.bq\((\d+),"(\w+)"\)', d):
        names[int(m.group(1))] = m.group(2)

    # Which commands the C++ host knows about.
    #
    # Careful: SSWCP.hpp defines 15 of them as macros (`#define DOWN_LOAD_FILE
    # "sw_DownLoadFile"`) and the .cpp routing tables then use the macro, not the
    # literal. Scanning only the .cpp for `"sw_*"` therefore under-reports and
    # makes host-implemented commands look page-only. Read both files and expand
    # the macros before comparing.
    cpp = read_cpp(SSWCP_CPP)
    hpp = read_cpp(SSWCP_HPP)
    macros = dict(re.findall(r'^#define\s+(\w+)\s+"(sw_[A-Za-z0-9_]+)"', hpp, re.M))
    cpp_cmds = set(re.findall(r'"(sw_[A-Za-z0-9_]+)"', cpp + hpp))
    cpp_cmds |= {v for k, v in macros.items() if re.search(r'\b' + k + r'\b', cpp)}

    # Routing group -> instance class, from the m_<group>_cmd_list initialisers.
    group_of = {}
    for gm in re.finditer(r'SSWCP::(m_(\w+)_cmd_list)\s*=\s*\{(.*?)\}', cpp, re.S):
        group = gm.group(2)
        for tok in re.findall(r'"(sw_[A-Za-z0-9_]+)"|\b([A-Z][A-Z0-9_]{2,})\b', gm.group(3)):
            name = tok[0] or macros.get(tok[1])
            if name:
                group_of[name] = group

    # Which commands the page actually references as a literal anywhere.
    page_literals = set(re.findall(r'"(sw_[A-Za-z0-9_]+)"', d))

    out = {}
    for idx in sorted(wire):
        w = wire[idx]
        out[w] = {
            "index": idx,
            "wire_name": w,
            "dart_enum_value": names.get(idx),
            "push_channel": channel.get(idx),
            "implemented_in_cpp": w in cpp_cmds,
            "routing_group": group_of.get(w),
            "referenced_in_bundle": w in page_literals,
        }

    # Host commands the page's WcpCmd enum does not know about.
    for w in sorted(cpp_cmds - set(out)):
        out[w] = {
            "index": None,
            "wire_name": w,
            "dart_enum_value": None,
            "push_channel": None,
            "implemented_in_cpp": True,
            "routing_group": group_of.get(w),
            "referenced_in_bundle": w in page_literals,
            "note": "host-only: dispatched by SSWCP.cpp but absent from the page's WcpCmd enum",
        }

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "wcp-commands.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)

    both = [c for c in out.values() if c["implemented_in_cpp"] and c["index"] is not None]
    page_only = [c for c in out.values() if not c["implemented_in_cpp"]]
    host_only = [c for c in out.values() if c["index"] is None]
    print(f"WcpCmd wire names      : {len(wire)}")
    print(f"push channels          : {len(channel)}")
    print(f"in both page and host  : {len(both)}")
    print(f"page-only (no C++)     : {len(page_only)}")
    for c in page_only:
        print(f"    {c['wire_name']}  ({c['dart_enum_value']})")
    print(f"host-only (no WcpCmd)  : {len(host_only)}")
    for c in host_only:
        print(f"    {c['wire_name']}")


if __name__ == "__main__":
    main()
