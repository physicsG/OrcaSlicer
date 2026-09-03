# multiACE dev tools

Run from a terminal or from VS Code (**Ctrl+Shift+P → Tasks: Run Task**, or
**Ctrl+Shift+B** for the default build task). Everything routes through
`start.sh`, so both paths behave identically.

| command | what it does |
|---|---|
| `./.claude/tools/start.sh status` | regenerate `build-status.html` (here) from live state |
| `… open` | regenerate and open it in a browser |
| `… watch [secs]` | refresh until the build finishes, then report per-log errors |
| `… check <page.html>` | load a page in WebKit and report JS errors |
| `… review [pages]` | re-inject the click-to-annotate overlay into the mockups |
| `… mockups` | open every mockup in a browser |

## The pieces

- **`build_status.py`** renders `build-status.json` into the status page. `--probe`
  first measures what it can: whether a `cmake --build` is running, the binary's
  mtime, and `error:` counts per build log. Edit the JSON to change what the page
  says about a build (features, the "try this" checklist, **the checks that were run
  against it**, what is deliberately *not* in it).

  The JSON is **hand-written state about the current build, and it goes stale silently**:
  the probe keeps the binary's age and the error counts honest, but the branch, the
  summary and the feature list are whatever was last typed. It once described a
  three-week-old segfault fix on another branch while reporting a fresh binary, which is
  the worst of both. Rewrite it when the work changes, not only when a build starts.

  `checks` is new and is the one thing the page exists to carry: what was actually run
  against this binary. There was a `tests` key before it that nothing rendered, so the
  numbers were being written and dropped.
- **`pagecheck.c`** loads a page in WebKitGTK, traps the first JS error and evaluates
  a probe expression. Compiled on demand into `bin/` by `start.sh check`. This is
  what catches a blank mockup caused by a stray `ReferenceError` — a failure no
  compiler sees.
- **`review-overlay.js`** + **`inject_review.py`** add click-to-annotate review mode
  to the mockups. One source, injected into every mockup, so they cannot drift.

## Notes

- `.gitignore` excludes `.claude/*` but re-includes this folder and `../skills`, so both
  are tracked. They were lost once when a scratchpad was wiped; that is why — and the
  re-inclusion had **silently stopped working**, which is how this note came to be false
  for weeks. The rule must be `.claude/*`, never `.claude/`: git does not descend into a
  directory it has ignored whole, so a negation inside one never fires and `git add`
  answers "paths are ignored" for a folder the README insists is tracked. Check it with
  `git check-ignore -v .claude/tools/build_status.py`, which should print nothing.
- `bin/` and the generated `build-status.html` are ignored by git; the sources
  and `build-status.json` are tracked.
- The status page is a **snapshot**, not live: a published artifact cannot reach this
  machine. Re-run `status` and reload to refresh.
- `check` needs `libgtk-3-dev` and `libwebkit2gtk-4.1-dev`; it says so if they are
  missing.
- On WSL the openers fall back to `explorer.exe` with a converted path.

## Headless GUI testing

`Xvfb` + `xdotool` + `xshot` let a crash be reproduced and *seen* without the user
touching anything. This is the loop that found the Multimaterial segfault after three
wrong diagnoses from code reading.

    ./start.sh headless        # Xvfb :99, Orca, crash catcher armed
    ./start.sh shot out.png    # screenshot - coordinates map 1:1 to click coordinates
    ./start.sh click X Y       # focus-then-click (the first click is otherwise swallowed)
    ./start.sh trace /tmp/orca_headless_crash.log
    ./start.sh stop

The instance runs against a copy of the real config in `/tmp/orca-headless-datadir`, so it
cannot disturb presets and can run alongside the user's own Orca.

Requires `sudo apt install -y xvfb xdotool` (done 2026-08-08). `xshot.c` writes PNG directly
via zlib so imagemagick is not needed.

## Crash catcher

`crash_catcher.c` is an LD_PRELOAD signal handler: there is no gdb here. It records a
module+offset backtrace, registers, and any readable strings near the top frames;
`start.sh trace` resolves it with addr2line. Release symbols give function names, and the
Debug config (`start.sh run --debug`) gives exact lines.
