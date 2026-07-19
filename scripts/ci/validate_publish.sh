#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

base_ref="${1:-${VALIDATION_BASE_REF:-}}"
head_ref="${2:-${VALIDATION_HEAD_REF:-HEAD}}"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "validate-publish: required command not found: $1" >&2
        exit 1
    fi
}

require_command python3
require_command clang-format

resolved_head="$(git rev-parse --verify "${head_ref}^{commit}" 2>/dev/null || git rev-parse --verify HEAD)"
if [[ -n "$base_ref" ]] && git rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
    resolved_base="$base_ref"
elif git rev-parse --verify "${resolved_head}^" >/dev/null 2>&1; then
    resolved_base="${resolved_head}^"
else
    resolved_base="$(git hash-object -t tree /dev/null)"
fi

echo "validate-publish: validating ${resolved_base}..${resolved_head}"
python3 scripts/ci/check_clang_format.py --base "$resolved_base" --head "$resolved_head"
python3 scripts/ci/check_repository_hygiene.py --base "$resolved_base" --head "$resolved_head"

changed_markdown=()
while IFS= read -r file; do
    [[ -n "$file" ]] && changed_markdown+=("$file")
done < <(git diff --name-only --diff-filter=ACMRT "$resolved_base" "$resolved_head" -- '*.md')
if (( ${#changed_markdown[@]} > 0 )); then
    require_command npx
    npx --yes markdownlint-cli@0.49.0 "${changed_markdown[@]}"
fi

while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    python3 -m json.tool "$file" >/dev/null
done < <(git diff --name-only --diff-filter=ACMRT "$resolved_base" "$resolved_head" -- '*.json')

workflow_files=()
while IFS= read -r file; do
    [[ -n "$file" ]] && workflow_files+=("$file")
done < <(git diff --name-only --diff-filter=ACMRT "$resolved_base" "$resolved_head" -- '.github/workflows/*.yml' '.github/workflows/*.yaml')
if (( ${#workflow_files[@]} > 0 )); then
    require_command docker
    require_command yamllint
    docker run --rm --volume "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12 -color "${workflow_files[@]}"
    yamllint --config-file .yamllint.yml "${workflow_files[@]}"
fi

if git diff --name-only --diff-filter=ACMRT "$resolved_base" "$resolved_head" -- 'scripts/release/*' | grep -q .; then
    python3 -m py_compile scripts/release/*.py
    python3 scripts/release/test_release_tools.py
    python3 scripts/release/check_builder_side_effects.py
fi

if command -v clang-tidy >/dev/null 2>&1; then
    clang-tidy --verify-config
else
    echo "validate-publish: clang-tidy not installed; configuration validation skipped"
fi

git diff --check "$resolved_base" "$resolved_head"

echo "validate-publish: all blocking publication checks passed"
