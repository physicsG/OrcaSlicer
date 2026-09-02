(function(){
  const out=[]; const P=window.__devicePage;
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const pop=()=>document.querySelector('.popover');
  const segOn=(i)=>{const g=pop().querySelectorAll('.cam-set-group')[i];
    const b=g.querySelector('.cam-seg-btn[data-on="1"]'); return b && b.textContent;};
  const modeOn=()=>{const m=[...pop().querySelectorAll('.cam-mode[data-on="1"]')];
    return m.length===1 ? m[0].querySelector('.cam-mode-name').textContent : `${m.length} lit`;};
  (async()=>{ try{
    await P.byModule.camera.startCamera(); await wait(500);
    document.getElementById('camera-settings').click(); await wait(300);
    say('the popover is open', !!pop(), true);
    say('it starts on Single', segOn(0), 'Single');

    // ---- the bug: click a view and the tick must move WITHOUT reopening ----
    const grid=[...pop().querySelectorAll('.cam-set-group')[0].querySelectorAll('.cam-seg-btn')]
      .find(b=>b.textContent==='Grid');
    grid.click();
    await wait(900);                       // one render tick
    say('the popover is still open after clicking', !!pop(), true);
    say('and the tick moved to Grid without reopening', segOn(0), 'Grid');
    say('the page behind it followed too', document.querySelectorAll('.cam-tile').length, 4);

    // ---- fps ----
    const fpsGroup=[...pop().querySelectorAll('.cam-set-group')].pop();
    [...fpsGroup.querySelectorAll('.cam-seg-btn')].find(b=>b.textContent==='5').click();
    await wait(900);
    say('the fps tick moved', [...fpsGroup.querySelectorAll('.cam-seg-btn')].length &&
        [...pop().querySelectorAll('.cam-set-group')].pop()
          .querySelector('.cam-seg-btn[data-on="1"]').textContent, '5');
    say('and the store agrees', P.store.cam.fps, 5);

    // ---- transport ----
    say('Auto is lit to begin with', modeOn(), 'Auto');
    [...pop().querySelectorAll('.cam-mode')].find(m=>
      m.querySelector('.cam-mode-name').textContent==='Monitor file').click();
    await wait(1000);
    say('the transport tick moved', modeOn(), 'Monitor file');
    say('and the page switched transport',
        P.byModule.camera.cameraStatus().transport, 'monitor');
    say('exactly one transport is ever lit',
        pop().querySelectorAll('.cam-mode[data-on="1"]').length, 1);

    // ---- and it does NOT rebuild when nothing changed ----
    const before=pop().querySelector('.cam-set-group');
    await wait(1600);                      // a couple of render ticks
    say('an idle tick leaves the DOM alone', pop().querySelector('.cam-set-group')===before, true);

    // ---- the other popovers must be untouched ----
    document.querySelector('.popover-x').click(); await wait(150);
    document.querySelector('.qtile[data-k="speed"]').click(); await wait(300);
    const sp=pop(); say('a Control popover still opens', !!sp, true);
    const range=sp.querySelector('input[type="range"]');
    say('and it has its slider', !!range, true);
    const node=range;
    await wait(1600);
    say('and nothing rebuilds it under the user',
        pop().querySelector('input[type="range"]')===node, true);
  } catch(e){ out.push('FAIL  threw: '+(e&&e.stack||e)); }
  window.__report=out.join('\n'); })();
})();
