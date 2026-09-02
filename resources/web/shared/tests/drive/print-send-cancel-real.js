/*
 * The send path, end to end, on a real machine - and then stopped.
 *
 *   python3 resources/web/shared/tests/run_webkit.py --real --sn <SN> --allow-print \
 *       --size 714x750 --settle 25 --gcode ~/models/plate.gcode \
 *       --page web/print_processing/index.html \
 *       --drive resources/web/shared/tests/drive/print-send-cancel-real.js
 *
 * THIS STARTS A PRINT. It is the only script here that does, it needs --allow-print to
 * get past the bridge, and it should be run with a person watching the machine.
 *
 * It is the last unmeasured stretch of this surface: everything up to `sw_GetFileStream`
 * has been seen against hardware and nothing past it has. Three things are genuinely
 * unknown and this is what answers them:
 *
 *   - does a multipart POST to the printer's /server/files/upload work from this page,
 *     cross-origin from Orca's own HTTP server
 *   - what `{type, path}` does THIS firmware want from `server.files.start_local_print`
 *   - does the job actually stop when told to
 *
 * The rails:
 *
 *   - it refuses to start if anything is already printing
 *   - every filament is mapped to a toolhead the picker ACCEPTS, chosen before the send
 *   - the cancel is sent UNCONDITIONALLY after the start command returns, whatever it
 *     returned, because an `ok` is not a yes and a start that looked like it failed may
 *     not have
 *   - and again from a `finally`, so a throw anywhere in the middle still stops the job
 */
(function () {
  const L = [];
  const say = (s) => L.push(s);
  const check = (n, got, want) =>
    L.push(`${got === want ? 'PASS' : 'FAIL'} ${n}`
           + (got === want ? '' : `   got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  const q = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stateNow = (pp) => ((pp.state.objects || {})['print_stats'] || {}).state;

  async function cancel(pp, why) {
    say(`  -> sw_MachinePrintCancel (${why})`);
    try {
      const r = await pp.bridge.request(pp.CMD.PRINT_CANCEL, {});
      say(`     reply ${JSON.stringify(r)}`);
      return true;
    } catch (e) {
      say(`     FAILED ${e.message}`);
      return false;
    }
  }

  const run = async () => {
    const pp = window.__preprint;
    if (!pp) { window.__report = 'FAIL no window.__preprint'; return; }
    const m = pp.model;

    check('the machine half came up', m.connected, true);
    if (!m.connected) { window.__report = L.join('\n'); return; }

    /* ---- rail 1: nothing may already be running ---- */
    const before = stateNow(pp);
    say(`print_stats.state before: ${JSON.stringify(before)}`);
    if (before === 'printing' || before === 'paused') {
      say('REFUSED  something is already printing. Not touching it.');
      window.__report = L.join('\n');
      return;
    }

    /* ---- rail 2: a mapping the machine will accept ----
       Every file filament onto ONE head that takes it, so there are no toolchanges in
       the few seconds this job is alive. */
    const { matchOf } = pp.session;
    // One head for everything if the machine allows it - a job with no toolchange is a
    // job with less to interrupt. Otherwise each filament gets the first head that
    // accepts it, which is all the picker would have offered anyway.
    const single = m.toolheads.find((h) => m.filaments.every((f) => matchOf(f, h).ok));
    const plan = m.filaments.map((f) => ({
      f, head: single || m.toolheads.find((h) => matchOf(f, h).ok) || null,
    }));
    const homeless = plan.filter((p) => !p.head);
    check('every filament on this plate has a toolhead that accepts it',
          homeless.length, 0);
    if (homeless.length) {
      say(`  ${homeless.map((p) => p.f.type).join(', ')} - not loaded on this machine`);
      window.__report = L.join('\n');
      return;
    }
    say('');
    say(single
      ? `--- mapping all ${m.filaments.length} filaments to toolhead ${single.index + 1} `
        + `(${single.filamentType} @ ${single.nozzleDiameter}) - no toolchange ---`
      : `--- mapping each filament to the first head that accepts it ---`);
    for (const { f, head } of plan) {
      say(`  filament ${f.index + 1} (${f.type}) -> toolhead ${head.index + 1}`);
      pp.ctx.assign(f, head.index);
      await sleep(250);                    // each write is a SET_PRINT_EXTRUDER_MAP
    }
    await sleep(1200);
    say(`  assignment: ${JSON.stringify(m.assignment)}`);
    check('every filament now has a home', 
          m.filaments.every((f) => m.assignment[f.key] != null), true);
    check('and Send is offered', q('#send').disabled, false);

    /* ---- the send ---- */
    say('');
    say('--- sending ---');
    let started = false;
    try {
      const t0 = Date.now();
      q('#send').click();
      // Watch the send bar's state machine rather than the promise, which the page owns.
      let last = null;
      for (let i = 0; i < 240; i++) {
        const st = q('#send').dataset.state;
        if (st !== last) {
          say(`  ${String(Date.now() - t0).padStart(6)}ms  ${st}`
              + (st === 'uploading' ? `  ${q('#pct').textContent}` : ''));
          last = st;
        }
        if (st === 'starting') started = true;
        if (st === 'done' || st === 'failed') break;
        await sleep(250);
      }
      say(`  final state: ${q('#send').dataset.state}`);
      say('  the wire:');
      (pp.said || []).filter((x) => x.startsWith('send:') || x.startsWith('err:'))
        .forEach((x) => say(`    ${x}`));
      check('the send reached the start command', started, true);
    } catch (e) {
      say(`  THREW ${e.message}`);
    } finally {
      /* ---- the cancel, unconditionally ---- */
      say('');
      say('--- stopping ---');
      await cancel(pp, 'unconditional, immediately after the send');
    }

    /* ---- did it actually stop? ---- */
    say('');
    say('--- print_stats after the cancel ---');
    let settled = null;
    for (let i = 0; i < 40; i++) {
      const st = stateNow(pp);
      if (st !== settled) { say(`  ${String(i * 500).padStart(6)}ms  ${JSON.stringify(st)}`); settled = st; }
      if (st === 'cancelled' || st === 'standby' || st === 'complete') break;
      await sleep(500);
    }
    // A second cancel if it is somehow still going - cheap, and the point of the exercise.
    if (settled === 'printing' || settled === 'paused') {
      await cancel(pp, 'still running after the first');
      await sleep(3000);
      settled = stateNow(pp);
      say(`  after the second: ${JSON.stringify(settled)}`);
    }
    check('the machine is not printing', settled === 'printing' || settled === 'paused', false);
    say(`  ended at ${JSON.stringify(settled)}`);

    window.__report = L.join('\n');
  };

  let n = 0;
  const tick = () => {
    if ((window.__preprint && window.__preprint.ready && window.__preprint.model.connected)
        || n++ > 200) setTimeout(() => { run().catch((e) => {
          window.__report = `${L.join('\n')}\nFAIL threw: ${e && e.message}`;
        }); }, 1500);
    else setTimeout(tick, 200);
  };
  tick();
})();
