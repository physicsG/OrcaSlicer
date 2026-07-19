#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

base_ref="${PREPUSH_BASE_REF:-}"
if [[ -z "$base_ref" ]]; then
    current_branch="$(git branch --show-current)"
    upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"

    if [[ -n "$upstream" ]]; then
        base_ref="$(git merge-base HEAD "$upstream")"
    elif git show-ref --verify --quiet refs/remotes/origin/feat/integrate-multiace; then
        base_ref="$(git merge-base HEAD origin/feat/integrate-multiace)"
    elif git show-ref --verify --quiet refs/remotes/origin/main; then
        base_ref="$(git merge-base HEAD origin/main)"
    else
        echo "pre-push: cannot determine a base ref for $current_branch" >&2
        echo "Set PREPUSH_BASE_REF to the intended PR base branch or commit." >&2
        exit 1
    fi
fi

exec bash scripts/ci/validate_publish.sh "$base_ref" HEAD
