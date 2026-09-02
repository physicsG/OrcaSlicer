/*
 * Walk one multiACE print-dialog mockup and say what is actually on it.
 *
 * The four-card mockups' own walker (print-mockups.js) reads `model.assignment` and
 * throws here, because these three options deliberately have no assignment: on a plate
 * whose gcode names a head in every ACE_SWAP_HEAD, remapping the tools desynchronises
 * the swaps, so there is nothing to pick. A drive script that throws never sets
 * `window.__report` and the harness waits for it forever - which is how this one came to
 * exist rather than being folded into the other.
 *
 *   python3 resources/web/shared/tests/run_webkit.py --size 714x750 \
 *       --page 'web/print_processing/mockups/option-d.html?scenario=wrong' \
 *       --drive resources/web/shared/tests/drive/print-mockups-ace.js
 */
(function () {
  const L = [];
  const say = (s) => L.push(s);
  const check = (name, ok, detail) =>
    L.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);

  try {
    const m = window.__mockup;
    if (!m) { window.__report = 'FAIL no window.__mockup — the module never ran'; return; }

    const c = m.check || { rows: [], differs: 0, unsure: 0, checked: false };
    say(`title:    ${document.title}`);
    say(`scenario: ${m.scenario}   mode: ${m.mode}`);
    say(`plate:    ${m.mapping.filament_type.length} filaments`);
    say(`plan:     ${m.plan ? `${m.plan.heads.length} heads, ${m.plan.swaps} swaps` : 'none'}`);
    say(`check:    ${c.rows.length} places · differs ${c.differs} · unsure ${c.unsure}`
        + ` · checked ${c.checked}`);
    if (c.rows.length) {
      say('places:   ' + c.rows.map((r) =>
        `${r.addr || 'T' + (r.head + 1)}=${r.verdict}`).join('  '));
    }
    say('');

    /* ---- the tree ---- */
    const walk = (elm, d) => {
      const cls = elm.className && typeof elm.className === 'string'
        ? '.' + elm.className.trim().split(/\s+/).filter(Boolean).join('.') : '';
      const id = elm.id ? '#' + elm.id : '';
      const data = Object.keys(elm.dataset || {}).sort()
        .map((k) => `[${k}=${elm.dataset[k]}]`).join('');
      const r = elm.getBoundingClientRect();
      const geo = (r.width || r.height)
        ? ` {${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}}` : '';
      L.push('  '.repeat(d) + elm.tagName.toLowerCase() + id + cls + data + geo
             + (elm.hidden ? ' HIDDEN' : ''));
      [...elm.children].forEach((x) => walk(x, d + 1));
    };
    walk(document.body, 0);
    say('');
    say('--- checks ---');

    /* ---- the dialog is the size the host opens ---- */
    const vh = document.documentElement.clientHeight;
    check('dialog does not scroll past its own body',
          document.body.scrollHeight <= vh + 1,
          `body ${document.body.scrollHeight} vs viewport ${vh}`);
    check('nothing overflows horizontally',
          document.body.scrollWidth <= document.documentElement.clientWidth + 1,
          `${document.body.scrollWidth} vs ${document.documentElement.clientWidth}`);

    /* ---- the plate is identified on arrival, without a click ---- */
    const img = document.querySelector('img.thumb');
    check('plate thumbnail visible on arrival', !!img && !!img.getAttribute('src'),
          img ? `${Math.round(img.getBoundingClientRect().width)}px wide` : 'no img.thumb');
    if (img) check('thumbnail decoded', img.naturalWidth > 0, `naturalWidth ${img.naturalWidth}`);

    /* ---- EVERY file filament reaches the screen ----
       This is the whole complaint against the four-card dialog: it draws four labels for
       a plate with seven filaments. A design that silently drops three fails here. */
    const want = m.mapping.filament_type.length;
    /* Each design says "this filament" in its own way - a numbered badge in the sidebar's
       vocabulary, or a chip carrying the material on its own colour. The check is that
       every filament reaches the screen SOMEHOW, so it is a union and not one design's
       class name. Asking every design for `.fnum` is how a working design reports FAIL. */
    const marks = document.querySelectorAll('[data-fil]');
    if (m.mode === 'print') {
      const seen = new Set([...marks].map((b) => b.dataset.fil));
      const missing = [];
      for (let i = 0; i < want; i += 1) if (!seen.has(String(i))) missing.push(i + 1);
      check('every file filament is drawn somewhere', missing.length === 0,
            `${seen.size} of ${want} (${marks.length} marks)`
            + (missing.length ? ` — missing ${missing.join(', ')}` : ''));
    }

    /* ---- every bay address is a real address ----
       `NaN1` renders, sits in the DOM, and passes every check that counts elements. It is
       what a head-level unit index does in multi mode, where a head has none. An address
       is one of A-D and 1-4 or it is a defect. */
    const addrNodes = [...document.querySelectorAll(
      '.addr, .chip-from .addr-t, .pb-addr, .ace-disc')]
      .map((n) => n.textContent.trim())
      .filter((s) => s && !['Feeder', 'Loaded', 'Empty'].includes(s));
    if (addrNodes.length) {
      const bad = addrNodes.filter((s) => !/^[A-D][1-4]$/.test(s));
      check('every bay address is well formed', bad.length === 0,
            bad.length ? `bad: ${[...new Set(bad)].join(', ')}`
                       : `${addrNodes.length} addresses, units ${
                         [...new Set(addrNodes.map((s) => s[0]))].sort().join('')}`);
    }

    /* ---- no destination picker on an ACE plate ----
       Not an omission: the file already chose, and a control that let the operator
       disagree with it would produce a print on the wrong heads. */
    if (m.plan) {
      const picks = document.querySelectorAll('select.head-pick, .fil-pick');
      check('no head picker on an ACE plate', picks.length === 0,
            `${picks.length} pickers`);
    }

    /* ---- a place that disagrees is visibly marked ---- */
    if (m.mode === 'print' && c.checked && (c.differs || c.unsure)) {
      const bad = document.querySelectorAll('.place[data-verdict="differs"], '
        + '.place[data-verdict="unsure"], .dot.bad, .dot.warn, .head-verdict.bad, '
        + '.head-verdict.warn, .todo-row, .prow.bad, .prow.warn, '
        + '.chip.is-bad, .chip.is-warn');
      check('a disagreement is marked on screen', bad.length > 0,
            `${bad.length} marks for ${c.differs + c.unsure} places`);
    }

    /* ---- a tick is a claim, and must not be made where nothing was checked ----
       A stock feeder is not reported by the ACE. A green tick over one would claim a
       check that never happened, which is worse than no tick at all. */
    const ticks = document.querySelectorAll('.tick').length;
    if (m.mode === 'print' && !c.checked) {
      check('no sync tick when nothing was read', ticks === 0, `${ticks} ticks`);
    }
    if (m.mode === 'print' && c.checked && (c.differs || c.unsure)) {
      const allGood = c.rows.filter((r) => r.verdict !== 'unchecked')
                            .every((r) => r.verdict === 'agrees');
      check('no sync tick claims agreement that is not there', allGood || ticks < 4,
            `${ticks} ticks with ${c.differs} differing`);
    }

    /* ---- Send agrees with the scenario ---- */
    const send = document.querySelector('#send');
    const mustBlock = m.mode === 'print' && !!m.plan
      && (c.differs > 0 || c.unsure > 0 || !c.checked);
    check('send button reflects the scenario', !!send && send.disabled === mustBlock,
          `disabled=${send && send.disabled}, expected ${mustBlock}`);

    /* ---- a blocked send has to offer a way forward ----
       Not necessarily an override. A design may instead offer to change the PLAN - to
       re-group around what is loaded and slice again - which is a different door and a
       better one where the printer is not in the room. What is not allowed is a refusal
       with no door at all, which is the fault this check was written after. */
    const ov = document.querySelector('#override');
    const regroup = document.querySelector('.regroup');
    if (mustBlock) {
      check('a blocked send offers a way forward', !!(ov || regroup),
            ov ? 'an override' : (regroup ? 'regroup and re-slice' : 'NOTHING'));
    }

    /* ---- and whichever door it is, it works and repaints ---- */
    if (ov && send) {
      const before = document.body.innerHTML.length;
      ov.checked = true;
      ov.dispatchEvent(new Event('change'));
      const now = document.querySelector('#send');
      check('the override lifts the refusal', now && now.disabled === false,
            `disabled=${now && now.disabled}`);
      check('and the dialog repaints', document.body.innerHTML.length !== before,
            `${before} -> ${document.body.innerHTML.length} chars`);
    } else if (regroup) {
      const before = document.body.innerHTML.length;
      regroup.click();
      const sheet = document.querySelector('.sheet');
      check('the regroup sheet opens', !!sheet,
            sheet ? `${sheet.querySelectorAll('.mode').length} modes` : 'no .sheet');
      /* The mode that groups around what is loaded is the one that makes a mismatch go
         away without anyone walking to the printer. A regroup sheet without it is just a
         second way to ask for the same plan. */
      const modes = [...document.querySelectorAll('.mode')].map((m) => m.dataset.key);
      check('it offers grouping around what is loaded', modes.includes('match'),
            `modes: ${modes.join(', ') || 'none'}`);
      const esc = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(esc);
      check('and it closes', !document.querySelector('.sheet'),
            `${before} -> ${document.body.innerHTML.length} chars`);
    }

    /* ---- the cost is stated before Send, not after ---- */
    if (m.plan && m.mode === 'print') {
      /* What the arrangement costs, however the design phrases it: three state the swap
         count outright, one states what the grouping SAVED. Both are the same fact from
         opposite ends and both are a number on screen before Send. */
      const cost = document.querySelector('#cost, .cost, .saving, #saving');
      check('what the arrangement costs is on screen',
            !!cost && /\d/.test(cost.textContent),
            cost ? cost.textContent.trim().replace(/\s+/g, ' ') : 'nothing');
    }

    window.__report = L.join('\n');
  } catch (e) {
    /* Never leave the harness waiting: a drive script that throws sets no report and
       run_webkit.py has nothing to time out on. */
    window.__report = L.join('\n') + `\n\nFAIL drive script threw: ${e && e.message}\n`
                    + (e && e.stack ? e.stack : '');
  }
})();
