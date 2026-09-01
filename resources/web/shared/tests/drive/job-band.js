(function(){
  const out=[]; const P=window.__devicePage;
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const b=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();
    return {w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.left),y:Math.round(r.top),
            cy:Math.round(r.top+r.height/2)};};
  (async()=>{ try{
    const body=document.querySelector('#task');
    const panel=document.querySelector('.col-main > .panel:last-child');
    out.push(`  card ${body.clientHeight}  panel ${b('.col-main > .panel:last-child').h}  content ${body.scrollHeight}`);
    say('nothing is clipped', body.scrollHeight <= body.clientHeight, true);
    say('the card is a band, not a stack', body.clientHeight < 160, true);

    // ---- the status is in the header ----
    const badge=document.querySelector('.panel-head .job-badge');
    say('the status badge is in the panel header', !!badge, true);
    say('and it is in the TASK panel header',
        badge.closest('.panel') === panel, true);
    // Against the simulator this is always `printing`; against a printer it is whatever
    // the machine last did. Compare with the live state, not with a word - the first
    // real run read `cancelled` and was right to.
    const live = P.state.job().state;
    say('it reads the live state', badge.textContent,
        live === 'standby' ? 'idle' : live);
    // This check used to assert the OPPOSITE - that the hover read
    // `print_stats.state: <state>`, which f7ddc2973 put there so that renaming standby
    // to idle "hid nothing". a946c250b took it off again and was right to: translating
    // is not hiding. `stateLabel()` is a single rename and every other state passes
    // through verbatim, so the badge already carries the machine's word; the only thing
    // the hover added was the FIELD NAME, which says where the page read it. That is
    // the page's business, and the wire has a home already - the trace pane.
    //
    // So the check is inverted, and it is the rule it guards rather than the instance:
    // no schema on a hover. conformance_test.py asks the same of every hover on the
    // page; this one asks it of the running DOM, where a title assembled at runtime is
    // visible and a source scan cannot see it.
    say('and carries no schema on its hover',
        /[a-z0-9]_[a-z0-9]|\.[a-z_]{3}/.test(badge.title || ''), false);
    say('the card no longer repeats the machine name',
        document.querySelectorAll('#task .job-dev').length, 0);
    say('nor carries its own badge', document.querySelectorAll('#task .job-badge').length, 0);

    // ---- the band's shape ----
    say('the thumbnail anchors the block', b('.job-thumb').w, 96);
    const th=b('.job-thumb'), col=b('.job-col');
    say('the column sits beside it, not under it', col.x > th.x + th.w - 1, true);
    say('three rows', document.querySelectorAll('#task .job-row').length, 3);
    const bar=b('.job-bar'), btns=b('.job-actions');
    say('the buttons ride the bar row', Math.abs(bar.cy - btns.cy) <= 1, true);
    say('and sit to its right', btns.x > bar.x + bar.w - 1, true);
    const name=b('.job-name'), meta=b('.job-meta');
    say('the metadata shares the name row', Math.abs(name.cy - meta.cy) <= 1, true);
    const pct=b('.job-pct'), nums=b('.job-nums');
    say('the numbers share the percentage row', Math.abs(pct.cy - nums.cy) <= 1, true);

    // ---- it still says what it used to say ----
    say('percentage', /^\d+%$/.test(document.querySelector('.job-pct').textContent), true);
    say('layers', /^Layer \d+\/\d+$/.test(document.querySelector('.job-layer').textContent), true);
    say('time left', /^\u2014\s\d+h \d+m$/.test(document.querySelector('.job-time').textContent), true);
    say('elapsed', /^\d+h \d+m$/.test(document.querySelector('.job-elapsed').textContent), true);
    say('filament used, in metres and not guessed grams',
        /^\d+\.\d m$/.test(document.querySelector('.job-used').textContent), true);
    const nm=document.querySelector('.job-name');
    say('the filename stays on one line', nm.scrollHeight <= nm.clientHeight + 1, true);
    say('and the whole of it is reachable', nm.title.length > nm.textContent.length - 1, true);

    // ---- the badge follows the machine, not a click ----
    // Only the simulator can be told to pause on demand; against a printer this is
    // skipped rather than faked, and says so.
    if (P.mock) {
      P.mock.printer.pause(); await wait(1600);
      say('pausing moves the header badge', badge.textContent, 'paused');
      say('and recolours it', badge.dataset.state, 'paused');
      say('the card grew a resume button',
          document.querySelector('.job-btn[data-kind="play"]') !== null, true);
      P.mock.printer.resume(); await wait(1600);
      say('resuming moves it back', badge.textContent, 'printing');
    } else {
      out.push('  (pause/resume needs the simulator; skipped against a printer)');
    }

    // ---- and the camera took the height back ----
    const cam=b('.col-main > .panel'), main=b('.col-main');
    out.push(`  column ${main.h} = camera ${cam.h} + 20 + task ${b('.col-main > .panel:last-child').h}`);
    say('the column is exactly filled',
        Math.abs(main.h - (cam.h + 20 + b('.col-main > .panel:last-child').h)) <= 1, true);
  } catch(e){ out.push('FAIL  threw: '+(e&&e.stack||e)); }
  window.__report=out.join('\n'); })();
})();
