# The restructure, pass by pass

The Device page was reconstructed a panel at a time, and it showed: by the end of the
first stretch of work each addition landed in five places - markup in `index.html`,
classes in `device.css`, a renderer somewhere in one shared `ui.js`, a render call plus a
slice of module state in `app.js`, and a click handler in `wireChrome`. Nothing tied the
five together and nothing listed them, so *what is on this page, what does each part
read, and what can each part do* had no answer short of reading all of it.

Seven passes fixed that. Each is a separate commit, each was verified against the real
printer, and each is written up below with what it found - because in almost every case
the structural question found bugs that using the page had not.

## Flutter was weighed first, and rejected

The shipped bundle is Flutter, so the obvious question was whether to join it.

| | |
|---|---|
| **What you would ship** | 36 MB, CanvasKit - 19 MB of WASM/WebGL plus a 5.1 MB `main.dart.js` |
| **The build step** | A Dart/Flutter SDK in a CMake tree that has neither |
| **The working method** | Everything proven here came from *edit → reload → measure on hardware*, because `build/resources` is a symlink and the server sends no cache headers. Flutter puts a compile between every hypothesis and its test, on a loop where one measurement is a 31-second toolchange |
| **The test rig** | CanvasKit paints to a `<canvas>`. There is no DOM. `run_webkit.py`'s findings are DOM assertions and `unit_jsc.py` executes the modules directly - all of it goes |
| **Cross-platform risk** | Orca renders in three engines (WebView2, WKWebView, WebKitGTK). Plain DOM is the common denominator; WASM+WebGL is the fragile one |
| **What it is for** | The reconstruction exists as readable evidence that the protocol docs are right. A compiled Dart bundle is not readable evidence |

The three things Flutter would genuinely buy - composable widgets, a state-management
story, keyed reconciliation - were all reachable without leaving the DOM, and the passes
below are how.

## Where it ended up

```
js/
  registry.js              the two destinations, and which panels each has
  shell.js  app.js  page-commands.js
  core/      dom render pending store session connection overlay diag mock thumbs
  widgets/   rail  rail-commands  trace  art  format
  views/
    device-control/
      camera/    camera-panel.js   camera-view.js   camera-commands.js
      control/   control-panel.js  control-view.js  control-commands.js
      task/      task-panel.js     task-view.js     task-commands.js
      filament/  filament-panel.js filament-view.js filament-commands.js
    storage/
      storage/   storage-panel.js  storage-view.js  storage-commands.js
    fault/       fault-panel.js    fault-view.js    fault-commands.js
```

`app.js` went from 1,579 lines to 383; `index.html` from 143 to 42; `ui.js` from 1,359 to
nothing. Tests went from 140 to 150 conformance checks, 93 to 134 in `unit_jsc`, and 17 to
23 in the browser.

---

### Structure, pass one: the page has an overview now (2026-08-25)

The page had grown a panel at a time and each addition landed in five places — markup in
`index.html`, classes in `device.css`, a renderer in `ui.js`, a render call plus a slice
of module state in `app.js`, and a click handler in `wireChrome()`. Nothing tied the five
together and nothing listed them, so "what is on this page, what does each part read,
what can each part send" had no answer short of reading all of it.

**Flutter was weighed and rejected.** The shipped bundle is 36 MB of CanvasKit — WASM and
WebGL painting to a `<canvas>`. Adopting it would mean a Dart/Flutter SDK build step in a
tree that has neither, an end to *edit → reload → measure on hardware* (which is where
every finding above came from), and the loss of the whole test rig: `run_webkit.py`'s
checks are DOM assertions and `unit_jsc.py` executes the modules directly. Orca renders in
three different engines, and plain DOM is the common denominator, not the fragile one.
The three things Flutter would genuinely buy — composable widgets, a state-management
story, keyed reconciliation — are all reachable without leaving the DOM.

[`device_page/js/panels/registry.js`](../../../resources/web/device_page/js/registry.js)
is now that answer. Every panel declares `id`, `title`, `view`, its header controls, what
it `reads` and what it `sends`, plus `mount`/`update`. `shell.js` builds the page from it;
`index.html` is down to 42 lines of shell and `wireChrome()` to the device menu alone.
Adding a panel is one file plus one line in `PANELS`.

**`reads` and `sends` are the point.** `07-parity.md` called the command surface complete
on the strength of `CMD.NAME` appearing in source, which proves a command is *mentioned* —
not that a control exists to issue it. `check_coverage.py` now asks both questions, and
the second one immediately found what the first could not:

