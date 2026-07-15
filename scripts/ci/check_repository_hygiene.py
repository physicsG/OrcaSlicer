#!/usr/bin/env python3
"""Check changed files for common repository hygiene problems."""

from __future__ import annotations

import argparse
from pathlib import Path

from changed_files import changed_paths

MAX_FILE_SIZE = 5 * 1024 * 1024
GENERATED_PARTS = {"build", "build-ci", "destdir", "CMakeFiles"}
GENERATED_SUFFIXES = {
    ".7z",
    ".appimage",
    ".dll",
    ".dmg",
    ".dylib",
    ".exe",
    ".o",
    ".obj",
    ".so",
    ".tar",
    ".tgz",
    ".zip",
}
CONFLICT_MARKERS = ("<<<<<<<", "=======", ">>>>>>>")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base")
    parser.add_argument("--head")
    return parser.parse_args()


def has_allowed_markdown_break(line: str, path: Path) -> bool:
    return path.suffix.lower() == ".md" and line.endswith("  ") and not line.endswith("   ")


def check_text(path: Path, text: str) -> list[str]:
    errors: list[str] = []
    lines = text.splitlines(keepends=True)

    if text and not text.endswith("\n"):
        errors.append("missing final newline")

    for number, raw_line in enumerate(lines, start=1):
        line = raw_line.rstrip("\r\n")
        if line.endswith((" ", "\t")) and not has_allowed_markdown_break(line, path):
            errors.append(f"line {number}: trailing whitespace")
        if line.startswith(CONFLICT_MARKERS):
            errors.append(f"line {number}: merge conflict marker")

    return errors


def main() -> int:
    args = parse_args()
    failures: list[str] = []

    for path in changed_paths(args.base, args.head):
        parts = set(path.parts)
        suffix = path.suffix.lower()

        if parts.intersection(GENERATED_PARTS) or suffix in GENERATED_SUFFIXES:
            failures.append(f"{path}: generated/build artifact should not be committed")
            continue

        size = path.stat().st_size
        if size > MAX_FILE_SIZE:
            failures.append(f"{path}: file is larger than {MAX_FILE_SIZE} bytes")
            continue

        data = path.read_bytes()
        if b"\x00" in data:
            continue

        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as error:
            failures.append(f"{path}: invalid UTF-8 ({error})")
            continue

        for error in check_text(path, text):
            failures.append(f"{path}: {error}")

    if failures:
        print("Repository hygiene checks failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Repository hygiene checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
