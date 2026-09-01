/*
 * Storage's paging, across all three kinds.
 *
 * Every one of these sources pages - `start`/`limit` for history, `page_index` for
 * recordings, `page_number` for files - and only history had it wired, so the other two
 * showed a first page and offered no way to ask for a second. The first page was also
 * 20 or 24 rows against a grid that holds 21, so the answer to "what is on this
 * printer" arrived a row short of the space it had.
 *
 * The simulator holds a handful of items, which is too few to page, so the three reads
 * are answered here: sixty rows, then a short page. Everything else - the store, the
 * commands, the grid, the footer - is the page's.
 *
 *   python3 run_webkit.py --size 1920x1080 --drive drive/storage-paging.js
 */
(function(){
  const out=[]; const P=window.__devicePage;
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const info=(s)=>out.push('  '+s);
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const vis=(s)=>{const e=document.querySelector(s);return !!e && e.getBoundingClientRect().height>0;};
  const foot=()=>document.querySelector('.stor-foot span').textContent;
  const cards=()=>document.querySelectorAll('.stor-card').length;

  const seen=[];
  const real = P.bridge.request.bind(P.bridge);
  const rows=(n,tag)=>Array.from({length:n},(_,i)=>({job_id:tag+i, filename:'/f/'+tag+i+'.gcode',
      status:'completed', end_time:1756000000+i, print_duration:600, exists:true}));
  // Recordings as the printer really sends them: `date_index` and `gcode_name`, no
  // `name` and no `id` - and a gcode_name that REPEATS, because a file recorded more
  // than once is the normal case. Measured on hardware: 48 distinct gcode_names across
  // 60 recordings, one of them four times, which drew 72 cards for 60 items.
  const tl=(n,tag)=>Array.from({length:n},(_,i)=>({gcode_name:tag+(i%3),
      date_index:'2026080118'+tag+String(i).padStart(3,'0'),
      video_duration:'0:10', video_file_size:1024, generate_date:'2026-08-01'}));
  const files=(n,tag)=>Array.from({length:n},(_,i)=>({path:'logs/'+tag+i+'.log', size:100, modified:1756000000}));

  P.bridge.request = async (cmd, params) => {
    seen.push([cmd, JSON.stringify(params)]);
    // only the paged reads are slowed - a roots lookup on the way there would blow the
    // test's own budget, not the page's
    if (!/History|Timelapse|FileListPage/.test(cmd)) return real(cmd, params);
    await wait(500);                                  // long enough to see the spinner
    if (cmd === 'sw_GetPrintHistory')
      return { jobs: params.start === 0 ? rows(60,'a') : rows(7,'b') };
    if (cmd === 'sw_GetCameraTimelapseInstance')
      return { instances: params.page_index === 0 ? tl(60,'a') : tl(4,'b') };
    if (cmd === 'sw_GetFileListPage')
      return { files: params.page_number === 0 ? files(60,'a') : files(3,'b') };
    return real(cmd, params);
  };

  (async ()=>{
   try{
    P.handlers.showView('storage'); await wait(200);

    for (const [kind,first,second,cursor] of [
        ['prints', 60, 67, 'start'],
        ['timelapses', 60, 64, 'page_index'],
        ['logs', 60, 63, 'page_number']]) {
      seen.length = 0;
      P.handlers.openStorage(kind); await wait(150);
      say(`${kind}: a first read shows a spinner, not an empty box`,
          vis('.stor-grid') === false && vis('.spinner'), true);
      await wait(700);
      say(`${kind}: the first page arrived`, cards(), first);
      say(`${kind}: and the count says so`, foot(), `${first} shown`);
      say(`${kind}: Load more is offered`, vis('.stor-more'), true);
      say(`${kind}: and nothing is spinning`, vis('.stor-foot .spinner'), false);

      // Checked without waiting: the flag is raised before the request goes out, so a
      // reply that beats the check is the only way this can be seen to fail. On the
      // real printer a page came back inside 250 ms and did exactly that.
      document.querySelector('.stor-more').click();
      say(`${kind}: pressing it is a page in flight`,
          P.handlers.storageData().loadingMore, true);
      await wait(150);
      say(`${kind}: which spins`, vis('.stor-foot .spinner'), true);
      say(`${kind}: and takes the button away while it works`, vis('.stor-more'), false);
      say(`${kind}: the grid is not disturbed`, cards(), first);
      await wait(700);
      say(`${kind}: the page appended`, cards(), second);
      say(`${kind}: the count followed`, foot(), `${second} shown`);
      say(`${kind}: a short page means no more`, vis('.stor-more'), false);
      say(`${kind}: and the spinner is gone`, vis('.stor-foot .spinner'), false);
      const asked = seen.filter(([c])=>/History|Timelapse|FileListPage/.test(c))
                        .map(([,p])=>JSON.parse(p)[cursor]);
      say(`${kind}: the cursor advanced on the wire (${cursor})`,
          JSON.stringify(asked), JSON.stringify(kind==='prints'?[0,60]:[0,1]));
      // One node per item, however the source names them. A key that repeats leaks a
      // node per repaint, and nothing on screen says so - the count read 60 while the
      // grid held 72.
      say(`${kind}: one card per item, no orphans`,
          document.querySelectorAll('.stor-grid .stor-card').length, second);
      say(`${kind}: and every card is separately addressable`,
          new Set([...document.querySelectorAll('.stor-card')]
            .map(c=>c.dataset.key)).size, second);
    }

    // the two subjects that used to share cam.error
    P.store.timelapses.error = 'x';
    say('a failed listing no longer writes on the camera',
        P.store.cam.error, '');
   }catch(e){ out.push('FAIL  threw: '+(e&&e.stack||e)); }
   P.bridge.request = real;
   window.__report=out.join('\n');
  })();
})();