- **`sw_BedMesh_AbortProbeMesh` was reachable by nothing.** `handlers.abortBedMesh` had
  existed since the panel was built, with no call site. It cannot be wired either:
  `bed_mesh` is not in `SUBSCRIBE_OBJECTS` and no activity label mentions probing, so an
  abort button has no state to appear with. The handler is gone and the command is in
  `EXCLUDED` with that reason.
- **`handlers.showFiles` is dead too** — the comment calls it "the one useful action from
  an idle job card" and nothing calls it. It sends no command, so coverage cannot see it;
  it is the next pass's job.
- Seven more were reachable but undeclared, and writing the declaration is what surfaced
  them: the Control header's Refresh re-reads four objects that are not the Control panel's,
  and the storage card's details dialog reaches `GetFileListPage`, `MachineFilesThumbnails`
  and `DownloadMachineFile`.
- Declaring `sends` also caught a claim that was simply false: storage listed
  `DELETE_MACHINE_FILE`, which no code issues.

**Verified behaviour-preserving, not asserted.** A drive script dumps every element's tag,
id, classes and `data-*` across both destinations and the trip back; run against a
worktree at the previous commit and against this one, the two dumps are 949 lines each and
differ only by the `id` the shell puts on the Control panel's body so `paint()` can address
it. All three suites still pass: 140/140 conformance, 93/93 `unit_jsc`, 17/17 `run_webkit`.

**Worth knowing:** `run_webkit.py --shots` has been writing **blank PNGs** all along in
this environment — EGL finds no driver under WSL, so the snapshot surface paints nothing.
The two files compare byte-identical at 8,515 bytes before and after this change. The DOM
assertions are what confirm anything; the images never did.

**What is still ad hoc, and what pass two is for.** Three things, all of them the same
shape — state with no single home:

- **State lives in four places.** `MachineState` (correct), sixteen module-level `let`s in
  `app.js`, two *in the renderer* (`ui.js` holds `activeTool` and `head`, and
  `renderControlMain` reassigns `head` then re-calls itself), and the DOM itself
  (`root.__state`, `dataset.built`, `dataset.sig`, `dataset.pend*`). `ctx` in `app.js` is
  the seam: it exposes the page's state through one door with live getters, so moving it
  into a store is a change to that object and nothing else.
- **Four update disciplines answer one question.** The status card builds once and patches;
  storage guards on a signature and rebuilds; control, task, filament, camera and fault
  clear `innerHTML` on every frame, about once a second. Every focus, scroll and
  popover-anchor bug is downstream of that, and each was fixed by inventing a new guard on
  the spot.
- **The pending-until-confirmed model existed twice and was missing once. It is one
  thing now.** *The request was stored in the thing that mirrors the machine* is written
  up above for tool selection and for temperature, solved two unrelated ways: a
  poll-until-confirmed dialog in `app.js`, DOM datasets and timers in `ui.js`. The LED
  switch had neither — `ui.js` read `root.__state.led.on` for the click and the render
  loop rewrote `aria-checked` from `led.on` every frame, so the mirror won until the
  printer echoed.

  Driven against the machine, toggling the chamber light and putting it back, three runs
  each side:

  | | printer echoed after | switch reverted while waiting |
  |---|---|---|
  | before | 236 / **2029** / 620 ms | **2 of 3** |
  | after | 1219 / 214 / 1024 ms | **0 of 3** |

  Run 1 of the "before" set is why one measurement is not evidence: it echoed in 236 ms,
  before a repaint landed, and looked clean. The trace after the fix shows the mechanism
  working rather than the outcome only — `switch=true machine=false` at 102 ms, the
  request on screen while the mirror still disagrees.

  [`pending.js`](../../../resources/web/shared/js/pending.js) is that one mechanism. A
  request has three ends — confirmed, refused, lost — and the third is the one that
  matters: *an instant `ok` is indistinguishable from success*, so a silently-ignored
  command has to be timed out and reported rather than left looking applied. It touches
  no DOM, so `unit_jsc.py` tests it directly against an injected clock: 12 new checks,
  including that `200` and `"200"` are the same answer (the wire carries either) and that
  a late refusal cannot overwrite what the user has moved on to.

  The click reads *what is shown* rather than what the machine says, so clicking twice
  inside the echo window undoes the first click instead of re-sending it.

- **A throwing panel is no longer silent.** Found the hard way during this pass: `jogWheel`
  still referenced a module variable that had moved, and the whole paint runs inside one
  `requestAnimationFrame` callback — so the page simply stopped having a motion column,
  with nothing in the console. `run_webkit.py`'s 17 checks all passed, because they cover
  the temperature rows and not the wheel. What caught it was the structural DOM dump.
  `paint()` now catches per panel: the one that failed says so on the page and logs once,
  and the others still paint.

