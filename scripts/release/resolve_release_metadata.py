#!/usr/bin/env python3
"""Resolve and validate metadata shared by manual release workflows."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
from pathlib import Path

VERSION_PATTERN = re.compile(r'set\(Snapmaker_VERSION\s+"([^"]+)"\)')
LABEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$")


def run_git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return result.stdout.strip()


def read_version(path: Path) -> str:
    match = VERSION_PATTERN.search(path.read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"Snapmaker_VERSION was not found in {path}")
    return match.group(1)


def tag_exists(tag: str) -> bool:
    result = subprocess.run(
        ["git", "show-ref", "--verify", "--quiet", f"refs/tags/{tag}"],
        check=False,
    )
    return result.returncode == 0


def append_output(path: Path, values: dict[str, str]) -> None:
    with path.open("a", encoding="utf-8", newline="\n") as stream:
        for key, value in values.items():
            stream.write(f"{key}={value}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--version-label", default="")
    parser.add_argument("--version-file", type=Path, default=Path("version.inc"))
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()

    source_ref = args.source_ref.strip()
    if not source_ref or any(ord(character) < 32 for character in source_ref):
        raise ValueError("source_ref must be a non-empty printable value")

    version = read_version(args.version_file)
    commit = run_git("rev-parse", "HEAD")
    short_commit = commit[:12]

    requested_label = args.version_label.strip()
    if requested_label:
        label = requested_label
    elif tag_exists(source_ref):
        label = source_ref
    else:
        label = f"V{version}-{short_commit}"

    if not LABEL_PATTERN.fullmatch(label):
        raise ValueError(
            "version_label must start with an alphanumeric character and contain only "
            "letters, numbers, '.', '_', '+', or '-' (maximum 80 characters)"
        )

    values = {
        "commit": commit,
        "short_commit": short_commit,
        "version": version,
        "version_label": label,
        "source_ref": source_ref,
    }

    output_path = args.github_output or (
        Path(os.environ["GITHUB_OUTPUT"]) if os.environ.get("GITHUB_OUTPUT") else None
    )
    if output_path:
        append_output(output_path, values)
    else:
        for key, value in values.items():
            print(f"{key}={value}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
