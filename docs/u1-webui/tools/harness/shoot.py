#!/usr/bin/env python3
"""Drive the harness: load a route, settle, optionally click, screenshot, pull the record.

usage: shoot.py NAME PATH [WAIT] [WxH] [click=x,y[;x,y] ...] [post=SECONDS]
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp

SP = os.path.dirname(os.path.abspath(__file__))
CH = os.path.expanduser("~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome")
BASE = "http://127.0.0.1:8765/web/flutter_web/index.html"

args = sys.argv[1:]
name, path = args[0], args[1]
wait = float(args[2]) if len(args) > 2 and not args[2].startswith(("click", "post")) else 12
size = next((a for a in args if "x" in a and a.replace("x", "").isdigit()), "1280x900")
clicks = next((a.split("=", 1)[1] for a in args if a.startswith("click=")), "")
post = float(next((a.split("=", 1)[1] for a in args if a.startswith("post=")), 2))
w, h = (int(x) for x in size.split("x"))

env = dict(os.environ, LD_LIBRARY_PATH=os.path.join(SP, "libs"))
c = cdp.Chrome(CH, extra=[f"--window-size={w},{h}"], env=env)
try:
    c.open(f"{BASE}?path={path}&dump={name}")
    c.call("Emulation.setDeviceMetricsOverride", width=w, height=h,
           deviceScaleFactor=1, mobile=False)
    time.sleep(wait)

    for pt in [p for p in clicks.split(";") if p.strip()]:
        x, y = (int(v) for v in pt.split(","))
        for typ in ("mousePressed", "mouseReleased"):
            c.call("Input.dispatchMouseEvent", type=typ, x=x, y=y,
                   button="left", clickCount=1)
        time.sleep(post)

    os.makedirs(os.path.join(SP, "shots"), exist_ok=True)
    p = os.path.join(SP, "shots", f"{name}.png")
    size_b = c.shot(p)
    rec = c.eval("JSON.stringify({record: window.__wcp ? window.__wcp.record : [],"
                 " replies: window.__wcp ? window.__wcp.replies : 0,"
                 " unhandled: window.__wcp ? Array.from(new Set(window.__wcp.unhandled)) : []})")
    d = json.loads(rec) if rec else {"record": [], "replies": 0, "unhandled": []}
    os.makedirs(os.path.join(SP, "dumps"), exist_ok=True)
    with open(os.path.join(SP, "dumps", f"{name}.json"), "w") as f:
        json.dump(d, f, indent=1)
    print(f"{name}: {size_b:,} B png | {len(d['record'])} req | {d['replies']} rep | "
          f"unhandled: {d['unhandled']}")
finally:
    c.close()
