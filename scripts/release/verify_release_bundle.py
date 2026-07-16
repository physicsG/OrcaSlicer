#!/usr/bin/env python3
"""Verify release manifests, required platforms, and SHA-256 sidecars."""

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


def find_literal_files(root: Path, filename: str) -> list[Path]:
    """Find regular files by literal basename, without interpreting glob syntax."""
    return [path for path in root.rglob("*") if path.is_file() and path.name == filename]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle-dir", type=Path, required=True)
    parser.add_argument("--require-platform", action="append", default=[])
    parser.add_argument("--require-tests", action="store_true")
    parser.add_argument("--require-signed-macos", action="store_true")
    args = parser.parse_args()

    bundle_dir = args.bundle_dir.resolve()
    manifests = sorted(bundle_dir.rglob("build-manifest-*.json"))
    if not manifests:
        raise ValueError("release bundle contains no build manifests")

    platforms: dict[str, dict[str, object]] = {}
    common_values: dict[str, str] | None = None

    for manifest_path in manifests:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        platform = str(manifest["platform"])
        if platform in platforms:
            raise ValueError(f"duplicate build manifest for platform: {platform}")
        platforms[platform] = manifest

        current_common = {
            "repository": str(manifest["repository"]),
            "commit": str(manifest["commit"]),
            "source_ref": str(manifest["source_ref"]),
            "version": str(manifest["version"]),
            "version_label": str(manifest["version_label"]),
        }
        if common_values is None:
            common_values = current_common
        elif current_common != common_values:
            raise ValueError(
                f"manifest metadata mismatch in {manifest_path}: "
                f"expected {common_values}, got {current_common}"
            )

        if args.require_tests and not bool(manifest.get("tests_passed")):
            raise ValueError(f"{platform} manifest does not record successful tests")
        if args.require_signed_macos and platform == "macos" and not bool(manifest.get("signed")):
            raise ValueError("macOS production artifact is not marked as signed")

        for artifact in manifest.get("artifacts", []):
            name = str(artifact["name"])
            expected = str(artifact["sha256"])
            matches = find_literal_files(bundle_dir, name)
            if len(matches) != 1:
                raise ValueError(f"expected exactly one artifact named {name}, found {len(matches)}")
            actual = sha256(matches[0])
            if actual != expected:
                raise ValueError(f"SHA-256 mismatch for {name}: expected {expected}, got {actual}")

            sidecar_matches = find_literal_files(bundle_dir, f"{name}.sha256")
            if len(sidecar_matches) != 1:
                raise ValueError(f"missing or duplicate checksum sidecar for {name}")
            sidecar_parts = sidecar_matches[0].read_text(encoding="utf-8").split()
            if not sidecar_parts:
                raise ValueError(f"checksum sidecar for {name} is empty")
            sidecar_hash = sidecar_parts[0]
            if sidecar_hash != expected:
                raise ValueError(f"checksum sidecar mismatch for {name}")

    missing = sorted(set(args.require_platform) - set(platforms))
    if missing:
        raise ValueError(f"release bundle is missing required platforms: {', '.join(missing)}")

    print(f"Verified platforms: {', '.join(sorted(platforms))}")
    print(f"Verified commit: {common_values['commit'] if common_values else 'unknown'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
