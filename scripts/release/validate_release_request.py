#!/usr/bin/env python3
"""Validate manual release inputs and production tag/version requirements."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

VERSION_PATTERN = re.compile(r'set\(Snapmaker_VERSION\s+"([^"]+)"\)')
VALID_MODES = {"artifacts-only", "draft-release", "prerelease", "production-release"}


def parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes"}:
        return True
    if normalized in {"0", "false", "no"}:
        return False
    raise argparse.ArgumentTypeError(f"invalid boolean value: {value}")


def read_version(path: Path) -> str:
    match = VERSION_PATTERN.search(path.read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"Snapmaker_VERSION was not found in {path}")
    return match.group(1)


def run_git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        check=check,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def normalize_tag_version(tag: str) -> str:
    return tag.removeprefix("refs/tags/").removeprefix("v").removeprefix("V")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--version-label", required=True)
    parser.add_argument("--publish-mode", required=True)
    parser.add_argument("--build-linux", type=parse_bool, required=True)
    parser.add_argument("--build-windows", type=parse_bool, required=True)
    parser.add_argument("--build-macos", type=parse_bool, required=True)
    parser.add_argument("--run-full-tests", type=parse_bool, required=True)
    parser.add_argument("--sign-artifacts", type=parse_bool, required=True)
    parser.add_argument("--version-file", type=Path, default=Path("version.inc"))
    args = parser.parse_args()

    if args.publish_mode not in VALID_MODES:
        raise ValueError(f"unsupported publish mode: {args.publish_mode}")
    if not any((args.build_linux, args.build_windows, args.build_macos)):
        raise ValueError("select at least one platform to build")
    if args.sign_artifacts and not args.build_macos:
        raise ValueError("sign_artifacts currently applies to macOS and requires build_macos")
    if args.publish_mode != "artifacts-only" and not args.version_label.strip():
        raise ValueError("version_label is required when publishing a GitHub release")

    if args.publish_mode == "production-release":
        if not args.run_full_tests:
            raise ValueError("production releases require run_full_tests")
        if not all((args.build_linux, args.build_windows, args.build_macos)):
            raise ValueError("production releases require Linux, Windows, and macOS builds")

        source_tag = args.source_ref.removeprefix("refs/tags/")
        tag_ref = f"refs/tags/{source_tag}"
        if run_git("show-ref", "--verify", "--quiet", tag_ref, check=False).returncode != 0:
            raise ValueError("production source_ref must resolve to an existing tag")
        if run_git("cat-file", "-e", f"{source_tag}^{{tag}}", check=False).returncode != 0:
            raise ValueError("production source_ref must be an annotated tag")

        version = read_version(args.version_file)
        if normalize_tag_version(source_tag) != version:
            raise ValueError(
                f"production tag {source_tag!r} does not match Snapmaker_VERSION {version!r}"
            )
        if args.version_label != source_tag:
            raise ValueError("production version_label must exactly match the selected source tag")

    print("Manual release request is valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
