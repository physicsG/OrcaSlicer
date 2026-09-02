/* What the Device page owes ORCA, and the two writes that were going to the wrong place.
 *
 * Three things nothing else can see, because all three are about what leaves the page
 * rather than about what is drawn:
 *
 *   1. the filament inventory reaching Orca at all. `sw_UpdateMachineFilamentInfo` is the
 *      only writer of `preset_bundle->machine_filaments`, which the sidebar's filament
 *      combo boxes are built from. The shipped Device page was the only caller, so
 *      retiring it silently emptied the Prepare page's filament rows.
 *   2. its SHAPE. Orca type-checks `objects`, `key` and `value`, then loops
 *      `filament_official` and indexes every other array with the same `i` - with no
 *      try/catch anywhere above it. The simulator validates exactly that, so a payload
 *      that would throw inside a wxWidgets event handler fails here instead.
 *   3. that naming a filament and setting the print preferences send G-CODE. Both used to
 *      send `sw_UpdateMachineFilamentInfo` with a flat `print_task_config` patch, which
 *      never reaches the printer and fails its first `if`. Neither is awaited, by design,
 *      so nothing on screen would ever have said so.
 *
 * The macro text is checked verbatim, quotes included. `SET_PRINT_FILAMENT_CONFIG` is
 * single-quoted and `SET_PRINT_PREFERENCES` is bare, and the third preference is sent as
 * `BED_LEVEL` while the machine reports it as `auto_bed_leveling` - all three recovered
 * from the shipped bundle, and all three the kind of detail that is re-derived wrong.
 */
