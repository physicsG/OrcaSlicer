#!/usr/bin/env python3
"""Reject publication and repository-mutation behavior in build workflows."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = (
    ".github/workflows/build_all.yml",
    ".github/workflows/build_check_cache.yml",
    ".github/workflows/build_deps.yml",
    ".github/workflows/build_orca.yml",
    ".github/workflows/build_platform.yml",
)
PROHIBITED = {
    "WebFreak001/deploy-nightly": "nightly release deployment",
    "rickstaa/action-create-tag": "tag creation or mutation",
    "sentry_cli.yml": "Sentry symbol publication",
    "gh release": "direct GitHub release publication",
    "contents: write": "repository write permission",
    "git push": "direct repository mutation",
}


def main() -> int:
    failures: list[str] = []
    for relative_path in WORKFLOWS:
        path = ROOT / relative_path
        if not path.is_file():
            failures.append(f"missing expected builder workflow: {relative_path}")
            continue

        content = path.read_text(encoding="utf-8")
        for needle, description in PROHIBITED.items():
            if needle in content:
                failures.append(f"{relative_path}: contains {description} ({needle!r})")

    if failures:
        raise SystemExit("Builder side-effect validation failed:\n- " + "\n- ".join(failures))

    print("Builder workflows are free of publication and repository-mutation side effects.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
