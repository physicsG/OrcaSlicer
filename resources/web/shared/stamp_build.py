#!/usr/bin/env python3
"""Write resources/web/shared/build-stamp.json — the commit the surfaces were built from.

The reconstructed surfaces show a badge naming the surface, the Flutter bundle's
build number, and the git commit. The first two come from the bundle itself; the
commit can only come from the repo, so it is stamped into a small JSON file the
badge fetches at runtime.

The stamp is optional: the badge degrades to bundle version + build number if the
file is missing or stale, so a checkout that never runs this still works.

Run it after checking out or committing:
    python3 resources/web/shared/stamp_build.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(HERE, "build-stamp.json")


def git(*args, default=""):
    try:
        return subprocess.run(["git", "-C", REPO, *args],
                              capture_output=True, text=True, timeout=10,
                              check=True).stdout.strip()
    except Exception:
        return default


def main():
    commit = git("rev-parse", "--short", "HEAD", default="unknown")
    dirty = bool(git("status", "--porcelain"))
    stamp = {
        "commit": commit,
        "commit_full": git("rev-parse", "HEAD", default=""),
        "branch": git("rev-parse", "--abbrev-ref", "HEAD", default=""),
        "dirty": dirty,
        "subject": git("log", "-1", "--pretty=%s", default=""),
        "committed": git("log", "-1", "--pretty=%cI", default=""),
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(stamp, f, indent=1)
        f.write("\n")
    mark = "+dirty" if dirty else ""
    print(f"{os.path.relpath(OUT, REPO)}: {stamp['branch']} @ {commit}{mark}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
