#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

chmod +x .githooks/pre-commit .githooks/pre-push scripts/ci/precommit.sh scripts/ci/prepush.sh
git config core.hooksPath .githooks

echo "Installed repository Git hooks from .githooks"
