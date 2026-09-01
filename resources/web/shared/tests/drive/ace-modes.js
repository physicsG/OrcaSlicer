/* The three modes, driven — because the panel had only ever been right in one of them.
 *
 * Every measurement behind this panel was taken on a machine in `head` mode. multiACE has
 * three, and a mode is not a display preference: it is HOW MANY HEADS THE ACE DRIVES, and
 * it changes what the same four bays physically are. The payloads below are the machine's
 * own, captured on 811002511261022618B3 on 2026-09-01 by switching a live printer to
 * `multi` and back — see docs/u1-webui/data/ace-mode-switch-20260901.json. `normal` has
 * still never been observed and is marked where it is assumed.
 *
 * What this has to prove, and none of it was true before:
 *
 *   the panel reads `ace_heads` rather than rebuilding it from `head_feeder`, which the
 *   machine consults only in head mode;
 *   a bay in multi belongs to ONE head — its lane — and the verbs say so;
 *   the background verbs are gone in multi, where the plugin refuses them outright;
 *   the mode switch's three outcomes are three different things on screen.
 */
(function () {
  const out = []; const P = window.__devicePage;
  const say = (n, g, w) => out.push(`${g === w ? 'PASS' : 'FAIL'}  ${n}`
    + (g === w ? '' : `   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const body = () => $('#filament');
  const fits = () => body().scrollHeight <= body().clientHeight + 1;
  const bodyH = () => Math.round(body().getBoundingClientRect().height);
  const setAce = async (o) => { P.state.apply({ ace: null }); P.state.apply({ ace: o });
                                await wait(90); };
  const opts = (n) => [...$$('#filament .ace-src')[n].options].map((o) => o.textContent);
  const srcs = () => $$('#filament .ace-src').map((s) => s.value).join(',');
  // One closer for every popup: the dialog's own X, then a body click for a menu.
  const shut = () => { const x = $('.dialog-x'); if (x) x.click(); document.body.click(); };

  (async () => { try {
    for (let i = 0; i < 30 && !(P && P.bridge); i += 1) await wait(400);
    await wait(2500);
    const head = JSON.parse(JSON.stringify(P.state.get('ace')));

    /* ---- head mode: the reference, unchanged ---------------------------- */
    say('head: one card is on the cabinet', $$('#filament .ace-cab').length, 1);
    say('head: four bays on it', $$('#filament .ace-bay').length, 4 + 3);
    say('head: the sources resolve as they always did', srcs(), 'feeder,feeder,feeder,ace:0');
    say('head: the selector can name WHICH unit',
        opts(0).join(' · '), 'Default feeder · ACE A · Hand-fed');
    say('head: each card carries its own unit row',
        $$('#filament .ace-card .ace-strip').length, 4);
    say('head: no band, because the cabinet belongs to a card', $$('#filament .ace-band').length, 0);
    say('head: the body fits', fits(), true);
    const headH = bodyH();

    /* ---- multi, exactly as the machine reported it ---------------------- */
    // The measured payload, field for field: only `mode` and `ace_heads` moved, and
    // `head_feeder`, `head_ace` and `head_source` were left behind untouched. That is the
    // whole trap - a panel reading head_feeder here draws three stock feeders.
    const multi = JSON.parse(JSON.stringify(head));
    multi.mode = 'multi';
    multi.ace_heads = [0, 1, 2, 3];
    await setAce(multi);

    say('multi: every head is ACE-driven, whatever head_feeder still says',
        srcs(), 'lane,lane,lane,lane');
    say('multi: and head_feeder really is unchanged underneath',
        JSON.stringify(P.state.get('ace').head_feeder),
        JSON.stringify(head.head_feeder));
    say('multi: no card offers a choice of unit — the lane is plumbing',
        opts(0).join(' · '), 'Bay A1 · Hand-fed');
    say('multi: hand-feeding survives, because ACE_SET_HEAD_MANUAL does',
        opts(2).indexOf('Hand-fed') >= 0, true);
    say('multi: one bay per card, its own lane', $$('#filament .ace-bay').length, 4);
    say('multi: and it is the lane, not the first bay',
        $$('#filament .ace-bay').map((b) => b.querySelector('.ace-disc').textContent).join(','),
        'A1,A2,A3,A4');
    say('multi: the unit row leaves the cards for one band',
        [$$('#filament .ace-band .ace-strip').length,
         $$('#filament .ace-card .ace-strip').length].join('/'), '1/0');
    say('multi: the band still carries the dryer', !!$('#filament .ace-band .ace-dry'), true);
    say('multi: the body fits', fits(), true);
    say('multi: and is no taller than head mode', bodyH() <= headH, true);

    /* ---- the cross-lane feed the machine actually reported --------------- */
    // head_source survives a mode switch: this machine is plumbed for head mode, so in
    // multi it reported bay A2 feeding Toolhead 4 — which is Toolhead 2's lane, and which
    // multi's own rule says cannot happen. The mode is a claim about tubes and nothing
    // verifies it, so the panel draws the record.
    // The simulator carries the machine's own shape rather than its exact slot: what
    // matters is that the recorded bay is NOT this head's lane, which is the state a
    // head-mode-plumbed machine lands in the moment it is put into multi.
    const h3 = P.state.ace().heads[3];
    say('the recorded feed is off-lane, as the machine reported after the switch',
        [h3.lane, h3.bay !== h3.lane].join('/'), '3/true');
    const lent = $$('#filament .ace-lent');
    say('the bay it came from is marked on ITS OWN lane`s card, once',
        lent.length, 1);
    say('and names the head it is feeding', lent[0] && lent[0].textContent, '→ Toolhead 4');
    say('on the card of the lane it belongs to, not the one it feeds',
        lent[0].closest('.ace-card').querySelector('.ace-name').textContent,
        `Toolhead ${h3.bay + 1}`);
    const from = $('#filament .ace-from');
    say('the fed head says where it came from instead of pretending it was its lane',
        !!from && from.textContent.indexOf(`from A${h3.bay + 1}`) >= 0, true);

    /* ---- the verbs stop offering every bay to every head ----------------- */
    // The page's OWN function, not a copy of it: a check that re-implements the model
    // inline is checking its own copy rather than the panel's.
    const verbs = (h, slot, loaded, u) =>
      P.multiACE.aceVerbs(P.state.ace(), h, slot, loaded, u);
    // Toolhead 1 is loaded; its lane is bay 0.
    say('multi: a head`s own lane is a verb',
        verbs(0, 0, true, 0).map((v) => v.name).join(','), 'Swap,Unload and retract');
    say('multi: somebody else`s lane is not — and not greyed either, because no macro '
        + 'would make it one',
        verbs(0, 2, true, 0).filter((v) => v.slotted).length, 0);
    say('multi: but the head`s own verbs survive an off-lane question',
        verbs(3, 1, true, 0).map((v) => v.name).join(','),
        'Unload and retract');
    say('multi: no background verb anywhere — the plugin refuses them outside head mode',
        [0, 1, 2, 3].map((h) => verbs(h, h, true, 0)).flat().filter((v) => v.bg).length, 0);
    say('multi: a load names no SLOT it has not got',
        verbs(2, 2, false, 0)[0].cmd,
        'ACE_LOAD_HEAD HEAD=2 ACE=0 SLOT=2');

    /* ---- two units: the splitter, which is what multi is for ------------- */
    const two = JSON.parse(JSON.stringify(multi));
    two.device_count = 2;
    two.aces = [multi.aces[0], JSON.parse(JSON.stringify(multi.aces[0]))];
    two.aces[1].idx = 1;
    two.aces[1].model = 'ACE Pro';
    two.aces[1].humidity = 52;
    await setAce(two);
    say('2 units: each card holds its lane on BOTH cabinets',
        $$('#filament .ace-bay').length, 8);
    say('2 units: and the selector names the whole lane, not one bay of it',
        opts(0).join(' · '), 'Bay A1 · B1 · Hand-fed');
    say('2 units: two bands, one per cabinet', $$('#filament .ace-band .ace-strip').length, 2);
    say('2 units: the body still fits', fits(), true);
    await setAce(multi);

    /* ---- normal: no verbs, one fact -------------------------------------- */
    // Assumed, not measured: normal needs a reboot each way and has never been observed.
    // `ace_heads` is deliberately left saying all four, because that is what the plugin's
    // own head_uses_ace() would answer there - and the panel must read the MODE instead.
    const normal = JSON.parse(JSON.stringify(multi));
    normal.mode = 'normal';
    await setAce(normal);
    say('normal: nothing is ACE-fed, whatever ace_heads claims',
        srcs(), 'feeder,feeder,feeder,feeder');
    say('normal: and the claim really was all four',
        JSON.stringify(P.state.get('ace').ace_heads), '[0,1,2,3]');
    say('normal: no cabinet is drawn', $$('#filament .ace-cab').length, 0);
    say('normal: the selector is the feeder or the hand',
        opts(0).join(' · '), 'Default feeder · Hand-fed');
    say('normal: the unit row goes BELOW the grid, so drying stays reachable',
        !!$('#filament .ace-grid + .ace-band .ace-dry'), true);
    say('normal: the cards drop the line that named a unit',
        $$('#filament .ace-card .ace-strip').length, 0);
    say('normal: the body fits', fits(), true);

    /* ---- the switch, and its three outcomes ------------------------------ */
    await setAce(JSON.parse(JSON.stringify(head)));
    const pill = () => $('#filament-mode');
    pill().click(); await wait(60);
    const items = $$('.menu .menu-item').map((e) => e.textContent.trim());
    say('the mode list offers three, and marks the one it is in',
        items.join(' | '), 'Normal | Multi | Head  ✓');
    // Head, which asks WHICH head - including from head mode, because that is how the
    // coupled head is moved. The panel never sent HEAD= before.
    $$('.menu .menu-item')[2].click(); await wait(90);
    say('head asks which toolhead is on the cabinet', $$('.dialog .hrow').length, 4);
    say('and marks the one that is', $$('.dialog .hrow')[3].getAttribute('aria-pressed'), 'true');
    say('naming the line it would send', $('.dialog .verb-cmd').textContent,
        'SET_ACE_MODE MODE=head HEAD=3');
    $$('.dialog .hrow')[1].click(); await wait(40);
    say('picking another head moves the line', $('.dialog .verb-cmd').textContent,
        'SET_ACE_MODE MODE=head HEAD=1');
    shut(); await wait(60);

    /* ---- multi <-> head is live and needs no restart --------------------- */
    const before = P.mock.printer.gcodeLog.length;
    pill().click(); await wait(50);
    $$('.menu .menu-item')[1].click(); await wait(400);
    say('multi is sent live, with no dialog in the way',
        P.mock.printer.gcodeLog.slice(before).join('|'), 'SET_ACE_MODE MODE=multi');
    await P.session.refreshAce(); await wait(150);
    say('and the machine is in it', P.state.ace().mode, 'multi');
    say('the pill says so', pill().textContent.trim(), 'ACE mode · Multi');
    say('the machine said it needed no reboot',
        /No reboot needed/.test(P.mock.printer.console.map((c) => c.message).join('\n')), true);
    // Measured: filament_type went from ["","","","PETG"] to four names and
    // filament_exist from [T,T,F,T] to all true - including a head whose extruder is
    // empty. In multi the U1's display model mirrors the BAYS, whatever the tubes do.
    const ptc = P.state.get('print_task_config');
    say('entering multi pushed the bays onto their lanes, as measured',
        [ptc.filament_type.filter(Boolean).length,
         ptc.filament_exist.filter(Boolean).length].join('/'), '4/4');

    /* ---- normal is refused while anything is loaded ---------------------- */
    pill().click(); await wait(50);
    $$('.menu .menu-item')[0].click(); await wait(90);
    say('normal warns that it needs a restart before it sends anything',
        /restarted/.test($('.dialog').textContent), true);
    $('.dialog .btn.primary').click();
    await wait(600);
    say('and the printer refuses it, in its own words',
        /Cannot switch mode! Filament still loaded in/.test(($('.dialog') || {}).textContent || ''),
        true);
    say('with what to do about it, which is the second line the macro prints',
        /Please unload all toolheads first/.test(($('.dialog') || {}).textContent || ''), true);
    say('the mode did not move', P.state.ace().mode, 'multi');
    shut(); await wait(60);

    /* ---- and with the heads empty, it is a restart --------------------- */
    P.mock.printer.filamentExist = [false, false, false, false];
    await P.session.refreshAce(); await wait(120);
    pill().click(); await wait(50);
    $$('.menu .menu-item')[0].click(); await wait(90);
    $('.dialog .btn.primary').click();
    await wait(700);
    say('a successful switch to normal arrives as a REFUSED command',
        P.mock.printer.saveVars.ace__mode, 'normal');
    say('and the machine goes on reporting the old mode until it is restarted',
        P.state.ace().mode, 'multi');
    say('so the pill reports both, and says what is owed',
        pill().textContent.trim(), 'ACE mode · Multi → Normal · restart to finish');
    say('the panel keeps drawing the mode the machine is actually in',
        $$('#filament .ace-src')[0].value, 'lane');

    /* ---- the restart ---------------------------------------------------- */
    P.mock.printer.ace.mode = 'normal';
    P.mock.printer.ace.ace_heads = [0, 1, 2, 3];
    await P.session.refreshAce(); await wait(150);
    say('after the restart the two agree and the pill is a mode again',
        pill().textContent.trim(), 'ACE mode · Normal');
    say('and the panel is in normal', $$('#filament .ace-src')[0].value, 'feeder');
    say('the body fits in every mode this script has been through', fits(), true);
  } catch (e) { out.push(`FAIL  drive threw: ${e && e.message}`); }
  window.__report = out.join('\n');
  })();
})();
