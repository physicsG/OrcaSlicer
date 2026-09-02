/* What can be done to one filament, and what the machine is doing about it.
 *
 * Both were settled in docs/u1-webui/02-device-page/multiace-actions.html and neither can
 * be checked by reading the page: the verb list depends on the state the HEAD is in, and
 * the step bar on a `channel_state` that only moves during a three-minute physical swap.
 * So this drives both.
 *
 * The two halves reach their state by different routes, and the difference is worth
 * keeping in mind when adding to this:
 *
 *   `ace`            is NOT on the subscription, so the mirror can be written directly -
 *                    nothing pushes over it. That is what drive/ace-panel.js does.
 *   `filament_feed`  IS, so the simulator re-pushes its own snapshot and a write into the
 *                    mirror is gone within the second. The SIMULATED PRINTER is what has
 *                    to change, and the page then learns about it the way it would from a
 *                    real one.
 */
(function () {
  const out = []; const P = window.__devicePage;
  const say = (n, g, w) => out.push(`${JSON.stringify(g) === JSON.stringify(w) ? 'PASS' : 'FAIL'}  ${n}`
    + (JSON.stringify(g) === JSON.stringify(w) ? '' : `   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const names = () => $$('.verb .verb-name').map((e) => e.textContent);
  // One closer for every popup this panel opens: the dialog's own X, and a body click for
  // a menu, which closes on the document listener.
  const shut = () => { const x = $('.dialog-x'); if (x) x.click(); document.body.click(); };
  (async () => {
    try {
      /* ---- a bay says what is in it; a swap is chosen at the toolhead ------ */
      // A swap reads as an operation on the filament when it is offered on the spool -
      // "swap this one" - and what it actually does is move a TOOLHEAD from one bay to
      // another. Every macro it sends addresses `HEAD=n`, and the head's own sheet brings
      // every bay to it labelled with what each would do.
      const bays = () => $$('#filament .ace-card.is-ace .ace-bay');
      bays()[2].click(); await wait(120);
      say('the bay already feeding says so',
          /Already feeding/.test($('.dialog').textContent), true);
      shut(); await wait(80);
      bays()[0].click(); await wait(120);
      say('and another bay offers no swap, only what it holds',
          [names(), /Toolhead 4 is loaded/.test($('.dialog').textContent)], [[], true]);
      say('with the bay`s own identity above it',
          !!$('.dialog .verb-idtext'), true);
      shut(); await wait(80);

      // the head-level verbs, in the card menu where they belong
      $$('#filament .ace-card.is-ace .ace-more')[0].click(); await wait(120);
      const items = $$('.menu .menu-item span:not(.mcmd)').map((e) => e.textContent);
      // Names only: the reason lives in the bay's sheet, which has a line for it, and in
      // the row's own title. Spelling it in the label took the menu to 532 px on a 391 px
      // card - the macro chip beside a muted row is the reason, in the panel's own idiom.
      say('the menu carries the verbs that take no slot',
          items.filter((t) => /nload/.test(t)),
          ['Unload and retract', 'Background unload']);
      // No macro chips: the reason is in the row's own hover, in words.
      say('and the refused ones are muted, and carry no G-code',
          [$$('.menu .menu-item.is-muted').map((b) => b.title),
           $$('.menu .mcmd').length],
          [['Background unload — not enabled for this toolhead',
            'Click the toolhead, then the bay'], 0]);
      say('and points at the bay for the ones that do',
          items.some((t) => /Swap to another bay/.test(t)), true);
      document.body.click(); await wait(80);

      // a feeder head: one verb, and only one
      $$('#filament .ace-card:not(.is-ace) .ace-more')[0].click(); await wait(120);
      const f = $$('.menu .menu-item span:not(.mcmd)').map((e) => e.textContent);
      say('a loaded stock feeder offers unload, alone',
          f.filter((t) => /^(Load|Unload)/.test(t)), ['Unload']);
      document.body.click(); await wait(80);

      // and what the machine is doing, from its own channel_state
      /* ---- the toolhead, which is the other thing you can click ------------ */
      // Every one of these macros addresses HEAD=n, so the head is what they are about -
      // and it is the only target that does not shrink with the panel.
      say('every toolhead is a target', $$('#filament .ace-tool.is-target').length, 4);
      const tool = $$('#filament .ace-tool')[3];
      say('and wears nothing at rest', getComputedStyle(tool, '::before').boxShadow, 'none');
      tool.classList.add('is-hover');
      say('the pointer lights the bay`s own traced edge, 1.5 px and no fill',
          getComputedStyle(tool, '::before').boxShadow, 'rgb(12, 99, 226) 0px 0px 0px 1.5px inset');
      tool.classList.remove('is-hover');
      tool.click(); await wait(180);
      say('clicking one opens that toolhead`s sheet', $('.dialog h3').textContent, 'Toolhead 4');
      say('naming what it holds and where from',
          $('.dialog .verb-idtext').textContent, 'PETG BasicGeneric · ACE A');
      // two of the verbs take a SLOT= and a head is not one, so the bays come to it
      say('the bays come to the sheet, each saying what it would do in this state',
          $$('.dialog .pickbay').map((b) => b.querySelector('.picklab').textContent).join(','),
          'Swap,Swap,feeding,Swap');
      say('and the one already feeding is not offered',
          $$('.dialog .pickbay')[2].disabled, true);
      say('with the head`s own verbs below them',
          $$('.dialog .verb .verb-name').map((e) => e.textContent.split(' — ')[0]).join(','),
          'Unload and retract,Background unload');
      shut(); await wait(100);
      $$('#filament .ace-tool')[0].click(); await wait(180);
      say('a stock feeder head has no bays to bring, and one verb',
          [$$('.dialog .pickbay').length,
           $$('.dialog .verb .verb-name').map((e) => e.textContent).join(',')].join('/'),
          '0/Unload');
      shut(); await wait(100);
      say('and none of that cost the body its 456',
          $('#filament').scrollHeight <= $('#filament').clientHeight + 1, true);

      /* ---- an activity code is not a fault --------------------------------- */
      // Reported: starting a load raised a red banner reading `Printer fault · code
      // 0000000000000240 · not in the shipped catalogue`. That is 0x240 = 576, which is
      // `action_code` for "Auto Loading" - the fine-grained ACTIVITY table, padded into a
      // 16-digit fault code that could never match because it never was one.
      P.mock.printer.mainState = 1; P.mock.printer.actionCode = 576;
      await wait(1500);
      say('an activity code does not raise the fault banner', $('#fault').hidden, true);
      say('and it is still read as activity',
          P.state.activity().actionCode, 576);
      P.mock.printer.actionCode = 0; P.mock.printer.mainState = 0; await wait(1400);

      /* ---- a non-background verb takes the machine over, and says so -------- */
      // Reported: `Toolhead 1: load failed: sw_SendGCodes timed out after 15000ms` for a
      // load that was running - a load HOMES first, and the bridge gives up at 15s. The
      // request is not awaited now, and the wait is a blocking dialog because a swap is
      // three minutes during which a second verb is a collision rather than a queue.
      $$('#filament .ace-tool')[3].click(); await wait(160);
      $$('.dialog .pickbay').find((b) => b.querySelector('.picklab').textContent === 'Swap')
        .click();
      await wait(400);
      say('a swap opens a blocking dialog', !!$('.dialog.blocking'), true);
      say('naming both ends of it', $('.dialog.blocking h3').textContent,
          'Swap A1 → Toolhead 4');
      say('with no way to dismiss it while the machine is working',
          !$('.dialog.blocking .dialog-x'), true);
      // And what went out is an UNLOAD then a LOAD, not ACE_SWAP_HEAD.
      //
      // That macro is the print's swap: it opens with `G91 / G1 Z2 F600 / G90` to lift
      // the nozzle off the part, and Klipper refuses a Z move on an unhomed Z - so it
      // answered `ok`, printed `!! Must home Z axis first` and did nothing on a machine
      // at `homed_axes: "xy"`. Neither half of the pair moves Z. Asserted on the WIRE,
      // because the panel does not put macro names on screen.
      say('and a swap sends the pair that needs no homed Z, in that order',
          P.mock.printer.gcodeLog[P.mock.printer.gcodeLog.length - 1],
          'ACE_UNLOAD_HEAD HEAD=3\nACE_LOAD_HEAD HEAD=3 ACE=0 SLOT=0');
      P.mock.printer.channels[3].state = 'unload_heating'; await wait(1500);
      say('and it reports the step the printer is on, not a spinner alone',
          $('.blocking-msg').textContent, 'Heat nozzle  (3/6)');
      P.mock.printer.channels[3].state = 'load_flushing'; await wait(1500);
      say('following the same bar across both halves',
          $('.blocking-msg').textContent, 'Purge  (6/6)');
      P.mock.printer.channels[3].state = 'load_finish'; await wait(1700);
      say('and it closes when the machine says it finished', !$('.dialog.blocking'), true);
      P.mock.printer.channels[3].state = 'wait_insert';

      /* ---- multiACE's own verdict, in a second rather than twenty-five ----- */
      // Reported: a swap sat for 25s and then said "Nothing started. The toolhead is
      // waiting for filament." The printer had answered in under a second, in two places
      // the page was not reading: `ace.last_swap_result.status` went to `error`, and its
      // console carried `!! Must home Z axis first` - `homed_axes` was "xy". The RPC reply
      // was `ok`, which on this machine is not a yes.
      //
      // The Z failure itself is gone with ACE_SWAP_HEAD, and only that macro writes
      // `last_swap_result` - so what this now covers is the PRINT's swap failing
      // underneath a verb someone started, which dooms that verb too.
      $$('#filament .ace-tool')[3].click(); await wait(160);
      $$('.dialog .pickbay').find((b) => b.querySelector('.picklab').textContent === 'Swap')
        .click();
      await wait(500);
      say('a swap is waiting', !!$('.dialog.blocking'), true);
      // On the SIMULATED PRINTER, not the mirror: the wait re-reads `ace` every 400 ms,
      // so a value written into the mirror is gone before the next check.
      P.mock.printer.ace.last_swap_result =
        { head: 3, ace: 0, slot: 0, status: 'error', ts: 1234.5 };
      await wait(1400);
      // The reason itself comes from Moonraker, which is not there in the simulator - so
      // this is the fallback, and that it FAILS FAST is the part being checked.
      say('and multiACE saying error ends it at once, without waiting out the 25 s',
          [!!$('.dialog.blocking'), $('.blocking-msg').textContent],
          [true, 'The swap failed.']);
      say('with a way out, because the machine is no longer working',
          !!$('.dialog .dialog-foot .btn'), true);
      $('.dialog-foot .btn').click(); await wait(120);
      P.mock.printer.ace.last_swap_result = null;
      await wait(400);

      /* ---- and a verb the machine ignores does not look like one it is doing --- */
      // Reported: `Load - Toolhead 2` sat on "Asking the printer..." A stock feeder head
      // sends `ACE_LOAD_HEAD HEAD=1` with no ACE= and no SLOT=, and that macro's own help
      // says it loads a toolhead FROM ACE. Whatever the machine does with it, the panel
      // must not spend ninety seconds saying nothing: the state the printer IS in is the
      // one thing worth putting on screen.
      P.mock.printer.channels[2].act = 'unload_finish'; await wait(1500);
      $$('#filament .ace-tool')[2].click(); await wait(200);
      say('a toolhead`s verbs are names, with no G-code under them',
          [$$('.dialog .verb .verb-name').map((e) => e.textContent),
           $$('.dialog .verb .verb-cmd').length, $$('.dialog .verb')[0].title],
          [['Load'], 0, 'Load']);
      // The wire is asserted on the WIRE. It is not in the DOM any more, and the
      // simulated printer records every script it is handed.
      const sent = () => P.mock.printer.gcodeLog[P.mock.printer.gcodeLog.length - 1];
      $$('.dialog .verb')[0].click();
      await wait(500);
      say('and a stock feeder sends the U1`s own macro, not an ACE one at a head with '
          + 'no ACE',
          sent(), 'AUTO_FEEDING EXTRUDER=2 LOAD=1 STAGE=prepare\n'
                  + 'AUTO_FEEDING EXTRUDER=2 LOAD=1 STAGE=doing');
      say('a verb on an idle head opens the same blocking dialog',
          [!!$('.dialog.blocking'), $('.dialog.blocking h3').textContent],
          [true, 'Load — Toolhead 3']);
      say('and says the state the printer is in, in words rather than its own enum',
          $('.blocking-msg').textContent, 'Waiting for filament');

      /* ---- after an unload, the head is empty and the verbs say so ---------- */
      // Reported from ordinary use TWICE, against two different wrong fields.
      //
      // `filaments()[i].loaded` is `print_task_config` - what the SLICER assigned to the
      // slot - and a physical unload does not clear it, so an emptied head went on
      // offering Unload. Reading `filament_at_extruder` instead fixed the simulator and
      // not the printer: measured on 811002511261022618B3 with toolhead 1 unloaded by
      // hand, that field was still TRUE, along with `filament_detected` and
      // `filament_in_toolhead`. `channel_action_state` was the field that had moved.
      //
      // So this drives all three, and asserts that the two liars are lying.
      const exists = () => JSON.stringify(P.state.objects.print_task_config.filament_exist);
      const feed0 = () => P.state.objects['filament_feed left'].extruder0;
      const before = exists();
      P.mock.printer.channels[0].act = 'unload_finish';
      P.mock.printer.channels[0].state = 'unload_finish';
      await wait(1500);
      say('the job record is untouched by an unload, which is the trap', exists(), before);
      say('and so is every filament_* boolean, which is the second trap',
          [feed0().filament_at_extruder, feed0().filament_detected,
           feed0().filament_in_toolhead], [true, true, true]);
      say('the field that moves is the last operation the channel finished',
          feed0().channel_action_state, 'unload_finish');
      $$('#filament .ace-tool')[0].click(); await wait(180);
      say('so an emptied stock feeder offers Load, not Unload again',
          $$('.dialog .verb .verb-name').map((e) => e.textContent).join(','), 'Load');
      say('and says it is holding nothing',
          /Nothing loaded/.test($('.dialog .verb-idtext').textContent), true);
      shut(); await wait(100);
      // And then `channel_state` settles back to `wait_insert`, which is where head 1 was
      // found on the printer - unloaded, and no longer saying so in the live field. A
      // panel reading only that one goes back to offering Unload a second or two later.
      P.mock.printer.channels[0].state = 'wait_insert';
      await wait(1500);
      $$('#filament .ace-tool')[0].click(); await wait(180);
      say('and it stays Load once the live state settles back to wait_insert',
          $$('.dialog .verb .verb-name').map((e) => e.textContent).join(','), 'Load');
      shut(); await wait(100);
      $$('#filament .ace-more')[0].click(); await wait(140);
      say('the card menu agrees, because both read the same answer',
          $$('.menu .menu-item span:not(.mcmd)').map((e) => e.textContent)
            .filter((t) => /^(Load|Unload)/.test(t)).join(','), 'Load');
      document.body.click(); await wait(80);

      // the same hole was in the ACE head: `head_source` names the bay it was fed from
      // and does not stop naming it because the filament came out.
      P.mock.printer.channels[3].act = 'unload_finish';
      await wait(1500);
      say('an emptied ACE head is a LOAD from any bay, not a swap',
          (bays()[0].click(), await wait(160),
           names().map((t) => t.split(' — ')[0])), ['Load']);
      shut(); await wait(100);
      P.mock.printer.channels[0].act = 'load_finish';
      P.mock.printer.channels[0].state = 'load_finish';
      P.mock.printer.channels[3].act = 'none';
      await wait(1500);

      // The SIMULATED PRINTER, not the mirror: `filament_feed` is on the subscription,
      // so the mock re-pushes its own snapshot and a write into the mirror is overwritten
      // within the second. `ace` could be written directly precisely because it is not.
      const setState = async (v) => {
        P.mock.printer.channels[3].state = v;
        await wait(1400);
      };
      await setState('unload_heating');
      await wait(120);
      say('an unload_heating draws the swap bar at its heat step',
          [$$('#filament .ace-card.is-ace .ace-steps i').length,
           $('#filament .ace-card.is-ace .ace-flight-at').textContent], [6, 'Heat nozzle']);
      say('with the steps behind it done',
          $$('#filament .ace-card.is-ace .ace-steps i.is-done').length, 2);
      await setState('load_flushing');
      await wait(120);
      say('and the load half lands on the same bar, not a new one',
          [$$('#filament .ace-card.is-ace .ace-steps i').length,
           $('#filament .ace-card.is-ace .ace-flight-at').textContent], [6, 'Purge']);
      await setState('unload_fail');
      await wait(120);
      // It used to draw `unload_fail` verbatim, on the reasoning that translating a
      // firmware state would be this page's opinion of what happened. Two words is not an
      // opinion, and the enum was the only thing on screen naming the failure.
      say('a failure is named in words, and still says which half failed',
          $('#filament .ace-card.is-ace .ace-flight-at').textContent, 'Unload failed');
      await setState('none');
      await wait(120);
      say('and idle draws nothing at all', $$('#filament .ace-flight').length, 0);
      say('the body still fits its 456',
          $('#filament').scrollHeight <= $('#filament').clientHeight + 1, true);
    } catch (e) { out.push('FAIL  threw: ' + ((e && e.stack) || e)); }
    window.__report = out.join('\n');
  })();
})();
