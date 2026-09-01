(function(){
  const out=[]; const P=window.__devicePage;
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const b=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();
    return {w:Math.round(r.width),h:Math.round(r.height),y:Math.round(r.top)};};
  (async()=>{ try{
    const body=document.querySelector('#task');
    out.push(`  printing:  body ${body.clientHeight}  content ${body.scrollHeight}  panel ${b('.col-main > .panel:last-child').h}`);
    say('nothing is clipped while printing', body.scrollHeight <= body.clientHeight, true);
    const job=document.querySelector('.job');
    const last=job.lastElementChild.getBoundingClientRect();
    say('the last row is inside the panel',
        Math.round(last.bottom) <= Math.round(body.getBoundingClientRect().bottom), true);
    say('the progress bar is visible', !!b('.job-bar') && b('.job-bar').h > 0, true);
    say('both job buttons are visible', document.querySelectorAll('.job-actions .job-btn').length, 2);
    const btn=document.querySelectorAll('.job-actions .job-btn')[1].getBoundingClientRect();
    say('and the second one is on screen',
        Math.round(btn.bottom) <= Math.round(body.getBoundingClientRect().bottom), true);

    // ---- and the idle machine, where the card is one line ----
    P.mock.printer.printState='standby';
    P.mock.printer.mainState='standby';
    P.mock.printer.filename='';
    await wait(1800);
    out.push(`  idle card: ${document.querySelector('.job') ? '.job' : (document.querySelector('.empty') ? '.empty' : '?')}`);
    out.push(`  idle:      body ${body.clientHeight}  content ${body.scrollHeight}`);
    say('idle does not clip either', body.scrollHeight <= body.clientHeight, true);
    // Not a floor any more - `--task-h` is gone. The card always draws a 96px thumbnail,
    // so what stops it collapsing is the card, not a number in the stylesheet.
    say('and does not collapse to nothing', body.clientHeight >= 120, true);

    // the camera still takes the rest of the column
    const main=b('.col-main'), cam=b('.col-main > .panel'), task=b('.col-main > .panel:last-child');
    out.push(`  column ${main.h} = camera ${cam.h} + 20 + task ${task.h}`);
    say('the column is exactly filled', Math.abs(main.h - (cam.h + 20 + task.h)) <= 1, true);
    say('the camera still takes the surplus', cam.h > cam.w * 9 / 16, true);
  } catch(e){ out.push('FAIL  threw: '+(e&&e.stack||e)); }
  window.__report=out.join('\n'); })();
})();
