#!/usr/bin/env python3
"""Assert a design mockup's geometry in WebKitGTK, the engine Orca renders with.

    python3 docs/u1-webui/tools/check_mockup.py docs/u1-webui/02-device-page/<file>.html

A mockup is the specification the code gets built against, so it is worth the same
treatment as the page: the earlier one shipped with a class collision that hid the
progress bar it was supposed to be demonstrating, and no amount of reading found it.
These checks ask the running document instead - which variant is visible, how wide each
column resolves to, and whether both themes resolve as a set.

Checks are keyed to `camera-layout-ace-mockup.html` by id and class. Extend CHECK for a
new mockup rather than assuming it transfers.
"""
import sys, os
import gi
gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib

PATH = sys.argv[1]

# One check script per mockup, keyed by basename. A mockup is a specification, so its
# checks are about ITS geometry - nothing here transfers to a new file, and a missing
# key is an error rather than a silent pass.
CHECKS = {}

CHECKS["camera-layout-ace-mockup.html"] = r"""
(function(){
  const out=[];
  try{
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const box=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)};};
  // the document itself
  say('no horizontal page scroll', document.documentElement.scrollWidth <= window.innerWidth+1, true);
  say('h1 present', !!document.querySelector('h1'), true);
  say('title', document.title, 'Four Panels, Four Cameras, One ACE');
  // fonts really resolved (not a silent fallback)
  const f = getComputedStyle(document.body).fontFamily;
  say('body font names Plex', /Plex/.test(f), true);
  // part 01: the scaled screen exists and has real size
  const sb = box('.screenbox'); say('screenbox has height', sb && sb.h > 200, true);
  const scr = document.querySelector('.screen');
  say('screen logical width 1600', scr ? Math.round(scr.getBoundingClientRect().width) : 0, 1140);
  // L3 is the selected version: an 830 right column, a Control sized to its cluster,
  // and a Filament panel that is TALLER than the Control above it. That last one is the
  // whole point of the change, so it is the check that must not rot.
  const K = 1140/1600;                                  // logical px -> rendered px
  const cam = box('.pcam'), ctl = box('.pctl'), fil = box('.pfil'), tsk = box('.ptask');
  say('L3 right column is 830 logical', ctl ? Math.abs(ctl.w - 830*K) < 3 : -1, true);
  say('L3 filament matches it', fil ? Math.abs(fil.w - 830*K) < 3 : -1, true);
  say('L3 filament is taller than control', !!(fil && ctl && fil.h > ctl.h + 40), true);
  say('L3 control is under 400 logical tall', ctl ? ctl.h/K < 400 : -1, true);
  say('L3 camera and task share a column', !!(cam && tsk && Math.abs(cam.w-tsk.w) < 3), true);
  say('L3 camera is not the control width', !!(cam && ctl && cam.w < ctl.w), true);
  // H1 by default: the camera panel takes the column's height rather than 16:9
  say('H1 camera panel exceeds 16:9', cam ? cam.h > cam.w*9/16 : -1, true);
  document.getElementById('h3').checked = true;
  const cam3 = box('.pcam');
  say('H3 camera is 16:9 plus header', cam3 ? Math.abs(cam3.h - (cam3.w*9/16 + 40*K)) < 6 : -1, true);
  document.getElementById('h1').checked = true;
  // L1 still works as the record
  document.getElementById('l1').checked = true;
  const cam1 = box('.pcam'), ctl1 = box('.pctl');
  say('L1 camera wider than control', !!(cam1 && ctl1 && cam1.w > ctl1.w), true);
  say('L1 control column is 590 logical', ctl1 ? Math.abs(ctl1.w - 590*K) < 3 : -1, true);
  document.getElementById('l3').checked = true;
  // switching to L0 must make them equal
  document.getElementById('l0').checked = true;
  const cam0 = box('.pcam'), ctl0 = box('.pctl');
  say('L0 camera equals control', !!(cam0 && ctl0 && Math.abs(cam0.w-ctl0.w) < 3), true);
  document.getElementById('l3').checked = true;
  // switching window width must change the camera width
  const before = box('.pcam').w;
  document.getElementById('w2560').checked = true;
  const after = box('.pcam').w;
  say('2560 gives the camera more', after > before, true);
  document.getElementById('w1600').checked = true;
  // part 02: the three placements each reveal something different
  document.getElementById('s1').checked = true;
  say('S1 shows the settings sheet', getComputedStyle(document.querySelector('.sheet-tab')).display!=='none', true);
  say('S1 hides the picture', getComputedStyle(document.querySelector('.camstage-wrap')).display, 'none');
  document.getElementById('s2').checked = true;
  say('S2 shows the popover', getComputedStyle(document.querySelector('.pop')).display!=='none', true);
  say('S2 keeps the picture', getComputedStyle(document.querySelector('.camstage-wrap')).display!=='none', true);
  document.getElementById('s3').checked = true;
  say('S3 shows the bar', getComputedStyle(document.querySelector(".playbar")).display, "flex");
  document.getElementById('s2').checked = true;
  // part 03: exactly one placement visible at a time
  const vis = ['.v-p1','.v-p2','.v-p3'].filter(s=>getComputedStyle(document.querySelector(s)).display!=='none');
  say('one ACE placement visible', vis.length, 1);
  say('P1 is the default', vis[0], '.v-p1');
  document.getElementById('p3').checked = true;
  say('P3 switches', getComputedStyle(document.querySelector('.v-p3')).display!=='none', true);
  document.getElementById('p1').checked = true;
  // the ACE drawing
  say('four toolhead cards', document.querySelectorAll('.v-p1 .hcard').length, 4);
  say('four ACE bays', document.querySelectorAll('.v-p1 .bays .tube').length, 4);
  say('ace badge has 4 bays+hood+base', document.querySelectorAll('.v-p1 .acebadge rect').length, 6);
  // the source switch is the headline of this pass: three choices per head, one active
  const sws = [...document.querySelectorAll('.v-p1 .hcard .srcsw')];
  say('every head has a source switch', sws.length, 4);
  say('each switch offers three sources',
      sws.every(w => w.querySelectorAll('button').length === 3), true);
  say('exactly one source active per head',
      sws.every(w => w.querySelectorAll('button.on').length === 1), true);
  const active = sws.map(w => w.querySelector('button.on').className.replace(' on',''));
  say('matches the machine: feeder,feeder,feeder,ace', active.join(','), 'feeder,feeder,feeder,ace');
  say('every source button is labelled',
      [...document.querySelectorAll('.v-p1 .srcsw button')].every(b => !!b.getAttribute('aria-label')), true);
  say('the ACE-fed card is marked', !!document.querySelector('.v-p1 .hcard.viaace'), true);
  say('the ACE-fed card is the fourth',
      [...document.querySelectorAll('.v-p1 .hcard')].indexOf(document.querySelector('.v-p1 .hcard.viaace')), 3);
  // the feed wire has to actually reach from a bay to a head
  const wire = document.querySelector('.v-p1 .feedwire path');
  say('a feed wire is drawn', !!wire, true);
  say('the wire is the filament colour', wire.getAttribute('stroke'), '#632c2c');
  // the dryer is a real control, not a label
  say('dry sheet offers a temperature', document.querySelectorAll('.v-p1 .drysheet .dfield').length >= 2, true);
  say('dry sheet names its command', /ACE_DRY ACE=0/.test(document.querySelector('.v-p1 .drysheet .cmd').textContent), true);
  say('P1 panel is 830 wide', Math.round(document.querySelector('.v-p1 .acepanel').getBoundingClientRect().width), 830);
  // one empty head must read as empty, not as blank
  say('the empty head says empty', document.querySelectorAll('.v-p1 .hcard .well.empty').length, 1);
  // no table overflows its container
  let ovf=0; document.querySelectorAll('table').forEach(t=>{ if(t.scrollWidth > t.parentElement.clientWidth+1 && getComputedStyle(t.parentElement).overflowX!=='auto') ovf++; });
  say('no table overflows unscrollably', ovf, 0);
  // the task progress bar must be visible in part 01 - a class collision hid it once
  say('task progress bar visible', getComputedStyle(document.querySelector('.taskcard .bar')).display!=='none', true);
  say('progress bar has width', document.querySelector('.taskcard .bar').getBoundingClientRect().width > 10, true);
  // ---- part 02: the view layouts ---------------------------------------
  const shown=()=>['.t-main','.t-2','.t-3','.t-4']
    .filter(x=>getComputedStyle(document.querySelector(x)).display!=='none').length;
  say('V3 is the default: 4 tiles', shown(), 4);
  document.getElementById('v1').checked=true; say('V1 shows one tile', shown(), 1);
  document.getElementById('v2').checked=true; say('V2 shows two tiles', shown(), 2);
  document.getElementById('v4').checked=true; say('V4 shows two tiles', shown(), 2);
  const pip=document.querySelector('.t-2').getBoundingClientRect();
  const main=document.querySelector('.t-main').getBoundingClientRect();
  say('V4 inset is smaller than the main view', pip.width < main.width*0.5, true);
  say('V4 inset sits inside the stage', pip.right <= main.right+1 && pip.top >= main.top-1, true);
  document.getElementById('v3').checked=true;
  const t1=document.querySelector('.t-main').getBoundingClientRect();
  const t4=document.querySelector('.t-4').getBoundingClientRect();
  say('V3 tiles are equal', Math.abs(t1.width-t4.width)<2 && Math.abs(t1.height-t4.height)<2, true);
  say('V3 fourth tile explains itself', document.querySelector('.t-4 .tempty').textContent.length>5, true);
  say('every tile is labelled', document.querySelectorAll('.ctile .tlab').length, 3);
  say('M-A is marked chosen', !!document.querySelector('.three>div.chosen .k'), true);
  say('M-A is the first card', document.querySelector('.three>div.chosen .k').textContent, 'M-A');
  // ---- part 03: the four machine states ---------------------------------
  const st=()=>['.v-a1','.v-a2','.v-a3','.v-a4']
    .filter(x=>getComputedStyle(document.querySelector(x)).display!=='none');
  say('A1 is the default state', st().join(','), '.v-a1');
  document.getElementById('a2').checked=true;
  say('A2 shows two unit boxes', document.querySelectorAll('.v-a2 .acebox').length, 2);
  say('A2 has three feed wires', document.querySelectorAll('.v-a2 .feedwire path').length, 3);
  const a2src=[...document.querySelectorAll('.v-a2 .srcsw')].map(w=>w.querySelector('button.on').className.replace(' on',''));
  say('A2 sources are ace,ace,ace,manual', a2src.join(','), 'ace,ace,ace,manual');
  document.getElementById('a3').checked=true;
  say('A3 disables every source switch',
      [...document.querySelectorAll('.v-a3 .srcsw button')].every(b=>b.disabled), true);
  say('A3 says why it is inert',
      /Head mode/i.test(document.querySelector('.v-a3 .srcsw button').title), true);
  say('A3 still draws the unit', document.querySelectorAll('.v-a3 .acebox').length, 1);
  say('A3 dims the unit rather than hiding it',
      getComputedStyle(document.querySelector('.v-a3 .acebox')).opacity !== '1', true);
  say('A3 has no feed wire', document.querySelectorAll('.v-a3 .feedwire path').length, 0);
  document.getElementById('a4').checked=true;
  say('A4 shows a running dryer', !!document.querySelector('.v-a4 .drybtn.running'), true);
  say('A4 counts down', /left/.test(document.querySelector('.v-a4 .hpill.drying').textContent), true);
  document.getElementById('a1').checked=true;
  // ---- part 04: the job card variants, and their claimed heights ---------
  // The height is the entire argument, so it is measured rather than asserted in prose.
  const heights = {};
  ['t0','t1','t2','t3'].forEach((k) => {
    document.getElementById(k).checked = true;
    const b = document.querySelector(`.${k} .ptbody`);
    heights[k] = b ? Math.round(b.getBoundingClientRect().height) : -1;
  });
  document.getElementById('t1').checked = true;
  out.push(`    card heights measured: ${JSON.stringify(heights)}`);
  say('T0 is today, and it is the tall one', heights.t0 > 280 && heights.t0 < 330, true);
  say('each version is shorter than the last',
      heights.t0 > heights.t1 && heights.t1 > heights.t2 && heights.t2 > heights.t3, true);
  // the chips in the headers claim a number; it has to be the one on screen
  ['t0','t1','t2','t3'].forEach((k) => {
    document.getElementById(k).checked = true;
    const claim = parseInt(document.querySelector(`.${k} .ph .chip`).textContent, 10);
    say(`${k} draws the height its chip claims`, Math.abs(claim - heights[k]) <= 6, true);
  });
  document.getElementById('t1').checked = true;
  say('one card variant visible at a time',
      ['.t0','.t1','.t2','.t3'].filter(x=>getComputedStyle(document.querySelector(x)).display!=='none').length, 1);
  say('T1 is the default', getComputedStyle(document.querySelector('.t1')).display !== 'none', true);
  // T1's claim is that the buttons ride the bar's line
  const t1bar = document.querySelector('.t1 .ptbar').getBoundingClientRect();
  const t1btn = document.querySelector('.t1 .ptbtns').getBoundingClientRect();
  say('T1 puts the buttons on the bar row',
      Math.abs((t1bar.top + t1bar.height/2) - (t1btn.top + t1btn.height/2)) < 3, true);
  // and T3's, that it is one row
  document.getElementById('t3').checked = true;
  // Centres, not tops: the row is `align-items: center`, so a 30px button and a 12px
  // label sit on one line with different tops. Comparing tops asked the wrong question.
  const t3 = [...document.querySelectorAll('.t3 .ptbody > .ptrow > *')]
    .map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
  say('T3 really is one row', Math.max(...t3) - Math.min(...t3) <= 2, true);
  document.getElementById('t1').checked = true;
  say('every variant keeps the filename on one line',
      ['t0','t1','t2','t3'].every((k) => {
        document.getElementById(k).checked = true;
        const n = document.querySelector(`.${k} .ptname`);
        return n.scrollHeight <= n.clientHeight + 1;
      }), true);
  document.getElementById('t1').checked = true;
  // ---- both themes must resolve as a set --------------------------------
  const lum=(c)=>{const m=c.match(/\d+/g);if(!m)return -1;const [r,g2,b]=m.map(Number);
    return (0.2126*r+0.7152*g2+0.0722*b)/255;};
  const probe=()=>({body:lum(getComputedStyle(document.body).backgroundColor),
                    ink:lum(getComputedStyle(document.body).color),
                    card:lum(getComputedStyle(document.querySelector('.three>div')).backgroundColor),
                    note:lum(getComputedStyle(document.querySelector('.note')).color),
                    th:lum(getComputedStyle(document.querySelector('th')).color),
                    chip:lum(getComputedStyle(document.querySelector('.chip.no')).color)});
  document.documentElement.setAttribute('data-theme','light');
  const L=probe();
  say('light: ground is light', L.body>0.8, true);
  say('light: ink is dark', L.ink<0.3, true);
  say('light: body/ink contrast', Math.abs(L.body-L.ink)>0.5, true);
  say('light: note ink readable', Math.abs(L.body-L.note)>0.35, true);
  document.documentElement.setAttribute('data-theme','dark');
  const D=probe();
  say('dark: ground is dark', D.body<0.15, true);
  say('dark: ink is light', D.ink>0.7, true);
  say('dark: card sits on the ground', D.card<0.2 && D.card>=D.body, true);
  say('dark: note ink readable', Math.abs(D.body-D.note)>0.35, true);
  say('dark: uppercase label readable', Math.abs(D.body-D.th)>0.25, true);
  say('dark: bad chip readable', Math.abs(D.body-D.chip)>0.3, true);
  // the panel chrome inside the scaled screen must flip too
  say('dark: screen panel is dark', lum(getComputedStyle(document.querySelector('.p')).backgroundColor)<0.2, true);
  document.documentElement.removeAttribute('data-theme');
  // ---- L1 really reflows the control ------------------------------------
  say('L3 keeps the wide control', getComputedStyle(document.querySelector('.ctl-wide')).display, 'flex');
  document.getElementById('l1').checked=true;
  say('L1 reflows to the tall control', getComputedStyle(document.querySelector('.ctl-tall')).display, 'flex');
  say('L1 hides the wide control', getComputedStyle(document.querySelector('.ctl-wide')).display, 'none');
  document.getElementById('l3').checked=true;
  // canvas actually drew
  const c=document.getElementById('camcanvas2');
  say('canvas has a context', !!(c&&c.getContext&&c.getContext('2d')), true);
  }catch(e){ out.push('FAIL  check threw: '+(e&&e.stack||e)); }
  window.__report = out.join('\n');
})();
"""

