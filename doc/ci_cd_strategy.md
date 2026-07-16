# CI/CD, automated testing, and platform release strategy

**Repository:** `physicsG/OrcaSlicer`  
**Branch:** `Research/ace2pro-integration`  
**Scope:** Automated tests, formatting and static checks, cross-platform build validation, and selectable release artifacts

## 1. Objectives

The CI/CD system should provide four distinct guarantees:

1. Every pull request automatically runs formatting, static checks, unit tests, integration tests, and at least one representative build.
2. Changes cannot be merged when required quality gates fail.
3. Maintainers can manually build release artifacts for one or more selected platforms without modifying workflow files.
4. Publishing a GitHub release is a separate, protected action from merely building artifacts.

The system should support these target platforms:

```text
Linux:   Ubuntu 24.04 AppImage
Windows: Windows Server 2022 installer and portable archive
macOS:   macOS 14 universal DMG
```

Optional future targets may include Linux Flatpak, separate macOS architectures, or additional Linux distributions.

## 2. Existing repository capabilities

The repository already contains useful reusable workflow pieces:

```text
.github/workflows/build_all.yml
.github/workflows/build_check_cache.yml
.github/workflows/build_deps.yml
.github/workflows/build_orca.yml
```

Existing behavior includes:

- dependency caching based on operating system and `deps/**` content;
- reusable workflows using `workflow_call`;
- Ubuntu, Windows, and macOS build jobs;
- Windows NSIS installer generation;
- Windows portable packaging;
- macOS universal application and DMG packaging;
- macOS signing and notarization on protected branches;
- Linux AppImage packaging;
- artifact uploads;
- nightly deployment behavior.

The current `Build all` entry point is mainly scheduled or manually dispatched. It is not sufficient as the pull-request quality gate because it focuses on full product builds and deployment rather than fast tests and code quality.

The recommended strategy is to preserve the existing platform build implementation while separating:

```text
quality checks
unit and integration tests
compile validation
artifact packaging
signing/notarization
release publication
```

## 3. Proposed workflow structure

Add or refactor workflows into the following structure:

```text
.github/workflows/
  ci.yml
  ci_quality.yml
  ci_tests.yml
  build_platform.yml
  release_manual.yml
  release_tag.yml             # optional later

  build_check_cache.yml       # keep and reuse
  build_deps.yml              # keep, then make side-effect free
  build_orca.yml              # refactor into build/package only
  publish_release.yml         # optional reusable publisher
```

### Responsibilities

#### `ci.yml`

Pull-request and branch entry point. It orchestrates quality checks, tests, and build smoke tests.

#### `ci_quality.yml`

Reusable workflow for formatting, style, static analysis, workflow validation, and CMake validation.

#### `ci_tests.yml`

Reusable workflow for Catch2/CTest unit and integration tests.

#### `build_platform.yml`

Reusable side-effect-free platform builder. It produces artifacts but never deploys or publishes them.

#### `release_manual.yml`

Manual dispatcher with platform selections and release-mode inputs.

#### `release_tag.yml`

Optional later workflow that creates production releases from signed version tags.

## 4. Pull-request CI entry point

Create `.github/workflows/ci.yml` with these triggers:

```yaml
name: CI

on:
  pull_request:
    branches:
      - main
      - 'release/**'
  push:
    branches:
      - main
      - 'release/**'
  workflow_dispatch:
```

Use concurrency cancellation so new commits supersede stale runs:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Use read-only permissions by default:

```yaml
permissions:
  contents: read
```

Do not expose signing, release, printer, or deployment secrets to this workflow.

### Required jobs

```text
quality
unit-tests-linux
integration-tests-linux
build-linux
compile-windows
compile-macos
ci-summary
```

Recommended dependency graph:

```text
quality ────────────────┐
                        ├─> ci-summary
unit-tests-linux ───────┤
integration-tests-linux ┤
build-linux ────────────┤
compile-windows ────────┤
compile-macos ──────────┘
```

Quality checks and Linux unit tests should start in parallel.

## 5. Quality and style checking

