#!/usr/bin/env python3
"""Run clang-format checks only on changed C and C++ line ranges."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

from changed_files import changed_paths, git, resolve_range

CPP_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".cxx",
    ".h",
    ".hh",
    ".hpp",
    ".hxx",
    ".m",
    ".mm",
}
HUNK_PATTERN = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base")
    parser.add_argument("--head")
    parser.add_argument("--clang-format", default="clang-format")
    return parser.parse_args()


def merge_line_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def changed_line_ranges(path: Path, base: str, head: str) -> list[tuple[int, int]]:
    output = git(
        "diff",
        "--unified=0",
        "--no-color",
        "--diff-filter=ACMRT",
        base,
        head,
        "--",
        path.as_posix(),
    )

    ranges: list[tuple[int, int]] = []
    for line in output.splitlines():
        match = HUNK_PATTERN.match(line)
        if not match:
            continue
        start = int(match.group(1))
        count = int(match.group(2) or "1")
        if count > 0:
            ranges.append((start, start + count - 1))
    return merge_line_ranges(ranges)


def main() -> int:
    args = parse_args()
    base, head = resolve_range(args.base, args.head)
    files = [path for path in changed_paths(base, head) if path.suffix.lower() in CPP_SUFFIXES]
    if not files:
        print("No changed C/C++ lines require formatting checks.")
        return 0

    failures: list[Path] = []
    for path in files:
        ranges = changed_line_ranges(path, base, head)
        if not ranges:
            continue

        command = [args.clang_format, "--dry-run", "--Werror", "--style=file"]
        command.extend(f"--lines={start}:{end}" for start, end in ranges)
        command.append(path.as_posix())
        result = subprocess.run(command, check=False)
        if result.returncode != 0:
            failures.append(path)

    if failures:
        print("clang-format checks failed for changed lines in:")
        for path in failures:
            print(f"- {path}")
        return 1

    print(f"clang-format checks passed for changed lines in {len(files)} files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
