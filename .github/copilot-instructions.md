# Snapmaker Orca — Copilot Instructions

## Repository
Snapmaker Orca is a C++17 desktop 3D-slicer forked from OrcaSlicer/BambuStudio.
Build system: CMake (see `CLAUDE.md` and `AGENTS.md` for build commands, code
style, and commit conventions).

## Active feature branch: `feat/add-ace-mmu-support`
An ACE Multi-Material provider is being implemented on this branch.

**Before working on any file matched by the patterns below, read:**
- `.github/instructions/ace-mmu.instructions.md` — full playbook (what to build,
  where the info is, workflow, guardrails, how to store progress).
- `docs/ace-mmu/PROGRESS.md` — current phase, decisions log, blockers, session
  log. **Always sync here first; always update here before ending a session.**

The design docs are in `docs/ace-mmu/` (README + files 01–07).