The project already has a root `.clang-format`. CI should use that file as the authoritative C++ formatting configuration.

### 5.1 C++ formatting

Pin one clang-format major version in CI. Do not use an unpinned `latest`, because formatting output can change between versions.

Recommended check:

```bash
git diff --name-only --diff-filter=ACMRT "$BASE_SHA" "$HEAD_SHA" \
  | grep -E '\.(c|cc|cpp|cxx|h|hh|hpp|hxx|mm)$' \
  | xargs -r clang-format --dry-run --Werror
```

For pushes where a pull-request base SHA is unavailable, compare against the previous commit or check the new multiACE directories directly.

Initial policy:

- enforce formatting on files changed by the pull request;
- enforce formatting on all newly introduced multiACE files;
- avoid failing a feature PR for unrelated legacy formatting debt.

A separate scheduled cleanup workflow may check the entire repository without being a required merge gate.

### 5.2 Static type and semantic checking

C++ does not have a separate type checker comparable to TypeScript. Compiler builds and clang-tidy provide the type and semantic checks.

Add a root `.clang-tidy` with a conservative initial set such as:

```yaml
Checks: >-
  clang-analyzer-*,
  bugprone-*,
  performance-*,
  portability-*,
  modernize-use-nullptr,
  modernize-use-override,
  readability-container-size-empty
WarningsAsErrors: ''
HeaderFilterRegex: '^(src/libslic3r|src/slic3r/GUI/multiace)/'
FormatStyle: file
```

Start by running clang-tidy only on changed files and new multiACE modules:

```text
src/libslic3r/FilamentRoutingPlan.*
src/libslic3r/FilamentPlacementOptimizer.*
src/slic3r/GUI/multiace/*
```

Once the baseline is clean, promote selected checks to errors for those directories.

Do not enable `WarningsAsErrors: '*'` repository-wide immediately; inherited Orca code may contain existing warnings unrelated to this work.

### 5.3 Compiler warning policy

Use strict warnings for new modules:

```text
GCC/Clang:
-Wall -Wextra -Wpedantic -Wconversion -Wshadow

MSVC:
/W4
```

Apply `-Werror` or `/WX` only to the new source-routing library target initially. Avoid converting all legacy warnings into merge blockers in one change.

If no separate library target exists, use source-specific CMake properties or a dedicated object library for the new domain logic.

### 5.4 CMake validation

Run at least:

```bash
cmake -S . -B build-config-check \
  -DBUILD_TESTS=ON \
  -DSLIC3R_SENTRY=OFF
cmake --build build-config-check --target help
```

Add `cmake-lint` or `cmake-format --check` only after introducing and committing a shared configuration file. Do not enforce an unconfigured formatter across existing CMake files.

### 5.5 GitHub Actions validation

Run `actionlint` against all workflow files:

```bash
actionlint .github/workflows/*.yml
```

This catches invalid expressions, missing inputs, shell mismatches, and workflow syntax problems before workflows reach the default branch.

Pin the actionlint version or download a checksum-verified release.

### 5.6 YAML, JSON, and Markdown

Recommended checks:

```text
yamllint     workflow and configuration YAML
jq           parse all JSON test fixtures
markdownlint documentation added by this feature
```

Use repository-local configuration files:

```text
.yamllint.yml
.markdownlint.json
```

Keep rules practical. Line-length checks should not reject long code paths, URLs, JSON fixtures, or generated tables.

### 5.7 Whitespace and repository hygiene

Check:

- trailing whitespace;
- missing newline at end of file;
- accidental large files;
- merge conflict markers;
- invalid UTF-8;
- executable bits on scripts;
- generated build outputs committed by mistake.

This can be implemented through a small script such as:

```text
scripts/ci/check_repository_hygiene.py
```

or through a pinned pre-commit configuration shared by local development and CI.

## 6. Automated unit and integration tests

The repository already supports:

```text
BUILD_TESTS=ON
Catch2
CTest
tests/libslic3r
tests/fff_print
```

The CI test workflow should build and run the test targets documented in `doc/multiace_testing_strategy.md`.

### 6.1 Linux test build