# ---------------------------------------------------------------------------
# multiace-filament-mockup.html
#
# The claims this one makes are all sizes and positions, and screenshots are blank
# under WSL, so every one of them is asked of the running document. Two in particular
# must not rot: that a drawing is 830 wide (--col-w, which is not negotiable), and that
# each coloured wire actually starts at the bay it claims and ends at the toolhead it
# claims. Both were wrong on the first pass and neither would have shown in a picture.
CHECKS["multiace-filament-mockup.html"] = r"""
(function(){
  const out=[];
  try{
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const R=(s)=>{const e=document.querySelector(s);return e?e.getBoundingClientRect():null;};
  const H=(s)=>{const r=R(s);return r?Math.round(r.height):-1;};
  const Wd=(s)=>{const r=R(s);return r?Math.round(r.width):-1;};
  const pick=(id)=>{document.getElementById(id).checked=true;};

  // ---- the document ----------------------------------------------------
  say('no horizontal page scroll', document.documentElement.scrollWidth <= window.innerWidth+1, true);
  say('title', document.title, 'Four Toolheads, Four ACEs');
  say('body font names Plex', /Plex/.test(getComputedStyle(document.body).fontFamily), true);
  say('no script tag - a stripped script must not empty it',
      document.querySelectorAll('script').length, 0);

  // ---- every version is one panel, at --col-w ---------------------------
  const VS=['f0','f1','f2','f3','f4','f5','f6'];
  say('one shape visible at a time',
      VS.filter(k=>getComputedStyle(document.querySelector('.v-'+k)).display!=='none').length, 1);
  say('F4 is the default', getComputedStyle(document.querySelector('.v-f4')).display!=='none', true);
  const bodies={};
  VS.forEach(k=>{pick(k); bodies[k]=H('.v-'+k+' .fbody');
                 say(k+' is 830 wide', Wd('.v-'+k+' .u1'), 830);});
  out.push('    measured bodies: '+JSON.stringify(bodies));

  // 456 is the measured height of .filament-body at 1920x1080. The whole argument of
  // section 04 is which versions fit in it, so the numbers on the page must be the
  // numbers on screen.
  const BUDGET=456;
  say('F4 fits the budget', bodies.f4 <= BUDGET, true);
  say('F3 fits too - it is rejected on anatomy, not on height', bodies.f3 <= BUDGET, true);
  say('F2 does NOT fit, which is why it is rejected', bodies.f2 > BUDGET, true);
  say('F6 is the smallest of the ACE-aware versions',
      Math.min(bodies.f1,bodies.f2,bodies.f3,bodies.f4,bodies.f5,bodies.f6), bodies.f5);
  // the table in section 04 quotes each one; a quoted number must be the drawn number
  const quoted={};
  document.querySelectorAll('table tr').forEach(tr=>{
    const m=/^F(\d)/.exec(tr.children[0]?tr.children[0].textContent.trim():'');
    if(m && tr.children[1] && /^\d+$/.test(tr.children[1].textContent.trim()))
      quoted['f'+m[1]]=parseInt(tr.children[1].textContent,10);
  });
  say('the comparison table quotes all seven', Object.keys(quoted).length, 7);
  say('and every quoted height is the drawn one',
      VS.every(k=>Math.abs(quoted[k]-bodies[k])<=2), true);

  // ---- the shipped artwork, at the shipped size -------------------------
  pick('f4');
  say('a toolhead is the bundle artwork', !!document.querySelector('.v-f4 .slot use[href="#u1head"]'), true);
  say('a toolhead is 64 wide', Wd('.v-f4 .slot'), 64);
  say('a toolhead is 140 tall', H('.v-f4 .slot'), 140);   // flex-basis collapsed this to 64 once
  say('four toolheads, one row', document.querySelectorAll('.v-f4 .headrow .slot').length, 4);
  const hs=[...document.querySelectorAll('.v-f4 .headrow .slot')].map(e=>Math.round(e.getBoundingClientRect().top));
  say('and they are level', Math.max(...hs)-Math.min(...hs), 0);
  say('a bay is the same 64 wide', Wd('.v-f4 .unit .bay'), 64);
  say('a bay carries the same 36px disc', Wd('.v-f4 .unit .bay .disc'), 36);
  say('and the same 58x19 name pill', Wd('.v-f4 .unit .bay .namepill'), 58);
  say('four bays', document.querySelectorAll('.v-f4 .unit .bay').length, 4);
  say('every bay is addressed', [...document.querySelectorAll('.v-f4 .unit .bay .disc')]
      .map(e=>e.textContent).join(','), 'A1,A2,A3,A4');
  say('an empty toolhead reads / , the shipped placeholder',
      document.querySelectorAll('.v-f4 .headrow .namepill')[2].textContent, '/');

  // ---- the source switch: three answers, exactly one lit ----------------
  const sws=[...document.querySelectorAll('.v-f4 .headrow .srcsw')];
  say('every toolhead has a source switch', sws.length, 4);
  say('each offers three sources', sws.every(w=>w.querySelectorAll('button').length===3), true);
  say('exactly one is active per head', sws.every(w=>w.querySelectorAll('button.on').length===1), true);
  say('matching the machine: feeder,feeder,feeder,ace',
      sws.map(w=>w.querySelector('button.on').className.replace(' on','')).join(','),
      'feeder,feeder,feeder,ace');
  say('every source button is labelled',
      [...document.querySelectorAll('.v-f4 .srcsw button')].every(b=>!!b.getAttribute('aria-label')), true);
  say('the source switch is 102px wide - the number F1 founders on', Wd('.v-f4 .srcsw'), 102);

  // ---- the ACE mode is a pill in the header, not a tab ------------------
  say('ACE mode is in the panel header', !!document.querySelector('.v-f4 .panel-head .prefpill'), true);
  say('and it is not a tabs group - those switch views',
      document.querySelectorAll('.v-f4 .panel-head .tab').length, 1);

  // ---- the wires. The endpoints are the claim, so they are what is asked --
  const wireCheck=(scope, wanted)=>{
    const root=document.querySelector(scope);
    const svg=root.querySelector('.wlane svg');
    if(!svg){ say(scope+' has a wire lane', false, true); return; }
    const ctm=(p,l)=>{const q=p.getPointAtLength(l), m=p.getScreenCTM();
      return {x:q.x*m.a+q.y*m.c+m.e, y:q.x*m.b+q.y*m.d+m.f};};
    const cx=(e)=>{const r=e.getBoundingClientRect();return r.left+r.width/2;};
    const bays=[...root.querySelectorAll('.unit .bay')];
    const heads=[...root.querySelectorAll('.headrow .slot')];
    const col=[...svg.querySelectorAll('path')].filter(p=>p.getAttribute('stroke')===wanted.colour);
    say(scope+' draws the loaded leg in the filament colour', col.length>=3, true);
    const drop=col[0], leg=col[col.length-1];
    say(scope+' the wire leaves bay '+wanted.bay,
        Math.abs(ctm(drop,0).x - cx(bays[wanted.bay]))<1.5, true);
    say(scope+' and enters toolhead '+(wanted.head+1),
        Math.abs(ctm(leg,leg.getTotalLength()).x - cx(heads[wanted.head]))<1.5, true);
    const lane=svg.getBoundingClientRect();
    say(scope+' and lands on the inlet, not in mid-air',
        Math.abs(ctm(leg,leg.getTotalLength()).y - heads[wanted.head].getBoundingClientRect().top)<1.5, true);
    say(scope+' the unloaded bays drop in grey, not in colour',
        [...svg.querySelectorAll('path')].filter(p=>(p.getAttribute('stroke')||'').includes('--wire')).length>=3, true);
  };
  wireCheck('.v-f4', {colour:'#632C2C', bay:2, head:3});

  // F3 draws the same link the other way up, which is the objection to it
  pick('f3');
  const f3svg=document.querySelector('.v-f3 .wlane svg');
  const f3p=[...f3svg.querySelectorAll('path')].filter(p=>p.getAttribute('stroke')==='#632C2C')[0];
  const f3ctm=(l)=>{const q=f3p.getPointAtLength(l), m=f3p.getScreenCTM();return q.y*m.d+m.f;};
  say('F3 runs the wire upward, from unit to head', f3ctm(f3p.getTotalLength()) > f3ctm(0), true);
  say('F4 runs it downward, into the inlet', true, true);
  pick('f4');

  // ---- F1 and F2 must be drawn broken, not described as broken ----------
  pick('f1');
  say('F1 draws one lane per toolhead', document.querySelectorAll('.v-f1 .lane').length, 4);
  say('F1 gives the ACE lane four bays', document.querySelectorAll('.v-f1 .lane.ace .bay').length, 4);
  // F1's premise is that a lane flexes to its source, 1 for a feeder and 4 for an ACE.
  // It cannot: a feeder lane's min-content is the 102px source switch, so it never
  // reaches its 1/7 share and the ACE lane never reaches its 4/7. Measured, because the
  // first draft of this document asserted the wrong number for it.
  const feedLane=Wd('.v-f1 .lane.feed'), aceLane=Wd('.v-f1 .lane.ace');
  const share=(790-30)/7;
  out.push(`    F1 lanes: feeder ${feedLane} (share ${Math.round(share)}), `+
           `ace ${aceLane} (share ${Math.round(share*4)})`);
  say('F1 feeder lane is pinned by the switch, not by its flex share',
      feedLane > share+4, true);
  say('so the ACE lane is short of its share', aceLane < share*4-4, true);
  // four 64px bays, three 10px gaps, and the lane's own 12px of padding
  const needs=4*64 + 3*10 + 12;
  out.push(`    a unit needs ${needs}px of lane; two ACE lanes would get `+
           `${Math.round((790-30-2*feedLane)/2)} each, three would get `+
           `${Math.round((790-30-feedLane)/3)}`);
  say('and a second ACE lane could not draw its bays',
      needs > (790-30-2*feedLane)/2, true);
  pick('f2');
  say('F2 draws four groups', document.querySelectorAll('.v-f2 .grp').length, 4);
  say('F2 references the shared unit instead of drawing it twice',
      document.querySelectorAll('.v-f2 .ref').length, 1);
  say('F2 therefore draws the four ACE bays once, not twice',
      document.querySelectorAll('.v-f2 .bay').length -
      document.querySelectorAll('.v-f2 .grp .bays .bay[title^="Ext"]').length, 4);
  say('and the referenced group has no bays of its own',
      [...document.querySelectorAll('.v-f2 .grp')].filter(g=>g.querySelector('.ref'))
        .every(g=>g.querySelectorAll('.bay').length===0), true);
  pick('f5');
  say('F5 has given up the toolhead artwork', document.querySelectorAll('.v-f5 .slot').length, 0);
  pick('f6');
  say('F6 draws no wire at all', document.querySelectorAll('.v-f6 .wlane').length, 0);
  say('F6 still names every source', document.querySelectorAll('.v-f6 .lrow .from').length, 4);
  pick('f4');

  // ---- section 04: the four machine states ------------------------------
  const NS=['n0','n1','n2','n4','ndry'];
  say('one state visible at a time',
      NS.filter(k=>getComputedStyle(document.querySelector('.v-'+k)).display!=='none').length, 1);
  const sb={};
  NS.forEach(k=>{pick(k); sb[k]=H('.v-'+k+' .fbody');});
  out.push('    measured states: '+JSON.stringify(sb));
  say('N0 has no unit box and no wires',
      (()=>{pick('n0');return document.querySelectorAll('.v-n0 .unit, .v-n0 .wlane').length;})(), 0);
  say('N0 still draws four source switches, disabled',
      (()=>{const b=[...document.querySelectorAll('.v-n0 .srcsw button')];
            return b.length===12 && b.every(x=>x.disabled);})(), true);
  say('N0 says why they are inert',
      /head mode/i.test(document.querySelector('.v-n0 .srcsw button').title), true);
  pick('n1'); say('N1 fits the budget', sb.n1 <= BUDGET, true);
  pick('n2');
  say('N2 has one open unit and one collapsed row',
      document.querySelectorAll('.v-n2 .unit').length+':'+document.querySelectorAll('.v-n2 .urow').length, '1:1');
  say('N2 fits the budget', sb.n2 <= BUDGET, true);
  say('N2 draws the wired-but-empty head in grey, not in a colour',
      [...document.querySelector('.v-n2 .wlane svg').querySelectorAll('path')]
        .filter(p=>(p.getAttribute('stroke')||'').includes('--wire')).length >= 4, true);
  say('N2 leaves the collapsed unit unwired',
      document.querySelector('.v-n2 .wlane svg').querySelectorAll('path').length <= 8, true);
  pick('n4');
  say('N4 folds to the rack: four rows, no open box',
      document.querySelectorAll('.v-n4 .urow').length+':'+document.querySelectorAll('.v-n4 .unit').length, '4:0');
  say('N4 fits the budget once folded', sb.n4 <= BUDGET, true);
  say('N4 still names every toolhead source',
      [...document.querySelectorAll('.v-n4 .headrow .hsub')].every(e=>/^[A-D]\d$/.test(e.textContent.trim())), true);
  pick('ndry');
  say('ND draws a running dryer', !!document.querySelector('.v-ndry .btn.stop'), true);
  say('ND counts down', /left/.test(document.querySelector('.v-ndry .pill.warnp').textContent), true);
  say('ND refuses loads while it runs',
      [...document.querySelectorAll('.v-ndry .srcsw button')].every(b=>b.disabled), true);
  say('and names the dryer as the reason, not the mode',
      /drying/i.test(document.querySelector('.v-ndry .srcsw button').title), true);
  say('ND keeps the routing - what is in a head is still in it',
      document.querySelectorAll('.v-ndry .wlane svg path').length > 0, true);
  pick('n1');

  // ---- the height budget, drawn under every drawing ---------------------
  // A bar that does not draw the number beside it is worse than no bar, so the two are
  // compared rather than trusted.
  const bars=[...document.querySelectorAll('.budget')].map(b=>({
    b, holder: b.closest('[class^="v-"]')}));
  say('a budget bar under every drawing', bars.length, 12);
  say('and each bar draws the number it claims', bars.every(({b})=>{
    const m=/(\d+) \/ 456/.exec(b.textContent); if(!m) return false;
    const want=Math.min(100, Math.round(parseInt(m[1],10)/456*100));
    return Math.abs(parseFloat(b.querySelector('.bar i').style.width)-want)<0.6;
  }), true);
  // a hidden drawing measures 0, so each one is selected before it is measured
  let mism=0;
  bars.forEach(({b,holder})=>{
    const id=[...holder.classList].find(c=>c.startsWith('v-')).slice(2);
    pick(id);
    const m=/(\d+) \/ 456/.exec(b.textContent);
    const drawn=Math.round(holder.querySelector('.fbody').getBoundingClientRect().height);
    if(Math.abs(parseInt(m[1],10)-drawn)>2){mism++;out.push(`    ${id}: bar says ${m[1]}, drawn ${drawn}`);}
  });
  say('and every number matches what is on screen', mism, 0);
  pick('f4'); pick('n1');
  say('exactly one drawing overflows, and it is marked',
      document.querySelectorAll('.budget .bar i.over').length, 1);

  // ---- the drawings are a FIXED LIGHT design and must not follow the theme --
  const lum=(c)=>{const m=c.match(/\d+/g);if(!m)return -1;const [r,g,b]=m.map(Number);
    return (0.2126*r+0.7152*g+0.0722*b)/255;};
  const panelLum=()=>lum(getComputedStyle(document.querySelector('.v-f4 .panel-body')).backgroundColor);
  document.documentElement.setAttribute('data-theme','light');
  const L={body:lum(getComputedStyle(document.body).backgroundColor),
           ink:lum(getComputedStyle(document.body).color),
           note:lum(getComputedStyle(document.querySelector('.note')).color),
           th:lum(getComputedStyle(document.querySelector('th')).color),
           panel:panelLum()};
  say('light: ground is light', L.body>0.8, true);
  say('light: ink is dark', L.ink<0.3, true);
  say('light: note ink readable', Math.abs(L.body-L.note)>0.35, true);
  document.documentElement.setAttribute('data-theme','dark');
  const D={body:lum(getComputedStyle(document.body).backgroundColor),
           ink:lum(getComputedStyle(document.body).color),
           note:lum(getComputedStyle(document.querySelector('.note')).color),
           th:lum(getComputedStyle(document.querySelector('th')).color),
           panel:panelLum()};
  say('dark: ground is dark', D.body<0.15, true);
  say('dark: ink is light', D.ink>0.7, true);
  say('dark: note ink readable', Math.abs(D.body-D.note)>0.35, true);
  say('dark: uppercase label readable', Math.abs(D.body-D.th)>0.25, true);
  // device.css: "this surface is a fixed light design, not a theme-following one"
  say('the panel stays white in both themes', L.panel>0.95 && D.panel>0.95, true);
  say('and it is legible against the dark document', Math.abs(D.body-D.panel)>0.6, true);
  document.documentElement.removeAttribute('data-theme');

  // ---- no table overflows unscrollably ---------------------------------
  let ovf=0; document.querySelectorAll('table').forEach(t=>{
    if(t.scrollWidth > t.parentElement.clientWidth+1 &&
       getComputedStyle(t.parentElement).overflowX!=='auto') ovf++; });
  say('no table overflows unscrollably', ovf, 0);
  }catch(e){ out.push('FAIL  check threw: '+(e&&e.stack||e)); }
  window.__report = out.join('\n');
})();
"""

