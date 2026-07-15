#!/usr/bin/env python3
"""List changed repository files for CI checks."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

ZERO_SHA = "0" * 40


def git(*args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", *args],
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.stdout.strip()


def commit_exists(revision: str) -> bool:
    if not revision or revision == ZERO_SHA:
        return False
    result = subprocess.run(
        ["git", "cat-file", "-e", f"{revision}^{{commit}}"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def resolve_range(base: str | None, head: str | None) -> tuple[str, str]:
    resolved_head = head if commit_exists(head or "") else "HEAD"

    if commit_exists(base or ""):
        return str(base), resolved_head

    parent = git("rev-parse", f"{resolved_head}^", check=False)
    if parent and commit_exists(parent):
        return parent, resolved_head

    empty_tree = git("hash-object", "-t", "tree", "/dev/null")
    return empty_tree, resolved_head


def changed_paths(base: str | None, head: str | None) -> list[Path]:
    resolved_base, resolved_head = resolve_range(base, head)
    output = git(
        "diff",
        "--name-only",
        "--diff-filter=ACMRT",
        resolved_base,
        resolved_head,
    )

    paths: list[Path] = []
    for line in output.splitlines():
        path = Path(line)
        if path.is_file():
            paths.append(path)
    return sorted(set(paths), key=lambda item: item.as_posix())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base")
    parser.add_argument("--head")
    parser.add_argument("--prefix", action="append", default=[])
    parser.add_argument("--suffix", action="append", default=[])
    parser.add_argument("--include-regex")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pattern = re.compile(args.include_regex) if args.include_regex else None

    for path in changed_paths(args.base, args.head):
        value = path.as_posix()
        if args.prefix and not any(value.startswith(prefix) for prefix in args.prefix):
            continue
        if args.suffix and not any(value.endswith(suffix) for suffix in args.suffix):
            continue
        if pattern and not pattern.search(value):
            continue
        print(value)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
