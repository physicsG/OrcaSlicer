/*
 * The free fix: re-address the bays, send, and never re-slice.
 *
 * Drives `?plan=bayswap` - every spool the plate wants is in the ACE and two of them are in
 * each other's bay. That is the state a plan chosen at slicing time lands in most often,
 * because the bays were addressed before anybody could see the machine.
 *
 * What it proves: the panel refuses first, offers the fix only because it would clear EVERY
 * bay, and after one click the verdict is clean and Send opens - with the swap count
 * unchanged, which is the evidence that addressing is not a cost.
 *
 * Sets __report on every path; a drive script that throws leaves the harness waiting.
 */
(async () => {
  const out = [];
  const ok = (c, m) => out.push((c ? 'PASS ' : 'FAIL ') + m);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const txt = (s) => (($(s) || {}).textContent || '').trim();
  const settle = async (ms = 900) => new Promise((r) => setTimeout(r, ms));

  try {
    const P = window.__preprint;
    ok(!!P, 'the page exposed itself');
    const model = () => (P ? P.model : {});   // a getter on __preprint, not a call

    ok(!!model().plan, 'the plate carries a plan');
    ok(model().check.differs === 2, 'two bays differ, got ' + model().check.differs);
    ok($$('.g-chip.is-bad').length === 2, 'and two chips are marked');
    ok($('#send').disabled === true, 'Send is refused while they do');

    const fix = $('.g-fix');
    ok(fix && !fix.hidden, 'the free fix is offered');
    ok(/in other bays/.test(txt('.g-fix')), 'and says why it is free: ' + txt('.g-fix').slice(0, 52));
    const btn = $('.g-fixbtn');
    ok(!!btn && !btn.disabled, 'its button is live');

    const swapsBefore = model().plan.swaps;
    const purgeBefore = model().plan.purgeG;
    btn.click();
    await settle();

    ok(model().check.differs === 0, 'after one click nothing differs, got ' + model().check.differs);
    ok($$('.g-chip.is-bad').length === 0, 'no chip is marked any more');
    ok($('#send').disabled === false, 'and Send opens');
    ok($('.g-fix').hidden, 'the offer withdraws once it is taken');
    /* The point of the whole exercise: which bay a head presents does not change how often
       it has to present a different one. A fix that moved the swap count would be a re-plan
       wearing a cheap coat. */
    ok(model().plan.swaps === swapsBefore,
       'the swap count is untouched: ' + swapsBefore + ' -> ' + model().plan.swaps);
    ok(model().plan.purgeG === purgeBefore, 'and so is the purge');
    ok(/re-addressed/i.test((P.said || []).join(' ')), 'the page said what it did: '
       + (P.said || []).slice(-1)[0]);
    /* The addresses really moved - it is not a verdict that was quietly relaxed. */
    const slots = model().plan.heads.filter((h) => !h.feeder)
      .flatMap((h) => h.run.map((r) => r.slot)).join(',');
    ok(slots !== '0,1,2,3', 'the bay addresses changed: ' + slots);
  } catch (e) {
    out.push('FAIL threw: ' + (e && e.stack || e));
  }

  const total = out.filter((l) => !l.startsWith('INFO')).length;
  window.__report = out.join('\n') + '\n'
    + out.filter((l) => l.startsWith('PASS')).length + '/' + total + ' checks passed';
})();
