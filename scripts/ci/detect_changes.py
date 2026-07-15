#!/usr/bin/env python3
"""Classify changed paths and emit GitHub Actions outputs."""

from __future__ import annotations

import argparse

from changed_files import changed_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base")
    parser.add_argument("--head")
    return parser.parse_args()


def starts_with_any(path: str, prefixes: tuple[str, ...]) -> bool:
    return path.startswith(prefixes)


def main() -> int:
    args = parse_args()
    files = [path.as_posix() for path in changed_paths(args.base, args.head)]

    code = any(
        path == "CMakeLists.txt"
        or starts_with_any(
            path,
            (
                "src/",
                "tests/",
                "cmake/",
                "deps/",
                "scripts/linux.d/",
            ),
        )
        or path in {
            "build_linux.sh",
            "build_release_macos.sh",
            "build_release_vs2022.bat",
        }
        for path in files
    )
    workflows = any(
        starts_with_any(path, (".github/workflows/", "scripts/ci/"))
        for path in files
    )
    profiles = any(path.startswith("resources/profiles/") for path in files)
    tests = any(path.startswith("tests/") for path in files)
    dependencies = any(path.startswith("deps/") for path in files)
    documentation = any(path.startswith("doc/") or path.endswith(".md") for path in files)

    outputs = {
        "code": code,
        "workflows": workflows,
        "profiles": profiles,
        "tests": tests,
        "dependencies": dependencies,
        "documentation": documentation,
        "run_tests": code or workflows or profiles or tests or dependencies,
    }

    for key, value in outputs.items():
        print(f"{key}={'true' if value else 'false'}")

    print(f"changed_count={len(files)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
