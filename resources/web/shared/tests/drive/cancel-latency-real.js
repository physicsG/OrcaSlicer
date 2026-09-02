/*
 * Why did a cancel take longer than the client waits?
 *
 *   python3 resources/web/shared/tests/run_webkit.py --real --sn <SN> --size 714x750 \
 *       --settle 25 --gcode ~/models/plate.gcode \
 *       --page web/print_processing/index.html \
 *       --drive resources/web/shared/tests/drive/cancel-latency-real.js
 *
 * Measured once, on a print that had just started: `sw_MachinePrintCancel` did not answer
 * inside the client's 15 s, while `print_stats` reached `cancelled` in about 10. The
 * conclusion drawn from that - "this firmware does not answer a cancel" - was a guess
 * with one data point behind it.
 *
 * The better explanation is that Klipper runs G-code SEQUENTIALLY: a command issued
 * behind a blocking one waits for it, and a print that has just started is homing. If
 * that is what happened then the reply is not lost, it is queued, and how long a caller
 * should wait is a different question from whether it should wait at all.
 *
 * This separates the two WITHOUT printing anything. `G4` is a dwell: it blocks the queue
 * for a known time and moves nothing, heats nothing and extrudes nothing. If a cancel
 * behind a 6 s dwell takes ~6 s, the queue is the explanation and the firmware is fine.
 *
 * Nothing here moves the machine. It refuses outright if anything is printing.
 */
(function () {
  const L = [];
  const say = (s) => L.push(s);
  const check = (n, got, want) =>
    L.push(`${got === want ? 'PASS' : 'FAIL'} ${n}`
           + (got === want ? '' : `   got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function timed(label, fn) {
    const t0 = Date.now();
    let out = null;
    let err = null;
    try { out = await fn(); } catch (e) { err = e.message; }
    const ms = Date.now() - t0;
    say(`  ${String(ms).padStart(6)} ms  ${label}`
        + (err ? `  FAILED ${err}` : `  -> ${JSON.stringify(out)}`));
    return { ms, out, err };
  }

  const run = async () => {
    const pp = window.__preprint;
    if (!pp) { window.__report = 'FAIL no window.__preprint'; return; }
    const st = () => ((pp.state.objects || {})['print_stats'] || {}).state;

    check('the machine half came up', pp.model.connected, true);
    say(`print_stats.state: ${JSON.stringify(st())}`);
    if (st() === 'printing' || st() === 'paused') {
      say('REFUSED  something is printing. Not queueing dwells behind a live job.');
      window.__report = L.join('\n');
      return;
    }

    /* ---- 1. the baseline: nothing in the queue ---- */
    say('');
    say('--- cancel with an empty queue ---');
    const base = await timed('sw_MachinePrintCancel', () =>
      pp.bridge.request(pp.CMD.PRINT_CANCEL, {}));
    check('an idle cancel answers quickly', base.ms < 2000, true);

    /* ---- 2. the same cancel, behind a dwell ----
       G4 is a pure delay: no motion, no heater, no extruder. If the round trip tracks
       the dwell then the queue is what a cancel waits for. */
    for (const ms of [3000, 6000]) {
      say('');
      say(`--- cancel behind G4 P${ms} (a dwell: nothing moves) ---`);
      // The dwell itself is fire-and-forget; what is being timed is what follows it.
      const dwell = pp.bridge.request(pp.CMD.SEND_GCODES, { script: `G4 P${ms}` });
      await sleep(150);
      const behind = await timed(`sw_MachinePrintCancel behind ${ms} ms`, () =>
        pp.bridge.request(pp.CMD.PRINT_CANCEL, {}));
      await dwell.catch(() => {});
      const tracked = behind.ms > ms * 0.6;
      check(`a cancel behind a ${ms} ms dwell waits for it`, tracked, true);
      say(`     ${behind.ms} ms against a ${ms} ms dwell`
          + `  (baseline was ${base.ms} ms)`);
      await sleep(500);
    }

    say('');
    say('--- what this means ---');
    say('  If the numbers above track the dwell, the cancel was never lost on that');
    say('  print - it was queued behind the homing move a starting job makes, and the');
    say('  client gave up at 15 s while the firmware was still working through it.');
    say('  The reply is late, not absent, and a caller has to either wait longer or');
    say('  confirm against print_stats rather than against the ack.');

    say('');
    say(`print_stats.state at the end: ${JSON.stringify(st())}`);
    check('nothing was left running', st() === 'printing' || st() === 'paused', false);

    window.__report = L.join('\n');
  };

  let n = 0;
  const tick = () => {
    if ((window.__preprint && window.__preprint.ready && window.__preprint.model.connected)
        || n++ > 200) setTimeout(() => { run().catch((e) => {
          window.__report = `${L.join('\n')}\nFAIL threw: ${e && e.message}`; }); }, 1200);
    else setTimeout(tick, 200);
  };
  tick();
})();