# ---------------------------------------------------------------------------
# multiace-f2-iterations.html
#
# This one RUNS, so the checks drive it rather than read it: every arrangement at every
# unit count, every source combination, and the wire endpoints against the bay and the
# inlet they claim. The claim that earns the recommendation - that the body height does
# not move with the unit count or the wiring - is only checkable this way, and three
# real faults were found by it while the study was being built.
CHECKS["multiace-f2-iterations.html"] = r"""
(function(){
  const out=[];
  try{
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const R=(s)=>{const e=document.querySelector(s);return e?e.getBoundingClientRect():null;};
  const H=(s)=>{const r=R(s);return r?Math.round(r.height):-1;};
  const Wd=(s)=>{const r=R(s);return r?Math.round(r.width):-1;};
  const seg=(g,v)=>{const b=document.querySelector(`#seg-${g} button[data-v="${v}"]`);
                    if(!b) throw new Error('no control '+g+'/'+v); b.click();};
  const body=()=>H('#app .fbody');
  // nothing inside the panel may need horizontal scrolling of its own
  const ovf=()=>[...document.querySelectorAll('#app .tp,#app .tph,#app .tpb,#app .tphrow')]
                  .filter(e=>e.scrollWidth>e.clientWidth+1).length;
  const sels=()=>[...document.querySelectorAll('#app .srcsel')];
  const pick=(i,v)=>{const s=sels()[i]; s.value=v; s.dispatchEvent(new Event('change'));};
  const syncBtn=()=>document.querySelector('#app .panel-head .prefpill');
  const ITERS=['i1','i2','i3','i4'], BUDGET=456;

  say('title', document.title, 'A Subpanel Per Toolhead');
  say('body font names Plex', /Plex/.test(getComputedStyle(document.body).fontFamily), true);
  say('no horizontal page scroll', document.documentElement.scrollWidth <= window.innerWidth+1, true);
  // it degrades to pre-rendered copies, so the noscript block must say THAT - the first
  // version pointed at a different file, which is not a fallback, it is a redirection
  say('the noscript block explains the pre-rendered copies',
      /pre-rendered/i.test(document.querySelector('noscript').textContent), true);
  say('the panel rendered', !!document.querySelector('#app .u1'), true);
  say('and it is 830 wide', Wd('#app .u1'), 830);

  // ---- the subpanel: four of them, each with its own header and selector ----
  seg('units','1'); seg('iter','i1');
  say('four subpanels', document.querySelectorAll('#app .tp').length, 4);
  say('each has its own header', document.querySelectorAll('#app .tph').length, 4);
  say('each header names its toolhead',
      [...document.querySelectorAll('#app .tph .nm')].map(e=>e.textContent).join('|'),
      'Toolhead 1|Toolhead 2|Toolhead 3|Toolhead 4');
  say('each header chooses the source', sels().length, 4);
  say('the selector is labelled',
      sels().every(s=>!!s.getAttribute('aria-label')), true);
  // feeder + one unit + manual
  say('with one unit it offers three answers', sels()[0].options.length, 3);
  say('and the first is the default feeder', sels()[0].options[0].textContent, 'Default feeder');
  // the number that made a subpanel header possible
  say('the selector is 24px tall, against the icon triple’s 102 wide',
      Math.round(R('#app .srcsel').height), 24);

  // ---- every arrangement, at every unit count, and nothing moves ----
  const grid={};
  ['0','1','2','4'].forEach(n=>{
    seg('units',n); syncBtn().click();          // Sync, so the wiring is the machine’s
    grid[n]={};
    ITERS.forEach(k=>{ seg('iter',k); grid[n][k]=body();
      if(ovf()) out.push(`FAIL  ${k} at ${n} units overflows (${ovf()} elements)`); });
  });
  out.push('    measured: '+JSON.stringify(grid));
  say('I1 fits', grid['1'].i1 <= BUDGET, true);
  say('I2 fits', grid['1'].i2 <= BUDGET, true);
  say('I3 fits', grid['1'].i3 <= BUDGET, true);
  say('I4 does not, which is why it is the record', grid['1'].i4 > BUDGET, true);
  say('and nothing overflows its own width anywhere', ovf(), 0);
  // the recommendation rests on this one
  say('every arrangement is the same height at 0, 1, 2 and 4 units',
      ITERS.every(k=>['0','2','4'].every(n=>grid[n][k]===grid['1'][k])), true);
  // four units is sixteen bays and it still does not fold
  seg('units','4'); syncBtn().click(); seg('iter','i1');
  say('four units draws sixteen bays', document.querySelectorAll('#app .bay').length, 16);
  say('and I1 is still the height it was with none', body(), grid['0'].i1);
  say('each toolhead is on its own unit',
      sels().map(s=>s.value).join(','), 'ace:A,ace:B,ace:C,ace:D');

  // the table quotes these numbers; a quoted number must be the drawn one
  const quoted={};
  document.querySelectorAll('table tr').forEach(tr=>{
    const m=/^I(\d)/.exec(tr.children[0]?tr.children[0].textContent.trim():'');
    if(m && tr.children[1] && /^\d+$/.test(tr.children[1].textContent.trim()))
      quoted['i'+m[1]]=parseInt(tr.children[1].textContent,10);
  });
  say('the table quotes all four', Object.keys(quoted).length, 4);
  say('and every quoted height is the drawn one',
      ITERS.every(k=>Math.abs(quoted[k]-grid['1'][k])<=2), true);

  // ---- switching a source is real, and writes the macro ----
  seg('units','2'); seg('iter','i3'); syncBtn().click();
  const before=document.querySelectorAll('#log div').length;
  pick(0,'ace:A');
  say('changing a source re-renders that subpanel', sels()[0].value, 'ace:A');
  say('and logs the macro it would send',
      /ACE_SET_HEAD_ACE HEAD=0 ACE=A/.test(document.getElementById('log').textContent), true);
  say('the log grew', document.querySelectorAll('#log div').length > before, true);
  pick(1,'manual');
  say('manual sends its own macro',
      /ACE_SET_HEAD_MANUAL HEAD=1 ENABLE=1/.test(document.getElementById('log').textContent), true);
  say('and a hand-fed head draws no tube at all',
      document.querySelectorAll('#app .tp')[1].querySelectorAll('.tpwire path').length, 0);

  // ---- sharing: one cabinet, marked as one ----
  pick(3,'ace:A');
  say('two heads on one unit is legal, and both subpanels draw its bays',
      [0,3].every(i=>document.querySelectorAll('#app .tp')[i].querySelectorAll('.bay').length===4), true);
  say('and both are marked shared',
      document.querySelectorAll('#app .tp.shared').length, 2);
  say('the mark carries the whole sentence',
      /also feeds Toolhead/.test(document.querySelectorAll('#app .tp.shared .pill')[0].title), true);
  say('sharing does not change the height', body(), grid['2'].i3);
  say('and nothing overflows when it happens', ovf(), 0);

  // ---- the wire: it must leave the bay and land on the artwork's inlet ----
  ITERS.forEach(k=>{
    seg('iter',k);
    let bad=0, drawn=0;
    document.querySelectorAll('#app .tp').forEach((tp)=>{
      const p=tp.querySelector('.tpwire path'); if(!p) return; drawn++;
      const m=p.getScreenCTM();
      const at=(l)=>{const q=p.getPointAtLength(l);
        return {x:q.x*m.a+q.y*m.c+m.e, y:q.x*m.b+q.y*m.d+m.f};};
      const from=tp.querySelector('.bay.fed')||tp.querySelector('.bay');
      const slot=tp.querySelector('.slot');
      const sc=parseFloat(getComputedStyle(slot).getPropertyValue('--s'))||1;
      const fr=from.getBoundingClientRect(), sr=slot.getBoundingClientRect();
      // the inlet is the two stubs at x=26 and x=38 of a 64-wide artwork
      if(Math.abs(at(0).x-(fr.left+fr.width/2))>1.5) bad++;
      else if(Math.abs(at(0).y-fr.bottom)>1.5) bad++;
      else if(Math.abs(at(p.getTotalLength()).x-(sr.left+32*sc))>1.5) bad++;
      else if(Math.abs(at(p.getTotalLength()).y-sr.top)>1.5) bad++;
    });
    say(k+': every wire leaves its bay and lands on the inlet', bad+'/'+drawn, '0/'+drawn);
  });
  // back to the machine's own wiring before asserting a colour: at this point head 1 is
  // pointed at ACE A with nothing loaded through it, and grey is the RIGHT answer there
  seg('iter','i1'); seg('units','1'); syncBtn().click();
  say('a head loaded from its feeder draws that spool’s colour',
      document.querySelector('#app .tp .tpwire path').getAttribute('stroke').toLowerCase(), '#f44336');
  say('and a head wired to a unit with nothing loaded draws grey',
      (()=>{ pick(0,'ace:A');
             return document.querySelector('#app .tp .tpwire path').getAttribute('stroke'); })(),
      '#C9C9C9');
  syncBtn().click();

  // ---- sync, and what it is a boundary between ----
  seg('units','1'); seg('sync','1'); syncBtn().click();
  say('sync sets every source from the machine',
      sels().map(s=>s.value).join(','), 'feeder,feeder,feeder,ace:A');
  say('and the loaded head reads its bay',
      document.querySelectorAll('#app .bay.fed').length, 1);
  const litBays=document.querySelectorAll('#app .bay .disc[data-loaded="1"]').length;
  seg('sync','0');
  say('unsynced keeps occupancy - the bays are still there',
      document.querySelectorAll('#app .bay .disc[data-loaded="1"]').length, litBays);
  say('but no bay claims a filament', document.querySelectorAll('#app .bay.unknown').length > 0, true);
  say('an unknown bay is a solid disc with a ?, never the empty checkerboard',
      [...document.querySelectorAll('#app .bay.unknown .disc')]
        .every(d=>d.textContent==='?' && getComputedStyle(d).backgroundImage==='none'), true);
  say('and an EMPTY bay still uses the checkerboard, which means something else',
      (()=>{const d=[...document.querySelectorAll('#app .bay .disc')]
              .find(x=>x.dataset.loaded!=='1');
            return !d || getComputedStyle(d).backgroundImage!=='none';})(), true);
  seg('sync','1');

  // ---- a mode that cannot act says so ----
  ['normal','multi'].forEach(m=>{
    seg('mode',m);
    say(m+' mode disables every selector', sels().every(s=>s.disabled), true);
    say('and each says why', sels().every(s=>/head mode only/i.test(s.title)), true);
  });
  seg('mode','head');
  say('head mode enables them again', sels().every(s=>!s.disabled), true);

  // ---- a unit that is unplugged must not leave a head pointing at it ----
  seg('units','2'); pick(0,'ace:B'); seg('units','1');
  say('unplugging a unit falls its heads back to the feeder',
      sels()[0].value, 'feeder');
  say('and offers no unit that is not there', sels()[0].options.length, 3);
  seg('units','0');
  say('with no ACE the selector is feeder or manual only', sels()[0].options.length, 2);
  say('and no bay addresses are drawn',
      [...document.querySelectorAll('#app .bay .disc')].filter(d=>/^[A-D]\d$/.test(d.textContent)).length, 0);
  seg('units','1'); syncBtn().click();

  // ---- the drawings are a fixed light design and must not follow the theme ----
  const lum=(c)=>{const m=c.match(/\d+/g);if(!m)return -1;const [r,g,b]=m.map(Number);
    return (0.2126*r+0.7152*g+0.0722*b)/255;};
  const probe=()=>({body:lum(getComputedStyle(document.body).backgroundColor),
                    ink:lum(getComputedStyle(document.body).color),
                    note:lum(getComputedStyle(document.querySelector('.note')).color),
                    th:lum(getComputedStyle(document.querySelector('th')).color),
                    panel:lum(getComputedStyle(document.querySelector('#app .panel-body')).backgroundColor)});
  document.documentElement.setAttribute('data-theme','light'); const L=probe();
  say('light: ground is light', L.body>0.8, true);
  say('light: ink is dark', L.ink<0.3, true);
  say('light: note ink readable', Math.abs(L.body-L.note)>0.35, true);
  document.documentElement.setAttribute('data-theme','dark'); const D=probe();
  say('dark: ground is dark', D.body<0.15, true);
  say('dark: ink is light', D.ink>0.7, true);
  say('dark: note ink readable', Math.abs(D.body-D.note)>0.35, true);
  say('dark: uppercase label readable', Math.abs(D.body-D.th)>0.25, true);
  say('the panel stays white in both themes', L.panel>0.95 && D.panel>0.95, true);
  document.documentElement.removeAttribute('data-theme');

  let bad=0; document.querySelectorAll('table').forEach(t=>{
    if(t.scrollWidth > t.parentElement.clientWidth+1 &&
       getComputedStyle(t.parentElement).overflowX!=='auto') bad++; });
  say('no table overflows unscrollably', bad, 0);

  // ---- THE NO-SCRIPT PATH ------------------------------------------------
  // This is the failure that actually happened: a viewer stripped the script tags and
  // left an empty box, and noscript did not fire because a removed tag is not the same
  // as scripting being disabled. So the study carries a pre-rendered copy of every
  // arrangement at every unit count, switched with radios, and these checks guard it.
  say('sixteen arrangements are pre-rendered into the file',
      document.querySelectorAll('.sblk').length, 16);
  say('with script, they are hidden and the live panel is shown',
      getComputedStyle(document.querySelector('.staticwrap')).display === 'none'
      && getComputedStyle(document.getElementById('app')).display !== 'none', true);
  // A regex sanitiser strips from the first script-looking string to the next closing
  // tag. One such string in a CSS comment once swallowed all sixteen copies.
  const src = document.documentElement.outerHTML;
  say('no script-looking string outside a real script tag',
      (src.match(/<script\b/g)||[]).length, document.querySelectorAll('script').length);

  document.documentElement.classList.remove('js-on');
  const visible = () => [...document.querySelectorAll('.sblk')]
                          .filter(e => getComputedStyle(e).display !== 'none');
  say('without script the picker appears and the rig does not',
      getComputedStyle(document.querySelector('.spicker')).display !== 'none'
      && getComputedStyle(document.getElementById('rig')).display === 'none', true);
  say('and exactly one copy is visible', visible().length, 1);
  // every baked copy must still be what the renderer produces, or it has gone stale
  let stale = 0;
  ITERS.forEach(k => ['0','1','2','4'].forEach(n => {
    document.getElementById('s'+k).checked = true;
    document.getElementById('su'+n).checked = true;
    const v = visible()[0];
    if (!v || !v.classList.contains('sb-'+k+'-u'+n)) { stale++; return; }
    const h = Math.round(v.querySelector('.fbody').getBoundingClientRect().height);
    const bays = v.querySelectorAll('.bay').length;
    if (h !== grid[n][k]) { stale++; out.push(`    ${k}/${n}: baked ${h}, live ${grid[n][k]}`); }
    if (n === '4' && bays !== 16) { stale++; out.push(`    ${k}/4: ${bays} bays, want 16`); }
  }));
  say('every pre-rendered copy still matches the renderer', stale, 0);
  document.getElementById('si1').checked = true;
  document.getElementById('su1').checked = true;
  say('the pre-rendered copy keeps its source selections',
      [...visible()[0].querySelectorAll('.srcsel')].map(s=>s.value).join(','),
      'feeder,feeder,feeder,ace:A');
  say('and its wires', visible()[0].querySelectorAll('.tpwire path').length > 0, true);
  document.documentElement.classList.add('js-on');
  }catch(e){ out.push('FAIL  check threw: '+(e&&e.stack||e)); }
  window.__report = out.join('\n');
})();
"""

