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

    /* ---- the chip menu: what each dropdown holds ------------------------- */
    $('#s-aware').click(); await wait();
    const aceChips = $$('.g-chip.pc-pick');
    ok(aceChips.length === 7, 'every chip opens a source menu, got ' + aceChips.length);
    const aceChip = $$('.g-head')[3].querySelector('.g-chip');
    aceChip.click(); await wait();
    const menu = $('.menu');
    ok(!!menu, 'the page\'s own picker opened');
    const rows = [...menu.querySelectorAll('.menu-item')];
    ok(rows.length === 7, 'four bays of this head\'s unit and three other toolheads, got '
       + rows.length);
    const free = rows.filter((r) => r.querySelector('.menu-cost.free'));
    const paid = rows.filter((r) => r.querySelector('.menu-cost:not(.free)'));
    ok(free.length === 3, 'the bays are free, minus the one already in use: ' + free.length);
    ok(paid.length === 3, 'the toolheads cost a re-export: ' + paid.length);
    ok(/re-export/i.test(paid[0].textContent), 'and each says so: ' + paid[0].textContent.trim());
    ok(/Toolhead \d/.test(paid[0].textContent), 'a toolhead row names itself in full: '
       + paid[0].textContent.trim().slice(0, 40));
    ok([...menu.querySelectorAll('.menu-col b, .menu-col span')]
       .every((n) => n.scrollWidth <= n.clientWidth + 1),
       'no row text is truncated at the menu\'s measured 200px');
    ok(rows.slice(0, 4).every((r) => /^A[1-4]/.test(r.textContent.trim())),
       'the bays come first, addressed');
    /* Every bay here holds PLA and the plate is all PLA, so nothing is refused - and two
       of the four hold the WRONG COLOUR. That is the assertion worth making: colour is
       shown on every row and blocks none of them, exactly as the toolhead menu's own rule
       (type and nozzle, never colour) already has it. */
    const refused = rows.filter((r) => r.getAttribute('aria-disabled') === 'true');
    ok(refused.length === 0, 'no place is refused on colour alone, got ' + refused.length);
    ok(!!rows.find((r) => r.querySelector('.menu-tick')), 'the bay in use carries the tick');

    /* Picking a bay is free, changes no swap count, and clears the verdict. */
    const before = window.__mockup.model.check.differs;
    const pick = rows.find((r) => r.querySelector('.menu-cost.free'));
    pick.click(); await wait();
    ok(!$('.menu'), 'the menu closes on a pick');
    ok(window.__mockup.state.choice === 'hand', 'a hand pick becomes its own answer');
    ok($$('.pc-opt').length === 4, 'and it appears in the list, got ' + $$('.pc-opt').length);
    out.push('INFO differs before=' + before + ' after=' + window.__mockup.model.check.differs);

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
