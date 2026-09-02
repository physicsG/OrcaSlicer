/* The not-connected branch, with no printer involved. Camera discovery reads the
   device record, so this is exactly the path the project's own rule says to force. */
(function(){
  const out=[]; const P=window.__devicePage;
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  (async()=>{ try{
    for (let i=0;i<30 && !(P&&P.bridge);i++) await wait(400);
    await wait(3000);
    out.push(`  reachable=${P.store.reachable}  device=${P.store.device && P.store.device.ip}`);
    say('the page is up', !!document.querySelector('.app'), true);
    say('both columns still built', document.querySelectorAll('.view-col').length, 2);
    say('every panel painted', document.querySelectorAll('#view-control .panel').length, 4);
    say('nothing reported a paint error',
        [...document.querySelectorAll('[data-paint-error]')].map(e=>e.id+':'+e.dataset.paintError).join(','), '');
    const t0=Date.now();
    await P.byModule.camera.startCamera();
    const took=Date.now()-t0;
    out.push(`  startCamera took ${took}ms with nothing there`);
    say('discovery gives up rather than hanging', took < 12000, true);
    say('and finds no cameras', P.store.cam.cams.length, 0);
    say('so it falls back to the monitor file',
        P.byModule.camera.cameraStatus().transport, 'monitor');
    await P.byModule.camera.stopCamera();
    say('the gear still opens', (document.getElementById('camera-settings').click(), !!document.querySelector('.popover')), true);
  } catch(e){ out.push('FAIL  threw: '+(e&&e.stack||e)); }
  window.__report=out.join('\n'); })();
})();