Use Linux as the primary full-test platform because it is the most economical runner for frequent tests.

Conceptual commands:

```bash
cmake -S . -B build-tests \
  -DBUILD_TESTS=ON \
  -DSLIC3R_SENTRY=OFF \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo

cmake --build build-tests \
  --target libslic3r_tests fff_print_tests \
  --parallel
```

Run unit tests first:

```bash
build-tests/tests/libslic3r/libslic3r_tests \
  "[multiace][unit],[multiace][parser],[multiace][routing],[multiace][optimizer],[multiace][timing],[multiace][persistence]"
```

Run integration and G-code tests separately:

```bash
build-tests/tests/fff_print/fff_print_tests \
  "[multiace][integration],[multiace][gcode],[multiace][contract]"
```

Alternatively, assign CTest labels and use:

```bash
ctest --test-dir build-tests \
  --output-on-failure \
  -L 'multiace|unit'
```

### 6.2 Test reporting

Generate JUnit output where supported:

```bash
ctest --test-dir build-tests \
  --output-on-failure \
  --output-junit test-results/ctest.xml
```

Upload on every run:

```text
CTest XML/JUnit report
failed-test logs
G-code golden-test diffs
optimizer diagnostic fixture
crash dumps when present
```

Keep failure artifacts for approximately 14 days and successful build artifacts for a shorter period unless they are release candidates.

### 6.3 Sanitizers

Run a nightly or scheduled Linux job with:

```text
AddressSanitizer
UndefinedBehaviorSanitizer
```

ThreadSanitizer should target the source-provider/event code in a separate job because it is slower and may conflict with some third-party libraries.

Sanitizer jobs should not initially block all pull requests, but failures on the default branch must create a visible alert or issue.

### 6.4 Cross-platform test subset

Windows and macOS should at minimum:

- configure successfully;
- compile new multiACE modules;
- compile unit-test targets;
- run parser, serialization, routing-invariant, and optimizer determinism tests.

The full G-code integration suite can remain Linux-only at first, provided platform-independent output is covered by deterministic golden tests.

## 7. Dependency and build caching

Continue using the existing dependency cache model based on:

```text
operating system
deps/** content
```

Enhance cache keys with architecture and toolchain where needed:

```text
${runner.os}-${architecture}-${compiler}-${hashFiles('deps/**')}
```

Add compiler output caching for application/test builds:

```text
ccache on Linux/macOS
sccache or clcache-compatible setup on Windows
```

Build caches must not replace dependency caches. Treat them as separate layers:

```text
dependency cache -> expensive third-party libraries
compiler cache   -> project object files
```

Never share compiler caches between incompatible compilers or dependency revisions.

## 8. Path-aware execution

Use path filters to avoid expensive release-style builds for documentation-only changes.

Suggested categories:

```text
code:
  src/**
  tests/**
  CMakeLists.txt
  cmake/**
  deps/**

workflows:
  .github/workflows/**
  scripts/ci/**

profiles:
  resources/profiles/**

multiace:
  src/libslic3r/Filament*
  src/slic3r/GUI/multiace/**
  tests/**/test_multiace*
```

Policy:

- documentation-only change: quality and Markdown checks;
- workflow-only change: actionlint, YAML, and workflow smoke validation;
- source change: all tests and compile checks;
- dependency change: rebuild dependency caches and all platform compile checks;
- profile change: profile validation plus representative slicing tests.

Avoid skipping all CI for documentation because workflow and Markdown validation still provide value.

## 9. Side-effect-free platform build workflow

Refactor `build_orca.yml` or add `build_platform.yml` so a reusable build never publishes releases or updates nightly assets.

Inputs:

```yaml
on:
  workflow_call:
    inputs:
      os:
        required: true
        type: string
      arch:
        required: false
        type: string
      build_type:
        required: false
        type: string
        default: Release
      run_tests:
        required: false
        type: boolean
        default: true
      package_artifact:
        required: false
        type: boolean
        default: true
      sign_artifact:
        required: false
        type: boolean
        default: false
      version_label:
        required: false
        type: string
```

