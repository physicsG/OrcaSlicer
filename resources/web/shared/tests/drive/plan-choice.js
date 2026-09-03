/* Walk the plan-choice mockup: both scenarios, every option, and the numbers. */
(async () => {
  const out = [];
  const ok = (c, m) => out.push((c ? 'PASS ' : 'FAIL ') + m);
  const $ = (s) => document.querySelector(s);
  const txt = (s) => (document.querySelector(s) || {}).textContent || '';
  const wait = () => new Promise((r) => setTimeout(r, 60));

  ok(!!window.__mockup, 'mockup exposed');
  const M = window.__mockup;

  // --- scenario 2: sliced onto the ACE -------------------------------------
  $('#s-aware').click(); await wait();
  ok(M.state.scenario === 'aware', 'aware scenario selected');
  const opts = [...document.querySelectorAll('.opt')];
  ok(opts.length === 3, 'three answers offered, got ' + opts.length);
  ok(/ACE mode/.test(txt('#modepill')), 'mode stated: ' + txt('#modepill').trim());

  // as sliced -> two bays differ, Send refused
  ok(M.disagreements('sliced') === 2, 'as sliced: 2 disagreements, got ' + M.disagreements('sliced'));
  ok($('#go').disabled === true, 'Send is refused on the as-sliced layout');
  const badMarks = [...document.querySelectorAll('.verdict.bad')].length;
  ok(badMarks === 2, 'two bays marked differs, got ' + badMarks);

  // the free option -> nothing disagrees, Send opens, swaps unchanged
  opts[1].click(); await wait();
  ok(M.state.choice === 'addresses', 'picked the address-only option');
  ok(M.disagreements('addresses') === 0, 'address fix clears every disagreement');
  ok($('#go').disabled === false, 'Send opens once the addresses match');
  ok($('#go').textContent.trim() === 'Send', 'still a Send, not a re-export');
  ok(M.layouts.addresses.swaps === M.layouts.sliced.swaps,
     'the free option changes no swap count (' + M.layouts.addresses.swaps + ')');
  ok([...document.querySelectorAll('.verdict.bad')].length === 0, 'no bay still marked differs');

  // the cheaper option -> fewer swaps, costs a re-export and two spool moves
  opts[2].click(); await wait();
  ok(M.layouts.replan.swaps < M.layouts.sliced.swaps,
     'replan is cheaper to print: ' + M.layouts.replan.swaps + ' vs ' + M.layouts.sliced.swaps);
  ok(/Re-export/.test($('#go').textContent), 'button says what it will do: ' + $('#go').textContent.trim());
  ok(/Move 2 spools/.test(txt('#todo')), 'it names the physical work: ' + txt('#todo').slice(0, 40).trim());
  ok(/text edit/.test(txt('#asym')), 'the head-vs-bay asymmetry is stated');

  // --- scenario 1: sliced without the ACE ----------------------------------
  $('#s-unaware').click(); await wait();
  ok(M.state.scenario === 'unaware', 'unaware scenario selected');
  ok(/No ACE in this file/.test(txt('#modepill')), 'says the file has no ACE');
  ok(/nowhere to go/.test(txt('#notice')), 'says three filaments have nowhere to go');
  ok([...document.querySelectorAll('.fnum.orphan')].length === 3, 'three filaments marked orphan');
  ok(/re-slice/i.test(txt('#opts')), 'a re-slice is the offer');
  ok(/Sync and re-slice/.test($('#go').textContent), 'button reads: ' + $('#go').textContent.trim());
  ok(/sliced/.test(txt('#asym')), 'says why a re-map cannot help here');

  // layout must not overflow the dialog body
  const b = document.querySelector('.body');
  out.push('INFO body scrollHeight=' + b.scrollHeight + ' clientHeight=' + b.clientHeight
           + ' overflow=' + (b.scrollHeight - b.clientHeight));
  ok(document.body.scrollWidth <= window.innerWidth + 1, 'no horizontal overflow');

  window.__report = out.join('\n') + '\n' +
    out.filter((l) => l.startsWith('PASS')).length + '/' +
    out.filter((l) => !l.startsWith('INFO')).length + ' checks passed';
})();
