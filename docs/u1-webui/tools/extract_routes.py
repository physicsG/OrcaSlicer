#!/usr/bin/env python3
"""Recover the entry-point table: `?path=N` -> AppModule -> named route.

Orca opens the same Flutter bundle for several different surfaces and selects
between them with a single query parameter:

    .../web/flutter_web/index.html?path=2   -> the Device page
    .../web/flutter_web/index.html?path=4   -> the Print-processing popup
    .../web/flutter_web/index.html?path=5   -> the upload-only popup

`main()` parses that parameter through one small function which survives dart2js
as a chain of string comparisons, each returning an `AppModule` constant:

    bFQ(a){var s=B.c.fS(J.p(a),"/","")
    if(s==="")return B.asT
    else if(s==="1"||s==="home")return B.up
    ...

Each returned constant resolves through the constant pool to `new A.qH(i,"name")`,
which gives both the enum index and the route name. Note that the URL number and
the enum index are NOT the same for every module - see the report below.

Writes: data/entry-points.json
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import read_bundle, DATA, ROOT  # noqa: E402


def main():
    d = read_bundle()

    # 1. The path -> constant dispatcher.
    m = re.search(r'\n(\w+)\(a\)\{var s=B\.c\.fS\(J\.p\(a\),"/",""\)\n(.*?)\nreturn B\.(\w+)\},', d, re.S)
    if not m:
        sys.exit("path dispatcher not found - bundle layout changed")
    fn_sym, body, fallback = m.group(1), m.group(2), m.group(3)

    # if(s==="4"||s==="preUploadAndPrint")return B.asW
    pairs = re.findall(r's==="([^"]*)"(?:\|\|s==="([^"]*)")?\)return B\.(\w+)', body)

    # 2. Resolve every constant through the pool: B.x = new A.qH(i,"name")
    pool = {c: (int(i), n) for c, i, n in
            re.findall(r'B\.(\w+)\s*=\s*new A\.qH\((\d+),"(\w+)"\)', d)}

    # 3. Which C++ file opens which path, for the round trip.
    hosts = {}
    for rel in ("src/slic3r/GUI/PrinterWebView.cpp", "src/slic3r/GUI/WebPreprintDialog.cpp",
                "src/slic3r/GUI/WebViewDialog.cpp", "src/slic3r/GUI/WebGuideDialog.cpp",
                "src/slic3r/GUI/WebPresetDialog.cpp"):
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            continue
        src = open(p, encoding="utf-8", errors="replace").read()
        for pm in re.finditer(r'flutter_web/index\.html\?path=(\d+)', src):
            hosts.setdefault(pm.group(1), []).append(rel)

    entries = []
    for num, alias, const in pairs:
        idx, name = pool.get(const, (None, None))
        entries.append({
            "url_path_param": num or None,
            "url_alias": alias or None,
            "module_const": f"B.{const}",
            "enum_index": idx,
            "module_name": name,
            "index_matches_url": (num.isdigit() and idx == int(num)) if num else None,
            "opened_by": sorted(set(hosts.get(num, []))),
        })

    fidx, fname = pool.get(fallback, (None, None))
    out = {
        "dispatcher_symbol": fn_sym,
        "enum_type": "AppModule (minified A.qH)",
        "fallback": {"module_const": f"B.{fallback}", "enum_index": fidx, "module_name": fname},
        "entries": entries,
    }

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "entry-points.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)

    print(f"dispatcher: A.{fn_sym}()   fallback: {fname}")
    print(f"{'path':>5}  {'alias':22} {'module':22} {'idx':>3}  opened by")
    for e in entries:
        flag = "" if e["index_matches_url"] in (True, None) else "  <-- index != url"
        host = ", ".join(os.path.basename(h) for h in e["opened_by"]) or "-"
        print(f"{str(e['url_path_param']):>5}  {str(e['url_alias']):22} "
              f"{str(e['module_name']):22} {str(e['enum_index']):>3}  {host}{flag}")


if __name__ == "__main__":
    main()