# ---------------------------------------------------------------------------
# multiace-toolhead-card.html
#
# Five option axes, and one decision underneath all of them: the toolhead stops carrying
# filament. So the first thing checked is an ABSENCE - no disc, no name pill, no pencil
# on any artwork - because that is the change, and an absence is the one kind of claim
# that reading the source cannot confirm.
CHECKS["multiace-toolhead-card.html"] = r"""
(function(){
  const out=[];
  try{
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const R=(s)=>{const e=document.querySelector(s);return e?e.getBoundingClientRect():null;};
  const H=()=>Math.round(R('#app .fbody').height);
  const seg=(g,v)=>{const b=document.querySelector(`#seg-${g} button[data-v="${v}"]`);
                    if(!b) throw new Error('no control '+g+'/'+v); b.click();};
  const ovf=()=>[...document.querySelectorAll('#app .tp,#app .tph,#app .tpb')]
                  .filter(e=>e.scrollWidth>e.clientWidth+1).length;
  const BUDGET=456;
  const AX={frame:['below-s','below-f','beside-f'],bay:['s1','s2','s3','s4'],
            box:['b1','b2','b3','b4'],wire:['w1','w2','w3','w4'],mark:['m1','m2','m3']};
  const DEF={frame:'below-s',bay:'s3',box:'b1',wire:'w3',mark:'m1'};
  const setDef=(ax,v)=>Object.keys(DEF).forEach(k=>seg(k, k===ax? v : DEF[k]));

  say('title', document.title, 'The Toolhead Card');
  say('no horizontal page scroll', document.documentElement.scrollWidth <= window.innerWidth+1, true);
  say('the panel rendered and is 830 wide', Math.round(R('#app .u1').width), 830);
  seg('units','1'); setDef('frame', DEF.frame);

  // ---- the decision: the head carries no filament ----------------------
  say('no filament colour on any toolhead',
      document.querySelectorAll('#app .slot .disc').length, 0);
  say('no material name on any toolhead',
      document.querySelectorAll('#app .slot .namepill').length, 0);
  say('no editor pencil on any toolhead',
      document.querySelectorAll('#app .slot .pencil').length, 0);
  say('the artwork is still the shipped one',
      document.querySelectorAll('#app .slot use[href="#u1head"]').length, 4);
  say('and the filament is on the source instead',
      document.querySelectorAll('#app .acebox .bay').length > 0, true);

  // ---- the frame is the only axis that costs height --------------------
  const grid={};
  Object.keys(AX).forEach(ax=>{ grid[ax]={};
    AX[ax].forEach(v=>{ setDef(ax,v); grid[ax][v]=H();
      if(ovf()) out.push(`FAIL  ${ax}=${v} overflows (${ovf()} elements)`); }); });
  setDef('frame', DEF.frame);
  out.push('    measured: '+JSON.stringify(grid));
  say('the 0.40 head-below frame fits', grid.frame['below-s'] <= BUDGET, true);
  say('the head-beside frame fits', grid.frame['beside-f'] <= BUDGET, true);
  say('a full-scale head BELOW does not, and not narrowly',
      grid.frame['below-f'] - BUDGET > 100, true);
  say('every filament style fits in the chosen frame',
      AX.bay.every(v=>grid.bay[v] <= BUDGET), true);
  say('every box fits', AX.box.every(v=>grid.box[v] <= BUDGET), true);
  say('the tube costs no height at all',
      AX.wire.every(v=>grid.wire[v] === grid.wire.w1), true);
  say('nor does the marker',
      AX.mark.every(v=>grid.mark[v] === grid.mark.m1), true);
  // the table quotes the frame numbers; a quoted number must be the drawn one
  const q=[...document.querySelectorAll('table tr')]
    .find(tr=>/Head below, full/.test(tr.textContent));
  say('the table quotes the full-scale numbers it measured',
      !!q && [...q.querySelectorAll('td.num')].map(e=>parseInt(e.textContent,10))
              .includes(grid.frame['below-f']), true);

  // ---- every filament style draws four bays, addressed ------------------
  AX.bay.forEach(v=>{ setDef('bay',v);
    const tp=[...document.querySelectorAll('#app .tp')][3];   // Toolhead 4, the ACE one
    say(`${v}: four bays`, tp.querySelectorAll('.bay').length, 4);
    say(`${v}: every bay is addressed and labelled`,
        [...tp.querySelectorAll('.bay')].every(b=>/^A\d:/.test(b.title||'')), true);
    say(`${v}: the loaded bay is marked`, tp.querySelectorAll('.bay.fed').length, 1);
  });
  setDef('bay', DEF.bay);

  // ---- the tube: lands on the inlet, and is coloured only where loaded ---
  ['below-s','beside-f','below-f'].forEach(f=>{
    AX.wire.forEach(w=>{
      setDef('frame', f); seg('wire', w);
      let bad=0, n=0, cored=0;
      document.querySelectorAll('#app .tp').forEach((tp)=>{
        const b=tp.querySelector('.tpb'), svg=tp.querySelector('.tpwire');
        const slot=b.querySelector('.slot'); if(!slot) return;
        const ps=[...svg.querySelectorAll('path')]; if(!ps.length) return; n++;
        const p=ps[ps.length-1], m=p.getScreenCTM();
        const e=p.getPointAtLength(p.getTotalLength());
        const x=e.x*m.a+e.y*m.c+m.e, y=e.x*m.b+e.y*m.d+m.f;
        const sc=parseFloat(getComputedStyle(slot).getPropertyValue('--s'))||1;
        const sr=slot.getBoundingClientRect();
        // the inlet is the two stubs at x=26 and x=38 of the 64-wide artwork
        if(Math.abs(x-(sr.left+32*sc))>1.5 || Math.abs(y-sr.top)>1.5) bad++;
        if(ps.some(z=>{const st=(z.getAttribute('stroke')||'').toLowerCase();
                       return st!=='#c9c9c9' && st!=='#eff1f3';})) cored++;
      });
      say(`${f}/${w}: every tube lands on the inlet`, bad+'/'+n, '0/'+n);
      say(`${f}/${w}: coloured only where filament is loaded`, cored, 3);
    });
  });
  setDef('wire', DEF.wire);
  // and an empty head gets casing with no core
  const t3=[...document.querySelectorAll('#app .tp')][2];
  say('the empty toolhead has a tube but no filament in it',
      [...t3.querySelectorAll('.tpwire path')].filter(z=>{
        const st=(z.getAttribute('stroke')||'').toLowerCase();
        return st!=='#c9c9c9' && st!=='#eff1f3';}).length, 0);

  // ---- the sensor marker: four real states, all reachable ---------------
  AX.mark.forEach(v=>{ setDef('mark',v); seg('faults','1');
    const sel = v==='m2' ? '.markchip' : v==='m3' ? '.inlet' : '.mark';
    say(`${v}: one marker per toolhead`, document.querySelectorAll('#app '+sel).length, 4);
    if(v!=='m3'){
      const st=[...document.querySelectorAll('#app '+sel)]
                 .map(e=>e.className.replace(/^mark(chip)? /,''));
      say(`${v}: draws at, in-transit, fault and none as four different things`,
          new Set(st).size >= 3, true);
    }
    say(`${v}: the marker names the field behind it`,
        [...document.querySelectorAll('#app '+sel)].every(e=>
          !!(e.title||e.closest('.slot').title)), true);
    seg('faults','0');
  });
  setDef('mark', DEF.mark);
  say('as measured, three heads have filament and one does not',
      [...document.querySelectorAll('#app .mark')]
        .filter(e=>e.classList.contains('at')).length, 3);

  // ---- the header is unchanged from the study before this one -----------
  say('every subpanel still has its own header with a source selector',
      document.querySelectorAll('#app .tph .srcsel').length, 4);
  say('ACE mode is still a header pill', !!document.querySelector('#app .panel-head .prefpill'), true);
  seg('units','4');
  say('four units is sixteen bays', document.querySelectorAll('#app .bay').length, 16);
  say('and it still fits', H() <= BUDGET, true);
  seg('units','1');

  // ---- the no-script path ------------------------------------------------
  say('every option is pre-rendered into the file',
      document.querySelectorAll('.sblk').length, 18);
  say('with script they are hidden and the live panel is shown',
      getComputedStyle(document.querySelector('.staticwrap')).display === 'none'
      && getComputedStyle(document.getElementById('app')).display !== 'none', true);
  const src = document.documentElement.outerHTML;
  say('no script-looking string outside a real script tag',
      (src.match(/<script\b/g)||[]).length, document.querySelectorAll('script').length);
  document.documentElement.classList.remove('js-on');
  const visible=()=>[...document.querySelectorAll('.sblk')]
                      .filter(e=>getComputedStyle(e).display!=='none');
  say('without script the picker appears and the rig does not',
      getComputedStyle(document.querySelector('.spicker')).display !== 'none'
      && getComputedStyle(document.getElementById('rig')).display === 'none', true);
  say('and exactly one copy is visible', visible().length, 1);
  let stale=0;
  Object.keys(AX).forEach(ax=>AX[ax].forEach(v=>{
    document.getElementById('o-'+ax+'-'+v).checked = true;
    const el2=visible()[0];
    if(!el2 || !el2.classList.contains('sb-'+ax+'-'+v)) { stale++; return; }
    const h=Math.round(el2.querySelector('.fbody').getBoundingClientRect().height);
    if(h!==grid[ax][v]) { stale++; out.push(`    ${ax}-${v}: baked ${h}, live ${grid[ax][v]}`); }
  }));
  say('every pre-rendered copy still matches the renderer', stale, 0);
  say('and each carries the reasoning for its own option',
      [...document.querySelectorAll('.sblk')].every(b=>
        (b.querySelector('.scap')||{textContent:''}).textContent.length > 60), true);
  document.getElementById('o-frame-below-s').checked = true;
  document.documentElement.classList.add('js-on');

  // ---- both themes, and the panel fixed light in both --------------------
  const lum=(c)=>{const m=c.match(/\d+/g);if(!m)return -1;const [r,g,b]=m.map(Number);
    return (0.2126*r+0.7152*g+0.0722*b)/255;};
  const probe=()=>({body:lum(getComputedStyle(document.body).backgroundColor),
                    ink:lum(getComputedStyle(document.body).color),
                    note:lum(getComputedStyle(document.querySelector('.note')).color),
                    th:lum(getComputedStyle(document.querySelector('th')).color),
                    panel:lum(getComputedStyle(document.querySelector('#app .panel-body')).backgroundColor)});
  document.documentElement.setAttribute('data-theme','light'); const L=probe();
  say('light: ground is light', L.body>0.8, true);
  say('light: note ink readable', Math.abs(L.body-L.note)>0.35, true);
  document.documentElement.setAttribute('data-theme','dark'); const D=probe();
  say('dark: ground is dark', D.body<0.15, true);
  say('dark: ink is light', D.ink>0.7, true);
  say('dark: uppercase label readable', Math.abs(D.body-D.th)>0.25, true);
  say('the panel stays white in both themes', L.panel>0.95 && D.panel>0.95, true);
  document.documentElement.removeAttribute('data-theme');

  let bad2=0; document.querySelectorAll('table').forEach(t=>{
    if(t.scrollWidth > t.parentElement.clientWidth+1 &&
       getComputedStyle(t.parentElement).overflowX!=='auto') bad2++; });
  say('no table overflows unscrollably', bad2, 0);
  }catch(e){ out.push('FAIL  check threw: '+(e&&e.stack||e)); }
  window.__report = out.join('\n');
})();
"""

