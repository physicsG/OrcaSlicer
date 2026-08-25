(function(){
  const out=[]; const P=window.__devicePage;
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const q=(s)=>document.querySelectorAll(s);
  (async ()=>{
   try{
    for (let i=0;i<40 && !(P&&P.bridge);i++) await wait(400);
    for (let i=0;i<40 && !P.store.device;i++) await wait(400);
    out.push(`  device ${P.store.device && P.store.device.ip}  reachable=${P.store.reachable}`);
    const H = P.byModule.camera;

    await H.startCamera();
    await wait(1500);
    const st=H.cameraStatus();
    out.push('  cameras: ' + P.store.cam.cams.map(c=>`${c.name}/${c.service}${c.snapshot_url?'':' (no still)'}`).join('  '));
    say('the real printer answered the camera list', P.store.cam.cams.length >= 2, true);
    say('multiACE was rejected', P.store.cam.cams.some(c=>c.name==='multiACE'), false);
    say('auto chose the direct snapshot', st.transport, 'snapshot');
    say('a tile is up', q('.cam-tile').length >= 1, true);
    const im=document.querySelector('.cam-tile img.cam-frame');
    // The first frame is a real HTTP round trip to the printer; waiting for it is the
    // check, not a workaround for one.
    for (let i=0;i<40 && !(im.naturalWidth>0);i++) await wait(250);
    say('a real frame decoded', im && im.naturalWidth > 0, true);
    out.push(`  frame ${im.naturalWidth}x${im.naturalHeight}  src ${im.src.slice(0,58)}...`);
    say('it is the case camera at 1080p', im.naturalWidth, 1920);

    // ---- measure the rate through the PANEL, not a synthetic loop ----
    const count = (sec) => new Promise((res)=>{
      let n=0; const el=document.querySelector('.cam-tile img.cam-frame');
      const h=()=>n++;
      el.addEventListener('load',h);
      setTimeout(()=>{ el.removeEventListener('load',h); res(n/sec); }, sec*1000);
    });
    const fps = await count(4);
    out.push(`  MEASURED ${fps.toFixed(1)} fps through the panel at 15 requested`);
    say('the panel is well past the monitor file’s 0.5 fps', fps > 5, true);

    // ---- and that the fps cap actually caps ----
    H.setCameraFps(1); await wait(600);
    const slow = await count(4);
    out.push(`  MEASURED ${slow.toFixed(1)} fps at 1 requested`);
    say('the cap is honoured', slow <= 2.5, true);
    H.setCameraFps(15); await wait(400);

    // ---- the grid, and the focus rule, against real cameras ----
    H.setCameraView('grid'); await wait(2500);
    say('grid draws four cells', q('.cam-tile').length, 4);
    const live=[...q('.cam-tile img.cam-frame')].filter(i=>i.naturalWidth>0);
    say('every real camera decoded', live.length, P.store.cam.cams.length);
    out.push('  tiles: ' + [...q('.cam-tile[data-cam]')].map(t=>{
      const i=t.querySelector('img'); return `${t.dataset.cam} ${i.naturalWidth}x${i.naturalHeight}`;
    }).join('  '));

    // focused tile fast, the rest at 1
    const rate = (sel, sec) => new Promise((res)=>{
      let n=0; const el=document.querySelector(sel); if(!el) return res(-1);
      const h=()=>n++; el.addEventListener('load',h);
      setTimeout(()=>{ el.removeEventListener('load',h); res(n/sec); }, sec*1000);
    });
    H.focusTile(0); await wait(500);
    const [f0,u1] = await Promise.all([
      rate('.cam-tile[data-index="0"] img', 4),
      rate('.cam-tile[data-index="1"] img', 4)]);
    out.push(`  focused ${f0.toFixed(1)} fps   unfocused ${u1.toFixed(1)} fps`);
    say('the focused tile runs fast', f0 > 4, true);
    say('the unfocused one does not', u1 <= 2.5, true);

    await H.stopCamera(); await wait(600);
    say('stop clears the tiles', q('.cam-tile').length, 0);
   } catch(e){ out.push('FAIL  drive threw: '+(e&&e.stack||e)); }
   window.__report=out.join('\n');
  })();
})();