Outputs:

```text
artifact name
artifact filename
version label
checksum filename
debug-symbol artifact name
```

The reusable workflow may:

- restore/build dependencies;
- compile;
- run selected tests;
- package application artifacts;
- sign only when explicitly enabled and permitted;
- upload workflow artifacts.

It must never:

- create or update a GitHub release;
- deploy nightly assets;
- push tags;
- modify branches;
- use release credentials unless signing was explicitly requested.

## 10. Decouple build, signing, and publication

The current build workflow includes build, packaging, signing, artifact upload, and deployment behavior. Split these responsibilities.

Recommended pipeline:

```text
tests
  ↓
platform build
  ↓
unsigned artifact upload
  ↓
optional signing/notarization
  ↓
signed artifact upload
  ↓
manual approval
  ↓
GitHub draft release publication
```

Benefits:

- pull requests cannot publish releases;
- release artifacts can be rebuilt without publishing;
- unsigned fork builds remain available;
- production credentials are restricted to one protected job;
- failed publication does not require rebuilding every platform.

## 11. Manual selectable platform builds

Create `.github/workflows/release_manual.yml` using `workflow_dispatch`.

Recommended inputs:

```yaml
on:
  workflow_dispatch:
    inputs:
      source_ref:
        description: Branch, tag, or commit SHA to build
        required: true
        default: main
        type: string

      build_linux:
        description: Build Ubuntu 24.04 AppImage
        required: true
        default: true
        type: boolean

      build_windows:
        description: Build Windows installer and portable archive
        required: true
        default: true
        type: boolean

      build_macos:
        description: Build macOS universal DMG
        required: true
        default: true
        type: boolean

      run_full_tests:
        description: Run full test suite before packaging
        required: true
        default: true
        type: boolean

      sign_artifacts:
        description: Sign/notarize supported artifacts
        required: true
        default: false
        type: boolean

      publish_mode:
        description: What to do with successful artifacts
        required: true
        default: artifacts-only
        type: choice
        options:
          - artifacts-only
          - draft-release
          - prerelease
          - production-release

      version_label:
        description: Optional artifact/release version label
        required: false
        type: string
```

Boolean platform inputs provide the clearest GitHub UI and allow any combination of targets.

### Conditional jobs

```yaml
jobs:
  tests:
    if: inputs.run_full_tests

  linux:
    if: inputs.build_linux

  windows:
    if: inputs.build_windows

  macos:
    if: inputs.build_macos
```

Every platform build must depend on successful tests when `run_full_tests` is enabled.

For production publication, full tests must be mandatory regardless of the selected input.

## 12. Release modes

### `artifacts-only`

Build selected platforms and upload workflow artifacts. Do not create a GitHub release.

Use for:

- developer testing;
- QA builds;
- branch snapshots;
- debugging platform-specific failures.

### `draft-release`

Create a draft GitHub release and attach selected artifacts. A maintainer reviews and publishes it manually.

This should be the default publication mode.

### `prerelease`

Create a GitHub prerelease, clearly labeled as experimental or beta.

Require:

- successful full tests;
- selected platform builds successful;
- checksums generated;
- protected environment approval when signing secrets are used.

### `production-release`

Allow only when:

- `source_ref` resolves to an annotated version tag;
- version in `version.inc` matches the tag;
- all mandatory platforms are selected;
- full tests pass;
- signing/notarization succeeds where configured;
- a protected `production-release` environment grants approval.

Do not allow a production release directly from an arbitrary feature branch.

## 13. Platform build outputs

### Linux

Required artifact:

```text
Snapmaker_Orca_Linux_AppImage_Ubuntu2404_<version>.AppImage
```

Also generate:

```text
SHA256 checksum
build metadata JSON
optional debug symbols
```

Optional later artifact:

```text
Flatpak bundle
```

### Windows

Required artifacts:

```text
Snapmaker_Orca_Windows_Installer_<version>.exe
Snapmaker_Orca_Windows_<version>_portable.zip
```

Developer artifact:

```text
Debug_PDB_<version>_for_developers_only.7z
```