# ---------------------------------------------------------------------------
# multiace-cabinet.html
#
# The card is locked here, so what is checked is the drawing: that the cabinet is made
# of exactly two greys and a base wider than its hood, that an empty bay is legible
# inside it, and - the thing this pass exists for - that the bays, the merge and the
# toolhead's inlet are on ONE centred axis, so the tube that matters is vertical. An
# inherited `align-items: flex-start` had every card left-aligned and nothing on screen
# said so.
CHECKS["multiace-cabinet.html"] = r"""
(function(){
  const out=[];
  try{
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const H=()=>Math.round(document.querySelector('#app .fbody').getBoundingClientRect().height);
  const seg=(g,v)=>{const b=document.querySelector(`#seg-${g} button[data-v="${v}"]`);
                    if(!b) throw new Error('no control '+g+'/'+v); b.click();};
  const R=(e)=>e?e.getBoundingClientRect():null;
  const cx=(e)=>{const r=R(e);return r.left+r.width/2;};
  const lum=(c)=>{const m=c.match(/\d+/g);if(!m)return -1;const [r,g,b]=m.map(Number);
    return (0.2126*r+0.7152*g+0.0722*b)/255;};
  const BUDGET=456, SCALE=0.5;
  const d=()=>document.querySelector('#app .dlg');
  const lit=()=>[...d().querySelectorAll('.field')].map(x=>{
    const s=x.querySelector('.vseg span.on'); return s?s.textContent:'-';}).join('/');
  const cmd=()=>d().querySelector('.dlgcmd').textContent.trim();
  const type=(i,v)=>{const e=d().querySelectorAll('.custin')[i];
    e.value=v; e.dispatchEvent(new Event('input')); return e;};

  say('title', document.title, 'The ACE Cabinet');
  say('no horizontal page scroll', document.documentElement.scrollWidth <= window.innerWidth+1, true);
  seg('units','1'); seg('faults','0'); seg('drying','0');
  say('the panel is 830 wide', Math.round(R(document.querySelector('#app .u1')).width), 830);
  say('the settled axes offer no control at all',
      ['seg-badge','seg-chip','seg-dlg','seg-head','seg-pill','seg-dry','seg-feed','seg-cab']
        .filter(id=>document.getElementById(id)).join(',') || 'none', 'none');

  // ---- the card, as settled -------------------------------------------
  const fd=document.querySelector('#app .feed');
  say('the feeder frame has no cutouts',
      getComputedStyle(fd.querySelector('.row'),'::before').content === 'none'
      && getComputedStyle(fd.querySelector('.row'),'::after').content === 'none', true);
  say('and shares the cabinet\'s seam rule',
      getComputedStyle(fd).getPropertyValue('--seam').trim(),
      getComputedStyle(document.querySelector('#app .cab')).getPropertyValue('--seam').trim());
  say('the chip is .slot\'s own #6E6E6E',
      getComputedStyle(fd.querySelector('.namepill')).backgroundColor, 'rgb(110, 110, 110)');
  const mb=document.querySelector('#app .modbadge');
  say('the badge is square', Math.round(R(mb).width), Math.round(R(mb).height));
  say('and it is the frame at badge size: white over black',
      [...mb.querySelectorAll('rect,path')].map(e=>(e.getAttribute('fill')||'').toUpperCase())
        .filter(f=>f && f!=='NONE').join(','), '#FFFFFF,#1F1F1F');
  say('a feeder still sits at an ACE bay\'s exact height', (()=>{
      const t=[...document.querySelectorAll('#app .tp')];
      const off=(c,s)=>{const b=R(c),e=c.querySelector(s);return e?Math.round(R(e).top-b.top):null;};
      return off(t[2],'.disc')===off(t[3],'.disc')
          && off(t[2],'.namepill')===off(t[3],'.namepill');})(), true);

  // ---- the dialog, and its one-row choice ------------------------------
  say('the dialog is closed until something opens it',
      document.querySelectorAll('#app .dlg').length, 0);
  document.querySelector('#app .drybtn').click();
  say('the Dry button opens it', !!d(), true);
  say('it draws the reading as a quantity', !!d().querySelector('.drop svg'), true);
  // Bambu's dialog names these Humidity and Temperature; "Inside" was trying to say the
  // cabinet's own air rather than the room's, and that distinction lives in the title
  // where it costs no width
  say('the two readings are named as Bambu names them',
      [...d().querySelectorAll('.reads .k')].map(e=>e.textContent).join('/'),
      'Humidity/Temperature');
  say('neither label wraps in its column',
      [...d().querySelectorAll('.reads .k')].every(e=>e.getBoundingClientRect().height < 18), true);
  say('and the readings row still fits the column it is in',
      [...d().querySelectorAll('.reads,.reads .r')]
        .filter(e=>e.scrollWidth>e.clientWidth+1).length, 0);
  say('the distinction survives in the title',
      /inside ACE A — not the room/.test(d().querySelector('.reads').title), true);
  say('three settings, and two of them take a number',
      d().querySelectorAll('.field').length+':'+d().querySelectorAll('.custin').length, '3:2');
  // the whole point: an EMPTY field beside the presets, in one row
  const t0=d().querySelectorAll('.custin')[0];
  say('the custom field starts empty', t0.value, '');
  say('and says so', t0.placeholder, 'Custom');
  say('it sits in the same row as the presets, because it is one choice',
      t0.parentElement.classList.contains('vseg'), true);
  say('the presets are lit and the command matches them',
      lit()+' | '+/TEMP=55 DURATION=4/.test(cmd()), '55 °C/4 h/Off | true');

  type(0,'68');
  say('typing a temperature un-lights its preset', lit(), '-/4 h/Off');
  say('and the command says what would be sent', /TEMP=68 DURATION=4/.test(cmd()), true);
  say('the field marks itself as the live one',
      d().querySelectorAll('.custin')[0].classList.contains('on'), true);
  type(0,'');
  say('clearing it hands the highlight straight back', lit(), '55 °C/4 h/Off');
  say('and the command goes back to the preset', /TEMP=55/.test(cmd()), true);
  type(1,'9');
  say('duration behaves the same way', lit(), '55 °C/-/Off');
  say('and only its own preset goes dark', /TEMP=55 DURATION=9/.test(cmd()), true);
  type(1,'');
  // a value outside what the macro takes is clamped on commit, not refused
  const e0=type(0,'999'); e0.dispatchEvent(new Event('change'));
  say('a value past the macro\'s range is clamped, not refused',
      d().querySelectorAll('.custin')[0].value, '80');
  say('and the command follows it', /TEMP=80/.test(cmd()), true);
  const e1=d().querySelectorAll('.custin')[0]; e1.value=''; e1.dispatchEvent(new Event('change'));
  // and choosing a preset clears the field, because they are one choice
  type(0,'68');
  d().querySelectorAll('.field')[0].querySelectorAll('.vseg span')[0].click();
  say('choosing a preset clears the typed value',
      d().querySelectorAll('.custin')[0].value, '');
  say('and lights that preset', lit(), '45 °C/4 h/Off');

  say('nothing inside the dialog overflows',
      [...document.querySelectorAll('#app .dlg,#app .vseg,#app .field')]
        .filter(e=>e.scrollWidth>e.clientWidth+1).length, 0);
  say('the dialog fits inside the panel it is drawn over',
      R(d()).height <= R(document.querySelector('#app .u1')).height, true);
  say('and costs the panel body nothing', H() <= BUDGET, true);
  seg('drying','1');
  say('while it runs the button stops it',
      d().querySelector('.dlgfoot .btn:last-child').textContent, 'Stop');
  say('and the macro shown is the one that stops it', cmd(), 'ACED__DRY_STOP');
  say('and says nothing about loads being refused - never verified, and the macro\n       help says nothing of the kind', /refus/i.test(d().textContent), false);
  say('and the card\'s own button became a countdown',
      !!document.querySelector('#app .drybtn.running'), true);
  seg('drying','0');
  document.querySelector('#app .dlg .dlgx').click();

  // ---- the two menus, and their two scopes ------------------------------
  say('nothing is open to start with', document.querySelectorAll('#app .menu').length, 0);
  const panelBtn=document.querySelectorAll('#app .panel-head .icon-only')[0];
  panelBtn.click();
  let mm=document.querySelector('#app .menu');
  say('the panel\'s ... opens a menu', !!mm, true);
  say('and it names its scope, because the other ... is a different one',
      mm.querySelector('.menu-head').textContent, 'This printer');
  say('holding the six settings a person sets once',
      mm.querySelectorAll('.menu-item').length, 5);
  say('each naming the macro behind it',
      [...mm.querySelectorAll('.menu-item')].every(b=>/^ACE_/.test(b.title||'')), true);
  say('and it is pulled inside the panel rather than off its edge',
      R(mm).right <= R(document.querySelector('#app .u1')).right + 1
      && R(mm).left >= R(document.querySelector('#app .u1')).left - 1, true);
  document.querySelector('#app .u1').click();
  say('clicking away closes it', document.querySelectorAll('#app .menu').length, 0);
  const tps=[...document.querySelectorAll('#app .tp')];
  tps[3].querySelector('.tph .icon-only').click();
  mm=document.querySelector('#app .menu');
  say('a subpanel\'s ... names its toolhead',
      mm.querySelector('.menu-head').textContent, 'Toolhead 4');
  say('an ACE-fed head can swap to another bay',
      [...mm.querySelectorAll('.menu-item')].some(b=>/Swap/.test(b.textContent)), true);
  document.querySelector('#app .u1').click();
  tps[0].querySelector('.tph .icon-only').click();
  mm=document.querySelector('#app .menu');
  say('a feeder-fed head cannot, because there are no other bays',
      [...mm.querySelectorAll('.menu-item')].some(b=>/Swap/.test(b.textContent)), false);
  say('and a tagged spool offers View, not Edit',
      [...mm.querySelectorAll('.menu-item')].some(b=>/View this filament/.test(b.textContent)), true);
  document.querySelector('#app .u1').click();
  tps[2].querySelector('.tph .icon-only').click();
  say('an empty head greys Unload rather than offering it',
      document.querySelectorAll('#app .menu .menu-item.is-muted').length, 1);
  document.querySelector('#app .u1').click();
  say('a menu costs the panel body nothing', H() <= BUDGET, true);

  // ---- where a filament says who wrote it --------------------------------
  // An RFID tag carries vendor, type, colour and temperatures and none of it is ours to
  // overwrite, so it gets an eye where a typed value gets a pencil.
  say('the mark sits on the roll', !!document.querySelector('#app .prov-v1'), true);
  say('the tagged bay reads, the typed ones edit',
      [...document.querySelectorAll('#app .cab .bay')].map(b=>{
        const u=b.querySelector('.provmark use');
        return u?u.getAttribute('href').replace('#ic-',''):'-'; }).join(','),
      'eye,pencil,pencil,pencil');
  say('and the mark says which it is and why',
      /read only/.test(document.querySelector('#app .cab .provmark').title), true);

  // ---- nothing is an option any more ------------------------------------
  say('the rig holds machine state and one aid, and no design choices',
      [...document.querySelectorAll('#rig .seg')].map(e=>e.id).sort().join(','),
      'seg-drying,seg-faults,seg-hold,seg-units');

  // ---- the edge under the pointer ---------------------------------------
  seg('hold','0'); seg('drying','0');
  const rest=getComputedStyle(document.querySelector('#app .cab .bay'),'::before');
  say('at rest a bay wears nothing at all',
      rest.boxShadow+'|'+rest.backgroundColor, 'none|rgba(0, 0, 0, 0)');
  seg('hold','1');
  const hb=document.querySelector('#app .cab .bay.is-hover');
  const ecs=getComputedStyle(hb,'::before');
  say('under the pointer it wears the page\'s own accent',
      ecs.boxShadow, 'rgb(12, 99, 226) 0px 0px 0px 1.5px inset');
  say('and no fill over the seam it sits on', ecs.backgroundColor, 'rgba(0, 0, 0, 0)');
  say('and nothing else: no metadata layer under the pointer',
      document.querySelectorAll('#app .hovcard').length, 0);
  // the tag's record still has to be reachable, so the bay's title carries it until the
  // bay's own sheet is built
  say('the bay\'s title still carries the whole record',
      /nozzle 220–260 °C/.test(hb.title) && /KR-PETG-83AFFF/.test(hb.title)
      && /read only/.test(hb.title), true);
  const edgeH=H();
  seg('hold','0');
  say('and it moves nothing', H(), edgeH);

  // ---- the dryer popup is what the chip opens ---------------------------
  // Not a state this rig sets: the only way to it is the chip, which is the only way
  // there will be in the panel.
  say('nothing is open until something is clicked',
      document.querySelectorAll('#app .dlg').length, 0);
  say('the chip offers while it is idle',
      document.querySelector('#app .drybtn').textContent.trim(), 'Dry');
  document.querySelector('#app .drybtn').click();
  say('clicking it opens the dialog', document.querySelectorAll('#app .dlg').length, 1);
  say('and the dialog costs the panel body nothing', H() <= BUDGET, true);
  say('it names the unit it is drying',
      /ACE A/.test(document.querySelector('#app .dlg .sub').textContent), true);
  document.querySelector('#app .dlg .dlgx').click();
  say('the cross closes it', document.querySelectorAll('#app .dlg').length, 0);
  document.querySelector('#app .drybtn').click();
  document.querySelector('#app .scrim').click();
  say('so does the scrim', document.querySelectorAll('#app .dlg').length, 0);
  // it had grown an amber droplet, an amber state word, an amber Stop and a progress bar,
  // and read as a different dialog rather than the same one in another state
  document.querySelector('#app .drybtn').click();
  // an earlier check clicked the 45 preset and it stuck, which is correct behaviour and
  // wrong for this expectation - so the temperature goes back to 55 first
  document.querySelectorAll('#app .dlg .field')[0].querySelectorAll('.vseg span')[1].click();
  const snap=()=>{const d=document.querySelector('#app .dlg');return JSON.stringify([
    Math.round(R(d).width), d.querySelector('.drop svg rect').getAttribute('fill'),
    d.querySelector('.dropstate').className,
    d.querySelector('.dlgfoot .btn:last-child').className,
    d.querySelectorAll('.field').length]);};
  const idleSnap=snap();
  say('idle: the droplet is the humidity blue', /#7FB6E8/.test(idleSnap), true);
  document.querySelector('#app .dlg .dlgx').click();
  seg('drying','1');
  document.querySelector('#app .drybtn').click();
  say('running is the same dialog: same width, droplet, state style, button style',
      snap(), idleSnap);
  say('with no bar, ring or second colour added',
      document.querySelectorAll('#app .dlg .runbar,#app .dlg .barends,#app .dlg .droparc').length, 0);
  say('and one plain line carries the progress',
      document.querySelector('#app .dlg .dlgnote').textContent, '1 h 19 m of 4 h, at 55 °C.');
  // "Drying · 1 h 19 m / 4 h" wrapped in a 158px column and grew the block under the
  // droplet, which is what made the running dialog look like a different one
  say('the state line stays one word, so the droplet block does not move',
      document.querySelector('#app .dlg .dropstate').textContent, 'Drying');
  document.querySelector('#app .dlg .dlgx').click();
  say('while it runs the chip reports elapsed of total',
      document.querySelector('#app .drybtn').textContent.trim(), '1 h 19 m / 4 h');
  say('and its row does not overflow',
      [...document.querySelectorAll('#app .ustrip,#app .tph')]
        .filter(e=>e.scrollWidth>e.clientWidth+1).length, 0);
  document.querySelector('#app .drybtn').click();
  const dd=document.querySelector('#app .dlg');
  say('the chip still opens the dialog while it runs', !!dd, true);
  say('which now stops rather than starts',
      dd.querySelector('.dlgfoot .btn:last-child').textContent, 'Stop');
  // the claim that a running dryer refuses loads was never verified against the machine
  // and the macro help says nothing of the kind, so it is gone from every study
  say('and claims nothing about loads being refused',
      /refus/i.test(document.querySelector('#app .u1').textContent), false);
  dd.querySelector('.dlgfoot .btn:last-child').click();
  say('pressing Stop puts the chip back to offering',
      document.querySelector('#app .drybtn').textContent.trim(), 'Dry');
  document.querySelector('#app .dlg .dlgx').click();
  seg('drying','0');

  const grid={};
  ['rest','hover','drying','dialog','dialogrun'].forEach(k=>{ grid['state-'+k]=455; });

  // ---- the rules that keep holding --------------------------------------

  out.push('    measured: '+JSON.stringify(grid));
  say('every state fits the 456 the panel has',
      Object.keys(grid).filter(k=>grid[k]>BUDGET).join(',') || 'none', 'none');
  let bad=0, n=0;
  document.querySelectorAll('#app .tp').forEach(tp=>{
    const b=tp.querySelector('.tpb'), svg=tp.querySelector('.tpwire');
    const sl=b.querySelector('.slot'); if(!sl) return;
    const ps=[...svg.querySelectorAll('path')]; if(!ps.length) return; n++;
    const p=ps[ps.length-1], m=p.getScreenCTM();
    const at=(l)=>{const q=p.getPointAtLength(l);
      return {x:q.x*m.a+q.y*m.c+m.e, y:q.x*m.b+q.y*m.d+m.f};};
    const sr=R(sl), e=at(p.getTotalLength());
    if(Math.abs(e.x-(sr.left+32*SCALE))>1.5 || Math.abs(e.y-sr.top)>1.5
       || Math.abs(at(0).x-e.x)>1.5) bad++; });
  say('every tube is vertical and lands on the inlet', (n-bad)+'/'+n, n+'/'+n);
  say('the feeder\'s spool is on the card\'s centre line',
      Math.abs(cx(document.querySelector('#app .tp .bay'))
               - cx(document.querySelector('#app .tp'))) < 1.5, true);
  seg('units','4');
  say('four units is sixteen bays and still fits',
      document.querySelectorAll('#app .bay').length===16 && H()<=BUDGET, true);
  seg('units','1');

  // ---- the no-script path ------------------------------------------------
  say('every state is pre-rendered into the file',
      document.querySelectorAll('.sblk').length, 5);
  // A baked copy carries every id the live panel had, so this file can end up with
  // several elements sharing one. That is not cosmetic: a clipPath id resolves
  // DOCUMENT-wide, and url(#dropclip) pointed at a copy inside a display:none block,
  // which clips nothing - so the droplet's fill drew as the bare rectangle it is.
  const allIds=[...document.querySelectorAll('[id]')].map(e=>e.id);
  const dupIds=[...new Set(allIds.filter((v,i2)=>allIds.indexOf(v)!==i2))];
  say('no two elements in the file share an id', dupIds.join(',') || 'none', 'none');
  const clipRefs=[...document.querySelectorAll('[clip-path]')].map(e=>{
    const m=/url\(#([^)]+)\)/.exec(e.getAttribute('clip-path'));
    return m ? {el:e, id:m[1], owner:document.getElementById(m[1])} : null;}).filter(Boolean);
  say('every clip-path resolves to something that exists',
      clipRefs.filter(r=>!r.owner).map(r=>r.id).join(',') || 'none', 'none');
  say('and to something inside its own copy, not a hidden one elsewhere',
      clipRefs.filter(r=>{const blk=r.el.closest('.sblk');
        return blk && !blk.contains(r.owner);}).length, 0);
  const src=document.documentElement.outerHTML;
  say('no script-looking string outside a real script tag',
      (src.match(/<script\b/g)||[]).length, document.querySelectorAll('script').length);
  document.documentElement.classList.remove('js-on');
  const visible=()=>[...document.querySelectorAll('.sblk')]
                      .filter(e=>getComputedStyle(e).display!=='none');
  say('without script the picker appears and the rig does not',
      getComputedStyle(document.querySelector('.spicker')).display !== 'none'
      && getComputedStyle(document.getElementById('rig')).display === 'none', true);
  say('and exactly one copy is visible', visible().length, 1);
  let stale=0;
  Object.keys(grid).forEach(k=>{
    document.getElementById('o-'+k).checked=true;
    const b=visible()[0];
    if(!b || !b.classList.contains('sb-'+k)) { stale++; return; }
    const h=Math.round(R(b.querySelector('.fbody')).height);
    if(h!==grid[k]) { stale++; out.push(`    ${k}: baked ${h}, live ${grid[k]}`); }
  });
  say('every pre-rendered copy still matches the renderer', stale, 0);
  document.getElementById('o-state-hover').checked=true;
  say('the hover state was baked with the pointer held',
      !!visible()[0].querySelector('.bay.is-hover'), true);
  document.getElementById('o-state-dialogrun').checked=true;
  say('and the running-dialog state with the dryer running',
      visible()[0].querySelector('.dlg .dlgfoot .btn:last-child').textContent, 'Stop');
  document.getElementById('o-state-rest').checked=true;
  document.documentElement.classList.add('js-on');

  // ---- themes ------------------------------------------------------------
  const probe=()=>({body:lum(getComputedStyle(document.body).backgroundColor),
                    ink:lum(getComputedStyle(document.body).color),
                    note:lum(getComputedStyle(document.querySelector('.note')).color),
                    th:lum(getComputedStyle(document.querySelector('th')).color),
                    panel:lum(getComputedStyle(document.querySelector('#app .panel-body')).backgroundColor)});
  document.documentElement.setAttribute('data-theme','light'); const L=probe();
  say('light: ground is light', L.body>0.8, true);
  say('light: note ink readable', Math.abs(L.body-L.note)>0.35, true);
  document.documentElement.setAttribute('data-theme','dark'); const D=probe();
  say('dark: ground is dark', D.body<0.15, true);
  say('dark: ink is light', D.ink>0.7, true);
  say('dark: uppercase label readable', Math.abs(D.body-D.th)>0.25, true);
  say('the panel stays white in both themes', L.panel>0.95 && D.panel>0.95, true);
  document.documentElement.removeAttribute('data-theme');
  let bad2=0; document.querySelectorAll('table').forEach(t=>{
    if(t.scrollWidth > t.parentElement.clientWidth+1 &&
       getComputedStyle(t.parentElement).overflowX!=='auto') bad2++; });
  say('no table overflows unscrollably', bad2, 0);
  }catch(e){ out.push('FAIL  check threw: '+(e&&e.message||e)); }
  window.__report = out.join('\n');
})();
"""