- **`ui.js` has no module-level mutable state left.** `activeTool` is the user's choice,
  not the machine's, so it is page state on `ctx`; `head` existed only to survive a
  render function calling itself argument-less, and is read live. `root.__state` — a
  snapshot of six state objects written onto the DOM every frame for the popovers'
  closures to find — is gone with them, since the context is the same idea with one copy
  instead of one per frame.

### Structure, pass two: one pending model, one render discipline (2026-08-25)

Two of the three things the last section left open are done. The third — the sixteen
module-level `let`s in `app.js` — is next; `ctx` is already the door they all go through.

**[`pending.js`](../../../resources/web/shared/js/pending.js).** See the LED table
above for the measurement. Three controls had the same bug and two different fixes
between them; there is one mechanism now, it touches no DOM, and `unit_jsc.py` tests it
directly against an injected clock.

**[`render.js`](../../../resources/web/shared/js/render.js).** Four disciplines
answered *the state changed, what do I do with the DOM* — and they were spelled with four
different attributes, `data-built`, `data-sig`, `data-state` and `data-code`, which is
what made them hard to see as one question:

| panel | was | now |
|---|---|---|
| status card | `data-built` on toolhead count, then patch | `rebuildOn` |
| storage | `data-sig`, rebuild whole, `scrollTop` saved by hand | `rebuildOn` on shape + `keyedList` |
| camera | `data-state`, rebuild whole | `rebuildOn` + patched message |
| fault | `data-code`, rebuild whole | `rebuildOn` |
| task, filament, control | `innerHTML = ''` **every frame** | `rebuildOn` / `keyedList` + patch |

The jog wheel's twenty-four SVG sectors were being thrown away and recreated about once a
second, under whatever the pointer was over. The task card's buttons likewise. Neither is
rebuilt now unless its shape changes.

Three bugs fell out of writing it down, none of them from using the page:

- **The storage guard hashed the item *count*.** A list whose contents changed without
  its length did not repaint — a print going `in_progress` → `completed` kept its old
  badge. `keyedList` reconciles by key and rebuilds a card when its own signature
  changes, so the guard has nothing left to get wrong.
- **A recurring fault never showed again.** The banner compared `data-code` on the way in
  and never cleared it on the way out, so a fault that cleared and came back matched its
  own stale key, took the early return, and stayed hidden while the machine was
  reporting it.
- **`.stor-foot[hidden]` did nothing** — a class rule with `display` outranks the UA
  stylesheet's `[hidden] { display: none }`. This is the second time it has cost an hour;
  `.fault` was the first. Both are now pinned by a conformance check rather than
  re-learned a third time.

And one I introduced in pass one and found by using the page: **`is-active` moved in the
click handler**, which is almost right. Anything that changed the selection without a
click left the wrong tab lit — and the fix below does exactly that. A header belongs to
no renderer, so it now syncs from state on every paint.

**`handlers.showFiles` is live.** The dead handler the reachability check surfaced last
pass: its own comment calls it "the one useful action from an idle job card", and the
card had a *disabled* play button titled "Nothing to start here" instead. Driven against
the simulator: cancel the print, and the card offers one enabled button, "Choose a file
to print", which opens Storage on print files with the right tab lit.

**Verification.** 149/149 conformance, 106/106 `unit_jsc`, 17/17 `run_webkit`, coverage
clean. Against the pass-one DOM dump every difference is bookkeeping — the `key`, `sig`
and `built` attributes the primitives keep, plus a `.stor-foot` that is present and
hidden rather than absent. No content moved.

**A note on what caught what.** `run_webkit.py`'s 17 checks passed while the page had no
motion column at all: they cover the temperature rows, and a `ReferenceError` inside the
single `requestAnimationFrame` callback silently truncated the rest of the paint. The
structural DOM dump is what found it, and `paint()` now catches per panel so the failure
is on the page instead of nowhere. Keep the dump in the loop — it is the only check here
that asks *what is on the page* rather than *is this one thing right*.

### Structure, pass three: the page state has one home (2026-08-25)

The last of the three. What used to be sixteen module-level `let`s in `app.js` is
[`store.js`](../../../resources/web/device_page/js/core/store.js) — one declared object, with a
line of prose on each member saying what it is for. Eleven of the sixteen were written
from more than one place, and a panel reading `cam.error` gave no clue where `cam` was
set.

A panel now gets one `ctx` carrying three stores, and there are three because they answer
three different questions:

