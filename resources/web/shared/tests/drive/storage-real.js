/*
 * Storage against a REAL printer, read-only: it lists and it pages, and sends nothing
 * that changes anything.
 *
 * This is where the paging was actually settled. The simulator holds a handful of
 * items, so nothing there can page and nothing there collides; the printer holds sixty
 * recordings of which one file appears four times, and that is what showed the grid
 * drawing 72 cards for 60 items - a card key that was not unique, leaking a node per
 * repaint. `storage-paging.js` now poses that collision offline; this is the witness it
 * was written from.
 *
 *   python3 run_webkit.py --real --sn <SN> --size 1920x1080 --drive drive/storage-real.js
 *
 * Needs Orca closed - it authenticates with the same saved clientId.
 */
(function(){
  const out=[]; const P=window.__devicePage;
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const info=(s)=>out.push('  '+s);
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const vis=(s)=>{const e=document.querySelector(s);return !!e && e.getBoundingClientRect().height>0;};
  const foot=()=>{const e=document.querySelector('.stor-foot span');return e?e.textContent:null;};
  const cards=()=>document.querySelectorAll('.stor-card').length;
  const settle=async()=>{for(let i=0;i<60 && P.handlers.storageData().loading;i++) await wait(300); await wait(500);};
  (async ()=>{
   try{
    for (let i=0;i<40 && !(P&&P.bridge);i++) await wait(400);
    for (let i=0;i<40 && !P.state.lastUpdate;i++) await wait(500);
    say('a session came up and state arrived', P.state.lastUpdate>0, true);
    P.handlers.showView('storage'); await wait(300);
    const tabs=[...document.querySelectorAll('#storage .tab')].map(t=>t.title);
    say('three kinds', tabs.length, 3);
    info('tabs: '+JSON.stringify(tabs));

    for (const k of ['timelapses','prints','logs']) {
      P.handlers.openStorage(k); await settle();
      const d=P.handlers.storageData();
      info(`${k}: ${cards()} cards, footer ${JSON.stringify(foot())}, `
         + `hasMore=${d.hasMore}, error=${JSON.stringify(d.error||'')}`);
      say(`${k}: it read the machine without error`, d.error||'', '');
      // The count and the grid are two views of one list. They disagreed by twelve on
      // this printer, and nothing on screen said which was right.
      say(`${k}: the count matches the grid`, foot(), cards()+' shown');
      say(`${k}: one card per item`, cards(), d.items.length);
      say(`${k}: every card separately addressable`,
          new Set([...document.querySelectorAll('.stor-card')].map(c=>c.dataset.key)).size,
          d.items.length);
      say(`${k}: Load more offered exactly when there is more`,
          vis('.stor-more'), !!d.hasMore);
      if (!d.hasMore) continue;
      const before=cards();
      // Read the flag, not the DOM: a page came back inside 250 ms here, so anything
      // that waits before looking is racing the printer rather than testing the page.
      document.querySelector('.stor-more').click();
      say(`${k}: pressing it is a page in flight`,
          P.handlers.storageData().loadingMore, true);
      for (let i=0;i<60 && P.handlers.storageData().loadingMore;i++) await wait(300);
      await wait(400);
      say(`${k}: and it appended`, cards()>before, true);
      say(`${k}: still one card per item`, cards(), P.handlers.storageData().items.length);
      info(`${k}: ${before} -> ${cards()}`);
    }
    const glyph=document.querySelector('.stor-card .stor-glyph');
    say('a log card wears the log icon', glyph&&glyph.getAttribute('src'), 'icons/iconLog.svg');
    say('and the icon loaded on this engine', glyph&&glyph.naturalWidth>0, true);
   }catch(e){ out.push('FAIL  threw: '+(e&&e.stack||e)); }
   window.__report=out.join('\n');
  })();
})();