Production signing should occur in a protected job if a code-signing certificate is available.

### macOS

Required artifact:

```text
Snapmaker_Orca_Mac_universal_<version>.dmg
```

Developer artifact:

```text
dSYM_Mac_<version>
```

For production:

- sign the application;
- sign the DMG;
- notarize;
- staple the notarization ticket;
- validate with `spctl` and `codesign --verify`.

For branch builds without secrets, produce an unsigned DMG and label it clearly.

## 14. Artifact metadata and reproducibility

Every platform job should produce a metadata file:

```json
{
  "repository": "physicsG/OrcaSlicer",
  "commit": "<full SHA>",
  "source_ref": "<input ref>",
  "version": "<version>",
  "platform": "<platform>",
  "architecture": "<architecture>",
  "build_type": "Release",
  "dependency_cache_key": "<key>",
  "workflow_run": "<run URL>",
  "tests_passed": true,
  "signed": false
}
```

Generate SHA-256 checksums for every distributable artifact:

```bash
sha256sum <artifact> > <artifact>.sha256
```

Use the platform equivalent on Windows when necessary.

Optionally add GitHub artifact attestations for production builds.

## 15. Release publication workflow

The publication job should:

1. download successful platform artifacts;
2. verify checksums;
3. verify expected platform set;
4. verify test conclusion;
5. verify tag/version consistency for production;
6. generate release notes;
7. create a draft, prerelease, or production release;
8. attach artifacts, checksums, and metadata;
9. never overwrite an existing production artifact silently.

Use minimal permissions:

```yaml
permissions:
  contents: write
  attestations: write
  id-token: write
```

Only the publication/attestation job should receive these permissions.

## 16. Security model

### Pull requests

- `contents: read` only;
- no repository write token;
- no signing secrets;
- no deployment secrets;
- no printer credentials;
- no protected environment access;
- fork pull requests run untrusted code without secrets.

### Release jobs

- use GitHub environments such as `release-signing` and `production-release`;
- require maintainer approval;
- restrict allowed branches/tags;
- limit secret scope to the job that needs it;
- pin third-party actions to immutable commit SHAs where practical;
- do not use untrusted pull-request artifacts in privileged release workflows.

### Workflow command safety

Treat `source_ref`, `version_label`, and other manual inputs as untrusted strings:

- quote shell variables;
- validate allowed characters;
- resolve refs through Git rather than interpolating arbitrary shell commands;
- reject paths and labels containing control characters.

## 17. Branch protection and required checks

Configure branch protection for `main` and release branches.

Recommended required status checks:

```text
CI / Quality
CI / Unit tests (Linux)
CI / Integration tests (Linux)
CI / Build Linux
CI / Compile Windows
CI / Compile macOS
CI / Summary
```

Additional settings:

- require pull request reviews;
- require branches to be up to date before merge;
- dismiss stale approvals after new commits;
- block force pushes;
- block deletion;
- require conversation resolution;
- optionally require signed commits for release branches.

Use a final `CI / Summary` job that fails when any required matrix job fails. This provides one stable required check even when the internal matrix evolves.

## 18. Workflow failure behavior

Upload diagnostics on failure:

```text
CMake configure logs
compiler logs
CTest output
JUnit XML
clang-tidy output
clang-format failure list
G-code golden-test diff
packaging logs
signing/notarization logs with secrets redacted
```

Use `if: failure()` for diagnostic uploads.

Do not hide failures with `continue-on-error` for required jobs.

Allowed non-blocking jobs initially:

```text
full-repository clang-tidy
sanitizer nightly
optimizer performance trend
optional Flatpak build
hardware-in-the-loop tests
```

## 19. Performance budgets

Target warm-cache pull-request times:

```text
quality checks:          < 5 minutes
unit tests:              < 10 minutes
integration tests:       < 15 minutes
Linux compile/package:   < 25 minutes
Windows compile:         < 35 minutes
macOS compile:           < 35 minutes
```

Jobs should run in parallel so wall-clock time is determined by the slowest platform rather than the sum.