| | |
|---|---|
| `ctx.state` | what the **machine** says. A mirror, not a memory |
| `ctx.store` | what the **page** knows — which view, which tab, what it has fetched |
| `ctx.pending` | what has been **asked for** and not yet confirmed |

The third exists separately for the reason this whole restructure keeps running into: a
request stored in the mirror is overwritten by the next push.

Deliberately **not** an observable store. Making every write notify is the obvious next
step, and taking it would mean two ways to ask for a repaint alongside `render()` — one
page with two mechanisms for one job is what this work exists to undo. If explicit
`render()` turns out to be forgotten in practice, a Proxy is a change to `createStore`
and nothing else.

**The rename broke the connect path, and the simulator did not notice.** 112 call sites
moved; the script that moved them protected string literals, which also protected the
`${...}` inside template literals — so `` `${deviceLabel(device)} — not connected` ``
kept a name that no longer existed, `boot()` threw a `ReferenceError`, and the page came
up never connecting to anything.

The reason the browser suite stayed green is worth carrying forward: **that line is on
the not-connected branch, and the simulator's device reports connected**, so the
simulator never executes it. What caught it was `--real`. What would also have caught it
is `--real --device-ip 192.0.2.1`, which forces the same branch with no printer involved
— that flag is worth running on any change that touches the device record, not only when
testing the nothing-there path.

Both are verified now: **26 objects and live telemetry** against the U1, and a clean
`No route to host` down the unroutable path.

### Structure, pass four: the session is its own thing (2026-08-25)

Having a printer on the other end of the bridge — the connect path, whether the machine
is still there, the retry ladder, the heartbeat and the state stream — is 319 lines that
no panel reads, which is exactly why it could leave `app.js`. It is
[`session.js`](../../../resources/web/device_page/js/core/session.js) now, plus a 37-line
`diag.js` for the `?diag=1` beacon.

Dependencies are **injected rather than imported**, because they run the other way: the
session asks the page to repaint and to say things, and a module that imported `app.js`
to do it would be a cycle. It owns four things nothing outside it reads — `engineId`,
`subscription`, `connecting`, `heartbeat` — because a socket, a subscription id and two
timer handles are not state a panel can have an opinion about.

Verified where it matters: **26 objects and live telemetry** against the U1, and down the
unroutable path the retry ladder visibly makes its second attempt on a new client id.
149/149 conformance, 109/109 `unit_jsc`, 17/17 `run_webkit`, DOM unchanged.

Eight conformance checks moved with the code. They grep source text for a decision, so
they name a file — the same repointing pass one needed. Worth noting as a property of
this suite rather than a nuisance: it pins *decisions* to *places*, so moving a decision
is meant to be a visible edit.

### Structure, pass five: a panel is handed its own commands and nothing else (2026-08-25)

The last undifferentiated thing was `handlers` — 43 functions, 687 lines, one flat bag
given whole to every renderer. It is `js/commands/<panel>.js` now, one module per panel
plus `page.js` for the two things every panel shares and `device.js` for the rail's menu,
which is about Orca rather than about the printer and so has no panel to belong to.

`shell.js` gives each panel `commandsFor(id)` — its own module merged with the page-level
one — through a prototype-delegating context, so `state`, `store` and `pending` stay one
live object and only the commands differ. **Reaching for another panel's command is now a
`TypeError`.**

**The tooling checks facts instead of promises.** The `sends` array each panel used to
declare is gone. `check_coverage.py` reads the `CMD.` references out of the module a
panel is *actually handed*, so referencing a command is the only way to claim one:

```
camera      2   control     9   device     13   fault    1
filament    1   page        5   storage    12   task     4     elsewhere 29
```

Two things fell out of that:

- **`OWNED_ELSEWHERE` halved.** Fifteen of its entries said "rail device menu", which was
  true and hand-written; `commands/device.js` says the same thing by *being* the module
  that menu is handed.
- **A new check asks the question directly**: is every handler a panel is given actually
  called? `check_coverage` found `abortBedMesh` because it named a command; `showFiles`
  named none, so nothing could. Verified by planting a dead handler — it fails and names
  it.

**Two failures worth recording.** The page came up blank at first: `session` is built
before the command modules and holds a reference to the merged bag, so the `const` for it
was in its temporal dead zone. And a parse check over every module reported nine
"failures" that were all artefacts of the stripper — worth knowing that a green parse
sweep is not a green *load*, because what actually broke was resolution and ordering, not
syntax.

**Verified.** 150/150 conformance, 109/109 `unit_jsc`, 17/17 `run_webkit`, coverage
clean, DOM unchanged, and against the U1: 26 objects with live telemetry, and the chamber
light echoing at 1853 ms and 812 ms with **no revert** — the pending model still holding
at nearly two seconds.

