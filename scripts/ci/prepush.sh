#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if ! command -v python3 >/dev/null 2>&1; then
    echo "pre-push: python3 is required" >&2
    exit 1
fi

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

echo "pre-push: validating committed diff ${base_ref}..HEAD"

if command -v clang-format >/dev/null 2>&1; then
    python3 scripts/ci/check_clang_format.py --base "$base_ref" --head HEAD
else
    echo "pre-push: clang-format is required because CI formatting is blocking" >&2
    exit 1
fi

changed_markdown=()
while IFS= read -r file; do
    changed_markdown+=("$file")
done < <(git diff --name-only --diff-filter=ACMRT "$base_ref" HEAD -- '*.md')
if (( ${#changed_markdown[@]} > 0 )); then
    if ! command -v npx >/dev/null 2>&1; then
        echo "pre-push: npx is required for Markdown validation" >&2
        exit 1
    fi
    npx --yes markdownlint-cli@0.49.0 "${changed_markdown[@]}"
fi

while IFS= read -r file; do
    python3 -m json.tool "$file" >/dev/null
done < <(git diff --name-only --diff-filter=ACMRT "$base_ref" HEAD -- '*.json')

workflow_files=()
while IFS= read -r file; do
    workflow_files+=("$file")
done < <(git diff --name-only --diff-filter=ACMRT "$base_ref" HEAD -- '.github/workflows/*.yml' '.github/workflows/*.yaml')
if (( ${#workflow_files[@]} > 0 )); then
    if ! command -v docker >/dev/null 2>&1 || ! command -v yamllint >/dev/null 2>&1; then
        echo "pre-push: docker and yamllint are required for workflow validation" >&2
        exit 1
    fi
    docker run --rm --volume "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12 -color "${workflow_files[@]}"
    yamllint --config-file .yamllint.yml "${workflow_files[@]}"
fi

if git diff --name-only --diff-filter=ACMRT "$base_ref" HEAD -- 'scripts/release/*' | grep -q .; then
    python3 -m py_compile scripts/release/*.py
    python3 scripts/release/test_release_tools.py
    python3 scripts/release/check_builder_side_effects.py
fi

git diff --check "$base_ref" HEAD

echo "pre-push: all applicable blocking CI-equivalent checks passed"
