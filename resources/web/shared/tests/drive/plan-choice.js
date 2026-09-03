/*
 * plan-choice.js - the plan-choice mockup, both states.
 *
 * It runs the popup's OWN panels on the shared ACE fixture, so most of what this asserts
 * is that the real grouping view and the real four-card view are both reachable from one
 * page and agree with the fixture. The rest is the new block: three answers, the middle
 * one free, and Send following the answer rather than the file.
 *
 * Sets __report on every path - a drive script that throws leaves the harness waiting.
 */
(async () => {
  const out = [];
  const ok = (c, m) => out.push((c ? 'PASS ' : 'FAIL ') + m);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const txt = (s) => (($(s) || {}).textContent || '').trim();
  const wait = () => new Promise((r) => setTimeout(r, 70));

  try {
    ok(!window.__err, 'no error on load: ' + (window.__err || 'none'));
    ok(!!window.__mockup, 'mockup exposed');

    /* ---- it is the real dialog ------------------------------------------ */
    const ids = $$('section.card').map((s) => s.id).join(',');
    ok(ids === 'panel-model-info,panel-printer,panel-filament,panel-preferences',
       'the shipped sections, in order: ' + ids);
    ok($$('.card-title').length === 4, 'every section has the 120..180 title column');
    ok($$('.mi-thumb').length === 1 && $$('.mi-fact').length >= 3,
       'Model Information is the real panel');
    ok($$('.picker').length === 1, 'Select Printer is the real panel');
    ok($$('.pref').length >= 3, 'Print Preferences is the real panel, ' + $$('.pref').length + ' rows');

    /* ---- sliced onto the ACE -------------------------------------------- */
    $('#s-aware').click(); await wait();
    ok($$('.g-head').length === 4, 'the real grouping view draws four toolheads');
    ok(/ACE mode/.test(txt('.g-pill')), 'the mode pill is the real one: ' + txt('.g-pill'));
    ok($$('.g-chip').length === 7, 'seven filaments on four heads, got ' + $$('.g-chip').length);
    ok($$('.g-chip.is-bad').length === 2, 'two chips marked wrong by the real reconciliation, got '
       + $$('.g-chip.is-bad').length);
    ok(/^A[1-4]:/.test(txt('.g-verdict.bad')), 'the real verdict line names the bay: '
       + txt('.g-verdict.bad').slice(0, 46));

    /* The cost line is the real one, and it carries Bambu's counterfactual: their
       "Save 25g filament and 100 nozzle purges compared to a printer with one nozzle". */
    ok(/ACE swaps/.test(txt('.g-cost')), 'the cost line is drawn: ' + txt('.g-cost'));
    ok(/purged/.test(txt('.g-cost')), 'with the purge, which needs the normalised key');
    ok(/saves \d+ swaps against one spool per head/.test(txt('.g-cost')),
       'and the saving against the counterfactual');

    const opts = $$('.pc-opt');
    ok(opts.length === 3, 'three answers, got ' + opts.length);
    ok($('#send').disabled === true, 'Send refused on the as-sliced answer');

    opts[1].click(); await wait();
    ok(window.__mockup.state.choice === 'addresses', 'picked the address-only answer');
    ok($('#send').disabled === false, 'Send opens on the address-only answer');
    ok($('#send').textContent.trim() === 'Send', 'and it is still a Send');
    const A = window.__mockup.answers.aware;
    ok(A[1].swaps === A[0].swaps, 'the free answer changes no swap count (' + A[1].swaps + ')');
    ok(/free/i.test(txt('.pc-opt[data-key="addresses"] .pc-cost')), 'it is labelled free');
    ok(!/Move \d+ spools/.test(txt('.pc-detail')), 'and it asks nothing of the operator');

    opts[2].click(); await wait();
    ok(A[2].swaps < A[0].swaps, 'the re-plan is cheaper to run: ' + A[2].swaps + ' vs ' + A[0].swaps);
    ok(/Re-export/.test($('#send').textContent), 'the button says what it will do: '
       + $('#send').textContent.trim());
    ok(/Move 2 spools/.test(txt('.pc-detail')), 'and it names the physical work');
    ok(/text edit/.test(txt('.pc-whybody')), 'the head-versus-bay asymmetry is stated');

    /* ---- sliced without the ACE ----------------------------------------- */
    $('#s-unaware').click(); await wait();
    ok(window.__mockup.state.scenario === 'unaware', 'unaware state selected');
    ok($$('.g-head').length === 0, 'no grouping panel: the file carries no plan');
    ok($$('.fil-card').length === 7, 'the real four-card panel, one per filament, got '
       + $$('.fil-card').length);
    ok($$('.fil-card.unset').length === 3, 'three filaments have no toolhead, got '
       + $$('.fil-card.unset').length);
    ok($$('.pc-opt').length === 2, 'two answers here, got ' + $$('.pc-opt').length);
    ok(/no address to re-map/i.test(txt('.pc-whybody')), 'and it says why a re-map cannot help');
    $$('.pc-opt')[1].click(); await wait();
    ok(/Sync and re-slice/.test($('#send').textContent), 'the button reads: '
       + $('#send').textContent.trim());

    /* ---- the source panel, after Bambu's "Select filament" --------------- */
    $('#s-aware').click(); await wait();
    ok($$('.g-chip.pc-pick').length === 7, 'every chip opens a source panel, got '
       + $$('.g-chip.pc-pick').length);
    const aceChip = $$('.g-head')[3].querySelector('.g-chip');
    aceChip.click(); await wait();
    const panel = $('.src-panel');
    ok(!!panel, 'the panel opened');
    ok(/Toolhead 4/.test(txt('.src-title')), 'it names the head it is choosing for: '
       + txt('.src-title'));

    const boxes = [...panel.querySelectorAll('.src-box')];
    ok(boxes.length === 2, 'two sources drawn, got ' + boxes.length);
    ok(/ACE/.test(boxes[0].textContent), 'the head\'s own ACE first');
    ok(/Stock feeders/.test(boxes[1].textContent), 'and the stock feeders beside it');
    /* Bambu draws the AMS that cannot feed this nozzle and greys it. Head mode gives the
       same rule here: an ACE-fed head draws from its own unit and from nothing else. */
    ok(boxes[1].classList.contains('is-off'), 'what cannot feed this head is greyed, not hidden');
    ok([...boxes[1].querySelectorAll('.src-tile')].every((t) => t.disabled),
       'and none of it can be clicked');
    ok(boxes[0].querySelectorAll('.src-tile').length === 4, 'four addressed bays, got '
       + boxes[0].querySelectorAll('.src-tile').length);
    ok([...boxes[0].querySelectorAll('.src-addr')].map((n) => n.textContent).join(',')
       === 'A1,A2,A3,A4', 'addressed the way the machine addresses them');
    ok(!!panel.querySelector('.src-wedge'), 'the one in use wears the corner wedge');
    const pr = panel.getBoundingClientRect();
    ok(pr.left >= 0 && pr.right <= window.innerWidth + 1,
       'the panel fits the dialog: ' + Math.round(pr.left) + '..' + Math.round(pr.right)
       + ' in ' + window.innerWidth);
    /* Every bay holds PLA here and two hold the wrong COLOUR - and colour must not refuse. */
    ok([...boxes[0].querySelectorAll('.src-tile')].filter((t) => t.disabled).length === 0,
       'no bay is refused on colour alone');

    const before = window.__mockup.model.check.differs;
    const other = [...boxes[0].querySelectorAll('.src-tile')]
      .find((t) => !t.disabled && !t.querySelector('.src-wedge'));
    other.click(); await wait();
    ok(!$('.src-panel'), 'the panel closes on a pick');
    ok(window.__mockup.state.choice === 'hand', 'a pick becomes its own answer');
    out.push('INFO differs before=' + before + ' after=' + window.__mockup.model.check.differs);

    /* A chip on a FEEDER head: the ACE is the greyed half instead. */
    $$('.g-head')[0].querySelector('.g-chip').click(); await wait();
    const fboxes = [...$('.src-panel').querySelectorAll('.src-box')];
    ok(fboxes[0].classList.contains('is-off'), 'for a feeder head the ACE is the greyed half');
    ok(!fboxes[1].classList.contains('is-off'), 'and its own feeders are not');
    /* Dismissal is on pointerdown, not click: it has to happen before focus moves, or a
       click on another chip reopens the panel it just closed. A synthetic .click() emits
       no pointerdown, so the test has to send the real thing. */
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await wait();
    ok(!$('.src-panel'), 'pointing away closes it');

    /* The toolhead move is NOT in the panel - it is Bambu's "Regroup and slice" line. */
    ok($$('.src-panel .src-tile').length === 0, 'and nothing of it is left on the page');
    const link = $('.src-regroup .src-link');
    ok(!!link, 'the regroup line is under the grid');
    ok(/Re-plan which toolhead/.test(link.textContent), 'and says what it does: '
       + link.textContent.trim());
    ok(/re-export/i.test(txt('.src-price')), 'with its price beside it: ' + txt('.src-price'));
    link.click(); await wait();
    ok(window.__mockup.state.choice === 'replan', 'it selects the re-plan answer');

    /* Choosing an answer redraws the grid, and Send follows the real verdict. */
    $$('.pc-opt')[1].click(); await wait();
    ok(window.__mockup.model.check.differs === 0, 'the address answer really clears every bay');
    ok($('#send').disabled === false, 'so Send opens');
    $$('.pc-opt')[2].click(); await wait();
    ok(window.__mockup.model.check.differs > 0, 'the re-plan wants spools moved, so bays differ');
    ok($('#send').disabled === true, 'and Send stays shut until they are');

    /* ---- it fits the dialog --------------------------------------------- */
    $('#s-aware').click(); await wait();
    const b = $('.dlg-body');
    out.push('INFO body scrollHeight=' + b.scrollHeight + ' clientHeight=' + b.clientHeight
             + ' overflow=' + Math.max(0, b.scrollHeight - b.clientHeight));
    ok(document.body.scrollWidth <= window.innerWidth + 1, 'no horizontal overflow');
    ok(!window.__err, 'still no error after driving: ' + (window.__err || 'none'));
  } catch (e) {
    out.push('FAIL threw: ' + (e && e.stack || e));
  }

  const total = out.filter((l) => !l.startsWith('INFO')).length;
  window.__report = out.join('\n') + '\n'
    + out.filter((l) => l.startsWith('PASS')).length + '/' + total + ' checks passed';
})();
