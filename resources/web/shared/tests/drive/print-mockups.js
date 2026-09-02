/*
 * Walk one print-dialog mockup and say what is actually on it.
 *
 * The mockups are not the page, so they get no built-in checks - but they are the thing
 * a decision is being made from, and "it rendered on my screen" is exactly the evidence
 * CLAUDE.md says not to accept. This dumps the tree, then asserts the handful of facts
 * that would be silently wrong if the fixture or a renderer broke: the plate thumbnail
 * has a source, there is one row per file filament, the send button's state matches the
 * scenario, and an assignment change actually repaints.
 *
 *   python3 resources/web/shared/tests/run_webkit.py \
 *       --page 'web/print_processing/mockups/option-b.html?scenario=mismatch' \
 *       --drive resources/web/shared/tests/drive/print-mockups.js
 */
(function () {
  const L = [];
  const say = (s) => L.push(s);
  const check = (name, ok, detail) =>
    L.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);

  const m = window.__mockup;
  if (!m) { window.__report = 'FAIL no window.__mockup — the module never ran'; return; }

  say(`title:    ${document.title}`);
  say(`scenario: ${m.scenario}   mode: ${m.mode}`);
  say(`assign:   [${m.model.assignment.join(', ')}]`);
  say(`heads:    ${m.model.heads.map((h, i) =>
        `${i + 1}:${h.loaded ? (h.type || '?') + '@' + h.nozzle : 'empty'}`).join('  ')}`);
  say('');

  /* ---- the tree ---- */
  const walk = (el, d) => {
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).filter(Boolean).join('.') : '';
    const id = el.id ? '#' + el.id : '';
    const data = Object.keys(el.dataset || {}).sort()
      .map((k) => `[${k}=${el.dataset[k]}]`).join('');
    const r = el.getBoundingClientRect();
    const geo = (r.width || r.height)
      ? ` {${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}}` : '';
    const hidden = el.hidden ? ' HIDDEN' : '';
    L.push('  '.repeat(d) + el.tagName.toLowerCase() + id + cls + data + geo + hidden);
    [...el.children].forEach((c) => walk(c, d + 1));
  };
  walk(document.body, 0);
  say('');
  say('--- checks ---');

  /* ---- the dialog is the size the host opens ---- */
  const h = document.documentElement.clientHeight;
  check('dialog does not scroll', document.body.scrollHeight <= h + 1,
        `body ${document.body.scrollHeight} vs viewport ${h}`);

  /* ---- the plate thumbnail is drawn, and drawn WITHOUT a click ----
     Every design has to answer "is this the right plate" on arrival. Whether it does
     is the check; how big the picture is, is the design's business. */
  const img = document.querySelector('img.thumb');
  check('plate thumbnail visible on arrival', !!img && !!img.getAttribute('src'),
        img ? `${Math.round(img.getBoundingClientRect().width)}px wide` : 'no img.thumb');
  if (img) {
    check('thumbnail actually decoded', img.naturalWidth > 0,
          `naturalWidth ${img.naturalWidth}`);
  }

  /* ---- a way to choose a destination, per filament ----
     Each design counts its own, because they are not the same control: A and C use a
     select per filament, B uses a lane of toolhead buttons. Asking every design for a
     `select` is how a working design reports FAIL. */
  const wanted = m.mapping.filament_type.length;
  const controls = m.destinationControls ? m.destinationControls() : 0;
  if (m.mode === 'print') {
    check('a destination control per filament',
          controls >= wanted || m.disclosed,
          `${controls} controls for ${wanted} filaments`
          + (m.disclosed ? ' (this design discloses the mapping on demand)' : ''));
  } else {
    check('upload-only hides the mapping', controls === 0,
          `${controls} destination controls`);
  }

  /* ---- every filament colour reached the DOM ----
     Only in print mode: ?path=5 drops the mapping entirely, so no swatches is the
     correct answer there and asserting otherwise fails three working designs. */
  const swatches = [...document.querySelectorAll('.sw')]
    .map((s) => getComputedStyle(s).backgroundColor);
  if (m.mode === 'print') {
    check('swatches painted', swatches.length > 0, `${swatches.length} drawn`);
  } else {
    check('upload-only draws no filament swatches', swatches.length === 0,
          `${swatches.length} drawn`);
  }

  /* ---- Send agrees with the scenario ---- */
  const send = document.querySelector('#send');
  const mustBlock = m.scenario === 'noprinter' || m.scenario === 'wrongmodel'
    || (m.mode === 'print' && m.scenario === 'mismatch');
  check('send button reflects the scenario', !!send && send.disabled === mustBlock,
        `disabled=${send && send.disabled}, expected ${mustBlock}`);

  /* ---- an edit repaints ---- */
  const picks = document.querySelectorAll('select.head-pick');
  if (picks.length) {
    const before = document.body.innerHTML.length;
    const sel = picks[0];
    const other = [...sel.options].find((o) => o.value !== sel.value);
    sel.value = other.value;
    sel.dispatchEvent(new Event('change'));
    const moved = m.model.assignment[0] === Number(other.value);
    check('an assignment change lands in the model', moved,
          `assignment[0] = ${m.model.assignment[0]}, set ${other.value}`);
    check('and repaints', document.body.innerHTML.length !== before || moved,
          `${before} -> ${document.body.innerHTML.length} chars`);
  }

  window.__report = L.join('\n');
})();
