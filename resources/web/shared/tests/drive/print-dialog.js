/*
 * The rebuilt print dialog, against the numbers the shipped one is built from.
 *
 *   python3 resources/web/shared/tests/run_webkit.py --size 714x750 \
 *       --page 'web/print_processing/index.html?mock=1' \
 *       --drive resources/web/shared/tests/drive/print-dialog.js
 *
 * The specification is docs/u1-webui/03-print-processing/original-dialog-mockup.html and
 * every assertion here is one of its rows. Two things this checks that reading cannot:
 * that the geometry SURVIVES a real layout in the engine Orca renders with, and that the
 * behaviour the bundle carries - a toolhead that cannot be picked - is actually enforced
 * rather than merely drawn.
 */
(function () {
  const L = [];
  const say = (s) => L.push(s);
  const check = (n, got, want) =>
    L.push(`${got === want ? 'PASS' : 'FAIL'} ${n}`
           + (got === want ? '' : `   got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  const q = (s) => document.querySelector(s);
  const qq = (s) => [...document.querySelectorAll(s)];
  const R = (e) => e.getBoundingClientRect();
  const W = (s) => Math.round(R(q(s)).width);
  const H = (s) => Math.round(R(q(s)).height);
  const css = (s, p) => getComputedStyle(q(s))[p];

  const run = () => {
    const pp = window.__preprint;
    if (!pp) { window.__report = 'FAIL no window.__preprint'; return; }

    say(`route ${pp.route}   filaments ${pp.model.filaments.length}   `
        + `toolheads ${pp.model.toolheads.length}`);
    say('');

    /* ---- the sections, in the bundle's order ----
       ?path=5 drops the print half entirely, which is the whole difference between the
       two routes. Run this script against both URLs; it checks whichever it is on. */
    const ids = qq('#body .card, #body .bare').map((n) => n.id).join(',');
    if (pp.route === 'upload') {
      check('upload-only keeps two sections', ids, 'panel-model-info,panel-printer');
      check('and no filament cards', qq('.fil-card').length, 0);
      check('and no preferences', qq('.pref').length, 0);
      check('and no nozzle banner', qq('.nozzle-warn').length, 0);
      check('Send is still offered', q('.send').disabled, false);
      window.__report = L.join('\n');
      return;
    }
    check('five sections, in A.bi3 order', ids,
          'panel-model-info,panel-printer,panel-filament,panel-preferences,panel-nozzle');

    /* ---- the card ---- */
    check('card border is 2px (A.de(ax.ry,-1,2))', css('#panel-model-info', 'borderTopWidth'), '2px');
    check('card radius 8', css('#panel-model-info', 'borderTopLeftRadius'), '8px');
    check('card padding 12 (B.ch)', css('#panel-model-info', 'paddingTop'), '12px');
    const tw = Math.round(R(q('#panel-model-info .card-title')).width);
    check('title column stays inside B.m4 (120..180)', tw >= 120 && tw <= 180, true);
    say(`  (title column resolved to ${tw}px - the bundle ships Roboto and this page `
        + 'uses the webview\'s own face, so the width inside the constraint differs)');
    const cards = qq('#body .card');
    check('sections are 8 apart (B.aB)',
          Math.round(R(cards[1]).top - R(cards[0]).bottom), 8);
    check('16 above the first (B.aE)',
          Math.round(R(cards[0]).top - R(q('#body')).top), 16);

    /* ---- Model Information ---- */
    check('thumbnail is 100x100', `${W('.mi-thumb')}x${H('.mi-thumb')}`, '100x100');
    check('thumbnail radius 16', css('.mi-thumb', 'borderTopLeftRadius'), '16px');
    check('the plate thumbnail is DRAWN, not a grey box',
          (q('.mi-thumb').getAttribute('src') || '').startsWith('data:image/'), true);
    const facts = qq('.mi-fact').map((n) => n.textContent.split(':')[0]);
    check('three facts, in the shipped order', facts.join('/'),
          'Filename/Estimated Time/Estimated Materials');
    check('Estimated Materials is toStringAsFixed(2)',
          /\d+\.\d\d g$/.test(qq('.mi-fact')[2].textContent), true);

    /* ---- Select Printer ---- */
    check('printer picker is 300x50 (A.a2l(50,300,...))',
          `${W('.picker')}x${H('.picker')}`, '300x50');

    /* ---- Edit Filament: the part no screenshot ever showed ---- */
    check('one card per file filament',
          qq('.fil-card').length, pp.model.filaments.length);
    check('filament card is 80x100 (A.A0(...,80,100,8,...))',
          `${W('.fil-card')}x${H('.fil-card')}`, '80x100');
    check('card radius 8', css('.fil-card', 'borderTopLeftRadius'), '8px');
    check('grid gap is 12 both ways (Wrap 12/12)', css('.fil-grid', 'gap'), '12px');
    const sh = H('.fil-block');
    const ph = H('.fil-pick');
    check('colour block takes 3 of the 7 parts', Math.abs(sh - 42) <= 4, true);
    check('picker takes 4 of the 7 parts', Math.abs(ph - 56) <= 4, true);
    check('a 1px rule between them', H('.fil-rule'), 1);
    check('target disc is 28 (A.aJO(...,28,...,28))', W('.fil-card .disc'), 28);
    check('the disc carries the 1-based toolhead number',
          q('.fil-card .disc-n').textContent, '1');

    /* ---- Print Preferences ---- */
    check('three preferences', qq('.pref').length, 3);
    check('preference row is 220x20 (B.VS max)', `${W('.pref')}x${H('.pref')}`, '220x20');
    check('12 between rows (runSpacing)',
          Math.round(R(qq('.pref')[1]).top - R(qq('.pref')[0]).bottom), 12);
    check('one per line at this width',
          Math.round(R(qq('.pref')[0]).top) !== Math.round(R(qq('.pref')[1]).top), true);
    check('only the first carries a help control', qq('.pref-help').length, 1);
    check('the toggle is an 18px round box, not a switch',
          `${W('.pref-box')}x${H('.pref-box')}/${css('.pref-box', 'borderTopLeftRadius')}`,
          '18x18/9px');

    /* ---- the send bar ---- */
    check('progress track is 8 tall', H('.bar-track'), 8);
    check('Send is 120x40', `${W('.send')}x${H('.send')}`, '120x40');
    check('bar padding is 16 (B.bV)', css('.dlg-foot', 'padding'), '16px');
    check('the percentage has no decimals', /^\d+%$/.test(q('#pct').textContent), true);
    // Nothing this page adds for its own benefit may sit on the control being pressed.
    const send = R(q('.send'));
    const overlaps = ['#build-badge', '#status', '.trace-wrap']
      .map((s) => q(s)).filter((n) => n && !n.hidden)
      .filter((n) => { const r = R(n);
        return r.right > send.left && r.left < send.right
            && r.bottom > send.top && r.top < send.bottom; });
    check('no reconstruction chrome covers the Send button',
          overlaps.map((n) => n.className || n.id).join(','), '');

    /* ---- the behaviour the bundle carries ---- */
    q('.fil-card .fil-pick').click();
    const menu = q('.menu-head');
    check('the toolhead picker opens', !!menu, true);
    if (menu) {
      check('toolhead menu is 200 wide', Math.round(R(menu).width), 200);
      check('item height 48 (B.aqU)', Math.round(R(menu.children[0]).height), 48);
      check('menu caps at 300 (maxHeight)', parseInt(getComputedStyle(menu).maxHeight, 10), 300);
      check('offset -50 from the trigger (B.asz)',
            Math.abs((R(menu).left - R(q('.fil-card .fil-pick')).left) + 50) <= 1, true);
      check('one item per toolhead', menu.children.length, pp.model.toolheads.length);

      // Filament 1 is PLA/0.4; heads 1 and 2 are PLA/0.4, 3 is PETG, 4 is ABS.
      const dis = [...menu.children].filter((c) => c.getAttribute('aria-disabled') === 'true');
      check('a head whose type does not match is unpickable', dis.length, 2);
      check('and says which refusal it is',
            dis.map((c) => c.title).every((t) => /_tips$/.test(t)), true);

      // The flag is ENFORCED, not decoration: clicking a refused head changes nothing.
      const before = JSON.stringify(pp.model.assignment);
      dis[0].click();
      check('clicking a refused toolhead assigns nothing',
            JSON.stringify(pp.model.assignment), before);

      // And a permitted one does.
      const okItem = [...menu.children].find((c) => c.getAttribute('aria-disabled') !== 'true'
                                             && c.getAttribute('aria-selected') !== 'true');
      if (okItem) {
        okItem.click();
        check('a permitted toolhead is assigned',
              JSON.stringify(pp.model.assignment) !== before, true);
      }
    }

    window.__report = L.join('\n');
  };

  let n = 0;
  const tick = () => {
    if ((window.__preprint && window.__preprint.ready) || n++ > 60) setTimeout(run, 500);
    else setTimeout(tick, 150);
  };
  tick();
})();
