# multiACE on the Snapmaker U1 — design docs

Design and research notes for running one or more Anycubic **ACE Pro / ACE 2 Pro**
filament changers on a **Snapmaker U1** from this slicer, via the printer-side
[multiACE](https://github.com/decay71/multiACE) service.

Each document is written against **verified reality** — read from the running app, the
live printer at its REST endpoint, or the firmware's own macro help — rather than from
the code alone. Where something is unverified, it says so.

## Start here

**[NEXT.md](NEXT.md)** — what has been decided, what is still open, the shipping order,
and the traps on this branch. Read it before touching anything.

## Documents

| # | Document | Contents |
|---|----------|----------|
| 15 | [15-printer-panel.md](15-printer-panel.md) | **The U1 printer panel** in Prepare/Preview: the five defects, the reference shape applied to four heads, the ACE mode switch, two defects it uncovered, and the shipping order |
| 16 | [16-ace-visuals.md](16-ace-visuals.md) | **The ACE visual standard**: one way to draw an ACE, taken from Orca's own AMS widget geometry — badge, glyph, spool box, moisture pill |
| 17 | [17-plate-template.md](17-plate-template.md) | **The U1 plate template**: the measured silhouette, the emphasised path the app draws, and when a plate is photographed rather than drawn |

## Mockups

Self-contained HTML, interactive. Open directly, or all at once with
`./.claude/tools/start.sh mockups`.

| Mockup | For |
|--------|-----|
| [printer-panel-mockup.html](printer-panel-mockup.html) | [15](15-printer-panel.md) — the panel, every machine state, the sync flow and the assign popover |
| [ace-visual-standard.html](ace-visual-standard.html) | [16](16-ace-visuals.md) — the badge, its outlined and square twins, the spool box, the moisture pill |
| [plate-thumbnails-options.html](plate-thumbnails-options.html) | [17](17-plate-template.md) — the four plates in the card, the silhouette options that were weighed, and the advanced-mode ones noted |

Each mockup is the specification the code is built against: when the two disagree, the
mockup is updated in the same commit, not left to drift.

## Status

**Design only. No code has landed on this branch.** Every implementation step is listed in
[NEXT.md](NEXT.md).

## Numbering

Documents are numbered in the order they were written, not in reading order — the number
is a stable handle for cross-references. **15 and 16 are the first of this set to land on
`develop/add-multiace-support`**; documents 01–14 cover the provider, data model,
slicing, planner and dialogs, and arrive with the PRs that implement them.

## Conventions

- **Measure, don't infer.** Three crashes in this feature were misdiagnosed from reading
  code; each was settled in one run with `.claude/tools/start.sh` (headless X, crash
  catcher, `THROW_LOG=1`). GUI claims are made from screenshots, printer claims from the
  printer.
- **Status vocabulary:** *done* = observed working end to end · *built* = written and
  compiles, not yet observed · *gap* = not written.
- **Say what is not known.** A doc that hides an unverified assumption costs more than
  one that names it.
