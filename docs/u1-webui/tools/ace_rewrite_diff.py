#!/usr/bin/env python3
"""Measure the drift between Orca's ACE rewriter and multiACE's own, on the same input.

    ace_rewrite_diff.py LOGICAL.gcode SIBLING.ace.gcode [--multiace DIR] [--tag TAG] [--show]

Orca's rewriter (`src/libslic3r/AceMmuRewrite.cpp`) is a port of multiACE's preflight -
`rewrite_head_mode_to_file` + `inject_auto_load_to_file` in
`multiace/tools/post_process_virtual_toolheads.py` - and a second implementation drifts.
This runs the original over the same logical file with the same assignment and diffs the
two outputs. The assignment is read out of the sibling's own header (`; multiACE plan:
T<i>:H<h>S<s> …`) and its preload block, so the only inputs are the two files.

multiACE is taken from `git show TAG:…`, never from the working tree: the checkout is a
side branch and the printer runs the tag (09-route-c-plan.md §2.3).

The differences 09-route-c-plan.md §4.2 lists as deliberate are normalised away before the
diff; anything left is drift, and the exit code says so. Run it on the synthetic pairs the
unit tests keep (`ACE_REWRITE_KEEP_DIR=dir libslic3r_tests "[ace_mmu_rewrite]"`) and on a
real plate once one has been sliced.
"""
from __future__ import annotations

import argparse
import difflib
import importlib.util
import os
import re
import subprocess
import sys
import tempfile

PLAN_RE = re.compile(r"^; multiACE plan:")
STEP_RE = re.compile(r"\bT(\d+):H(\d+)S(\d+)\b")
PRELOAD_RE = re.compile(r"^ACE_SWAP_HEAD HEAD=(\d+) ACE=(\d+) SLOT=(\d+)")
MARKER_RE = re.compile(r"^;\s*Change Tool\s*\d+\s*->\s*Tool\s*\d+")
SWAP_RE = re.compile(r"^ACE_SWAP_HEAD HEAD=(\d+) ACE=(\d+) SLOT=(\d+)")
TEMP_PHYS_RE = re.compile(r"^(M10[49]\s+S\d+\s+)T(\d+)(\s+A\d+.*)$")


