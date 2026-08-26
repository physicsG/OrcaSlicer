/* The multiACE Filament card against a REAL printer.
 *
 * Read-only, deliberately and permanently. `ace-panel.js` switches sources, loads bays
 * and starts the dryer; every one of those is minutes of physical work on a machine with
 * filament in it, and a test suite is not a thing that should be able to purge a nozzle.
 * This one asks the printer what it has and checks the panel drew that - nothing else.
 *
 * It also DUMPS the raw `ace` object, because that is the point: `state.js` reads several
 * of its fields under more than one spelling, and until this has run against hardware the
 * right spelling is a guess taken from multiACE's own source rather than a reading.
 *
 *   python3 run_webkit.py --real --size 1920x1080 --drive drive/ace-real.js
 *
 * Needs Orca closed - it authenticates with the same saved clientId, and a broker evicts
 * the older holder.
 */
(function () {
  const out = []; const P = window.__devicePage;
  const say = (n, g, w) => out.push(`${g === w ? 'PASS' : 'FAIL'}  ${n}`
    + (g === w ? '' : `   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const info = (s) => out.push(`  ${s}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const round = (v) => Math.round(v * 10) / 10;

  (async () => { try {
    for (let i = 0; i < 40 && !(P && P.bridge); i += 1) await wait(400);
    for (let i = 0; i < 40 && !P.state.lastUpdate; i += 1) await wait(500);
    say('a session came up and state arrived', P.state.lastUpdate > 0, true);

    const t0 = Date.now();
    await P.session.refreshAce();
    const took = Date.now() - t0;
    info(`sw_GetMachineState {objects:{ace:null}} took ${took} ms`);
    await wait(200);

    const raw = P.state.get('ace');
    say('the printer answers for the `ace` object', !!raw, true);
    if (!raw) { window.__report = out.join('\n'); return; }

    /* ---- what the machine actually said -------------------------------- */
    // Printed whole. Every field state.js reads defensively is settled by looking at
    // this, and nothing else can settle it.
    const dump = JSON.stringify(raw, null, 1);
    info('---- raw `ace`, as the printer reports it ' + '-'.repeat(28));
    dump.split('\n').slice(0, 400).forEach((l) => info(l));
    if (dump.split('\n').length > 400) info(`... ${dump.split('\n').length - 400} more lines`);
    info('-'.repeat(70));
    info(`top-level keys: ${Object.keys(raw).sort().join(', ')}`);
    const a0 = (raw.aces || [])[0] || {};
    info(`aces[0] keys: ${Object.keys(a0).sort().join(', ')}`);
    const s0 = (a0.slots || [])[0] || {};
    info(`aces[0].slots[0] keys: ${Object.keys(s0).sort().join(', ')}`);
    info(`aces[0].dryer_status: ${JSON.stringify(a0.dryer_status)}`);
    info(`humidity=${JSON.stringify(a0.humidity)} temp=${JSON.stringify(a0.temp)}`);
    info(`head_source: ${JSON.stringify(raw.head_source)}`);

    /* ---- what state.js made of it -------------------------------------- */
    const ace = P.state.ace();
    info(`ace(): ${ace.unitCount} unit(s), mode ${ace.mode}, `
       + `heads ${ace.heads.map((h) => h.source + (h.unitId ? ':' + h.unitId : '')).join(' ')}`);
    ace.units.forEach((u) => info(
      `  ACE ${u.id}  ${u.model} ${u.firmware || '(no firmware field)'}  `
      + `${u.humidity == null ? 'humidity?' : u.humidity + '%'} `
      + `${u.temperature == null ? 'temp?' : u.temperature + 'C'}  `
      + `dryer ${JSON.stringify(u.dryer)}  `
      + `bays ${u.bays.map((b) => (b.occupied ? (b.material || '?') : '-')).join('/')}`));

    /* ---- the fields that were guessed, and are not any more ------------ */
    // Each of these replaced a guess that the machine had quietly disagreed with. They
    // are asserted here so a firmware that moves one fails loudly instead of showing a
    // dash, or a countdown that is sixty times too fast.
    const d0 = a0.dryer_status || {};
    say('dryer_status carries the four fields the panel reads',
        ['status', 'target_temp', 'duration', 'remain_time']
          .filter((k) => !(k in d0)).join(',') || 'none', 'none');
    say('and its idle word is one the panel reads as stopped',
        P.state.ace().units[0].dryer.running, String(d0.status) !== 'stop');
    const ad = a0.auto_dry || {};
    say('auto-dry is the unit`s own object, with the arguments the macro takes',
        ['enabled', 'rh_start', 'rh_end', 'temp'].filter((k) => !(k in ad)).join(',')
          || 'none', 'none');
    say('the unit names its own model rather than leaving it to `protocol`',
        typeof a0.model === 'string' && a0.model.length > 0, true);
    say('the settings a person sets once are reported, not write-only',
        ['confirm_commands', 'spoolman_url', 'spoolman_auto', 'purge_matrix']
          .filter((k) => !(k in raw)).join(',') || 'none', 'none');
    const st = P.state.ace().settings;
    info(`settings: confirm=${st.confirmCommands} spoolman=${st.spoolmanUrl || '(none)'} `
       + `auto=${st.spoolmanAuto} matrix=${st.purgeMatrix} bound=${st.bound}`);

    /* ---- what is IN each bay, which the ace object does not say -------- */
    // The discrepancy this file exists to catch: Orca's Prepare page polls
    // /multiace/api/state from C++ and sees four named bays, while the Klipper object
    // reports four blanks. The names live in multiACE's override store, and the store is
    // a file under Moonraker's config root - which the page CAN fetch, because Moonraker
    // reflects the Origin where nginx's /multiace/ sends no CORS header at all.
    await P.handlers.syncBays();
    await wait(150);
    const bays = P.store.aceBays;
    info(`override store: ${bays ? Object.keys(bays).sort().join(' ') : '(none)'}`);
    const rawNamed = (a0.slots || []).filter((s2) => (s2.material || '').trim()).length;
    info(`raw slots with a material: ${rawNamed} of ${(a0.slots || []).length}`);
    if (bays) {
      const occupied = P.state.ace().units[0].bays.filter((b) => b.occupied);
      const named = $$('#filament .ace-cab .ace-chip')
        .map((e) => e.textContent).filter((t) => t && t !== '?' && t !== '/');
      say('every occupied bay the store names is drawn with that name',
          named.length, occupied.length);
      say('and the mark says the name came from multiACE, not from a tag',
          $$('#filament .ace-cab .ace-prov')
            .some((e) => /multiACE/.test(e.title)), true);
      say('so no occupied bay is left reading `?`',
          $$('#filament .ace-cab .ace-chip').filter((e) => e.textContent === '?').length, 0);
    } else {
      info('no override store on this printer - occupied bays stay unnamed, correctly');
    }

    /* ---- the background-swap gate -------------------------------------- */
    // Written down as unavailable: `bg_swap` is in multiACE's FastAPI state and not in
    // the `ace` object. It IS its own Klipper object, so the page can ask for it.
    try {
      const snap = await P.bridge.request('sw_GetMachineState',
                                          { objects: { ace_bg_swap: null } });
      P.state.applyPayload(snap);
      const bg = P.state.get('ace_bg_swap');
      info(`ace_bg_swap: ${JSON.stringify(bg)}`);
      say('the background-swap gate is a Klipper object, and it answers',
          !!bg && Array.isArray(bg.enabled_heads), true);
    } catch (e) {
      say('the background-swap gate is a Klipper object, and it answers',
          `threw: ${e.message}`, true);
    }

    say('the unit count matches device_count',
        ace.unitCount, Math.min(4, Number(raw.device_count) || 0));
    say('a humidity reading is a percentage, not a 1-5 bucket',
        ace.units.every((u) => u.humidity == null || u.humidity > 5 || u.humidity === 0), true);
    say('every unit reports a temperature',
        ace.units.every((u) => u.temperature != null), true);
    // The trap: head_ace answers for every head whether or not that head is on an ACE.
    const lying = ace.heads.filter((h, i) => {
      const ha = raw.head_ace && (raw.head_ace[i] !== undefined ? raw.head_ace[i]
                                                                : raw.head_ace[String(i)]);
      return Number(ha) >= ace.unitCount && h.source === 'ace';
    });
    say('no head is drawn on a unit that is not attached', lying.length, 0);

    /* ---- and what the panel drew --------------------------------------- */
    const cards = $$('#filament .ace-card');
    say('the panel drew the ACE shape rather than the four slots',
        cards.length + ':' + $$('#filament .slot').length, '4:0');
    say('one cabinet per head that is on a unit',
        $$('#filament .ace-cab').length,
        ace.heads.filter((h) => h.source === 'ace').length);
    say('the sources on screen are the ones state.js resolved',
        cards.map((c) => c.querySelector('.ace-src').value).join(','),
        ace.heads.map((h) => (h.source === 'ace' ? `ace:${h.unitIndex}` : h.source)).join(','));
    say('the mode pill reports the machine`s mode',
        $('#filament-mode').textContent.trim().toLowerCase(),
        `ace mode · ${String(ace.mode || '')}`.toLowerCase());

    const body = $('#filament');
    info(`body ${body.scrollHeight}/${body.clientHeight}`);
    say('nothing is clipped in silence', body.scrollHeight <= body.clientHeight + 1, true);
    say('a card is still the height that lets two rows fit',
        Math.round(cards[0].getBoundingClientRect().height), 215);
    const mid = (e) => { const r = e.getBoundingClientRect(); return r.left + r.width / 2; };
    say('the box and the toolhead sit on one axis on every card',
        cards.filter((c) => round(Math.abs(mid(c.querySelector('.ace-tool'))
                                         - mid(c.querySelector('.ace-box')))) > 1).length, 0);
    const s = parseFloat(getComputedStyle(cards[0].querySelector('.ace-tool'))
                         .getPropertyValue('--s'));
    let bad = 0; let drawn = 0;
    cards.forEach((c) => {
      const p = [...c.querySelectorAll('.ace-wire path')].pop();
      if (!p) return;
      drawn += 1;
      const m = p.getScreenCTM();
      const at = (l) => { const q = p.getPointAtLength(l);
                          return { x: q.x * m.a + q.y * m.c + m.e,
                                   y: q.x * m.b + q.y * m.d + m.f }; };
      const t = c.querySelector('.ace-tool').getBoundingClientRect();
      const e = at(p.getTotalLength());
      if (Math.abs(e.x - (t.left + 32 * s)) > 1.5 || Math.abs(e.y - t.top) > 1.5
          || Math.abs(at(0).x - e.x) > 1.5) bad += 1;
    });
    info(`tubes drawn: ${drawn}`);
    say('every tube is vertical and lands on the inlet', bad, 0);
    say('nothing inside a card overflows its cell',
        $$('#filament .ace-card,#filament .ace-head,#filament .ace-hrow,#filament .ace-strip')
          .filter((e) => e.scrollWidth > e.clientWidth + 1).length, 0);
    say('no panel reported a paint error',
        $$('[data-paint-error]').map((e) => e.id + ':' + e.dataset.paintError).join(','), '');

    /* ---- the dryer dialog, opened and closed, sending nothing ----------- */
    const chip = $('#filament .ace-dry');
    if (chip) {
      chip.click(); await wait(120);
      const d = $('.dialog');
      say('the Dry chip opens the dialog on real readings', !!d, true);
      if (d) {
        const line = d.querySelector('.dry-cmd').textContent.trim();
        info(`dialog would send: ${line}`);
        // The panel offers hours; ACE_DRY takes minutes. Sending the panel's number
        // unconverted asked for four MINUTES of drying and the machine answered `ok`.
        say('the duration on the wire is minutes, not the hours on screen',
            /DURATION=240\b/.test(line), true);
        say('and automatic drying uses the arguments the machine reads',
            /ACE_SET_AUTO_DRY ACE=0 ENABLE=[01]/.test(line) && !/THRESHOLD/.test(line),
            true);
        say('and the droplet is drawn from a real humidity',
            !!d.querySelector('.dry-drop svg rect'), true);
        $('.dialog-x').click(); await wait(60);
      }
      say('and closing it sent nothing', $$('.dialog').length, 0);
    } else {
      info('no unit on this machine, so no dryer chip');
    }
  } catch (e) { out.push('FAIL  threw: ' + ((e && e.stack) || e)); }
  window.__report = out.join('\n'); })();
})();
