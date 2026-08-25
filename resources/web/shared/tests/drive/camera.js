(function(){
  const out=[]; const P=window.__devicePage;
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const q=(s)=>document.querySelectorAll(s);
  (async ()=>{
   try{
    const H = P.byModule.camera;
    say('the panel has a gear', !!document.getElementById('camera-settings'), true);
    say('camera is off at rest', P.store.cam.streaming, false);
    say('nothing is playing yet', q('.cam-tile').length, 0);

    // ---- start ----
    await H.startCamera();
    await wait(400);
    const st = H.cameraStatus();
    say('the simulator was asked and answered', P.store.cam.cams.length, 3);
    say('the multiACE panel was rejected as a camera',
        P.store.cam.cams.some(c=>c.name==='multiACE'), false);
    say('the touchscreen is kept, and last',
        P.store.cam.cams[P.store.cam.cams.length-1].name, 'gui');
    say('a direct transport was chosen, not the monitor file', st.transport, 'snapshot');
    say('this engine reports no H.264', st.caps.h264, false);
    say('this engine reports no WebRTC', st.caps.webrtc, false);
    say('single view draws one tile', q('.cam-tile').length, 1);
    const im0 = document.querySelector('.cam-tile img.cam-frame');
    say('the poller pointed it somewhere', !!(im0 && im0.src), true);
    // The rule, not the artifact: an http still is re-fetched every frame and must be
    // cache-busted; a data: URI has no cache and appending to it corrupts the data.
    say('cache-busting follows the scheme',
        /^data:/.test(im0.src) ? !/\?t=/.test(im0.src) : /[?&]t=\d+/.test(im0.src), true);
    say('the frame actually decoded', im0.naturalWidth > 0, true);
    say('no failure marker', im0.dataset.failed, undefined);

    // ---- views ----
    for (const [v,n] of [['split',2],['grid',4],['pip',2],['single',1]]) {
      H.setCameraView(v); await wait(250);
      say(`${v} draws ${n} tiles`, q('.cam-tile').length, n);
    }
    H.setCameraView('grid'); await wait(300);
    say('grid: three cameras and one explanation', q('.cam-tile.is-empty').length, 1);
    say('the empty cell says why', q('.cam-tile.is-empty .cam-tile-msg')[0].textContent, 'No fourth camera');
    say('every real tile is named', q('.cam-tile[data-cam] .cam-tile-name').length, 3);
    const srcs=[...q('.cam-tile img.cam-frame')].map(i=>i.src).filter(Boolean);
    say('all three tiles are pointed somewhere', srcs.length, 3);
    say('every tile decoded', [...q('.cam-tile img.cam-frame')].every(i=>i.naturalWidth>0), true);

    // ---- the focus rule ----
    say('tile 0 has focus by default', q('.cam-tile.is-focus').length, 1);
    H.focusTile(2); await wait(250);
    const f=document.querySelector('.cam-tile.is-focus');
    say('focus moved to the clicked tile', f && f.dataset.index, '2');
    say('and only one tile has it', q('.cam-tile.is-focus').length, 1);

    // ---- geometry: tiles fill the viewport and do not overlap ----
    const view=document.querySelector('.cam-view').getBoundingClientRect();
    const rs=[...q('.cam-tile')].map(t=>t.getBoundingClientRect());
    say('four cells in a 2x2', rs.length, 4);
    say('the grid covers the viewport width',
        Math.abs((rs[0].width+rs[1].width+2) - view.width) < 3, true);
    say('and its height', Math.abs((rs[0].height+rs[2].height+2) - view.height) < 3, true);
    say('no tile escapes the viewport',
        rs.every(r=>r.left>=view.left-1 && r.right<=view.right+1
                 && r.top>=view.top-1 && r.bottom<=view.bottom+1), true);
    say('the play control is above the tiles',
        getComputedStyle(document.querySelector('.cam-play')).zIndex, '4');

    // ---- the settings popover ----
    document.getElementById('camera-settings').click();
    await wait(200);
    const pop=document.querySelector('.popover');
    say('the gear opens a popover', !!pop, true);
    say('the picture is still up behind it', q('.cam-tile').length, 4);
    say('it offers four views', pop.querySelectorAll('.cam-set-group')[0].querySelectorAll('.cam-seg-btn').length, 4);
    const modes=[...pop.querySelectorAll('.cam-mode')];
    say('five transports listed', modes.length, 5);
    const off=modes.filter(m=>m.dataset.off==='1');
    say('two are unavailable in this engine', off.length, 2);
    say('and each says why',
        off.every(m=>{const t=m.querySelector('.cam-mode-tag.is-no'); return t && t.textContent.length>8;}), true);
    out.push('    reasons: ' + off.map(m=>m.querySelector('.cam-mode-tag').textContent).join(' | '));
    say('Auto is selected', modes[0].dataset.on, '1');
    say('and reports what it picked',
        modes[0].querySelector('.cam-mode-tag').textContent, 'Direct snapshot');
    say('unavailable transports cannot be clicked', off.every(m=>m.disabled), true);
    const fps=[...pop.querySelectorAll('.cam-set-group')].pop().querySelectorAll('.cam-seg-btn');
    say('the fps scale stops at 15', [...fps].map(b=>b.textContent).join(','), '1,5,10,15');

    // ---- the stock printer's path: one file, half a frame a second ----
    document.querySelector('.popover-x').click(); await wait(120);
    H.setCameraTransport('monitor'); await wait(500);
    say('the monitor transport is in use', H.cameraStatus().transport, 'monitor');
    say('it draws exactly one tile', q('.cam-tile').length, 1);
    const mim=document.querySelector('.cam-tile[data-cam="__monitor"] img.cam-frame');
    say('and points it at the monitor file', !!(mim && mim.src), true);
    say('which decodes too', mim.naturalWidth > 0, true);
    say('the monitor tile carries no camera name',
        q('.cam-tile[data-cam="__monitor"] .cam-tile-name').length, 0);
    H.setCameraTransport('auto'); await wait(400);
    say('back to auto picks the direct transport again', H.cameraStatus().transport, 'snapshot');

    // ---- stop ----
    await H.stopCamera(); await wait(250);
    say('stopping clears the tiles', q('.cam-tile').length, 0);
    say('and says the camera is not on', document.querySelector('.cam-msg').textContent, 'Camera not on');
    // nothing may keep polling after a stop
    const before=[...q('img')].length;
    await wait(400);
    say('no poller survived the stop', P.store.cam.streaming, false);
   } catch(e){ out.push('FAIL  drive threw: '+(e&&e.stack||e)); }
   window.__report=out.join('\n');
  })();
})();
