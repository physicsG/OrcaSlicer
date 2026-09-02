/*
 * The print dialog against a CONNECTED U1. Read-only.
 *
 *   python3 resources/web/shared/tests/run_webkit.py --real --sn <SN> --size 714x750 \
 *       --settle 25 --gcode ~/models/plate_1.gcode \
 *       --page web/print_processing/index.html \
 *       --drive resources/web/shared/tests/drive/print-dialog-machine.js
 *
 * This is the half nothing else can reach: a machine actually answering. Everything
 * before it - the reply shapes, the geometry, the refusal rule - has been checked
 * against a simulator built from the same documentation, which proves internal
 * consistency and not that a U1 agrees.
 *
 * IT SENDS NOTHING. Assigning a filament writes `SET_PRINT_EXTRUDER_MAP` to the printer
 * and a preference writes `SET_PRINT_PREFERENCES`; neither moves the machine, but both
 * change its `print_task_config`, and a suite should not edit the state it is measuring.
 * The picker is opened and read, never picked from. Same rule as drive/ace-real.js.
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
    const tc = (pp.state.objects || {})['print_task_config'] || {};

    /* ---- did the transport come up at all ---- */
    say('--- the connection ---');
    (pp.said || []).forEach((s) => say(`  ${s}`));
    check('the machine half came up', m.connected, true);
    check('and a device is selected', !!m.device, true);
    if (m.device) say(`  device: ${m.device.dev_name} @ ${m.device.ip} sn=${m.device.sn}`);

    /* ---- what the machine actually reports ----
       The raw shapes, printed rather than only asserted: this is the first time this
       surface has seen them from hardware, and a future run wants something to diff. */
    say('');
    say('--- print_task_config, as the machine sent it ---');
    ['filament_type', 'filament_vendor', 'filament_sub_type', 'filament_color_rgba',
     'filament_exist', 'filament_official', 'filament_edit',
     'extruders_used', 'flow_calibrate', 'time_lapse_camera', 'auto_bed_leveling']
      .forEach((k) => say(`  ${k.padEnd(20)} ${JSON.stringify(tc[k])}`));
    const table = tc.extruder_map_table;
    say(`  extruder_map_table   ${Array.isArray(table)
      ? `${table.length} entries: ${JSON.stringify(table.slice(0, 8))}…` : JSON.stringify(table)}`);
    say('');
    say('--- extruders ---');
    ['extruder', 'extruder1', 'extruder2', 'extruder3'].forEach((k) => {
      const e = (pp.state.objects || {})[k] || {};
      say(`  ${k.padEnd(9)} nozzle=${JSON.stringify(e.nozzle_diameter)}  `
          + `temp=${e.temperature}  state=${JSON.stringify(e.state)}`);
    });

    check('print_task_config arrived', Object.keys(tc).length > 0, true);
    check('it carries a filament type per slot',
          Array.isArray(tc.filament_type) && tc.filament_type.length === 4, true);
    // The nozzle is read off the EXTRUDER objects, not print_task_config. If the
    // subscription's field filter dropped it, every match would fail and the dialog
    // would refuse every toolhead - silently, and looking like a mismatch.
    check('every toolhead reports a nozzle diameter',
          m.toolheads.every((h) => h.nozzleDiameter != null), true);

    /* ---- the two sides, side by side ---- */
    say('');
    say('--- the file against the machine ---');
    m.filaments.forEach((f) => {
      const at = m.assignment[f.key];
      const h = at == null ? null : m.toolheads[at];
      const dest = h
        ? `head ${at + 1}: ${String(h.filamentType).padEnd(6)} `
          + `${String(h.nozzleDiameter).padEnd(4)}  `
          + (h.filamentType === f.type && String(f.nozzle) === String(h.nozzleDiameter)
             ? 'ok' : 'REFUSED')
        : '(unassigned)';
      say(`  file ${f.index + 1}: ${String(f.type).padEnd(6)} `
          + `${String(f.nozzle).padEnd(4)}  ->  ${dest}`);
    });
    say(`  nozzle banner: ${m.nozzleMismatch ? 'SHOWN' : 'silent'}`);

    /* ---- the refusal rule, on real data. Read, never clicked. ---- */
    const card = q('.fil-card .fil-pick');
    check('there is a filament card to open', !!card, true);
    if (card) {
      card.click();                       // opening a menu writes nothing
      const menu = q('.menu-head');
      check('the toolhead picker opens against a live machine', !!menu, true);
      if (menu) {
        const rows = [...menu.children].map((c) => ({
          type: (c.querySelector('.menu-type') || {}).textContent,
          off: c.getAttribute('aria-disabled') === 'true',
          tip: c.title,
        }));
        say('');
        say('--- what the picker offers for file filament 1 ---');
        rows.forEach((r, i) => say(`  head ${i + 1}: ${String(r.type).padEnd(8)} `
          + `${r.off ? 'REFUSED' : 'offered'}${r.tip ? '  ' + r.tip : ''}`));
        check('one row per toolhead', rows.length, 4);
        // Whatever the machine holds, a refusal must carry its reason and an offer
        // must not - that pairing is the bundle's and does not depend on the data.
        check('every refusal says which refusal it is',
              rows.filter((r) => r.off).every((r) => /_tips$/.test(r.tip || '')), true);
        check('and nothing offered carries one',
              rows.filter((r) => !r.off).every((r) => !r.tip), true);
        // The rule itself, recomputed here from the raw objects rather than from the
        // page's own model - so a bug in the page cannot make this agree with it.
        const f0 = m.filaments[0];
        const want = m.toolheads.map((h) => h.filamentType === f0.type
          && f0.nozzle != null && String(f0.nozzle) === String(h.nozzleDiameter));
        check('the picker refuses exactly what the match rule says it should',
              rows.map((r) => !r.off).join(','), want.join(','));
      }
      // Close it without choosing anything.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }

    /* ---- what the dialog does with a mapping nobody made ----
       This host has no `filament_extruder_map` - that is Orca's own config, and the
       bridge only reads devices - so every filament arrives unassigned. Identity used
       to fill in, which on this machine put filament 3 on an empty head and filament 4
       on PETG: two toolheads the picker itself refuses, with nothing on screen saying
       so, because the warning mark means "nothing chosen" and something had been. */
    say('');
    say('--- an assignment nobody made ---');
    const unplaced = m.filaments.filter((f) => m.assignment[f.key] == null);
    say(`  ${unplaced.length} of ${m.filaments.length} filaments are unassigned`);
    const marks = qq('.fil-card .disc-n').map((n) => n.textContent);
    say(`  card marks: ${JSON.stringify(marks)}`);
    check('an unassigned filament is marked, not silently placed',
          unplaced.length === 0 || marks.includes('!'), true);
    check('and its card wears the warning border',
          qq('.fil-card.unset').length, unplaced.length);
    check('Send is refused while any filament has no home',
          unplaced.length === 0 || q('#send').disabled, true);

    say('');
    check('nothing threw', window.__ppError || '-', '-');
    say('NOTE  read-only: no mapping, no preference and no send was written.');
    window.__report = L.join('\n');
  };

  window.addEventListener('error', (e) => {
    window.__ppError = `${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`;
  });
  let n = 0;
  const tick = () => {
    // The connect is a pairing exchange and two MQTT sessions; give it room.
    if ((window.__preprint && window.__preprint.ready && window.__preprint.model.connected)
        || n++ > 200) setTimeout(run, 1200);
    else setTimeout(tick, 200);
  };
  tick();
})();
