/*
 * The source picker: send a filament to another bay, or to another toolhead.
 *
 * The second one is the thing the planner will never choose on its own - putting a second
 * colour on an ACE-fed head makes the changer swap mid-print, which costs time and purge a
 * free plan does not - so it exists only as something the operator asks for. This drives
 * exactly that: two colours onto one ACE head, and a toolhead left with nothing on it.
 *
 * Sets __report on every path; a drive script that throws leaves the harness waiting.
 */
(async () => {
  const out = [];
  const ok = (c, m) => out.push((c ? 'PASS ' : 'FAIL ') + m);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));

  try {
    const P = window.__preprint;
    ok(!!P, 'the page exposed itself');
    const model = () => (P ? P.model : {});
    const plan = () => model().plan;
    const headOf = (f) => (plan().heads.find((h) => h.run.some((r) => r.filament === f)) || {}).head;

    ok(!!plan(), 'the plate carries a plan');
    const aceHead = plan().heads.find((h) => !h.feeder);
    ok(!!aceHead, 'one head is ACE-fed');
    const before = { swaps: plan().swaps, onAce: aceHead.run.length };

    /* Every chip is a control, including the ones on stock feeders - a filament can always
       be sent somewhere, and a feeder chip is how it gets onto the ACE. */
    ok($$('.g-chip.is-pick').length === $$('.g-chip').length,
       'every chip opens the picker, ' + $$('.g-chip.is-pick').length + ' of ' + $$('.g-chip').length);

    /* Take a filament off a stock feeder and put it on the ACE head. */
    const feeder = plan().heads.find((h) => h.feeder && h.run.length);
    ok(!!feeder, 'a stock feeder has something to move');
    const moving = feeder.run[0].filament;
    const chip = $$(`.g-chip[data-fil="${moving}"]`)[0];
    ok(!!chip, 'its chip is on screen');
    chip.click();
    await settle(150);

    const rows = $$('.menu .menu-item');
    ok(rows.length > 0, 'the picker opened, ' + rows.length + ' rows');
    /* Match the row's NAME element, not its whole text: the parts are concatenated with no
       separator, so `Toolhead 4` runs straight into `ACE, 4 here` and a \b never matches. */
    const nameOf = (r) => ((r.querySelector('.menu-col b') || {}).textContent || '').trim();
    const target = rows.find((r) => nameOf(r) === `Toolhead ${aceHead.head + 1}`);
    ok(!!target, 'the ACE toolhead is offered');
    ok(/re-export/i.test(target.textContent), 'and it says what moving there costs');
    target.click();
    await settle();

    ok(headOf(moving) === aceHead.head, 'the filament moved to the ACE head');
    const after = plan().heads.find((h) => !h.feeder);
    ok(after.run.length === before.onAce + 1,
       'the ACE head now runs ' + after.run.length + ', was ' + before.onAce);
    /* Not the swap count: it depends on the plate's tool order, which the simulator does
       not carry, so it leaves the number alone rather than invent one. Orca recomputes it
       exactly - measured there, forcing a second colour onto the ACE took a 0-swap plate
       to 1. What is checked here is the arrangement, which the simulator does know. */
    ok(/toolhead/i.test((P.said || []).join(' ')), 'the page said what it did: '
       + (P.said || []).slice(-1)[0]);
    /* The bays it named are real addresses, not first-use numbering left over. */
    const addrs = after.run.map((r) => r.slot);
    ok(new Set(addrs).size === addrs.length, 'each filament on it has its own bay: ' + addrs.join(','));

    /* And a toolhead can be left with nothing on it, which is the other half of the ask. */
    const emptied = plan().heads.filter((h) => h.feeder && !h.run.length).length;
    ok(emptied >= 1, 'a toolhead is left with nothing on it, ' + emptied);

    /* The other direction, and the one an operator reaches for first: the ACE head shows
       the bays of its unit that the plan does not use, and filling one is how a second
       colour gets behind the changer. */
    const aceBox = $$('.g-head')[plan().heads.findIndex((h) => !h.feeder)];
    const ghosts = [...aceBox.querySelectorAll('.g-chip.is-ghost')];
    ok(ghosts.length > 0, 'the ACE head shows its unused bays, ' + ghosts.length);
    ok(ghosts.every((g) => /^A[1-4]$/.test((g.querySelector('.g-from') || {}).textContent || '')),
       'each is addressed: ' + ghosts.map((g) => g.querySelector('.g-from').textContent).join(','));
    const fillable = ghosts.find((g) => g.classList.contains('is-pick'));
    ok(!!fillable, 'a bay with a spool in it can be filled');
    if (fillable) {
      const addr = fillable.querySelector('.g-from').textContent.trim();
      const onAceBefore = plan().heads.find((h) => !h.feeder).run.length;
      fillable.click(); await settle(150);
      const rows2 = $$('.menu .menu-item');
      ok(rows2.length > 0, 'it offers filaments, ' + rows2.length);
      ok(rows2.every((r) => /re-export|menu-warn/.test(r.innerHTML)), 'each priced or refused');
      rows2.find((r) => r.getAttribute('aria-disabled') !== 'true').click();
      await settle();
      const after2 = plan().heads.find((h) => !h.feeder);
      ok(after2.run.length === onAceBefore + 1,
         'the ACE head gained one, now ' + after2.run.length);
      const slot = 'A' + (Math.max(...after2.run.map((r) => r.slot)) + 1);
      out.push('INFO filled ' + addr + '; head now holds bays '
               + after2.run.map((r) => 'A' + (r.slot + 1)).sort().join(','));
    }

    /* Capacity refuses rather than overflows: a stock feeder holds one spool. */
    const full = plan().heads.find((h) => h.feeder && h.run.length);
    const other = plan().heads.find((h) => h.feeder && h.run.length && h !== full);
    if (full && other) {
      const f2 = other.run[0].filament;
      const c2 = $$(`.g-chip[data-fil="${f2}"]`)[0];
      c2.click(); await settle(150);
      const row = $$('.menu .menu-item').find(
        (r) => ((r.querySelector('.menu-col b') || {}).textContent || '').trim()
               === `Toolhead ${full.head + 1}`);
      /* The MENU refuses it, not the host: a stock feeder holds one spool, so the row is
         disabled and cannot be chosen at all. Reading the status line here was wrong - a
         disabled row fires nothing, so the line still said what the previous move did. */
      ok(!!row, 'the full toolhead is still listed');
      ok(row && row.getAttribute('aria-disabled') === 'true',
         'and an occupied stock feeder is refused in the menu, not after pressing it');
      ok(row && /already has a filament/.test(row.getAttribute('title') || ''),
         'with the reason on it: ' + (row ? row.getAttribute('title') : '-'));
    }
  } catch (e) {
    out.push('FAIL threw: ' + (e && e.stack || e));
  }

  const total = out.filter((l) => !l.startsWith('INFO')).length;
  window.__report = out.join('\n') + '\n'
    + out.filter((l) => l.startsWith('PASS')).length + '/' + total + ' checks passed';
})();
