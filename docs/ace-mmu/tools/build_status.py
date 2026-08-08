#!/usr/bin/env python3
"""Render docs/ace-mmu/build-status.json into a readable build page.

A published artifact cannot reach this machine, so the page is a snapshot: regenerate
and republish it when a build starts and when it finishes. The point is to answer, at a
glance, "what is compiling, what is in it, and what should I try when it lands" without
asking.

    python3 docs/ace-mmu/tools/build_status.py            # render
    python3 docs/ace-mmu/tools/build_status.py --probe    # refresh live bits first
"""
import datetime as dt
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
DOCS = HERE.parent
REPO = DOCS.parent.parent
STATE = DOCS / "build-status.json"
OUT = DOCS / "build-status.html"

E = lambda s: (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def probe(state: dict) -> dict:
    """Fill in what can be measured: is a build running, binary mtime, log errors."""
    running = subprocess.run(["pgrep", "-f", "cmake --build build"],
                             capture_output=True).returncode == 0
    state["running"] = running
    state["state"] = "building" if running else state.get("state_when_idle", "done")
    binp = REPO / "build/src/Release/snapmaker-orca"
    if binp.exists():
        state["binary"] = dt.datetime.fromtimestamp(binp.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
    for b in state.get("builds", []):
        log = pathlib.Path(b.get("log", ""))
        if log.exists():
            txt = log.read_text(errors="replace")
            b["errors"] = len(re.findall(r"\berror:", txt))
            b["lines"] = txt.count("\n")
    state["generated"] = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    STATE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    return state


CSS = """
:root{--bg:#eceef0;--card:#fff;--ink:#23282c;--dim:#69727a;--faint:#9aa2a9;--line:#e3e6e8;
 --ok:#12a594;--busy:#e2953a;--bad:#d64541;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
 --shadow:0 1px 2px rgba(16,24,32,.05),0 14px 34px -22px rgba(16,24,32,.5);}
@media (prefers-color-scheme:dark){:root{--bg:#0f1215;--card:#181c20;--ink:#e8ecef;--dim:#98a2aa;--faint:#6a757d;
 --line:#272d33;--ok:#17b890;--busy:#e6a23c;--bad:#e06c68;--shadow:0 1px 0 rgba(255,255,255,.03),0 16px 36px -22px #000;}}
:root[data-theme=dark]{--bg:#0f1215;--card:#181c20;--ink:#e8ecef;--dim:#98a2aa;--faint:#6a757d;--line:#272d33;
 --ok:#17b890;--busy:#e6a23c;--bad:#e06c68;--shadow:0 1px 0 rgba(255,255,255,.03),0 16px 36px -22px #000;}
:root[data-theme=light]{--bg:#eceef0;--card:#fff;--ink:#23282c;--dim:#69727a;--faint:#9aa2a9;--line:#e3e6e8;
 --ok:#12a594;--busy:#e2953a;--bad:#d64541;}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
 padding:24px 16px 48px;-webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:16px 18px}
h1{margin:0;font-size:19px;letter-spacing:-.01em}
h2{margin:0 0 10px;font-size:11.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim)}
.top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;border-radius:999px;
 padding:5px 12px;border:1px solid var(--line)}
.pill .dot{width:8px;height:8px;border-radius:50%}
.pill.building{color:var(--busy);border-color:color-mix(in srgb,var(--busy) 45%,var(--line))}
.pill.building .dot{background:var(--busy);animation:pulse 1.4s ease-in-out infinite}
.pill.done{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 45%,var(--line))}.pill.done .dot{background:var(--ok)}
.pill.failed{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 45%,var(--line))}.pill.failed .dot{background:var(--bad)}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.pill.building .dot{animation:none}}
.meta{margin-left:auto;font-size:12px;color:var(--faint);font-family:var(--mono)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.kv{border:1px solid var(--line);border-radius:9px;padding:9px 11px}
.kv .k{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.4px}
.kv .v{font-size:14px;font-family:var(--mono);font-variant-numeric:tabular-nums}
ul{margin:0;padding-left:18px}li{margin:4px 0}
li .why{color:var(--dim);font-size:12.5px}
.chk{list-style:none;padding:0}.chk li{display:flex;gap:9px;align-items:flex-start;margin:7px 0}
.chk .box{flex:none;width:15px;height:15px;border:1.5px solid var(--faint);border-radius:4px;margin-top:2px}
code{font-family:var(--mono);font-size:12.5px;background:rgba(127,127,127,.12);padding:1px 5px;border-radius:4px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--dim);padding:0 0 6px}
td{padding:6px 0;border-top:1px solid var(--line);font-family:var(--mono);font-size:12.5px}
td.t{font-family:inherit;font-size:13px}
.foot{color:var(--faint);font-size:12px;text-align:center}
"""


def render(s: dict) -> str:
    st = s.get("state", "done")
    label = {"building": "Building", "done": "Ready", "failed": "Failed"}.get(st, st)
    builds = s.get("builds", [])
    errs = sum(b.get("errors", 0) for b in builds)
    if st != "building" and errs:
        st, label = "failed", "Failed"

    kv = [("Binary", s.get("binary", "—")), ("Targets", str(len(builds))),
          ("Errors", str(errs)), ("Branch", s.get("branch", "—"))]

    parts = [f"""<div class="card"><div class="top"><h1>{E(s.get('title','Build'))}</h1>
      <span class="pill {st}"><span class="dot"></span>{E(label)}</span>
      <span class="meta">{E(s.get('generated',''))}</span></div>
      <p style="margin:10px 0 0;color:var(--dim)">{E(s.get('summary',''))}</p>
      <div class="grid" style="margin-top:12px">""" +
      "".join(f'<div class="kv"><div class="k">{E(k)}</div><div class="v">{E(v)}</div></div>' for k, v in kv) +
      "</div></div>"]

    if s.get("features"):
        parts.append('<div class="card"><h2>What is in this build</h2><ul>' + "".join(
            f'<li>{E(f["what"])}'
            + (f'<br><span class="why">{E(f["why"])}</span>' if f.get("why") else "")
            + "</li>" for f in s["features"]) + "</ul></div>")

    if s.get("verify"):
        parts.append('<div class="card"><h2>Try this when it lands</h2><ul class="chk">' + "".join(
            f'<li><span class="box"></span><span>{E(v)}</span></li>' for v in s["verify"]) + "</ul></div>")

    if builds:
        rows = "".join(
            f'<tr><td class="t">{E(b.get("name",""))}</td><td>{E(b.get("target",""))}</td>'
            f'<td>{b.get("errors","—")}</td><td>{E(b.get("log",""))}</td></tr>' for b in builds)
        parts.append('<div class="card"><h2>Build chain</h2><table>'
                     "<tr><th>Step</th><th>Target</th><th>Errors</th><th>Log</th></tr>" + rows + "</table></div>")

    if s.get("open"):
        parts.append('<div class="card"><h2>Not in this build</h2><ul>' + "".join(
            f"<li>{E(o)}</li>" for o in s["open"]) + "</ul></div>")

    return ("<title>" + E(s.get("title", "Build")) + "</title>\n<style>" + CSS + "</style>\n"
            '<div class="wrap">' + "".join(parts) +
            '<div class="foot">Snapshot — regenerate with '
            "<code>python3 docs/ace-mmu/tools/build_status.py --probe</code></div></div>\n")


def main() -> int:
    s = json.loads(STATE.read_text(encoding="utf-8"))
    if "--probe" in sys.argv:
        s = probe(s)
    OUT.write_text(render(s), encoding="utf-8")
    print(f"wrote {OUT} ({s.get('state')}, {sum(b.get('errors',0) for b in s.get('builds',[]))} errors)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
