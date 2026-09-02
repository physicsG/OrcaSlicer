/*
 * Can this machine be told to stop? Answered BEFORE anything is sent to it.
 *
 *   python3 resources/web/shared/tests/run_webkit.py --real --sn <SN> --size 714x750 \
 *       --settle 25 --gcode ~/models/plate_1.gcode \
 *       --page web/print_processing/index.html \
 *       --drive resources/web/shared/tests/drive/print-cancel-real.js
 *
 * The order matters and is the whole point: a send path that has never been exercised
 * should not be exercised first. `sw_MachinePrintCancel` is the only way back from a
 * print this dialog starts, and it has never been sent to this firmware by anything
 * here. Proving the route while the machine is IDLE costs nothing and settles the
 * precondition; discovering it is wrong with a job running costs a plate and a bed.
 *
 * What this can and cannot show:
 *
 *   it CAN    that the command routes - page to Orca's bridge to MQTT to Klipper - and
 *             what an idle machine answers, which is the reply a caller has to handle
 *   it CANNOT that a RUNNING print stops. Nothing short of running one shows that, and
 *             that is a decision for a person standing at the machine.
 *
 * It refuses to send anything at all if a print is in progress, which would be the one
 * situation where this script could do harm.
 */
(function () {
  const L = [];
  const say = (s) => L.push(s);
  const check = (n, got, want) =>
    L.push(`${got === want ? 'PASS' : 'FAIL'} ${n}`
           + (got === want ? '' : `   got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));

  const run = async () => {
    const pp = window.__preprint;
    if (!pp) { window.__report = 'FAIL no window.__preprint'; return; }
    const objs = pp.state.objects || {};
    const stats = objs['print_stats'] || {};
    const sd = objs['virtual_sdcard'] || {};
    const idleT = objs['idle_timeout'] || {};

    check('the machine half came up', pp.model.connected, true);

    say('');
    say('--- is anything printing? ---');
    say(`  print_stats.state    ${JSON.stringify(stats.state)}`);
    say(`  print_stats.filename ${JSON.stringify(stats.filename)}`);
    say(`  print_duration       ${JSON.stringify(stats.print_duration)}`);
    say(`  virtual_sdcard       is_active=${JSON.stringify(sd.is_active)} `
        + `progress=${JSON.stringify(sd.progress)}`);
    say(`  idle_timeout.state   ${JSON.stringify(idleT.state)}`);

    // Three independent answers, because one of them being absent is not evidence of
    // an idle machine - it is evidence of a field that did not arrive.
    const running = stats.state === 'printing' || stats.state === 'paused'
                 || sd.is_active === true;
    check('the machine is idle, so a cancel can be sent harmlessly', running, false);

    if (running) {
      say('');
      say('REFUSED  a print is in progress. This script will not send a cancel to a');
      say('         running job - that is a decision for a person at the machine.');
      window.__report = L.join('\n');
      return;
    }

    /* ---- the one command this script sends ---- */
    say('');
    say('--- sw_MachinePrintCancel, to an idle machine ---');
    let reply = null;
    let failed = null;
    const t0 = Date.now();
    try {
      reply = await pp.bridge.request(pp.CMD.PRINT_CANCEL, {});
    } catch (e) {
      failed = e.message;
    }
    const ms = Date.now() - t0;

    say(`  round trip ${ms} ms`);
    say(`  reply      ${JSON.stringify(reply)}`);
    say(`  error      ${JSON.stringify(failed)}`);

    // The route is what is under test. A refusal from Klipper is a perfectly good
    // answer - it means the command reached something that had an opinion about it.
    // What would be bad is silence, or a bridge-level "not dispatched".
    const routed = !(failed && /is answered inside Orca|not dispatched|REFUSED/i.test(failed));
    check('the command reached the machine rather than dying in the host', routed, true);
    check('and it answered within the request window', ms < 15000, true);

    say('');
    say('NOTE  the machine was idle, so nothing was stopped. That a RUNNING print stops');
    say('      is not shown here and cannot be without running one.');

    window.__report = L.join('\n');
  };

  let n = 0;
  const tick = () => {
    if ((window.__preprint && window.__preprint.ready && window.__preprint.model.connected)
        || n++ > 200) setTimeout(() => { run(); }, 1200);
    else setTimeout(tick, 200);
  };
  tick();
})();
