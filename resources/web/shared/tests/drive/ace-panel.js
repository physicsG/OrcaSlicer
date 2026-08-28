/* The multiACE Filament panel, driven through states the synchronous checks cannot
   reach: no ACE at all, four units, a source switched, the dryer run, and both menus.

   `ace` is not on the subscription, so nothing pushes it - which is exactly why this has
   to drive rather than read. Every state below is reached the way the page reaches it:
   the machine's mirror changes and the page is asked to look again. */
(function () {
  const out = []; const P = window.__devicePage;
  const say = (n, g, w) => out.push(`${g === w ? 'PASS' : 'FAIL'}  ${n}`
    + (g === w ? '' : `   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const body = () => $('#filament');
  const fits = () => body().scrollHeight <= body().clientHeight + 1;
  /* Replace the object outright. MachineState merges per object - a partial push must
     not drop fields - so writing a new `ace` over the old one would leave the old unit
     list underneath it. */
  const setAce = async (o) => { P.state.apply({ ace: null }); P.state.apply({ ace: o });
                                await wait(80); };
  const unit = (i, bays) => ({
    idx: i, connected: true, protocol: 'v2', firmware: 'V1.1.26',
    temp: 30 + i, humidity: 38 + i * 6, gate_status: bays.map((b) => (b ? 1 : 0)),
    dryer_status: { status: 'idle' },
    slots: bays.map((b, k) => ({ index: k, state: b ? 'ready' : 'empty', rfid: b ? b.rfid || 0 : 0,
                                 material: b ? b.m : '', brand: b ? b.v : '',
                                 color: b ? b.c : [0, 0, 0] })),
  });

  (async () => { try {
    for (let i = 0; i < 30 && !(P && P.bridge); i += 1) await wait(400);
    await wait(2500);
    const measured = JSON.parse(JSON.stringify(P.state.get('ace')));

    say('the page is up with no paint error',
        $$('[data-paint-error]').map((e) => e.id).join(','), '');

    /* ---- what the machine actually reports ---------------------------- */
    // The fourth card is the ACE one: heads 1-3 are on their stock feeders, which is
    // what head_feeder says and what head_ace does not.
    say('one unit is drawn, and it is an ACE 2 Pro',
        $$('#filament .ace-unit')[3].textContent.trim(), 'ACE A · ACE 2 Pro');
    say('its humidity and temperature are the machine`s',
        $$('#filament .ace-hum span').map((e) => e.textContent).filter(Boolean).join('/'),
        '38 %/30 °C');
    /* ---- where a bay's identity comes from ------------------------------ */
    // Every raw slot reads {material:"", brand:"", rfid:0} - these spools have no tags -
    // and multiACE keeps the names its own web UI shows in an override store. Orca's
    // Prepare page polls the MERGED endpoint from C++ and saw filament this panel drew
    // as `?`, which is what turned this up.
    say('a bay is named from multiACE`s own store',
        $$('#filament .ace-cab .ace-chip').map((e) => e.textContent).join(','),
        'PETG,PETG,PETG,PETG');
    say('and the mark says where the name came from',
        $$('#filament .ace-cab .ace-prov')
          .map((e) => (/multiACE/.test(e.title) ? 'o' : /read only/.test(e.title) ? 'r' : 'd'))
          .join(''), 'oooo');

    // Without the store there is nothing to merge, and the panel has to say so rather
    // than invent. This is also every printer that has no multiACE web service.
    const store = P.store.aceBays;
    P.store.aceBays = null;
    P.state.apply({ ace: JSON.parse(JSON.stringify(measured)) }); await wait(80);
    say('with no override store an occupied bay says it is not named',
        $$('#filament .ace-cab .ace-chip').map((e) => e.textContent).join(','),
        '?,?,PETG,?');
    say('and the one that IS named got there from head_source, which is weaker',
        $$('#filament .ace-cab .ace-prov')
          .map((e) => (/loaded filament/.test(e.title) ? 'd' : '-')).join(''), '--d-');

    // multiACE's own precedence, kept: a tag beats a name someone typed.
    const tagged = JSON.parse(JSON.stringify(measured));
    tagged.aces[0].slots[0] = { index: 0, status: 'ready', rfid: 2, material: 'PLA',
                                brand: 'Jayo', subtype: '', sku: '', color: [244, 67, 54] };
    P.store.aceBays = store;
    await setAce(tagged);
    say('a tagged bay keeps the tag`s answer, not the override`s',
        $$('#filament .ace-cab .ace-chip')[0].textContent, 'PLA');
    say('and it reads rather than edits',
        /read only/.test($$('#filament .ace-cab .ace-prov')[0].title), true);
    await setAce(JSON.parse(JSON.stringify(measured)));
    say('the rest are the store`s again',
        $$('#filament .ace-cab .ace-chip').map((e) => e.textContent).join(','),
        'PETG,PETG,PETG,PETG');
    say('and it is never drawn with the checkerboard, which is this page`s word for empty',
        $$('#filament .ace-cab .ace-disc').filter((e) => !e.dataset.loaded).length, 0);
    say('a named bay is drawn in its own colour rather than in the unknown grey',
        $$('#filament .ace-cab .ace-disc')
          .filter((e) => e.style.background === 'rgb(183, 189, 198)').length, 0);
    say('the bay the head is loaded from is the marked one',
        $$('#filament .ace-cab .ace-bay').findIndex((e) => e.classList.contains('is-fed')), 2);

    /* ---- no ACE at all ------------------------------------------------- */
    // The degradation path, and the one a stock U1 is always on: no `ace` object means
    // no unit to describe and no macro to send, so the panel is the one that shipped.
    P.state.apply({ ace: null }); await wait(80);
    say('with no `ace` object the panel falls back to the four slots',
        $$('#filament .slot').length + ':' + $$('#filament .ace-card').length, '4:0');
    say('and the mode pill says why it is dead',
        document.getElementById('filament-mode').disabled, true);
    say('the header stops claiming units', $('#filament-ace').textContent, 'no ACE');
    document.getElementById('filament-settings').click();
    say('the settings menu says there is nothing to configure',
        $('.menu .menu-item').classList.contains('is-muted'), true);
    document.body.click(); await wait(30);

    /* ---- four units, which is sixteen bays ----------------------------- */
    // Head-major never folds: a card shows only ITS own source, so four units is drawn in
    // the same height as none. Unit-major has to collapse to a rack at three.
    const four = JSON.parse(JSON.stringify(measured));
    four.device_count = 4;
    four.head_feeder = { 0: false, 1: false, 2: false, 3: false };
    four.head_ace = { 0: 0, 1: 1, 2: 2, 3: 3 };
    four.aces = [
      unit(0, [{ m: 'PETG', v: 'Kingroon', c: [131, 175, 255], rfid: 2 }, { m: 'PETG', v: 'Kingroon', c: [143, 167, 200] },
               { m: 'PETG', v: 'Generic', c: [99, 44, 44] }, { m: 'PETG', v: 'Kingroon', c: [196, 112, 83] }]),
      unit(1, [{ m: 'PLA', v: 'Jayo', c: [31, 138, 76] }, { m: 'PLA', v: 'Jayo', c: [240, 240, 240] },
               null, { m: 'PLA', v: 'Generic', c: [43, 43, 43] }]),
      unit(2, [{ m: 'PETG', v: 'Generic', c: [232, 177, 42] }, { m: 'PETG', v: 'Generic', c: [122, 79, 208] },
               { m: 'PETG', v: 'Generic', c: [214, 214, 214] }, null]),
      unit(3, [{ m: 'ABS', v: 'Generic', c: [15, 111, 209] }, { m: 'ABS', v: 'Generic', c: [201, 201, 201] },
               null, null]),
    ];
    await setAce(four);
    say('four units is sixteen bays', $$('#filament .ace-bay').length, 16);
    say('and it costs the panel nothing, because a card shows only its own source',
        fits() && Math.round($('#filament .ace-card').getBoundingClientRect().height) === 215,
        true);
    say('each card names its own unit',
        $$('#filament .ace-unit b').map((e) => e.textContent).join(','),
        'ACE A,ACE B,ACE C,ACE D');
    say('a tagged spool reads and the rest edit',
        $$('#filament .ace-card')[0].querySelectorAll('.ace-prov').length, 4);
    say('the tagged bay reads and the typed ones edit',
        [...$$('#filament .ace-card')[0].querySelectorAll('.ace-prov')]
          .map((e) => (/read only/.test(e.title) ? 'eye' : 'pencil')).join(','),
        'eye,pencil,pencil,pencil');

    /* ---- one unit feeding three heads ---------------------------------- */
    // ACE_SET_HEAD_ACE binds a head to a unit and says nothing about the reverse. The
    // duplication objection is answered where it happens: the reading risk, not the
    // drawing.
    const shared = JSON.parse(JSON.stringify(four));
    shared.device_count = 1;
    shared.head_ace = { 0: 0, 1: 0, 2: 0, 3: 0 };
    shared.aces = [four.aces[0]];
    await setAce(shared);
    say('a unit feeding every head is drawn on every card it feeds',
        $$('#filament .ace-cab').length, 4);
    say('and each says so, rather than looking like four cabinets',
        $$('#filament .ace-card.is-shared').length, 4);
    say('sixteen bays or four, the panel is the same height', fits(), true);

    /* ---- switching a source -------------------------------------------- */
    await setAce(JSON.parse(JSON.stringify(measured)));
    const before = P.mock.printer.gcodeLog.length;
    const sel = $('#filament .ace-card .ace-src');
    sel.value = 'ace:0';
    sel.dispatchEvent(new Event('change'));
    await wait(60);
    const sent = P.mock.printer.gcodeLog.slice(before).join(' | ');
    // head_feeder is read BEFORE head_ace, so binding a head to a unit without clearing
    // it changes nothing anyone can see.
    say('binding a head to a unit clears manual and feeder first',
        /ACE_SET_HEAD_MANUAL HEAD=0 ENABLE=0/.test(sent)
        && /ACE_SET_HEAD_FEEDER HEAD=0 ENABLE=0/.test(sent)
        && /ACE_SET_HEAD_ACE HEAD=0 ACE=0/.test(sent), true);
    say('and the switch holds what was asked for while it waits',
        $('#filament .ace-card .ace-src').value, 'ace:0');
    say('marked as unconfirmed rather than as fact',
        $('#filament .ace-card .ace-src').dataset.pend, 'sent');
    await P.session.refreshAce(); await wait(120);
    say('the machine agrees and the mark goes',
        $('#filament .ace-card .ace-src').dataset.pend, undefined);

    /* ---- the dryer ------------------------------------------------------ */
    $('#filament .ace-dry').click(); await wait(40);
    const d = $('.dialog');
    say('the Dry chip is what opens the dryer, and nothing else does', !!d, true);
    say('it draws the reading as a quantity', !!d.querySelector('.dry-drop svg'), true);
    say('the two readings are named as Bambu names them',
        [...d.querySelectorAll('.dry-k')].slice(0, 2).map((e) => e.textContent).join('/'),
        'Humidity/Temperature');
    say('three settings, and two of them take a number',
        d.querySelectorAll('.dry-field').length + ':' + d.querySelectorAll('.dry-custom').length,
        '3:2');
    const lit = () => [...d.querySelectorAll('.dry-field')]
      .map((f) => { const o = f.querySelector('.dry-opt.is-on'); return o ? o.textContent : '-'; })
      .join('/');
    // The line under the dialog used to be the macro it would send. It says what will
    // HAPPEN now - the numbers and the wire disagree (hours offered, minutes sent) and
    // that is a reason to get the conversion right, not to make the reader check the
    // arithmetic in G-code. The wire is still asserted, further down, on the wire.
    const cmd = () => d.querySelector('.dry-cmd').textContent;
    say('the presets are lit and the summary matches them',
        lit() + ' | ' + cmd(), '55 °C/4 h/Off | Dries at 55 °C for 4 h, and not automatically.');
    const type = (i, v) => { const e = d.querySelectorAll('.dry-custom')[i];
                             e.value = v; e.dispatchEvent(new Event('input')); return e; };
    type(0, '68');
    say('typing a temperature un-lights its preset', lit(), '-/4 h/Off');
    say('and the summary follows what was typed', /at 68 °C for 4 h/.test(cmd()), true);
    type(0, '');
    say('clearing it hands the highlight straight back', lit(), '55 °C/4 h/Off');
    const e0 = type(0, '999'); e0.dispatchEvent(new Event('change'));
    say('a value past what the macro takes is clamped, not refused',
        d.querySelectorAll('.dry-custom')[0].value, '80');
    d.querySelectorAll('.dry-field')[0].querySelectorAll('.dry-opt')[0].click();
    say('choosing a preset clears the typed value',
        d.querySelectorAll('.dry-custom')[0].value, '');
    say('and lights that preset', lit(), '45 °C/4 h/Off');
    say('the panel body is untouched while it is open', fits(), true);
    const nDry = P.mock.printer.gcodeLog.length;
    d.querySelector('.dialog-foot .btn.primary').click();
    await wait(700);
    // On the WIRE, which is where these two were always the point: the panel offers HOURS
    // and `ACE_DRY` takes MINUTES, so a dialog offering 4 would have dried for four
    // minutes; and automatic drying is ENABLE/RH_START, not the THRESHOLD that was
    // guessed - `ACE_SET_AUTO_DRY THRESHOLD=` answers `ok` and changes nothing.
    const dryLines = P.mock.printer.gcodeLog.slice(nDry).join('\n');
    say('the panel offers hours and the wire carries minutes',
        /ACE_DRY ACE=0 TEMP=45 DURATION=240/.test(dryLines)
        && !/DURATION=4\b/.test(dryLines), true);
    say('and automatic drying is ENABLE/RH_START, not the THRESHOLD that was guessed',
        !/THRESHOLD/.test(dryLines), true);
    say('starting it puts the chip on a countdown',
        /\d+ m \/ /.test($('#filament .ace-dry').textContent), true);
    say('and the chip`s row still does not overflow',
        $$('#filament .ace-strip').filter((e) => e.scrollWidth > e.clientWidth + 1).length, 0);
    $('#filament .ace-dry').click(); await wait(40);
    say('re-opening it offers Stop rather than Start',
        $('.dialog-foot .btn.primary').textContent, 'Stop');
    say('and says so, rather than naming the macro',
        $('.dialog .dry-cmd').textContent.trim(), 'Stops drying now.');
    const nStop = P.mock.printer.gcodeLog.length;
    // The claim that a running dryer refuses loads was never verified and the macro help
    // says nothing of the kind.
    say('and claims nothing about loads being refused',
        /refus/i.test($('.dialog').textContent), false);
    $('.dialog-foot .btn.primary').click(); await wait(700);
    // ACED__DRY_STOP stops "the current ACE", which on a machine with two units is
    // whichever is active rather than the one whose chip was pressed. The unit is named
    // on the wire; the dialog says what will happen.
    say('and stops THIS unit by name',
        P.mock.printer.gcodeLog.slice(nStop).join('\n').trim(), 'ACE_STOP_DRYING ACE=0');
    say('stopping it puts the chip back to offering',
        $('#filament .ace-dry').textContent.trim(), 'Dry');

    /* ---- the two menus, and their two scopes ---------------------------- */
    say('nothing is open to start with', $$('.menu').length, 0);
    document.getElementById('filament-settings').click(); await wait(30);
    say('the panel`s menu names the printer',
        $('.menu .menu-head').textContent, 'This printer');
    say('holding the settings a person sets once',
        $$('.menu .menu-item').length, 5);
    say('each named for what it sets, with no G-code on any of them',
        [$$('.menu .mcmd').length,
         $$('.menu .menu-item').some((b) => /ACE_[A-Z]/.test(b.title || ''))].join('/'),
        '0/false');
    say('and it is pulled inside the window rather than off its edge',
        $('.menu').getBoundingClientRect().right <= window.innerWidth + 1, true);
    document.body.click(); await wait(30);
    $$('#filament .ace-more')[3].click(); await wait(30);
    say('a card`s menu names its toolhead', $('.menu .menu-head').textContent, 'Toolhead 4');
    say('an ACE-fed head can swap to another bay',
        $$('.menu .menu-item').some((b) => /Swap/.test(b.textContent)), true);
    document.body.click(); await wait(30);
    $$('#filament .ace-more')[1].click(); await wait(30);
    say('a feeder-fed head cannot, because there are no other bays',
        $$('.menu .menu-item').some((b) => /Swap/.test(b.textContent)), false);
    // Not `Reload` any more, and not both verbs either. A stock feeder has one thing it
    // can be asked to do at a time - it holds filament or it does not - which is the rule
    // multiace-actions.html settled and aceVerbs() carries.
    say('a loaded stock feeder offers Unload, and only Unload',
        $$('.menu .menu-item span:not(.mcmd)').map((e) => e.textContent)
          .filter((t) => /^(Load|Unload)/.test(t)).join(','), 'Unload');
    document.body.click(); await wait(30);
    // Emptied the way the machine empties a head: `channel_action_state`, which is the
    // last operation the channel FINISHED. Not `print_task_config.filament_exist`, the
    // slicer's assignment, which survives a physical unload; and not
    // `filament_at_extruder`, which on the printer stayed TRUE on both emptied heads.
    // drive/ace-verbs.js pins down both wrong answers.
    // On the printer, not on the mirror: the simulator pushes a full snapshot every tick,
    // so a value written into the mirror survives only until the next one - which made
    // this check pass or fail on how long the script before it took.
    P.mock.printer.channels[1].act = 'unload_finish';
    await wait(1400);
    $$('#filament .ace-more')[1].click(); await wait(30);
    // An unload with nothing to unload is not a greyed control now, it is not a verb:
    // there is no reason to show for something that does not exist in this state.
    say('an empty one offers Load, and does not list Unload at all',
        $$('.menu .menu-item span:not(.mcmd)').map((e) => e.textContent)
          .filter((t) => /^(Load|Unload)/.test(t)).join(','), 'Load');
    document.body.click(); await wait(30);
    P.mock.printer.channels[1].act = 'load_finish';
    await wait(1400);
    say('a menu costs the panel body nothing', fits(), true);

    /* ---- the ACE's own icons, at the standard's sizes ------------------- */
    // The square glyph is the form for an icon slot the 44x26 cabinet cannot go in, and
    // 24x24 is its nominal size - which a menu row can take, so it is drawn at it.
    $$('#filament .ace-more')[3].click(); await wait(30);
    const sq = $('.menu .ace-glyph-sq');
    say('a menu row gets the square glyph at its nominal 24x24',
        sq ? `${Math.round(sq.getBoundingClientRect().width)}x`
           + `${Math.round(sq.getBoundingClientRect().height)}` : 'none', '24x24');
    say('and it is the front face - body and four bays, no hood',
        sq.querySelectorAll('rect').length, 5);
    say('nothing in the menu wraps now that a glyph and a macro share the row',
        $$('.menu .menu-item').filter((e) => e.getBoundingClientRect().height > 46).length, 0);
    document.body.click(); await wait(30);

    /* ---- the settings that ARE reported back ---------------------------- */
    // These were written as write-only on the assumption that none of them was readable.
    // Three of the four are right there in the object.
    document.getElementById('filament-settings').click(); await wait(30);
    $$('.menu .menu-item').find((b) => /Spoolman/.test(b.textContent)).click();
    await wait(60);
    say('the Spoolman dialog opens on the machine`s own URL',
        $('.dialog input[type="url"]').value, 'http://192.168.2.30:7912');
    say('and on its own auto-sync setting',
        $('.dialog .field-toggle input').checked, false);
    $('.dialog-x').click(); await wait(30);

    /* ---- clicking a bay --------------------------------------------------- */
    // A swap is minutes of physical work that purges filament, and the bays sit under the
    // pointer while someone is reading the card - so the click opens the bay's own sheet
    // and nothing is sent until a verb in it is pressed. What that sheet OFFERS is
    // drive/ace-verbs.js; what is checked here is that it asks at all, and costs nothing.
    // Which head it is depends on what the run has already switched - the source test
    // above left Toolhead 1 on ACE A - so it is read off the card rather than written
    // down.
    const withCab = $$('#filament .ace-card').findIndex((c) => c.querySelector('.ace-cab'));
    $$('#filament .ace-cab .ace-bay')[0].click(); await wait(40);
    say('clicking a bay asks first', !!$('.dialog'), true);
    // SWAP, and which one it is depends on what is physically in the head rather than on
    // what any record says. This head was switched to ACE A above, so `head_source` names
    // nothing from that unit - but the head still holds the filament its stock feeder put
    // there, and the sensor is what the verb list asks. Getting ACE A's filament in means
    // taking that out first, which is a swap.
    //
    // This expectation has moved twice, each time toward the more truthful answer: the
    // panel used to send ACE_SWAP_HEAD for everything because it is the macro that takes a
    // slot, then LOAD because `head_source` was empty, and now SWAP because the head is
    // not.
    // say() here compares with ===, so an array expectation can never match.
    say('and a bay says what state the head is in, without offering the swap',
        `${/is loaded/.test($('.dialog').textContent)}/${$$('.dialog .verb').length}`,
        'true/0');
    const n0 = P.mock.printer.gcodeLog.length;
    $('.dialog-x').click(); await wait(30);
    say('and closing it sends nothing', P.mock.printer.gcodeLog.length, n0);

    // The verb itself, where it is now chosen. Which one it is still depends on what is
    // physically in the head rather than on what any record says - that is the part of
    // this check worth keeping, and it moved to the toolhead with the verb.
    $$('#filament .ace-tool')[withCab].click(); await wait(60);
    say('the toolhead offers it, labelled per bay',
        $$('.dialog .pickbay .picklab').map((e) => e.textContent)[0], 'Swap');
    $('.dialog-x').click(); await wait(30);

    /* ---- the eye and the pencil ---------------------------------------- */
    // A mark has to agree with what the click does. Every slot wore the pencil and the
    // menu row read "View this filament" beside it, so the label and the icon disagreed
    // about which of the two this was. A tagged spool opens READ-ONLY: it gets the eye.
    const kind = (n) => (!n ? 'none' : n.querySelector('circle') ? 'eye'
                              : n.tagName.toLowerCase() === 'svg' ? 'pencil' : 'sprite');
    const tagInfo = (main) => ({ MAIN_TYPE: main, SUB_TYPE: 'Silk', VENDOR: 'Jayo',
                                 ARGB_COLOR: 4294198070, HOTEND_MIN_TEMP: 190,
                                 HOTEND_MAX_TEMP: 260, BED_TEMP: 45, SKU: 0 });
    // The mock ships four untagged spools, so the eye branch is vacuous without this.
    P.state.apply({ filament_detect: { state: [0, 0, 0, 0],
      info: [tagInfo('PLA'), tagInfo('NONE'), tagInfo('NONE'), tagInfo('NONE')] } });
    await wait(700);
    const idRow = () => $$('.menu .menu-item').filter((b) => /this filament/.test(b.textContent))[0];
    $$('#filament .ace-more')[0].click(); await wait(60);
    say('a tagged filament offers View, with the eye',
        `${/View this filament/.test(idRow().textContent)}/${kind(idRow().querySelector('svg'))}`,
        'true/eye');
    document.body.click(); await wait(60);
    $$('#filament .ace-more')[1].click(); await wait(60);
    say('and an untagged one offers Edit, with the pencil',
        `${/Edit this filament/.test(idRow().textContent)}/${kind(idRow().querySelector('svg'))}`,
        'true/pencil');
    document.body.click(); await wait(60);

    await setAce(null);
    say('with no ACE the page draws the four slots', $$('#filament .slot').length, 4);
    say('and the same pair marks them there',
        $$('#filament .slot').map((sl) =>
          `${sl.querySelector('.slot-tag') ? 'RFID' : '-'}:${kind(sl.querySelector('.pencil'))}`)
          .join(' '),
        'RFID:eye -:sprite -:sprite -:sprite');
    P.state.apply({ filament_detect: null });

    await setAce(measured);
    say('the page ends where it started', $$('#filament .ace-card').length, 4);
  } catch (e) { out.push('FAIL  threw: ' + ((e && e.stack) || e)); }
  window.__report = out.join('\n'); })();
})();
