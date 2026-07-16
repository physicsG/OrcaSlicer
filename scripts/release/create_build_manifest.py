#!/usr/bin/env python3
"""Generate SHA-256 sidecars and a reproducible build manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes"}:
        return True
    if normalized in {"0", "false", "no"}:
        return False
    raise argparse.ArgumentTypeError(f"invalid boolean value: {value}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--version-label", required=True)
    parser.add_argument("--platform", required=True)
    parser.add_argument("--architecture", required=True)
    parser.add_argument("--build-type", default="Release")
    parser.add_argument("--dependency-cache-key", required=True)
    parser.add_argument("--workflow-run", required=True)
    parser.add_argument("--tests-passed", type=parse_bool, required=True)
    parser.add_argument("--signed", type=parse_bool, required=True)
    args = parser.parse_args()

    artifact_dir = args.artifact_dir.resolve()
    if not artifact_dir.is_dir():
        raise FileNotFoundError(f"artifact directory does not exist: {artifact_dir}")

    artifacts = sorted(
        path
        for path in artifact_dir.iterdir()
        if path.is_file()
        and not path.name.endswith(".sha256")
        and not path.name.startswith("build-manifest-")
    )
    if not artifacts:
        raise ValueError(f"no distributable artifacts found in {artifact_dir}")

    artifact_entries: list[dict[str, object]] = []
    for artifact in artifacts:
        digest = sha256(artifact)
        checksum_path = artifact.with_name(f"{artifact.name}.sha256")
        checksum_path.write_text(f"{digest}  {artifact.name}\n", encoding="utf-8")
        artifact_entries.append(
            {
                "name": artifact.name,
                "sha256": digest,
                "size_bytes": artifact.stat().st_size,
            }
        )

    manifest = {
        "schema_version": 1,
        "repository": args.repository,
        "commit": args.commit,
        "source_ref": args.source_ref,
        "version": args.version,
        "version_label": args.version_label,
        "platform": args.platform,
        "architecture": args.architecture,
        "build_type": args.build_type,
        "dependency_cache_key": args.dependency_cache_key,
        "workflow_run": args.workflow_run,
        "tests_passed": args.tests_passed,
        "signed": args.signed,
        "artifacts": artifact_entries,
    }
    manifest_path = artifact_dir / f"build-manifest-{args.platform}.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
