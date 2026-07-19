#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

has_command() {
    command -v "$1" >/dev/null 2>&1
}

require_python3() {
    if ! has_command python3; then
        echo "pre-push: python3 is required for this check" >&2
        exit 1
    fi
}

remote_name="${1:-}"
remote_url="${2:-}"
updates_file="$(mktemp)"
trap 'rm -f "$updates_file"' EXIT
cat >"$updates_file"

base_args=()
if [[ -s "$updates_file" ]]; then
    while read -r local_ref local_sha remote_ref remote_sha; do
        [[ -z "${local_ref:-}" ]] && continue
        [[ "$local_sha" =~ ^0+$ ]] && continue

        if [[ ! "$remote_sha" =~ ^0+$ ]] && git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
            base_args+=(--base "$remote_sha" --head "$local_sha")
            break
        fi

        if [[ "$local_ref" == refs/heads/* ]]; then
            branch="${local_ref#refs/heads/}"
            if upstream="$(git rev-parse --verify --quiet "$branch@{upstream}" 2>/dev/null)"; then
                base_args+=(--base "$upstream" --head "$local_sha")
                break
            fi
        fi

        parent="$(git rev-parse --verify --quiet "$local_sha^" 2>/dev/null || true)"
        if [[ -n "$parent" ]]; then
            base_args+=(--base "$parent" --head "$local_sha")
            break
        fi
    done <"$updates_file"
fi

require_python3

echo "pre-push: checking repository hygiene${remote_name:+ for $remote_name}${remote_url:+ ($remote_url)}"
python3 scripts/ci/check_repository_hygiene.py "${base_args[@]}"

echo "pre-push: all applicable checks passed"