**Where this leaves the page.** `app.js` is **375 lines** — startup, `send`/`setpoint`,
the render loop and the device menu — down from 1,595. The largest file is `ui.js` at
1,359, and it is the obvious next thing: it is still one module rendering six panels, and
each panel's renderer wants to move into the panel module that already owns everything
else about it. That is a move rather than a design decision, which is why it can wait.

### Three reported from the running page (2026-08-25)

**The Filament panel showed ten slots where there are four**, cycling 3-4-1-2. That one
was mine, from the render pass: `keyedList` dropped a node whose signature had changed
out of the leftovers map *and* replaced it, so the sweep at the end could no longer see
it and it stayed in the DOM. One leaked node per content change per repaint. Driven
against a real DOM:

```
before   4 -> 5 -> 7 -> 11 -> 13    [a3 b3 c3 d3 a2 b1 c2 d1 a2 c1 a1]
after    4 -> 4 -> 4 ->  4 ->  3
```

The interleaving is exactly the reported 3-4-1-2. Five checks in `run_webkit.py` cover it
now; four of them fail without the fix.

**The Storage panel was showing on the Device control page.** `#view-storage` sets
`display: flex`, an id rule, which outranks the UA stylesheet's `[hidden]{display:none}` -
so setting `.hidden` did nothing and it computed to `display: flex` at 588x72, the
Storage header bar sitting under Filament. `#view-control` had opted back in and this
never had.

**Third time for that trap**, and the reason it got through is instructive: the
conformance check pinned `.fault` and `.stor-foot` *by name*. It derives the set now, and
`run_webkit.py` asks the running page the stronger version - **every element carrying
`[hidden]` must compute to `display: none`**, whatever the reason. Verified by removing
the opt-out again: both checks fail and name `#view-storage`.

**A latent one the printer's own data exposed.** The real signatures read
`1:PLA:null:Jayo:F44336FF:[object Object]` - `f.tag` is the RFID record, an object, so
every tagged spool signed identically and swapping one for another would not have rebuilt
the card. The signature carries only what the card draws now: that a tag exists.

Not reproduced, and recorded rather than claimed: one run reported 39 storage cards built
inside the hidden container. Three later runs report zero and a MutationObserver never
fires. The likely cause is an orphaned `WebKitWebProcess` from an earlier scripted run
that had clicked into Storage - the trap already documented above - but it was seen once.

### Structure, pass six: one panel, one directory (2026-08-25)

The last of it. `ui.js` was still one 1,359-line module rendering all six panels, so
changing the Camera panel meant three files in three places and hunting among six
renderers in the third. It decomposed cleanly along panel lines - nothing unclassified:

```
js/
  registry.js              the two destinations, and which panels each has
  shell.js  app.js  page-commands.js
  core/      dom render pending store session connection overlay diag mock thumbs
  widgets/   rail  rail-commands  trace  art  format
  views/
    device-control/        "Device control"
      camera/    camera-panel.js   camera-view.js   camera-commands.js
      control/   control-panel.js  control-view.js  control-commands.js
      task/      ...
      filament/  ...
    storage/
      storage/   storage-panel.js  storage-view.js  storage-commands.js
    fault/       fault-panel.js    fault-view.js    fault-commands.js
```

**Every filename carries its component.** Six files called `panel.js` in a file switcher
is not a structure, it is a lottery; `camera-panel.js` is unambiguous everywhere.

`temps()` fell out as dead - defined, exported by nothing, called by nothing. Four
helpers were genuinely shared and moved to `widgets/`: the two pieces of empty-state art,
and `clock()`. Everything else belonged to exactly one panel.

**The move was mechanical and checked as such.** Imports were rewritten by resolving each
specifier against the file's *old* directory and re-relativising to its new one, then a
sweep confirmed all 55 + 19 specifiers resolve **and** that every named import is actually
exported. The rendered DOM is byte-identical across both the move and the rename.

**Two checks had quietly stopped covering things**, both for the same reason - a flat
`os.listdir` where the tree is now nested:

- `unit_jsc.py`'s per-module parse sweep went from 2 modules to **37** once it walked.
  It had been checking almost nothing.
- `check_coverage.py`'s implemented-command scan reported **17** commands where there
  are 55.

Neither failed; both under-reported, which is worse. Any tool that enumerates this tree
walks it now.

**Verified.** 150/150 conformance, 134/134 `unit_jsc`, 23/23 `run_webkit`, coverage
clean, DOM unchanged, and 5/5 against the U1.