(function () {
  const out = []; const P = window.__devicePage;
  const eq = (g, w) => JSON.stringify(g) === JSON.stringify(w);
  const say = (n, g, w) => out.push(`${eq(g, w) ? 'PASS' : 'FAIL'}  ${n}`
    + (eq(g, w) ? '' : `   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const sent = () => P.mock.printer.gcodeLog[P.mock.printer.gcodeLog.length - 1];
  const rec = () => P.mock.printer.orcaFilamentRecord;

  (async () => {
    try {
      /* ---- 1. it happened, unprompted ---------------------------------- */
      // Nothing was clicked. The state stream brought it up, which is the point: the
      // sidebar has to be right before anyone opens this tab, not after.
      say('Orca has the inventory without anyone asking for it', !!rec(), true);
      say('filed under the connected machine`s serial',
          rec() && rec().sn, P.mock.printer.sn);

      /* ---- 2. the shape Orca actually parses ---------------------------- */
      const v = (rec() || {}).value || {};
      const n = (v.filament_official || []).length;
      say('four slots, from filament_official', n, 4);
      // Every one of these is indexed with the loop's own `i` on the C++ side.
      const lens = ['filament_vendor', 'filament_type', 'filament_sub_type',
                    'filament_color', 'filament_color_rgba', 'nozzle_diameters']
        .map((k) => (v[k] || []).length);
      say('and every array Orca indexes is that long', lens, [n, n, n, n, n, n]);
      // `machine.system_info` is the only place this firmware publishes the nozzle, and
      // Orca reads each entry with get<std::string>() - a number there is a type_error.
      say('the nozzles are strings, from machine.system_info',
          [v.nozzle_diameters, v.nozzle_diameters.every((x) => typeof x === 'string')],
          [['0.4', '0.4', '0.4', '0.4'], true]);
      // 32 entries, one per possible tool - not one per slot. The simulator used to send
      // a four-key object here, which is not what any U1 sends.
      say('the extruder map is passed through at the machine`s own length',
          (v.extruder_map_table || []).length, 32);

      /* ---- and once per stream, not once per caller ---------------------- */
      /*
       * Each push costs Orca a `load_current_presets()`: every preset tab reloaded, the
       * model page tree rebuilt, the print bed forced to update - all on the stack of a
       * webview message handler.
       *
       * This counts; it does not settle the ORDERING that made it two. In Orca the
       * snapshot's push completed 5 ms before resyncOrca's forget() re-armed the
       * identical inventory, so it went twice; here the second call finds the first still
       * in flight and skips, whichever order they are in. Reproduced against the source
       * instead, in conformance_test.py - "forgotten before the snapshot, not after".
       */
      const before = P.mock.printer.orcaSyncCount;
      say('coming up pushes the inventory once', before, 1);
      // load_current_presets() rebuilds every combo box in the sidebar. An idle machine
      // pushes state about twice a minute and this must not ride on that.
      await wait(1600);
      say('and an unchanged inventory is not pushed again',
          P.mock.printer.orcaSyncCount, before);

      /* ---- 3a. naming a filament writes the PRINTER --------------------- */
      const idRow = () => $$('.menu .menu-item')
        .filter((b) => /this filament/.test(b.textContent))[0];
      $$('#filament .ace-more')[2].click(); await wait(60);
      say('the untagged head offers an edit', /Edit this filament/.test(idRow().textContent), true);
      idRow().click(); await wait(200);
      const type = $$('.dialog input')[0];
      say('the sheet is a form', !!type, true);
      // Deliberately not the type it already has - the sync compares before it sends, so
      // re-confirming the same value proves nothing about whether Orca would be told.
      type.value = 'TPU';
      type.dispatchEvent(new Event('input', { bubbles: true }));
      $('.dialog .btn.primary').click(); await wait(200);

      say('Confirm sends the firmware`s own macro, single-quoted',
          /^SET_PRINT_FILAMENT_CONFIG /.test(sent()) && /FILAMENT_TYPE='TPU'/.test(sent()),
          true);
      say('addressed at the head, and told to persist',
          [/CONFIG_EXTRUDER='2'/.test(sent()), /SAVE='1'/.test(sent())], [true, true]);
      say('and the colour goes back as RRGGBBAA with no hash',
          /FILAMENT_COLOR_RGBA='[0-9A-F]{8}'/.test(sent()), true);
      say('nothing was sent to Orca as if it were the printer',
          /UpdateMachineFilamentInfo/.test(sent()), false);
      document.body.click(); await wait(60);

      /* ---- and Orca is told about the change --------------------------- */
      // The machine moved, so the mirror moved, so the record Orca holds has to follow -
      // otherwise the sidebar keeps offering the filament that was there before.
      await wait(1400);
      say('the new type reaches Orca too',
          (rec().value.filament_type || [])[2], 'TPU');
      say('which is a second push, not the first one again',
          P.mock.printer.orcaSyncCount > before, true);

      /* ---- 3b. the print preferences ------------------------------------ */
      // The pill lives in the Control panel's HEADER, which is on the card rather than
      // inside #control - so it is found by its id, not by walking the body.
      const prefsBtn = $('#print-prefs');
      if (prefsBtn) {
        prefsBtn.click(); await wait(160);
        const boxes = $$('.dialog input[type=checkbox]');
        say('three toggles, as the shipped page has', boxes.length, 3);
        boxes[2].checked = !boxes[2].checked;
        boxes[2].dispatchEvent(new Event('change', { bubbles: true }));
        $('.dialog .btn.primary').click(); await wait(200);
        say('Apply sends SET_PRINT_PREFERENCES, bare and upper-cased',
            /^SET_PRINT_PREFERENCES /.test(sent()), true);
        // The one that is not the field name. `auto_bed_leveling` is what the machine
        // reports; `BED_LEVEL` is what the macro takes, and a G-code macro answers `ok`
        // to an argument it has never heard of.
        say('and Auto Leveling goes out as BED_LEVEL, not the field name',
            [/BED_LEVEL=[01]/.test(sent()), /AUTO_BED_LEVELING/.test(sent())],
            [true, false]);
        say('with the other two named as the machine reports them',
            [/FLOW_CALIBRATE=[01]/.test(sent()), /TIME_LAPSE_CAMERA=[01]/.test(sent())],
            [true, true]);
        document.body.click(); await wait(60);
      } else {
        out.push('FAIL  no Print Preferences control on the Control panel');
      }

      /* ---- 4. the account, which is Orca's dialog and not a page --------- */
      // The requirement is that the Snapmaker login stays the ORIGINAL one. So the page
      // has no login form: this menu row asks Orca to open its own, which loads
      // id.snapmaker.com. What is checked here is that it asks, and that it then notices
      // the answer - the reply to sw_UserLogin arrives before the modal is even shown.
      const openRail = () => { $('#device-select').click(); };
      openRail(); await wait(120);
      const row = () => $$('.menu .menu-item')
        .filter((b) => /Sign in to Snapmaker|Signed in as/.test(b.textContent))[0];
      say('signed out, the rail offers the original login',
          !!row() && /Sign in to Snapmaker/.test(row().textContent), true);
      say('and no password is asked for anywhere on this page',
          $$('input[type=password]').length, 0);
      row().click();
      await wait(2600);
      document.body.click(); await wait(60);
      openRail(); await wait(140);
      say('and once Orca reports a session, the rail says who',
          !!row() && /Signed in as Mock Account/.test(row().textContent), true);
      document.body.click();
    } catch (e) { out.push('FAIL  threw: ' + ((e && e.stack) || e)); }
    window.__report = out.join('\n');
  })();
})();
