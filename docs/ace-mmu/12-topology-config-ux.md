# 12 · Where multiACE topology is configured — UX options

> Branch: `feat/ace-mmu-slicing`. Problem statement, options, and a recommendation for
> how the U1's multiACE topology (which head is fed by what) should be configured, and
> how to stop configuring it in three places.

## 1. What is wrong today

Printer settings → Multimaterial asks for two raw numbers per toolhead:

| field | value | what it actually means |
|---|---|---|
| multiACE slots on this head | `1` | **not** "one slot" — it means *no ACE, stock feeder* |
| | `4` | fed by an ACE with 4 slots |
| multiACE unit feeding this head | `0` | which **ACE unit** feeds it, 0-based |

Three concrete defects, all of which bit us in practice:

1. **`1` is a magic value.** It reads as a quantity but is really a mode switch
   (feeder vs ACE). Nothing in the UI says so.
2. **0-based unit vs 1-based label.** Every other surface calls the first unit
   **"ACE 1"**, while the setting demands `0`. So the UI that shows you the answer
   disagrees with the field that wants it. (This is what led to entering `1` for a head
   wired to the first ACE.)
3. **The "unit" field appears on heads with no ACE**, where it is meaningless — which
   is precisely why the wrong field was the obvious one to reach for.

## 2. The deeper problem: three places hold the same truth

| surface | what it holds | authority |
|---|---|---|
| multiACE's own web page (on the printer) | mode, per-head feeder/ACE/manual, unit wiring — **persisted** by `ACE_SET_HEAD_ACE`, `ACE_SET_HEAD_FEEDER`, `ACE_SET_HEAD_MANUAL`, `SET_ACE_MODE` | **authoritative** — it is the machine |
| Orca "U1 + multiACE" device page | live view of the same state (`/multiace/api/state`: `mode`, `ace_head`, `head_ace`, `head_feeder`, slots) | mirror |
| Orca Printer settings | `ace_head_capacity`, `ace_head_unit` | **duplicate, hand-entered** |

The printer already knows its topology and reports it. Asking the user to retype it in
Orca creates a second truth that can silently disagree — and a disagreement here does
not fail loudly, it emits `ACE=` pointing at the wrong hardware.

**Principle: one authoring surface, and it should be the machine. Orca's copy is a
cache so that slicing works offline.**

### Vocabulary (settled)

**multiACE** is the *layer* that drives the units, so it names the group and nothing
else. A toolhead is fed by **an ACE unit** — *ACE 1*, *ACE 2* — which may be an ACE Pro,
an ACE 2 Pro, and so on. Slots belong to a unit. Applied to the settings mockup and to
the assignment dialog, whose trays now read **`ACE 1 → T4`**.

## 3. Options

### A. Sync from printer (cache, don't author)
Add a **Sync from printer** button to the Multimaterial group. It queries
`/multiace/api/state` and fills every head's capacity/unit from `head_ace`,
`head_feeder` and each unit's slot count. Fields stay editable for offline use, plus a
status line: *"Matches printer · synced 2 min ago"* or *"Differs from printer — head 4:
unit 1, printer says 0 · [Use printer's]"*.

- **+** Kills the duplicate-truth failure mode; the common case becomes one click.
- **+** Works offline (values persist in the preset).
- **−** Still shows raw numbers if the user opens the fields.

### B. Read-only, derived
No editable fields. Orca fetches topology at connect/slice time and displays it.

- **+** Impossible to disagree with the machine.
- **−** Breaks slicing when the printer is unreachable, and blocks planning for a
  machine you are preparing offline. Rejected for that reason.

### C. Say what it means (fix the vocabulary)
Replace the two numbers with, per toolhead, one **"Fed by"** control:

```
Toolhead 4    Fed by  [ multiACE A1 ▾ ]   Slots [ 4 ▾ ]
Toolhead 1    Fed by  [ Stock feeder ▾ ]
```

- `Fed by` = *Stock feeder* | *ACE 1* | *ACE 2* … naming the **ACE unit** (the
  hardware — an ACE Pro, ACE 2 Pro, …), with its model shown when the printer reports
  it. Labels are **1-based**, matching every other surface; stored 0-based.
- `Slots` only appears when fed by an ACE — no meaningless field on feeder heads.
- "Stock feeder" replaces the magic `1`.

- **+** Removes all three defects above with no new concepts.
- **−** Needs a small enum/choice UI rather than two spin fields.

### D. Configure on the device page, sync down
Make the "U1 + multiACE" page the single Orca-side editor: it already draws the
topology, so let it *write* it — to the printer (via the persisted `ACE_SET_HEAD_*`
macros) **and** into the active printer preset. Printer settings then shows a
read-only summary plus *"Configure on the U1 + multiACE page →"*.

- **+** One editor, and it is the one that looks like the machine.
- **+** Editing in Orca actually reconfigures the printer, instead of quietly
  disagreeing with it.
- **−** Largest change; needs write paths and a confirmation step, since it mutates
  persisted printer state.

## 4. Recommendation

**C + A now, D next.**

1. **C** fixes the vocabulary — the biggest win for the smallest change, and it makes
   the numbering consistent with every other surface (A1, not 0).
2. **A** makes the machine the source of truth in one click, and surfaces divergence
   instead of letting it become a bad `ACE=`.
3. **D** later folds authoring into the device page, leaving Printer settings as a
   read-only summary. At that point Orca's preset is purely a cache, and the printer's
   own page and Orca can no longer disagree.

Also worth doing regardless: when a plan is computed, **validate the preset against the
live state** and warn on mismatch ("head 4 is configured as ACE unit 2 but the printer
reports unit 0") — cheap, and it catches exactly the error class that produced a wrong
`ACE=` argument.

## 5. Status

| step | state |
|---|---|
| Per-toolhead grouping on the Multimaterial page | done |
| C — "Fed by" vocabulary, 1-based unit labels, slots only when ACE | **mockup** (`multimaterial-config-mockup.html`) |
| A — Sync from printer + divergence status | mockup |
| Preset-vs-live validation warning at slice time | not started |
| D — authoring on the device page | not started |
