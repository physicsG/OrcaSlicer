/* What the panel offers on the REAL machine, and what that machine says it is doing.
 *
 * READ-ONLY, deliberately and permanently, for the same reason drive/ace-real.js is: every
 * verb on this surface is minutes of physical work on a printer with filament in it, and
 * ACE_BG_SWAP's own help says it purges ~60 mm through an open dock. A suite is not a
 * thing that should be able to do that. So this opens sheets and menus, reads what they
 * offer, dumps what `channel_state` actually says, and sends nothing.
 *
 * What only hardware can answer, and why it is worth a script:
 *   - `channel_state` is what the step bar reads. The words come from HelixScreen's
 *     classification of this firmware; this is the first time this page has looked at the
 *     field on a real machine, and it prints what it finds rather than asserting a guess.
 *   - `ace_bg_swap.enabled_heads` is `[]` here, so the refusal is the state the panel is
 *     actually in - which makes it the state most worth checking is drawn well.
 */
(function () {
  const out = []; const P = window.__devicePage;
  const say = (n, g, w) => out.push(`${g === w ? 'PASS' : 'FAIL'}  ${n}`
    + (g === w ? '' : `   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const note = (t) => out.push('    ' + t);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const shut = () => { const x = $('.dialog-x'); if (x) x.click(); };

  (async () => {
    try {
      const ace = P.state.ace();
      say('the machine has multiACE', ace.present, true);

      /* ---- what the printer says each channel is doing --------------------- */
      // Printed, not asserted: this is the field the step bar reads and the first look at
      // it on hardware. An idle machine should say an idle word, and which word it uses
      // is a fact about this firmware.
      const feeds = P.state.feedChannels();
      note('channel_state per head: '
           + feeds.map((f, i) => `${i}=${(f && f.channelState) || 'null'}`).join(' '));
      note('feed sensors: ' + feeds.map((f) => f
           ? `${f.inAce ? 'ace' : '-'}/${f.inToolhead ? 'tube' : '-'}/${f.atExtruder ? 'ext' : '-'}` 
           : 'none').join(' '));
      say('every head reports a channel state at all',
          feeds.filter((f) => f && f.channelState).length, 4);
      say('and the panel draws no step bar for an idle one',
          $$('#filament .ace-flight').length, 0);

      /* ---- the gate, as this machine has it ------------------------------- */
      note('ace_bg_swap.enabled_heads: ' + JSON.stringify(ace.bgHeads)
           + '  version: ' + ace.bgVersion);
      say('the gate is read in the same call as `ace`', Array.isArray(ace.bgHeads), true);

      /* ---- the bay sheet, on the head this machine actually feeds ---------- */
      const fedHead = ace.heads.findIndex((h) => h.source === 'ace' && h.bay != null);
      say('one head is fed from a bay', fedHead >= 0, true);
      const fedBay = ace.heads[fedHead].bay;
      note(`toolhead ${fedHead + 1} is fed from bay ${fedBay}`);

      const card = $$('#filament .ace-card')[fedHead];
      const bays = [...card.querySelectorAll('.ace-bay')];
      bays[fedBay].click(); await wait(120);
      say('clicking the bay that is feeding opens its sheet', !!$('.dialog'), true);
      say('and it offers no load and no swap, because neither is a verb here',
          $$('.dialog .verb').length, 0);
      say('saying which it is rather than showing an empty sheet',
          /Already feeding/.test($('.dialog').textContent), true);
      shut(); await wait(80);

      const other = [0, 1, 2, 3].find((k) => k !== fedBay);
      bays[other].click(); await wait(120);
      const verbs = $$('.dialog .verb').map((e) => ({
        name: e.querySelector('.verb-name').textContent,
        cmd: e.querySelector('.verb-cmd').textContent,
        off: e.disabled,
      }));
      note('bay sheet offers: ' + verbs.map((v) => `${v.name}${v.off ? ' (off)' : ''}`).join(', '));
      say('a different bay offers the two that take a slot', verbs.length, 2);
      say('the first is a swap, because that head is loaded',
          verbs[0].name.split(' — ')[0], 'Swap');
      say('and it names the line it would send, with this machine`s own indices',
          verbs[0].cmd, `ACE_SWAP_HEAD HEAD=${fedHead} ACE=0 SLOT=${other}`);
      say('the background one is refused on this machine',
          verbs[1].off, true);
      say('and names ACE_BG_SET_HEAD, which is what would lift it',
          verbs[1].cmd, `ACE_BG_SET_HEAD HEAD=${fedHead} ENABLE=1`);
      say('with a control that would send exactly that', !!$('.verb-gate'), true);
      shut(); await wait(80);

      /* ---- the card menu, on the same head --------------------------------- */
      card.querySelector('.ace-more').click(); await wait(120);
      const items = $$('.menu .menu-item').map((b) => ({
        label: b.querySelector('span:not(.mcmd)').textContent,
        cmd: (b.querySelector('.mcmd') || {}).textContent,
        muted: b.classList.contains('is-muted'),
      }));
      note('card menu: ' + items.map((i) => `${i.label}${i.muted ? ' (muted)' : ''}`).join(', '));
      say('the menu carries the verbs that take no slot',
          items.filter((i) => /nload/.test(i.label)).map((i) => i.label).join(','),
          'Unload and retract,Background unload');
      say('an ACE unload retracts into the bay, which a feeder cannot',
          items.find((i) => i.label === 'Unload and retract').cmd, 'ACE_UNLOAD_HEAD');
      say('and the refused one names its gate, not the macro it cannot run',
          items.find((i) => i.label === 'Background unload').cmd, 'ACE_BG_SET_HEAD');
      document.body.click(); await wait(80);

      /* ---- the toolhead, on the machine ------------------------------------ */
      // The other thing you can click. Read-only like the rest: the sheet is opened, what
      // it offers is read, and it is closed. Nothing in it is pressed.
      say('every toolhead is a target on the real panel',
          $$('#filament .ace-tool.is-target').length, 4);
      const tool = $$('#filament .ace-tool')[fedHead];
      tool.click(); await wait(160);
      say('clicking one opens that head`s sheet',
          $('.dialog h3').textContent, `Toolhead ${fedHead + 1}`);
      const picks = $$('.dialog .pickbay').map((b) => ({
        addr: b.querySelector('.pickdisc').textContent,
        does: b.querySelector('.picklab').textContent,
        off: b.disabled,
      }));
      note('bays brought to the sheet: '
           + picks.map((p) => `${p.addr}=${p.does}${p.off ? '(off)' : ''}`).join(' '));
      say('all four bays come to it, because a head is not a slot', picks.length, 4);
      say('and the one already feeding is the one that is not offered',
          picks.findIndex((p) => p.off), fedBay);
      say('the head`s own verbs are below them',
          $$('.dialog .verb .verb-name').map((e) => e.textContent.split(' — ')[0]).join(','),
          'Unload and retract,Background unload');
      note('head sheet identity: ' + $('.dialog .verb-idtext').textContent);
      shut(); await wait(80);

      /* ---- a stock feeder head, which has one verb at a time ---------------- */
      const feedHead = ace.heads.findIndex((h) => h.source !== 'ace');
      const fcard = $$('#filament .ace-card')[feedHead];
      fcard.querySelector('.ace-more').click(); await wait(120);
      const f = $$('.menu .menu-item span:not(.mcmd)').map((e) => e.textContent);
      /*
       * Against the SENSOR, not the job record - and on this machine the two disagree,
       * which is the whole reason the panel was changed.
       *
       * `print_task_config.filament_exist` is what the slicer assigned to the slot and is
       * not cleared by a physical unload; `filament_at_extruder` is what is in the head.
       * A head unloaded by hand reads loaded in the first and empty in the second, and
       * the panel offering `Unload` again was this check's expectation being right about
       * the wrong field.
       */
      const job = !!(P.state.filaments()[feedHead] || {}).loaded;
      const feed = P.state.feedChannels()[feedHead] || {};
      const loaded = P.state.headLoaded(feedHead);
      note(`toolhead ${feedHead + 1} is a stock feeder · ${feed.channelState}/`
           + `${feed.actionState} says ${loaded ? 'loaded' : 'empty'} · at_extruder says `
           + `${feed.atExtruder ? 'loaded' : 'empty'} · print_task_config says `
           + `${job ? 'loaded' : 'empty'}`);
      say('it offers exactly one of load and unload, and follows the sensor',
          f.filter((t) => /^(Load|Unload)$/.test(t)).join(','), loaded ? 'Unload' : 'Load');
      say('and never a swap, because it has no second bay',
          f.some((t) => /^Swap/.test(t)), false);
      document.body.click(); await wait(80);

      /* ---- the field that says whether a head is holding filament ---------- */
      /*
       * Reported twice, and the second report is why this section exists: an emptied
       * toolhead went on offering `Unload`, and the fix that made every simulated check
       * pass - reading `filament_at_extruder` - did nothing here, because on this machine
       * that field does not go false when a head is emptied.
       *
       * A simulator cannot catch that. It can only be wrong in the ways it was written to
       * be wrong, and it was written from the same belief as the panel. So this asserts
       * against the machine that the three plausible fields disagree with each other, and
       * that the panel is reading the one that is right.
       */
      const feeds = P.state.feedChannels();
      const occ = feeds.map((f, i) => P.state.headLoaded(i));
      feeds.forEach((f, i) => note(`head ${i}: ${f.channelState}/${f.actionState}`
        + ` · at_extruder=${f.atExtruder} detected=${f.detected} in_toolhead=${f.inToolhead}`
        + ` · occupied=${occ[i]}`));

      // Not a fixed expectation - what is loaded depends on what was left in the machine.
      // What CAN be asserted is that the panel and the model never diverge, and that the
      // marker, the sheet and the menu are three views of one answer.
      for (let i = 0; i < 4; i++) {
        const mark = $$('#filament .ace-sensor')[i];
        say(`head ${i + 1}: the marker draws the occupancy the model decided`,
            mark.classList.contains('is-at') || mark.classList.contains('is-err'), occ[i]);
      }
      const emptied = feeds.findIndex((f) => f.actionState === 'unload_finish');
      if (emptied < 0) {
        note('no head reports channel_action_state: unload_finish - nothing has been '
             + 'unloaded since boot, so the case that was reported is not on the machine '
             + 'right now.');
      } else {
        note(`head ${emptied} was unloaded: at_extruder=${feeds[emptied].atExtruder}`
             + ` (the field that was believed), job=`
             + `${!!(P.state.filaments()[emptied] || {}).loaded} (the field before that)`);
        say('an unloaded head is empty however loaded the other two fields look',
            occ[emptied], false);
        $$('#filament .ace-tool')[emptied].click(); await wait(220);
        say('and it offers Load rather than Unload again',
            $$('.dialog .verb .verb-name').map((e) => e.textContent)
              .filter((t) => /^(Load|Unload)/.test(t)).join(','), 'Load');
        const x = $('.dialog-x'); if (x) x.click();
        document.body.click(); await wait(120);
      }

      /* ---- what the printer said, when it said no ------------------------- */
      /*
       * A swap reported "Nothing started. The toolhead is waiting for filament." after
       * twenty-five seconds. The printer had answered in under one, in two places the
       * page was not reading:
       *
       *   ace.last_swap_result  {head:3, ace:0, slot:1, status:"error", ts:...}
       *   the console           !! Must home Z axis first: 229.300 250.000 277.000
       *
       * `toolhead.homed_axes` was "xy" - ACE_SWAP_HEAD parks and picks a head and does
       * not home first, unlike the U1's own feeder verbs. The `sw_SendGCodes` reply was
       * `ok`, which on this machine is not a yes.
       *
       * Read-only: this asserts the page can REACH both, using whatever the machine
       * already has in it. It sends nothing.
       */
      const aceNow2 = P.state.ace();
      note(`ace.lastSwap: ${JSON.stringify(aceNow2.lastSwap)}`
           + ` · swapping=${aceNow2.swapping} phase=${aceNow2.swapPhase}`);
      say('the swap fields the panel now watches are on this machine',
          [typeof aceNow2.swapping, 'lastSwap' in aceNow2].join('/'), 'boolean/true');

      const { gcodeStoreUrl, lastPrinterError } = P.multiACE;
      const url = gcodeStoreUrl(P.device, 40);
      say('and a Moonraker console URL can be built for it', !!url, true);
      let store = null;
      try { const r = await fetch(url, { cache: 'no-store' });
            store = r.ok ? await r.json() : null; } catch (e) { store = null; }
      say('the page can read the printer`s console across the origin',
          !!(store && store.result && store.result.gcode_store), true);
      const said = lastPrinterError(store);
      note(`the last error the printer printed: ${said === null ? '(none)' : said}`);
      say('and lastPrinterError returns a line or null, never a stray `!!`',
          said === null || (typeof said === 'string' && !said.startsWith('!!')), true);

      say('the body still fits its 456 on the real machine',
          $('#filament').scrollHeight <= $('#filament').clientHeight + 1, true);
    } catch (e) { out.push('FAIL  threw: ' + ((e && e.stack) || e)); }
    window.__report = out.join('\n');
  })();
})();