Track optimizer performance as a benchmark artifact, but do not make noisy microbenchmarks a merge blocker until a stable baseline exists.

## 20. Scheduled workflows

Add a nightly workflow for broader assurance:

```text
all repository tests
all multiACE tests
ASan/UBSan
selected ThreadSanitizer tests
full clang-tidy on new modules
fuzz corpus smoke tests
optimizer performance benchmark
all-platform build
profile validation
```

Use weekly rather than nightly cadence for the most expensive jobs if runner cost becomes significant.

Nightly jobs should create an issue or notification only for regressions on the default branch, not for transient failures from outdated feature branches.

## 21. Local developer parity

Add scripts that run the same checks locally:

```text
scripts/ci/format_check.sh
scripts/ci/static_analysis.sh
scripts/ci/configure_tests.sh
scripts/ci/run_multiace_tests.sh
scripts/ci/package_platform.sh
```

The GitHub Actions workflows should call these scripts rather than duplicating long shell fragments in YAML.

Benefits:

- developers reproduce CI failures locally;
- workflow YAML remains small;
- build logic is versioned and testable;
- moving to another CI provider remains possible.

Example local command:

```bash
./scripts/ci/run_multiace_tests.sh --build-dir build-tests --configuration RelWithDebInfo
```

## 22. Recommended implementation sequence

### Phase 1: Automated tests

1. Add `ci.yml` for pull requests and pushes.
2. Add Linux `BUILD_TESTS=ON` job.
3. Run existing `libslic3r_tests` and `fff_print_tests`.
4. Upload CTest/JUnit results.
5. Make tests a required branch-protection check.

### Phase 2: Quality checks

1. Add changed-file clang-format validation using the existing `.clang-format`.
2. Add actionlint.
3. Add JSON/YAML/Markdown checks.
4. Introduce a conservative `.clang-tidy` for new multiACE modules.
5. Add strict compiler warnings to the new source-routing target.

### Phase 3: Cross-platform compile validation

1. Reuse existing dependency caching.
2. Add Linux build gate.
3. Add Windows compile gate.
4. Add macOS compile gate.
5. Keep packaging optional for normal pull requests.

### Phase 4: Side-effect-free reusable platform builds

1. Refactor deployment steps out of `build_orca.yml`.
2. Add build/package inputs and outputs.
3. Ensure the reusable build uploads artifacts only.
4. Verify unsigned branch builds on all platforms.

### Phase 5: Manual release dispatcher

1. Add boolean platform inputs.
2. Add artifact-only mode.
3. Add draft-release mode.
4. Add checksums and metadata.
5. Add protected signing jobs.

### Phase 6: Production release automation

1. Validate tag and `version.inc` consistency.
2. Require all mandatory tests and platforms.
3. Add production environment approval.
4. Add signing/notarization verification.
5. Publish immutable release assets.
6. Optionally add artifact attestations.

## 23. Definition of done

The CI/CD implementation is complete when:

1. every source pull request automatically runs quality checks and tests;
2. test failures prevent merge;
3. changed C++ files are checked against the repository `.clang-format`;
4. new multiACE code is compiled with strict warnings and analyzed by clang-tidy;
5. workflow YAML is validated by actionlint;
6. unit and integration test results are visible in the Actions run;
7. Linux, Windows, and macOS compilation is verified;
8. a maintainer can manually select any combination of Linux, Windows, and macOS release builds;
9. artifact-only builds do not require release secrets;
10. signing and publishing require protected approval;
11. production releases can only originate from validated version tags;
12. every distributable artifact includes checksum and build metadata;
13. build workflows never publish or deploy implicitly;
14. CI scripts can be executed locally for reproduction.

## 24. Final recommendation

Implement two separate paths:

```text
Pull request path
  quality -> unit tests -> integration tests -> cross-platform compile checks

Release path
  full tests -> selected platform builds -> optional signing -> protected publication
```

Reuse the repository's existing dependency caches and platform packaging commands, but move deployment out of the reusable builder. This provides fast automatic feedback for development while preserving a controlled, selectable, and auditable release process for Linux, Windows, and macOS.
