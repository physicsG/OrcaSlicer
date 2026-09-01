/*
 * The Homing dialog against a REAL G28, which is the only witness that counts.
 *
 * This one MOVES THE MACHINE: it presses the page's own Home button and watches the
 * dialog against the printer's own state until the axes stop. Everything else about
 * this wait was got wrong twice from plausible readings of fields that turned out not
 * to mean what they looked like, so it is checked here where the bed can be seen.
 *
 *   python3 run_webkit.py --real --sn <SN> --size 1920x1080 --drive drive/homing-real.js
 *
 * Needs Orca closed - it authenticates with the same saved clientId, and a broker
 * evicts the older holder. Takes about a minute; a G28 measured 42 s.
 */
(function(){
  const out=[]; const P=window.__devicePage;
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const info=(s)=>out.push('  '+s);
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const open=()=>!!document.querySelector('.dialog.blocking');
  const msg =()=>{const m=document.querySelector('.blocking-msg');return m?m.textContent:null;};
  const g=(k)=>P.state.get(k)||{};

  (async ()=>{
   try{
    for (let i=0;i<40 && !(P&&P.bridge);i++) await wait(400);
    for (let i=0;i<40 && !P.state.lastUpdate;i++) await wait(500);
    say('a session came up and state arrived', P.state.lastUpdate>0, true);
    await P.session.refreshWaitState();
    info('before: homed_axes='+JSON.stringify(g('toolhead').homed_axes)
        +'  idle_timeout='+g('idle_timeout').state);

    const t0=Date.now(); const at=()=>((Date.now()-t0)/1000);
    P.byModule.control.home();

    // Sample until the dialog goes, or two minutes, whichever comes first.
    let openedAt=null, closedAt=null, busySeen=0, lastRow='';
    let velZeroWhileOpen=0, sawMotion=false, labels=new Set();
    for (let i=0;i<600;i++){
      const up=open();
      if (up && openedAt===null) openedAt=at();
      const mr=g('motion_report'), it=g('idle_timeout');
      const v=Number(mr.live_velocity)||0;
      const busy=it.state==='Printing';
      if (busy) busySeen++;
      if (Math.abs(v)>0.001) sawMotion=true;
      if (up) { if (Math.abs(v)<=0.001) velZeroWhileOpen++; if (msg()) labels.add(msg()); }
      const row=[up?'DIALOG':'-  -  ', 'idle='+it.state,
                 'vel='+v.toFixed(2),
                 'z='+(Array.isArray(mr.live_position)?Number(mr.live_position[2]).toFixed(1):'-'),
                 'msg='+JSON.stringify(msg())].join('  ');
      if (row!==lastRow){ info(at().toFixed(1).padStart(5)+'  '+row); lastRow=row; }
      if (!up && openedAt!==null){ closedAt=at(); break; }
      await wait(200);
    }

    say('the dialog opened', openedAt!==null, true);
    say('the printer actually ran it', busySeen>0 && sawMotion, true);
    say('and the dialog was still up when the machine went quiet', closedAt!==null, true);
    if (closedAt===null){ window.__report=out.join('\n'); return; }

    info(`open ${openedAt.toFixed(1)}s -> closed ${closedAt.toFixed(1)}s `
        +`(${(closedAt-openedAt).toFixed(1)}s), idle_timeout said Printing for `
        +`${(busySeen*0.2).toFixed(1)}s`);
    info('lines shown: '+JSON.stringify([...labels]));

    // The bug, stated as a number: the dialog used to go at the first quiet sample.
    // It must instead last essentially as long as the machine claimed to be working.
    say('it lasted as long as the machine was working, not a moment of it',
        closedAt >= busySeen*0.2, true);
    say('and that was a real procedure, not a moment', closedAt > 10, true);
    // Zero velocity is not the end of anything: it was measured reading 0 for two
    // seconds at a time, eight times, mid-G28.
    say('it survived the zero-velocity gaps rather than ending on one',
        velZeroWhileOpen > 5, true);

    await P.session.refreshWaitState();
    info('after: homed_axes='+JSON.stringify(g('toolhead').homed_axes)
        +'  idle_timeout='+g('idle_timeout').state);
    say('the axes are homed once it is over', P.state.toolhead().allHomed, true);
    say('and the machine is idle, so nothing was still moving behind the dialog',
        g('idle_timeout').state!=='Printing', true);
   }catch(e){ out.push('FAIL  threw: '+(e&&e.stack||e)); }
   window.__report=out.join('\n');
  })();
})();