def load_multiace(repo: str, tag: str):
    """The tagged rewriter as a module, whatever the working tree is at."""
    src = subprocess.check_output(
        ["git", "-C", repo, "show", f"{tag}:multiace/tools/post_process_virtual_toolheads.py"],
        text=True)
    fd, path = tempfile.mkstemp(prefix="pp_", suffix=".py")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(src)
    spec = importlib.util.spec_from_file_location("post_process_virtual_toolheads", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def read_plan(sibling: str):
    """assignment {t: entry} in multiACE's shape, the ACE heads, and the preload (head -> (ace, slot))."""
    head_of, slot_of = {}, {}
    preload = {}
    with open(sibling, encoding="utf-8", errors="replace") as f:
        for i, line in enumerate(f):
            if i > 5000:
                break
            if PLAN_RE.match(line) and "{" not in line:
                for t, h, s in STEP_RE.findall(line):
                    head_of[int(t)] = int(h)
                    slot_of[int(t)] = int(s)
            m = PRELOAD_RE.match(line)
            if m and "INITIAL=1" in line and int(m.group(1)) not in preload:
                preload[int(m.group(1))] = (int(m.group(2)), int(m.group(3)))
            if head_of and preload and MARKER_RE.match(line):
                break
    if not head_of:
        sys.exit(f"{sibling}: no `; multiACE plan:` header - not a rewritten file")
    unit_of = {h: a for h, (a, _s) in preload.items()}
    assignment = {}
    for t, h in head_of.items():
        if h in unit_of:
            assignment[t] = {"kind": "ace", "head": h, "ace": unit_of[h], "slot": slot_of[t]}
        else:
            assignment[t] = {"kind": "pin", "head": h}
    return assignment, sorted(unit_of), preload


def run_multiace(pp, logical: str, assignment: dict, ace_heads: list[int]) -> str:
    tmp_a = tempfile.mktemp(suffix=".a.gcode")
    tmp_b = tempfile.mktemp(suffix=".b.gcode")
    try:
        try:
            pp.rewrite_head_mode_to_file(logical, tmp_a, assignment, None, None, pickup_cleaning=False)
        except TypeError:
            pp.rewrite_head_mode_to_file(logical, tmp_a, assignment, None)
        try:
            pp.inject_auto_load_to_file(tmp_a, tmp_b, None, set(ace_heads), bg_heads=set())
        except TypeError:
            pp.inject_auto_load_to_file(tmp_a, tmp_b, None, set(ace_heads))
        with open(tmp_b, encoding="utf-8", errors="replace") as f:
            return f.read()
    finally:
        for p in (tmp_a, tmp_b):
            try:
                os.remove(p)
            except OSError:
                pass


def normalise(text: str, preload: dict, theirs: bool) -> list[str]:
    """Strip what the two are allowed to say differently. See 09-route-c-plan.md §4.2."""
    out = []
    in_body = False
    in_block = False
    first_swap_seen: set[int] = set()
    for raw in text.splitlines():
        line = raw.rstrip("\r")
        if MARKER_RE.match(line):
            in_body = True
        if line.startswith("; multiACE auto-load: load"):
            in_block = True
        elif line.startswith("; multiACE auto-load: end"):
            in_block = False
        # Ours only: the plan line and the per-swap comment, and the slicer's purge stamps.
        if PLAN_RE.match(line) or line.startswith("; multiACE: head ") or line.startswith("ACE_SET_PURGE LENGTH="):
            continue
        # Theirs only: the skipped-swap comment; the prime in the preload block; the
        # first-use swap of a preloaded head, which the plugin skips at run time.
        if "; skipped (already loaded)" in line:
            continue
        # Theirs only: the background-swap look-ahead (out of scope here, 09-route-c-plan.md §1).
        if theirs and (line.startswith("ACE_BG_SWAP ") or line.startswith("ACE_BG_UNLOAD ")
                       or line.startswith("; multiACE bg-swap ")):
            continue
        if theirs and in_block and line.startswith("SM_PRINT_PREEXTRUDE_FILAMENT"):
            continue
        m = SWAP_RE.match(line)
        if m and in_body and not in_block:
            head, key = int(m.group(1)), (int(m.group(2)), int(m.group(3)))
            if theirs and head not in first_swap_seen and preload.get(head) == key:
                first_swap_seen.add(head)
                continue
            first_swap_seen.add(head)
        # Arguments this port does not write yet.
        line = re.sub(r"\s+ANTI_OOZE=[0-9.]+", "", line)
        line = re.sub(r"\s+FORCE=1\b", "", line)
        # The dropped-standby comment quotes the line before (theirs) or after (ours) the remap.
        if line.startswith("; multiACE dropped:"):
            line = "; multiACE dropped"
        # Before the body, multiACE remaps the start gcode's physical shutdowns and we do not.
        if not in_body:
            line = TEMP_PHYS_RE.sub(r"\1T?\3", line)
        out.append(line)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("logical")
    ap.add_argument("sibling")
    ap.add_argument("--multiace", default=os.path.expanduser("~/proj/multiACE"))
    ap.add_argument("--tag", default="v0.99.8b")
    ap.add_argument("--show", action="store_true", help="print the unified diff")
    args = ap.parse_args()

    pp = load_multiace(args.multiace, args.tag)
    assignment, ace_heads, preload = read_plan(args.sibling)
    theirs_raw = run_multiace(pp, args.logical, assignment, ace_heads)
    with open(args.sibling, encoding="utf-8", errors="replace") as f:
        ours_raw = f.read()

    ours = normalise(ours_raw, preload, theirs=False)
    theirs = normalise(theirs_raw, preload, theirs=True)
    diff = list(difflib.unified_diff(theirs, ours, "multiACE " + args.tag, "Orca", lineterm="", n=1))
    changed = sum(1 for l in diff[2:] if l[:1] in "+-")
    print(f"{os.path.basename(args.logical)}: assignment {len(assignment)} tools on ACE heads {ace_heads}; "
          f"multiACE {len(theirs_raw.splitlines())} lines, Orca {len(ours_raw.splitlines())} lines; "
          f"after normalising: {changed} differing lines")
    if changed and (args.show or changed <= 40):
        print("\n".join(diff))
    return 1 if changed else 0


if __name__ == "__main__":
    sys.exit(main())
