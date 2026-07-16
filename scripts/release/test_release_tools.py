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


def run_script(
    script: str,
    *args: str,
    check: bool = True,
    cwd: Path = ROOT,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [PYTHON, str(ROOT / "scripts" / "release" / script), *args],
        cwd=cwd,
        check=check,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def run_git(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
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
            artifact = artifact_dir / "Snapmaker_Orca_[test]?.AppImage"
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
            sidecar = artifact_dir / f"{artifact.name}.sha256"
            self.assertTrue(sidecar.is_file())

            run_script(
                "verify_release_bundle.py",
                "--bundle-dir",
                str(artifact_dir),
                "--require-platform",
                "linux",
                "--require-tests",
            )

            original_sidecar = sidecar.read_text(encoding="utf-8")
            sidecar.write_text(" \n", encoding="utf-8")
            failed = run_script(
                "verify_release_bundle.py",
                "--bundle-dir",
                str(artifact_dir),
                "--require-platform",
                "linux",
                check=False,
            )
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn(
                f"checksum sidecar for {artifact.name} is empty",
                failed.stderr,
            )
            sidecar.write_text(original_sidecar, encoding="utf-8")

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

    def test_publish_workflow_requires_existing_matching_tag(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "publish_release.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            'show-ref --verify --quiet "refs/tags/$release_tag"',
            workflow,
        )
        self.assertIn('tag_commit=$(git -C source rev-list -n 1 "$release_tag")', workflow)
        self.assertIn("--verify-tag", workflow)
        self.assertNotIn('--target "$target_commit"', workflow)

    def test_publishing_requires_tag_matching_selected_commit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            run_git(repository, "init")
            run_git(repository, "config", "user.name", "Release Test")
            run_git(repository, "config", "user.email", "release-test@example.invalid")
            (repository / "version.inc").write_text(
                'set(Snapmaker_VERSION "2.3.5")\n',
                encoding="utf-8",
            )
            (repository / "payload.txt").write_text("first\n", encoding="utf-8")
            run_git(repository, "add", ".")
            run_git(repository, "commit", "-m", "initial")
            run_git(repository, "tag", "QA-2.3.5")

            run_script(
                "validate_release_request.py",
                "--source-ref",
                "HEAD",
                "--version-label",
                "QA-2.3.5",
                "--publish-mode",
                "draft-release",
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
                cwd=repository,
            )

            missing = run_script(
                "validate_release_request.py",
                "--source-ref",
                "HEAD",
                "--version-label",
                "missing-tag",
                "--publish-mode",
                "prerelease",
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
                check=False,
                cwd=repository,
            )
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("must name an existing tag", missing.stderr)

            (repository / "payload.txt").write_text("second\n", encoding="utf-8")
            run_git(repository, "add", "payload.txt")
            run_git(repository, "commit", "-m", "move head")
            mismatched = run_script(
                "validate_release_request.py",
                "--source-ref",
                "HEAD",
                "--version-label",
                "QA-2.3.5",
                "--publish-mode",
                "draft-release",
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
                check=False,
                cwd=repository,
            )
            self.assertNotEqual(mismatched.returncode, 0)
            self.assertIn("not selected commit", mismatched.stderr)

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

    def test_request_validator_rejects_shell_like_ref(self) -> None:
        failed = run_script(
            "validate_release_request.py",
            "--source-ref",
            "main;echo-pwned",
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
            check=False,
        )
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("source_ref must start with an alphanumeric", failed.stderr)

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

    def test_production_requires_macos_signing(self) -> None:
        failed = run_script(
            "validate_release_request.py",
            "--source-ref",
            "main",
            "--version-label",
            "V2.3.5",
            "--publish-mode",
            "production-release",
            "--build-linux",
            "true",
            "--build-windows",
            "true",
            "--build-macos",
            "true",
            "--run-full-tests",
            "true",
            "--sign-artifacts",
            "false",
            check=False,
        )
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("require signed and notarized macOS", failed.stderr)


if __name__ == "__main__":
    unittest.main()
