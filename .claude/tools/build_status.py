#!/usr/bin/env python3
"""Render docs/ace-mmu/build-status.json into a readable build page.

A published artifact cannot reach this machine, so the page is a snapshot: regenerate
and republish it when a build starts and when it finishes. The point is to answer, at a
glance, "what is compiling, what is in it, and what should I try when it lands" without
asking.

    .claude/tools/start.sh status     # render + probe (what VS Code runs)
    python3 .claude/tools/build_status.py --probe
"""
import datetime as dt
import glob
import json
import os
import pathlib
import re
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent      # .claude/tools
REPO = HERE.parent.parent
STATE = HERE / "build-status.json"
OUT = HERE / "build-status.html"

E = lambda s: (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def ago(ts: float) -> str:
    d = int(time.time() - ts)
    if d < 60:
        return f"{d}s ago"
    if d < 3600:
        return f"{d // 60}m ago"
    if d < 86400:
        return f"{d // 3600}h {d % 3600 // 60}m ago"
    return f"{d // 86400}d ago"


def tail(path: pathlib.Path, n: int = 400_000) -> str:
    """Build logs reach tens of MB; only the end carries the current step."""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        f.seek(max(0, f.tell() - n))
        return f.read().decode("utf-8", "replace")


def active_log() -> pathlib.Path | None:
    """The log being written right now - the newest of everything we might build into."""
    cands = [pathlib.Path(p) for p in glob.glob("/tmp/orca_build*.log")]
    cands = [p for p in cands if p.exists()]
    return max(cands, key=lambda p: p.stat().st_mtime) if cands else None


def newest_source() -> tuple[str, float] | None:
    """Newest source edit, so a binary older than it can be called out as stale."""
    best, best_t = None, 0.0
    for root, dirs, files in os.walk(REPO / "src"):
        dirs[:] = [d for d in dirs if d not in (".git", "build")]
        for fn in files:
            if fn.endswith((".cpp", ".hpp", ".h", ".c", ".cc")):
                try:
                    t = os.stat(os.path.join(root, fn)).st_mtime
                except OSError:
                    continue
                if t > best_t:
                    best, best_t = fn, t
    return (best, best_t) if best else None


def probe(state: dict) -> dict:
    """Fill in what can be measured: step counter, binary freshness, log errors."""
    running = subprocess.run(["pgrep", "-x", "ninja"], capture_output=True).returncode == 0
    state["running"] = running
    state["state"] = "building" if running else state.get("state_when_idle", "done")

    # Step counter. Ninja prints "[done/total] Building ..." per edge; the last one is where
    # we are. Without this the page says "building" for 20 minutes and tells you nothing.
    state.pop("progress", None)
    log = active_log()
    if log:
        txt = tail(log)
        steps = re.findall(r"^\[(\d+)/(\d+)\] (.+)$", txt, re.M)
        if steps:
            done, total, what = steps[-1]
            done, total = int(done), int(total)
            pct = round(done * 100 / total) if total else 0
            # Rate comes from a moving window of samples, not from the whole run. Two
            # reasons: the page is usually opened mid-build (so elapsed/done is wrong), and
            # step cost is wildly uneven - a Debug build opens with the precompiled header,
            # which is minutes on its own and extrapolates to a four-hour estimate.
            now = time.time()
            if state.get("run_log") != str(log):
                state["run_log"], state["samples"] = str(log), []
            samples = [tuple(s) for s in state.get("samples", [])]
            samples = [(t, n) for t, n in samples if now - t <= 600 and n <= done][-40:]
            samples.append((now, done))
            state["samples"] = [list(s) for s in samples]

            eta = ""
            if running:
                t0, n0 = samples[0]
                if now - t0 >= 15 and done > n0:
                    left = int((now - t0) / (done - n0) * (total - done))
                    if left > 0:
                        eta = f"~{left // 60}m {left % 60}s left" if left >= 60 else f"~{left}s left"
                else:
                    eta = "measuring rate…"
            state["progress"] = {"done": done, "total": total, "pct": pct, "eta": eta,
                                 "what": os.path.basename(what.split(" object ")[-1]).replace(".o", ""),
                                 "log": str(log)}
    if not running:
        for k in ("run_log", "samples"):
            state.pop(k, None)

    binp = REPO / "build/src/Release/snapmaker-orca"
    if binp.exists():
        mt = binp.stat().st_mtime
        state["binary"] = dt.datetime.fromtimestamp(mt).strftime("%H:%M:%S")
        state["binary_age"] = ago(mt)
        # A binary older than the newest source is the trap: the app you just launched
        # does not contain the change you are testing. Say so rather than showing a time.
        # Staleness is "older than the newest source", NOT "a build is running": the running
        # build may be another config (Debug shares this dir) and may not touch this binary
        # at all. Conflating the two labels a freshly linked binary as the previous one.
        ns = newest_source()
        stale = bool(ns and ns[1] > mt)
        state["binary_stale"] = stale
        state["binary_note"] = (f"relinking now - still the previous build ({ns[0]} is newer)" if stale and running
                                else f"STALE - older than {ns[0]} ({ago(ns[1])})" if stale
                                else "newer than every source file" + (" (a build is running)" if running else ""))

    dbg = REPO / "build/src/Debug/snapmaker-orca"
    state["debug_binary"] = (dt.datetime.fromtimestamp(dbg.stat().st_mtime).strftime("%H:%M:%S")
                             if dbg.exists() else "not built")

    for b in state.get("builds", []):
        lg = pathlib.Path(b.get("log", ""))
        if lg.exists():
            txt = tail(lg)
            b["errors"] = len(re.findall(r"\berror:", txt))
            b["lines"] = txt.count("\n")
    state["generated"] = dt.datetime.now().strftime("%H:%M:%S")
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
.chk .box.done{border-color:var(--ok);background:var(--ok);position:relative}
.chk .box.done::after{content:'';position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
code{font-family:var(--mono);font-size:12.5px;background:rgba(127,127,127,.12);padding:1px 5px;border-radius:4px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--dim);padding:0 0 6px}
td{padding:6px 0;border-top:1px solid var(--line);font-family:var(--mono);font-size:12.5px}
td.t{font-family:inherit;font-size:13px}
.foot{color:var(--faint);font-size:12px;text-align:center}
.bar{height:8px;border-radius:999px;background:color-mix(in srgb,var(--dim) 18%,transparent);overflow:hidden}
.bar span{display:block;height:100%;border-radius:999px;background:var(--busy);transition:width .4s ease}
.bar.done span{background:var(--ok)}
.steps{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:0 0 9px}
.steps .n{font-family:var(--mono);font-size:22px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.steps .of{color:var(--faint);font-family:var(--mono);font-size:13px}
.steps .eta{margin-left:auto;color:var(--dim);font-size:12.5px;font-family:var(--mono)}
.now{margin-top:8px;font-size:12.5px;color:var(--dim);font-family:var(--mono);
 white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kv.warn{border-color:color-mix(in srgb,var(--busy) 50%,var(--line))}
.kv .sub{font-size:11.5px;color:var(--dim);margin-top:2px}
.kv.warn .sub{color:var(--busy)}
"""


def render(s: dict) -> str:
    st = s.get("state", "done")
    label = {"building": "Building", "done": "Ready", "failed": "Failed"}.get(st, st)
    builds = s.get("builds", [])
    errs = sum(b.get("errors", 0) for b in builds)
    if st != "building" and errs:
        st, label = "failed", "Failed"

    # key, value, sub-line, warn
    kv = [("Binary", f"{s.get('binary','—')}  ({s.get('binary_age','')})",
           s.get("binary_note", ""), s.get("binary_stale", False)),
          ("Debug binary", s.get("debug_binary", "—"), "start.sh run --debug", False),
          ("Errors", str(errs), "across the chain", errs > 0),
          ("Branch", s.get("branch", "—"), "", False)]

    parts = [f"""<div class="card"><div class="top"><h1>{E(s.get('title','Build'))}</h1>
      <span class="pill {st}"><span class="dot"></span>{E(label)}</span>
      <span class="meta">{E(s.get('generated',''))}</span></div>
      <p style="margin:10px 0 0;color:var(--dim)">{E(s.get('summary',''))}</p>
      <div class="grid" style="margin-top:12px">""" +
      "".join(f'<div class="kv{" warn" if w else ""}"><div class="k">{E(k)}</div>'
              f'<div class="v">{E(v)}</div>'
              + (f'<div class="sub">{E(sub)}</div>' if sub else "")
              + "</div>" for k, v, sub, w in kv) +
      "</div></div>"]

    p = s.get("progress")
    if p:
        parts.append(
            f'<div class="card"><h2>Progress</h2><div class="steps">'
            f'<span class="n">{p["done"]}</span><span class="of">/ {p["total"]} steps</span>'
            f'<span class="of">&middot; {p["pct"]}%</span>'
            f'<span class="eta">{E(p.get("eta") or ("finished" if not s.get("running") else ""))}</span></div>'
            f'<div class="bar{"" if s.get("running") else " done"}"><span style="width:{p["pct"]}%"></span></div>'
            f'<div class="now">{"compiling" if s.get("running") else "last step"}: {E(p["what"])}</div>'
            f'<div class="now" style="color:var(--faint)">{E(p["log"])}</div></div>')

    if s.get("features"):
        parts.append('<div class="card"><h2>What is in this build</h2><ul>' + "".join(
            f'<li>{E(f["what"])}'
            + (f'<br><span class="why">{E(f["why"])}</span>' if f.get("why") else "")
            + "</li>" for f in s["features"]) + "</ul></div>")

    if s.get("verify"):
        parts.append('<div class="card"><h2>Try this when it lands</h2><ul class="chk">' + "".join(
            f'<li><span class="box"></span><span>{E(v)}</span></li>' for v in s["verify"]) + "</ul></div>")

    # What was actually run against it. The old state file carried a `tests` key that
    # nothing rendered, so the one piece of evidence a build report exists to carry was
    # being written and dropped. This is that key, with a card behind it.
    if s.get("checks"):
        parts.append('<div class="card"><h2>Checks run against this build</h2><ul class="chk">'
                     + "".join(f'<li><span class="box done"></span><span>{E(c)}</span></li>'
                               for c in s["checks"]) + "</ul></div>")

    if builds:
        rows = "".join(
            f'<tr><td class="t">{E(b.get("name",""))}</td><td>{E(b.get("target",""))}</td>'
            f'<td>{b.get("errors","—")}</td><td>{E(b.get("log",""))}</td></tr>' for b in builds)
        parts.append('<div class="card"><h2>Build chain</h2><table>'
                     "<tr><th>Step</th><th>Target</th><th>Errors</th><th>Log</th></tr>" + rows + "</table></div>")

    if s.get("open"):
        parts.append('<div class="card"><h2>Not in this build</h2><ul>' + "".join(
            f"<li>{E(o)}</li>" for o in s["open"]) + "</ul></div>")

    # The page is a static file, so refreshing only helps if something regenerates it -
    # that is what `start.sh watch` does. Refresh only while building; a done page that
    # keeps reloading is just noise.
    refresh = '<meta http-equiv="refresh" content="15">\n' if s.get("running") else ""
    foot = ("auto-refreshing every 15s &mdash; keep <code>.claude/tools/start.sh watch</code> running"
            if s.get("running") else
            "Snapshot &mdash; regenerate with <code>.claude/tools/start.sh status</code>")
    return (refresh + "<title>" + E(s.get("title", "Build")) + "</title>\n<style>" + CSS + "</style>\n"
            '<div class="wrap">' + "".join(parts) +
            '<div class="foot">' + foot + "</div></div>\n")


def main() -> int:
    s = json.loads(STATE.read_text(encoding="utf-8"))
    if "--probe" in sys.argv:
        s = probe(s)
    OUT.write_text(render(s), encoding="utf-8")
    print(f"wrote {OUT} ({s.get('state')}, {sum(b.get('errors',0) for b in s.get('builds',[]))} errors)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
