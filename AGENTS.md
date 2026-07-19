# Repository Guidelines

## Project Structure & Module Organization

Snapmaker_Orca’s C++17 sources live in `src/`, split by feature modules and
platform adapters. User assets, icons, and printer presets are in `resources/`;
translations stay in `localization/`. Tests sit in `tests/`, grouped by domain
(`libslic3r/`, `sla_print/`, etc.) with fixtures under `tests/data/`. CMake
helpers reside in `cmake/`, and longer references in `doc/` and
`SoftFever_doc/`. Automation scripts belong in `scripts/` and `tools/`. Treat
everything in `deps/` and `deps_src/` as vendored snapshots—do not modify
without mirroring upstream tags.

## Build, Test, and Development Commands

Use out-of-source builds:

- `cmake -S . -B build -DCMAKE_BUILD_TYPE=Release` configures dependencies and
  generates build files.
- `cmake --build build --target Snapmaker_Orca --config Release` compiles the
  app; add `--parallel` to speed up.
- `cmake --build build --target tests` then
  `ctest --test-dir build --output-on-failure` runs automated suites.

Platform helpers such as `build_linux.sh`, `build_release_macos.sh`, and
`build_release_vs2022.bat` wrap the same flow with toolchain flags. Use
`build_release_macos.sh -sx` when reproducing macOS build issues, and
`scripts/DockerBuild.sh` for reproducible container builds.

## Coding Style & Naming Conventions

`.clang-format` enforces 4-space indents, a 140-column limit, aligned
initializers, and brace wrapping for classes and functions. Run
`clang-format -i <file>` before committing; the CMake `clang-format` target is
available when LLVM tools are on your PATH. Prefer `CamelCase` for classes,
`snake_case` for functions and locals, and `SCREAMING_CASE` for constants,
matching conventions in `src/`. Keep headers self-contained and align include
order with the IWYU pragmas.

## Pre-Commit Verification

Install the repository Git hooks once per clone with:

`bash scripts/ci/install_git_hooks.sh`

The `.githooks/pre-commit` hook runs `scripts/ci/precommit.sh` against staged
files before every commit. Do not bypass it for normal development. The script
runs the applicable local equivalents of the pull-request quality gates,
including clang-format, clang-tidy configuration validation when available,
Markdown linting, JSON parsing, workflow linting, and release-tooling checks.

The `.githooks/pre-push` hook resolves the intended branch base and delegates to
`scripts/ci/validate_publish.sh`. That script is the canonical blocking
publication gate for formatting, repository hygiene, Markdown, JSON, workflow,
release-tooling, clang-tidy configuration when available, and whitespace checks.
CI and automation must use this same entry point instead of reimplementing an
approximation of these checks.

For connector/API-based publication, local Git hooks do not run. Direct writes
to the target feature branch are therefore prohibited. Automation must:

1. create or update a temporary `validation/**` candidate branch containing the
   exact commit intended for publication;
2. include `Validation-Base: <target-base-ref>` as a commit-message trailer;
3. wait for the `Pre-Publication Validation / publication-gate` workflow to pass;
4. only then fast-forward or otherwise promote the validated commit to the real
   feature branch.

A failed or missing candidate validation must never be bypassed by publishing
the commit directly to the target branch. This two-phase flow is the required
server-side equivalent of the local pre-push hook.

In addition:

- Run the narrowest relevant unit/integration tests for behavioral changes. For
  multiACE work, run the affected Catch2 multiACE tests at minimum; run the
  broader test target when shared infrastructure is changed.
- Before committing, inspect the staged diff and confirm generated files,
  credentials, build outputs, debug artifacts, and unrelated edits are not
  included.
- If an applicable required check cannot be executed locally, do not silently
  skip it. Explicitly record what was not run and why before committing or
  publishing the change.

A commit should be considered ready only when the hook and applicable tests are
green. Do not rely on GitHub Actions to discover routine formatting, lint, or
targeted-test failures after the commit is pushed.

## Testing Guidelines

Unit tests rely on Catch2 (`tests/catch2/`). Name specs after the component under
test—for example `tests/libslic3r/TestPlanarHole.cpp`—and tag long-running cases
so `ctest -L fast` remains useful. Cover new algorithms with deterministic
fixtures or sample G-code stored in `tests/data/`. Document manual printer
validation or regression slicer checks in your PR when automated coverage is
insufficient.

## Commit & Pull Request Guidelines

The history favors concise, sentence-style subject lines with optional issue
references, e.g., `Fix grid lines origin for multiple plates (#10724)`. Squash
fixups locally before opening a PR. Complete `.github/pull_request_template.md`,
include reproduction steps or screenshots for UI changes, and mention impacted
presets or translations. Link issues via `Closes #NNNN` when applicable, and
call out dependency bumps or profile migrations for maintainer review.

## Security & Configuration Tips

Follow `SECURITY.md` for vulnerability reporting. Keep API tokens and printer
credentials out of tracked configs; use `sandboxes/` for experimental settings.
When touching third-party code in `deps_src/`, record the upstream commit or
release in your PR description and run the relevant platform build script to
confirm integration.
