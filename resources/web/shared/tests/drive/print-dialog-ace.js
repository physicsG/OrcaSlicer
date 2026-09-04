/*
 * The print dialog on a plate sliced onto an ACE, against the simulator.
 *
 * `?plan=1` gives the mock a seven-filament plate on its own machine - three stock
 * feeders and one four-bay ACE head - and `?plan=mismatch` moves one file filament off
 * the bay that holds it. Both are the SAME machine the four-filament default runs on, so
 * a mismatch has to be created rather than assumed: a check of the match cannot be a
 * check of two fixtures agreeing with each other.
 *
 *   R=resources/web/shared/tests
 *   python3 $R/run_webkit.py --size 714x750 \
 *       --page 'web/print_processing/index.html?mock=1&plan=1' \
 *       --drive $R/drive/print-dialog-ace.js
 *
 * What it is for: every one of these would be silently wrong rather than loudly broken.
 * The four cards going on being drawn beside the panel that replaced them was found here
 * - `hidden` is a UA rule and `.card` is `display: flex`, so setting it hid nothing.
 */
(async function () {
  const L = [];
  const say = (s) => L.push(s);
  try {
    const pp = window.__preprint;
    if (!pp) { window.__report = 'FAIL no window.__preprint'; return; }
    const m = typeof pp.model === "function" ? pp.model() : pp.model;
    say(`plan: ${m.plan ? `${m.plan.heads.length} heads, ${m.plan.swaps} swaps` : 'none'}`);
    say(`filaments: ${m.filaments.length}`);
    say(`ace: present=${m.ace.present} mode=${m.ace.mode} units=${(m.ace.units||[]).length}`);
    say(`check: ${m.check.rows.length} places, differs ${m.check.differs}, `
      + `unsure ${m.check.unsure}, checked ${m.check.checked}`);
    say('places: ' + m.check.rows.map((r) =>
      `${r.addr || 'T' + (r.head + 1)}=${r.verdict}`).join('  '));
    say('bays: ' + ((m.ace.units || [])[0] || { bays: [] }).bays
      .map((b) => `${b.addr}:${b.material || '-'}/${b.source}`).join(' '));
    say('');
    const sections = [...document.querySelectorAll('#body .card, #body .bare')]
      .map((n) => `${n.id}${n.hidden ? '(hidden)' : ''}`).join(', ');
    say(`sections: ${sections}`);
    say(`said: ${(pp.said || []).join(' | ')}`);
    say('');
    say('--- checks ---');
    const check = (n, ok, d) => L.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);

    check('the file carried a plan', !!m.plan, m.plan ? `${m.plan.swaps} swaps` : 'none');
    check('the grouping panel is the visible one',
          !document.getElementById('panel-grouping').hidden
          && document.getElementById('panel-filament').hidden);
    /* Not "are they in the DOM" - both panels are mounted. Are they ON SCREEN.
       `hidden` is a UA rule that any author `display:` beats, and `.card` is
       `display: flex`, so the cards went on being drawn beside the panel replacing them. */
    const onScreen = (sel) => [...document.querySelectorAll(sel)]
      .filter((n) => n.getBoundingClientRect().width > 0).length;
    check('the four cards are not drawn', onScreen('.fil-card') === 0,
          `${onScreen('.fil-card')} visible of ${document.querySelectorAll('.fil-card').length}`);
    check('every file filament reaches the screen',
          new Set([...document.querySelectorAll('[data-fil]')]
            .map((n) => n.dataset.fil)).size === m.filaments.length,
          `${new Set([...document.querySelectorAll('[data-fil]')].map((n) => n.dataset.fil)).size}`
          + ` of ${m.filaments.length}`);
    check('no head picker on an ACE plate', onScreen('.fil-pick') === 0,
          `${onScreen('.fil-pick')} visible`);
    check('the ACE was read', m.ace.present, `mode ${m.ace.mode}`);
    check('the override store was merged',
          ((m.ace.units || [])[0] || { bays: [] }).bays.some((b) => b.source === 'override'
            || b.material), 'a bay is named');
    check('one place per plan step',
          m.check.rows.length === m.plan.heads.reduce((a, h) => a + h.run.length, 0));
    const addrs = [...document.querySelectorAll('.g-from')].map((n) => n.textContent.trim())
      .filter((s) => s !== 'Feeder');
    check('every bay address is well formed',
          addrs.length > 0 && addrs.every((s) => /^[A-D][1-4]$/.test(s)),
          addrs.join(' '));
    const pill = document.querySelector('.g-pill');
    check('the ACE mode is stated', !!pill && /ACE mode/.test(pill.textContent),
          pill ? pill.textContent : 'none');
    /* The cost line says what the plan costs, and zero is one of the answers: a plate
       whose filaments each have their own toolhead loads the ACE once and never cycles it.
       Demanding a digit here failed on exactly such a plate while the panel was right. */
    const cost = document.querySelector('.g-cost');
    const costText = cost ? cost.textContent.replace(/\s+/g, ' ').trim() : 'none';
    check('the swap cost is on screen',
          !!cost && (m.plan.swaps > 0 ? /\d/.test(costText) : /No\s*ACE swaps/i.test(costText)),
          `${m.plan.swaps} swaps -> "${costText}"`);
    const note = document.querySelector('.g-note');
    check('the feeder limit is stated', !!note && /feeder/i.test(note.textContent),
          note ? note.textContent.slice(0, 60) : 'none');
    const badge = document.querySelectorAll('.g-src .ace-badge').length;
    check('the ACE-fed head carries its unit badge', badge >= 1, `${badge} badges`);
    const feedmark = document.querySelectorAll('.g-feedmark').length;
    check('feeder heads carry the feeder mark, not an ACE', feedmark >= 1,
          `${feedmark} feeder marks`);
    /* Route C's free fix, and the rule that keeps it honest: re-addressing the bays helps
       only when every spool the plate wants is already in the unit, merely in another bay.
       On a plate wanting seven colours from a unit holding three, no permutation exists
       and the offer must stay away - a button that clears half the marks leaves the plate
       just as unprintable and the operator with less idea why. */
    const fixNode = document.querySelector('.g-fix');
    const offered = !!fixNode && !fixNode.hidden;
    check('the free fix is offered exactly when it would clear every bay',
          offered === !!m.bayFix, `offered=${offered}, possible=${!!m.bayFix}, `
          + `differs=${m.check.differs}`);

    const send = document.querySelector('.send');
    const expect = m.check.differs > 0;
    check('Send matches the bay verdict', !!send && send.disabled === expect,
          `disabled=${send && send.disabled}, differs=${m.check.differs}`);
    /* The identity map has to have gone out: extruder_map_table survives a print, and on
       an ACE plate any remap prints on the wrong heads. */
    /*
     * The tool map goes out on SEND, not on open - opening a dialog to look at a plate
     * must not change the machine. So this presses Send, and presses it ONLY against the
     * simulator: against a real printer that would upload a file to it, and this script
     * is read-only by contract.
     */
    if (pp.mock) {
      const btn = document.querySelector('.send');
      const blocked = btn.disabled;
      btn.click();
      await new Promise((r) => setTimeout(r, 900));
      const sent = ((pp.mock.printer && pp.mock.printer.gcodeLog) || []).join('\n');
      const lines = (sent.match(/SET_PRINT_EXTRUDER_MAP[^\n]*/g) || []).length;
      if (blocked) {
        /* A refused send writes NOTHING. The map is machine state that survives a print,
           so a dialog that sets it and then declines to send has changed the machine for
           the next job on the strength of a plate it would not print. */
        check('a refused send writes no tool map', lines === 0, `${lines} lines`);
      } else {
        check('the identity tool map is written on send',
              /SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=0 MAP_EXTRUDER=0/.test(sent)
              && /SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=6 MAP_EXTRUDER=6/.test(sent),
              `${lines} lines`);
        check('and no line remaps a tool off its own head',
              !/SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=(\d+) MAP_EXTRUDER=(?!\1\b)/.test(sent));
      }
    } else {
      L.push('NOTE  read-only against a real machine: Send was not pressed, so the tool '
           + 'map was not exercised here. The simulator covers it.');
    }
    check('the dialog does not scroll past its own body',
          document.body.scrollHeight <= document.documentElement.clientHeight + 1);
    window.__report = L.join('\n');
  } catch (e) {
    window.__report = L.join('\n') + `\n\nFAIL drive threw: ${e && e.message}\n${e && e.stack}`;
  }
})();
