/*
 * The print dialog against the REAL bridge, and read-only.
 *
 *   python3 resources/web/shared/tests/run_webkit.py --real --device-ip 192.0.2.1 \
 *       --size 714x750 --gcode ~/models/plate_1.gcode \
 *       --page web/print_processing/index.html \
 *       --drive resources/web/shared/tests/drive/print-dialog-real.js
 *
 * What this covers that the simulator cannot: the ORCA half answered out of a real
 * sliced plate rather than a fixture - the filament list Orca's own slicer wrote, its
 * weights, its embedded thumbnail - and the not-connected branch, forced with an
 * unroutable address so no printer is involved.
 *
 * It SENDS NOTHING. `drive/print-dialog.js` clicks through the toolhead picker against
 * the simulator; against hardware this one only reads, because the send path ends in
 * `sw_StartLocalPrint` and a suite that can start a print is a suite that will.
 */
(function () {
  const L = [];
  const say = (s) => L.push(s);
  const check = (n, got, want) =>
    L.push(`${got === want ? 'PASS' : 'FAIL'} ${n}`
           + (got === want ? '' : `   got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  const q = (s) => document.querySelector(s);
  const qq = (s) => [...document.querySelectorAll(s)];

  const run = () => {
    const pp = window.__preprint;
    if (!pp) { window.__report = 'FAIL no window.__preprint'; return; }
    const m = pp.model;

    /* ---- what the plate said about itself ---- */
    say('--- the plate, as Orca sliced it ---');
    say(`file        ${(m.mapping && m.mapping.filename) || '(none)'}`);
    say(`sliced for  ${(m.mapping && m.mapping.machine_model) || '(not stated)'}`);
    say(`estimate    ${(m.mapping && m.mapping.estimated_time) || 0}s`);
    say(`filaments   ${m.filaments.map((f) => `${f.type}/${f.nozzle}/${f.used}g`).join('  ')}`);
    say(`dropped     ${((m.mapping && m.mapping.filament_type) || []).length
                       - m.filaments.length} with no material (A.bEE)`);
    say('');

    check('the mapping arrived', !!m.mapping, true);
    // The shape is the handler's: parallel arrays, and no `filaments[]` anywhere.
    check('the reply is parallel arrays, not filaments[]',
          !!(m.mapping && Array.isArray(m.mapping.filament_type)
             && m.mapping.filaments === undefined), true);
    check('at least one filament survived the used-material filter',
          m.filaments.length > 0, true);
    check('every filament carries a weight',
          m.filaments.every((f) => f.used > 0 || f.usedMm !== 0), true);
    check('one card per surviving filament', qq('.fil-card').length, m.filaments.length);

    /* ---- the plate's own thumbnail, out of the gcode ---- */
    const src = (q('.mi-thumb') && q('.mi-thumb').getAttribute('src')) || '';
    check('the plate thumbnail came from the file',
          src.startsWith('data:image/png;base64,') && src.length > 2000, true);
    say(`thumbnail   ${src.length} chars of base64`);

    /* ---- the not-connected branch ---- */
    say('');
    say('--- with no printer answering ---');
    check('no machine is connected', m.device, null);
    check('every toolhead reads NONE',
          m.toolheads.every((h) => h.filamentType === 'NONE'), true);
    check('and none reports a nozzle',
          m.toolheads.every((h) => h.nozzleDiameter == null), true);
    // A.c8l is silent when the machine list is empty: a dialog that has not heard from
    // the printer does not accuse it of a mismatch.
    check('the nozzle banner stays silent', m.nozzleMismatch, false);
    check('and is not drawn', q('#panel-nozzle').hidden, true);
    check('Send is refused with nothing to send to', q('#send').disabled, true);

    /* ---- the dialog is still the right shape ---- */
    say('');
    check('five sections', qq('#body .card, #body .bare').length, 5);
    const c = q('.fil-card').getBoundingClientRect();
    check('filament card is still 80x100',
          `${Math.round(c.width)}x${Math.round(c.height)}`, '80x100');
    check('nothing threw', window.__ppError || '-', '-');

    window.__report = L.join('\n');
  };

  window.addEventListener('error', (e) => {
    window.__ppError = `${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`;
  });
  let n = 0;
  const tick = () => {
    if ((window.__preprint && window.__preprint.ready) || n++ > 80) setTimeout(run, 800);
    else setTimeout(tick, 150);
  };
  tick();
})();