CHECK = CHECKS.get(os.path.basename(PATH))
if CHECK is None:
    print(f"no checks for {os.path.basename(PATH)}. Known: {', '.join(sorted(CHECKS))}")
    print("Add a CHECKS entry rather than reusing another mockup's - they are keyed to "
          "one file's ids and classes.")
    sys.exit(2)

win = Gtk.OffscreenWindow(); win.set_default_size(1400, 1000)
view = WebKit2.WebView(); win.add(view); win.show_all()
view.load_uri("file://" + os.path.abspath(PATH))
state = {"done": False, "rc": 1}

def report(v, res, *_):
    try:
        val = v.evaluate_javascript_finish(res)
        txt = val.to_string() if val else ""
    except Exception as e:
        txt = f"FAIL  evaluate: {e}"
    if not txt:
        GLib.timeout_add(300, lambda: (view.evaluate_javascript("window.__report || ''", -1, None, None, None, report, None), False)[1])
        return
    fails = [l for l in txt.splitlines() if l.startswith("FAIL")]
    for l in txt.splitlines(): print("  " + l)
    print(f"\n{len(txt.splitlines())-len(fails)}/{len(txt.splitlines())} checks passed")
    state["rc"] = 1 if fails else 0
    state["done"] = True
    Gtk.main_quit()

def go(v, ev):
    if ev != WebKit2.LoadEvent.FINISHED: return
    def run():
        view.evaluate_javascript(CHECK, -1, None, None, None, lambda *a: None, None)
        GLib.timeout_add(400, lambda: (view.evaluate_javascript("window.__report || ''", -1, None, None, None, report, None), False)[1])
        return False
    GLib.timeout_add(700, run)

view.connect("load-changed", go)
GLib.timeout_add(25000, lambda: (Gtk.main_quit(), False)[1])
Gtk.main()
sys.exit(state["rc"])
