#!/usr/bin/env python3
"""Smoke tests for the release workflow helper scripts."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PYTHON = sys.executable


def run_script(script: str, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [PYTHON, str(ROOT / "scripts" / "release" / script), *args],
        cwd=ROOT,
        check=check,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


class ReleaseToolTests(unittest.TestCase):
    def test_resolve_metadata_writes_expected_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "github-output.txt"
            run_script(
                "resolve_release_metadata.py",
                "--source-ref",
                "main",
                "--version-label",
                "QA-2.3.5",
                "--github-output",
                str(output),
            )
            values = dict(
                line.split("=", 1)
                for line in output.read_text(encoding="utf-8").splitlines()
            )
            self.assertEqual(values["version_label"], "QA-2.3.5")
            self.assertRegex(values["version"], r"^\d+\.\d+\.\d+")
            self.assertRegex(values["commit"], r"^[0-9a-f]{40}$")

    def test_resolve_metadata_rejects_shell_like_ref(self) -> None:
        failed = run_script(
            "resolve_release_metadata.py",
            "--source-ref",
            "main$(touch-pwned)",
            "--version-label",
            "QA-2.3.5",
            check=False,
        )
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("source_ref must start with an alphanumeric", failed.stderr)

    def test_manifest_and_bundle_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact_dir = Path(directory) / "bundle"
            artifact_dir.mkdir()
            artifact = artifact_dir / "Snapmaker_Orca_test.AppImage"
            artifact.write_bytes(b"release-test-artifact\n")

            commit = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=ROOT,
                check=True,
                stdout=subprocess.PIPE,
                text=True,
            ).stdout.strip()

            run_script(
                "create_build_manifest.py",
                "--artifact-dir",
                str(artifact_dir),
                "--repository",
                "physicsG/OrcaSlicer",
                "--commit",
                commit,
                "--source-ref",
                "main",
                "--version",
                "2.3.5",
                "--version-label",
                "QA-2.3.5",
                "--platform",
                "linux",
                "--architecture",
                "X64",
                "--dependency-cache-key",
                "test-cache-key",
                "--workflow-run",
                "https://example.invalid/run/1",
                "--tests-passed",
                "true",
                "--signed",
                "false",
            )

            manifest = json.loads(
                (artifact_dir / "build-manifest-linux.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["platform"], "linux")
            self.assertTrue(manifest["tests_passed"])
            self.assertEqual(len(manifest["artifacts"]), 1)
            self.assertTrue((artifact_dir / f"{artifact.name}.sha256").is_file())

            run_script(
                "verify_release_bundle.py",
                "--bundle-dir",
                str(artifact_dir),
                "--require-platform",
                "linux",
                "--require-tests",
            )

            artifact.write_bytes(b"tampered\n")
            failed = run_script(
                "verify_release_bundle.py",
                "--bundle-dir",
                str(artifact_dir),
                "--require-platform",
                "linux",
                check=False,
            )
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn("SHA-256 mismatch", failed.stderr)

    def test_artifacts_only_request_accepts_one_platform(self) -> None:
        run_script(
            "validate_release_request.py",
            "--source-ref",
            "main",
            "--version-label",
            "QA-2.3.5",
            "--publish-mode",
            "artifacts-only",
            "--build-linux",
            "true",
            "--build-windows",
            "false",
            "--build-macos",
            "false",
            "--run-full-tests",
            "false",
            "--sign-artifacts",
            "false",
        )

    def test_signing_requires_macos(self) -> None:
        failed = run_script(
            "validate_release_request.py",
            "--source-ref",
            "main",
            "--version-label",
            "QA-2.3.5",
            "--publish-mode",
            "artifacts-only",
            "--build-linux",
            "true",
            "--build-windows",
            "false",
            "--build-macos",
            "false",
            "--run-full-tests",
            "false",
            "--sign-artifacts",
            "true",
            check=False,
        )
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("requires build_macos", failed.stderr)


if __name__ == "__main__":
    unittest.main()
