#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

chmod +x .githooks/pre-commit scripts/ci/precommit.sh
git config core.hooksPath .githooks

echo "Installed repository Git hooks from .githooks"
