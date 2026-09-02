# Print dialog — three designs

Three interactive answers to the same question, at the size the host actually opens
(714 × 750), running on the **real** `sw_GetFileFilamentMapping` reply shape and the
**corrected** send sequence. Open the chooser:

```bash
python3 resources/web/shared/tests/run_webkit.py \
    --size 1500x980 --watch \
    --page web/print_processing/mockups/index.html
```

Or one at a time, in the dialog's own size:

```bash
python3 resources/web/shared/tests/run_webkit.py --size 714x750 --watch \
    --page 'web/print_processing/mockups/option-b.html?scenario=mismatch'
```

`build/resources` is a symlink to `resources/`, so these need no build — edit and reload.

## The three

| | | The bet |
|---|---|---|
| **A** | [Faithful](option-a.html) | The shipped four cards, in the shipped order, carrying the fields the host was already returning. Familiarity is worth more than a better layout for a step most people click through. |
| **B** | [Match sheet](option-b.html) | The mapping *is* the page: file filaments on the left, what is loaded on the right, a wire between them. Showing the destination beats the four-card layout. |
| **C** | [Preflight](option-c.html) | A run of checks that resolve themselves — one line each when fine, open where a decision is needed. Most sends want one glance; the ones that do not want the problem in front of them. |

## Switches

Both are query parameters, on any of the four pages; the chooser drives all three frames
at once so they can be compared in the same state.

| | |
|---|---|
| `?scenario=` | `ready` · `mismatch` · `wrongmodel` · `noprinter` |
| `?mode=` | `print` (Orca's `?path=4`) · `upload` (`?path=5`) |

`mismatch` is the one worth looking at: toolhead 3 is empty, no PETG is loaded, and
toolhead 4 has a 0.2 mm nozzle where the file was sliced for 0.4. The three designs
differ most in what they do about it.

## What they have in common

Everything except the design, deliberately — so a comparison is between designs and not
between fixtures.

- **[`fixture.js`](fixture.js)** is the `sw_GetFileFilamentMapping` reply as
  `SSWCP.cpp:3039` builds it: parallel arrays, the plate thumbnail, per-filament grams
  and length, and the nozzle diameters the file was sliced for. The shipped
  reconstruction reads `mapping.filaments[i]`, which the host has never returned — see
  [04-requirements](../../../../docs/u1-webui/03-print-processing/04-requirements.md).
- **[`shell.js`](shell.js)** holds the send: `sw_GetFileStream` → `fetch` → a multipart
  POST with a real byte count → `sw_StartLocalPrint { type, path }` → the three-command
  close protocol. The progress bar moves on bytes, not on a timer.
- **[`mockup.css`](mockup.css)** is the dialog frame and the primitives more than one
  design draws.

These are **mockups**, not the page: no bridge, no printer, no `window.wx`. Each marks
itself in the corner and hands a `--drive` script `window.__mockup`.

## Checking one

```bash
python3 resources/web/shared/tests/run_webkit.py --size 714x750 \
    --page 'web/print_processing/mockups/option-a.html?scenario=mismatch' \
    --drive resources/web/shared/tests/drive/print-mockups.js
```

Dumps the tree, then asserts the handful of things that would be quietly wrong: the
thumbnail is visible without a click and decoded, there is a way to choose a destination
per filament, Send agrees with the scenario, and an edit reaches the model *and*
repaints. It found two real faults that a screenshot did not — a filament name column
squeezed to 22 px, and a lane that had fallen into the 54 px wire gutter.

## What is deliberately not here

No printer picker, no ACE bays, no live state. The mockups answer *what shape should this
dialog be*; the plumbing is settled and written down.
