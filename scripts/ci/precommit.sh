#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

staged_files=()
while IFS= read -r file; do
    staged_files+=("$file")
done < <(git diff --cached --name-only --diff-filter=ACMR)

if (( ${#staged_files[@]} == 0 )); then
    echo "pre-commit: no staged files"
    exit 0
fi

has_command() {
    command -v "$1" >/dev/null 2>&1
}

require_python3() {
    if ! has_command python3; then
        echo "pre-commit: python3 is required for this check" >&2
        exit 1
    fi
}

collect_matching() {
    local regex="$1"
    local file
    for file in "${staged_files[@]}"; do
        if [[ "$file" =~ $regex ]]; then
            printf '%s\n' "$file"
        fi
    done
}

run_staged_hygiene_checks() {
    local file

    require_python3
    echo "pre-commit: checking staged repository hygiene"
    git diff --cached --check

    for file in "${staged_files[@]}"; do
        case "$file" in
            build/*|build-ci/*|destdir/*|*/CMakeFiles/*|*.7z|*.appimage|*.dll|*.dmg|*.dylib|*.exe|*.o|*.obj|*.so|*.tar|*.tgz|*.zip)
                echo "pre-commit: generated/build artifact should not be committed: $file" >&2
                exit 1
                ;;
        esac
    done
}

run_clang_format() {
    local -a cpp_files=()
    local file
    while IFS= read -r file; do
        cpp_files+=("$file")
    done < <(collect_matching '\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$')
    (( ${#cpp_files[@]} == 0 )) && return

    if ! has_command clang-format; then
        echo "pre-commit: clang-format is required for changed C/C++ files" >&2
        exit 1
    fi

    echo "pre-commit: checking clang-format"
    clang-format --dry-run --Werror "${cpp_files[@]}"

    if has_command clang-tidy; then
        echo "pre-commit: validating clang-tidy configuration"
        clang-tidy --verify-config
    else
        echo "pre-commit: clang-tidy not installed; skipping configuration validation"
    fi
}

run_markdownlint() {
    local -a markdown_files=()
    local file
    while IFS= read -r file; do
        markdown_files+=("$file")
    done < <(collect_matching '\.md$')
    (( ${#markdown_files[@]} == 0 )) && return

    if ! has_command npx; then
        echo "pre-commit: npx is required for changed Markdown files" >&2
        exit 1
    fi

    echo "pre-commit: checking Markdown"
    npx --yes markdownlint-cli@0.49.0 "${markdown_files[@]}"
}

run_json_validation() {
    local -a json_files=()
    local file
    while IFS= read -r file; do
        json_files+=("$file")
    done < <(collect_matching '\.json$')
    (( ${#json_files[@]} == 0 )) && return

    require_python3
    echo "pre-commit: validating JSON"
    for file in "${json_files[@]}"; do
        python3 -m json.tool "$file" >/dev/null
    done
}

run_workflow_validation() {
    local file
    local -a workflow_files=()
    for file in "${staged_files[@]}"; do
        if [[ "$file" == .github/workflows/*.yml || "$file" == .github/workflows/*.yaml ]]; then
            workflow_files+=("$file")
        fi
    done
    (( ${#workflow_files[@]} == 0 )) && return

    if ! has_command docker; then
        echo "pre-commit: docker is required to run actionlint for changed workflows" >&2
        exit 1
    fi

    if ! has_command yamllint; then
        echo "pre-commit: yamllint is required for changed workflows (pip install yamllint==1.38.0)" >&2
        exit 1
    fi

    echo "pre-commit: checking GitHub Actions workflows"
    docker run --rm \
        --volume "$PWD:/repo" \
        --workdir /repo \
        rhysd/actionlint:1.7.12 \
        -color "${workflow_files[@]}"
    yamllint --config-file .yamllint.yml "${workflow_files[@]}"
}

run_release_tooling_checks() {
    local file
    local changed=false
    for file in "${staged_files[@]}"; do
        if [[ "$file" == scripts/release/* ]]; then
            changed=true
            break
        fi
    done
    [[ "$changed" == false ]] && return

    require_python3
    echo "pre-commit: checking release tooling"
    python3 -m py_compile scripts/release/*.py
    python3 scripts/release/test_release_tools.py
    python3 scripts/release/check_builder_side_effects.py
}

run_staged_hygiene_checks
run_clang_format
run_markdownlint
run_json_validation
run_workflow_validation
run_release_tooling_checks

echo "pre-commit: all applicable checks passed"
