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

CHECKS["multiace-actions.html"] = r"""
(function(){
  const out=[];
  try{
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const R=(e)=>e?e.getBoundingClientRect():null;
  const H=()=>Math.round(R(document.querySelector('#app .fbody')).height);
  const lum=(c)=>{const m=c.match(/\d+/g);if(!m)return -1;const [r,g,b]=m.map(Number);
    return (0.2126*r+0.7152*g+0.0722*b)/255;};
  const BUDGET=456, CAB=310;
  const panel=()=>document.querySelector('#app .u1');
  const W=()=>Math.round(R(panel()).width);
  const aceCard=()=>document.querySelector('#app .tp.viaace');
  const feedCard=()=>document.querySelector('#app .tp:not(.viaace)');
  const bay=(n)=>aceCard().querySelectorAll('.bay')[n];
  const verbs=()=>[...document.querySelectorAll('#app .verb')];
  // By NAME, never by index: what a bay offers depends on the state the head is in.
  const verb=(n)=>verbs().find(v=>v.querySelector('.vname').textContent.indexOf(n)===0);
  const vnames=()=>verbs().map(v=>v.querySelector('.vname').textContent.split(' — ')[0]);
  const sheet=()=>document.querySelector('#app .dlg');
  const shut=()=>{const x=document.querySelector('#app .dlg .dlgx'); if(x) x.click();};
  const machine=(t)=>[...document.querySelectorAll('#machine button')].find(b=>b.textContent===t);
  // Rounded for reporting, and NOT rounded for the boundary: at 707 the card is 329.5
  // and the room 309.5, so the cabinet is over by half a pixel. Rounding that away moves
  // the answer by one and makes the two methods disagree about which width is the floor.
  const innerWf=(card)=>{const b=card.querySelector('.tpb'), cs=getComputedStyle(b);
    return R(b).width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);};
  const innerW=(card)=>Math.round(innerWf(card));
  const cabW=(card)=>Math.round(R(card.querySelector('.cab .top')).width);
  const seen=(el,card)=>{const r=R(el), c=R(card);
    return Math.round(Math.max(0, Math.min(r.right,c.right)-Math.max(r.left,c.left)));};
  // The panel is DRAGGED, not switched, so the check drags it. Nothing here reaches past
  // the controls a person has - which is the point of driving the real thing.
  const q=(sel)=>document.querySelector(sel);
  const qa=(sel)=>[...document.querySelectorAll(sel)];
  // the option rows above the panel - the three questions that are still open
  const seg=(g,v)=>{const b=q(`#seg-${g} button[data-v="${v}"]`);
                    if(!b) throw new Error('no option '+g+'/'+v); b.click();};
  const grip=document.getElementById('grip');
  const drag=(dx)=>{const r=R(grip), x=r.left+r.width/2, y=r.top+10;
    grip.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y}));
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x+dx,clientY:y}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x+dx,clientY:y}));};
  const key=(k,shift)=>grip.dispatchEvent(new KeyboardEvent('keydown',{key:k,shiftKey:!!shift,bubbles:true}));
  const width=(w)=>{ let guard=0;
    while(W()!==w && guard++<600) key(W()<w?'ArrowRight':'ArrowLeft', Math.abs(W()-w)>=10);
    return W(); };

  say('title', document.title, 'Every Filament, and What Can Be Done To It');
  say('no horizontal page scroll', document.documentElement.scrollWidth <= window.innerWidth+1, true);
  const f = getComputedStyle(document.body).fontFamily;
  say('body font names Plex', /Plex/.test(f), true);
  // Two kinds of control, and the line between them is the point. ABOVE: the questions
  // still open - where a verb is chosen, where a swap is reported, how wide the panel is.
  // ON THE PANEL: everything else, which behaves the way the page behaves.
  say('the rows above are the open questions and nothing else',
      qa('#rig .grp .k').map(e=>e.textContent.replace(/ — or drag the edge/,'')).join(' / '),
      'Where a verb is chosen / Where a running swap is reported / Panel width');
  say('the panel opens at the Device page own 830', W(), 830);
  say('four cards, one per toolhead', document.querySelectorAll('#app .tp').length, 4);

  // ---- the edge really is draggable ---------------------------------------------
  drag(-120);
  say('dragging the edge left narrows the panel by what the pointer moved', W(), 710);
  say('and the readout follows it',
      /panel 710/.test(document.getElementById('readout').textContent), true);
  drag(+120);
  say('dragging it back restores it', W(), 830);
  key('ArrowLeft'); key('ArrowLeft');
  say('the same control takes the arrow keys, one pixel at a time', W(), 828);
  key('ArrowRight',true);
  say('and a shift-step is ten of them', W(), 838);
  width(830);

  // ---- the two widths that matter, FOUND rather than listed ----------------------
  // Walk the edge in one step at a time and record where the drawing stops fitting.
  // Nothing below is a number typed into this check: they are read off the panel.
  // A linear 1px walk, deliberately not the page's own binary search: two different
  // methods agreeing is worth more than one method run twice.
  let floor=null, cuts=null;
  for(let w=730; w>=600; w-=1){
    width(w);
    const card=aceCard(), room=innerWf(card);
    if(floor===null && room < CAB) floor = w+1;              // last width with room
    if(cuts===null && seen(card.querySelectorAll('.bay')[3], card) < 62) cuts = w+1;
    if(floor!==null && cuts!==null) break;
  }
  out.push(`    measured by dragging: room runs out below ${floor}, a bay is cut below ${cuts}`);
  say('the cabinet has exactly the card at 708', floor, 708);
  say('and a bay starts being cut at 655', cuts, 655);
  // and the page found the same two, by its own method, and says so on the ruler
  const marks=[...document.querySelectorAll('#ruler .tlab')].map(e=>e.textContent);
  // 655 and 708 are 53 px apart on the axis, so the labels were on top of each other
  // and unreadable in the first cut of this. Nothing on a ruler may overlap.
  width(830);
  const lb=[...document.querySelectorAll('#ruler .tlab')].map(e=>R(e));
  let clash=0;
  for(let i=0;i<lb.length;i++) for(let j=i+1;j<lb.length;j++)
    if(Math.abs(lb[i].top-lb[j].top)<2 && lb[i].left<lb[j].right && lb[j].left<lb[i].right) clash++;
  say('no two marks on the ruler sit on each other', clash, 0);
  const axis=R(document.getElementById('ruler')).width;
  drag(-150);
  say('and the axis does not move when the panel does',
      Math.round(R(document.getElementById('ruler')).width), Math.round(axis));
  width(830);
  say('the ruler marks the width where the room runs out',
      marks.some(t=>t.indexOf(String(floor))===0), true);
  say('and the width where a bay starts being cut',
      marks.some(t=>t.indexOf(String(cuts))===0), true);
  width(708);
  say('at the floor the room is the cabinet, to the pixel',
      [Math.round(R(aceCard()).width), innerW(aceCard()), cabW(aceCard())].join(','), '330,310,310');
  width(560);
  say('at the single-column width the fourth bay is 14 px of 62',
      seen(aceCard().querySelectorAll('.bay')[3], aceCard()), 14);
  say('it is cut rather than scrolled, which is why nothing says so',
      getComputedStyle(aceCard()).overflow, 'hidden');
  say('and the readout says so in words',
      /fourth bay is cut/.test(document.getElementById('readout').textContent), true);

  // ---- the body never goes over, at any width -----------------------------------
  const over=[];
  for(let w=560; w<=1000; w+=20){ width(w); if(H()>BUDGET) over.push(w+':'+H()); }
  say('the body fits 456 at every width the panel can be dragged to',
      over.join(',')||'none','none');
  width(830);
  // ---- every control on the panel opens the thing it owns -------------------------
  // A mockup whose menus are pictures cannot answer the question it exists for: where a
  // verb should live is a question about how many clicks it takes to get to one.
  const head=()=>qa('#app .panel-head .icon-only');
  const pills=()=>qa('#app .panel-head .prefpill');
  const dlgTitle=()=>{const d=q('#app .dlg'); return d?d.querySelector('h3').textContent:'none';};
  head()[1].click();
  say('the ? opens the help', dlgTitle(), 'Filament sources');
  shut();
  pills()[1].click();
  say('ACE mode opens a list rather than cycling', qa('#app .menu .menu-item').length, 3);
  qa('#app .menu .menu-item')[0].click();
  say('and picking one sets the mode', /Normal/.test(pills()[1].textContent), true);
  pills()[1].click(); qa('#app .menu .menu-item')[2].click();
  head()[0].click();
  say('the panel overflow opens the machine settings menu',
      qa('#app .menu .menu-item').length, 5);
  qa('#app .menu .menu-item')[1].click();
  say('and Flush length opens its own sheet', dlgTitle(), 'Flush length');
  shut();
  head()[0].click(); qa('#app .menu .menu-item')[3].click();
  say('and Spoolman opens its own', dlgTitle(), 'Spoolman');
  shut();
  q('#app .tp .icon-only').click();
  say('a card overflow is about that toolhead', q('#app .menu .menu-head').textContent, 'Toolhead 1');
  const card=qa('#app .menu .menu-item');
  card[card.length-1].click();
  say('and its last item opens the filament record', /filament/i.test(dlgTitle()), true);
  shut();
  q('#app .drybtn').click();
  say('the Dry chip opens the dryer', dlgTitle(), 'Filament drying');
  shut();

  // ---- clicking a bay, and sending a verb ---------------------------------------
  // From a known machine. Every group below leaves the panel somewhere, and a state
  // rule asserted against the previous group's leavings is not asserted at all.
  machine('reset').click();
  bay(2).click();
  say('clicking a bay opens its own sheet', !!sheet(), true);
  say('the sheet names the bay', sheet().querySelector('h3').textContent, 'A3');
  say('every verb names the macro it would send',
      verbs().length>0 && verbs().every(v=>/^ACE_/.test(v.querySelector('.vcmd').textContent)), true);

  // ---- what a filament can have done to it, in the state it is actually in ---------
  // The list is not fixed. A verb that is not a thing in this state is LEFT OUT, because
  // there is no reason to show for a verb that does not exist; a verb the MACHINE is
  // refusing is listed and greyed, because its reason names a macro you can send.
  say('the bay already feeding the head offers no load and no swap',
      vnames().join('|'), 'Unload and retract|Background unload');
  shut(); bay(0).click();
  say('a different bay offers a swap rather than a load',
      vnames().join('|'), 'Swap|Background swap|Unload and retract|Background unload');
  say('and an ACE unload is an unload AND a retract, which a feeder cannot do',
      /RETRACT_LENGTH/.test(verb('Unload and retract').querySelector('.vcmd').textContent), true);
  shut();
  feedCard().querySelector('.bay').click();
  say('a loaded stock feeder offers unload, and only unload', vnames().join('|'), 'Unload');
  shut();
  qa('#app .tp:not(.viaace)')[2].querySelector('.bay').click();
  say('and an empty one offers load, and only load', vnames().join('|'), 'Load');
  shut();
  say('no verb explains itself in prose',
      verbs().every(v=>v.querySelector('.vcmd').textContent.split(/\s+/).length<=8), true);
  machine('reset').click();
  bay(0).click();
  // the gate, opened the way the machine opens it
  const offBg=()=>verbs().filter(v=>v.classList.contains('is-off')
                                 && /Background/.test(v.querySelector('.vname').textContent));
  say('with enabled_heads [] both background verbs are unavailable', offBg().length, 2);
  say('and each names ACE_BG_SET_HEAD and nothing else',
      offBg().every(v=>/^ACE_BG_SET_HEAD HEAD=\d ENABLE=1$/.test(v.querySelector('.vcmd').textContent)), true);
  say('the macro they name is a thing you can send from there',
      !!document.querySelector('#app .verb .venable'), true);
  document.querySelector('#app .verb .venable').click();
  // A1 rather than A3: A3 is the bay already feeding this head, so its sheet has no swap
  // in it to be gated - which is the state rule above doing its job.
  bay(0).click();
  say('sending it opens the gate', verbs().filter(v=>v.classList.contains('is-off')).length, 0);
  say('and background swap then sends ACE_BG_SWAP',
      /^ACE_BG_SWAP HEAD=3 SLOT=0 ACE=A$/.test(verb('Background swap').querySelector('.vcmd').textContent), true);
  shut(); machine('reset').click();

  // ---- the toolhead as the thing you click ---------------------------------------
  machine('reset').click();
  seg('place','head');
  say('every toolhead becomes a target', qa('#app .slot.is-target').length, 4);
  const sl=qa('#app .slot')[0];
  say('and wears nothing at rest', getComputedStyle(sl,'::before').boxShadow, 'none');
  sl.classList.add('is-hover');
  say('the pointer lights a 1.5 px traced edge in the accent, with no fill',
      getComputedStyle(sl,'::before').boxShadow, 'rgb(12, 99, 226) 0px 0px 0px 1.5px inset');
  sl.classList.remove('is-hover');
  qa('#app .slot')[3].click();
  say('clicking one opens that toolhead sheet',
      dlgTitle(), 'Toolhead 4');
  say('and the bays come to it, because two of the verbs take a slot',
      qa('#app .pickbay').length, 4);
  say('each saying what it would do in this state',
      qa('#app .pickbay .picklab').map(e=>e.textContent).join('|'), 'Swap|Swap|loaded|Swap');
  say('and the one already feeding is not offered',
      qa('#app .pickbay')[2].disabled, true);
  say('the head verbs are the ones that take no slot',
      vnames().join('|'), 'Unload and retract|Background unload');
  verb('Unload and retract').click();
  // An unload is an OPERATION now, not an assignment: it runs the unload direction and
  // the head is empty when it finishes. Waiting for the printer is the point.
  say('and sending one starts the unload direction, four steps', qa('#app .steps i').length, 4);
  machine('finish it').click();
  qa('#app .slot')[3].click();
  say('with the head emptied every bay offers a load instead',
      qa('#app .pickbay .picklab').map(e=>e.textContent).join('|'), 'Load|Load|Load|Load');
  say('and there is nothing left to unload', vnames().length, 0);
  shut();
  seg('place','sheet'); machine('reset').click();

  // ---- a swap that actually runs --------------------------------------------------
  machine('reset').click();
  const idleH=H();
  bay(0).click(); verb('Swap').click();          // Swap, from the sheet
  say('sending a verb closes the sheet', !!sheet(), false);
  say('and starts a swap the panel header reports',
      /swapping/.test(document.querySelector('#app .status').textContent), true);
  say('the bay it is leaving says so', document.querySelectorAll('#app .bay.is-moving').length, 1);
  say('and it is the bay that was clicked', bay(0).classList.contains('is-moving'), true);
  say('the head it is going to says so', document.querySelectorAll('#app .slot.is-moving').length, 1);
  const line=document.querySelector('#app .actrow.beside');
  say('the line beside the head names both ends',
      line.textContent.replace(/\s+/g,' ').trim().indexOf('A1 → Toolhead 4'), 0);
  // The steps are the U1's own `channel_state`, taken from HelixScreen's Snapmaker
  // backend rather than invented: a swap on an ACE head is ONE bar with two halves.
  say('a swap is six steps, not a percentage', qa('#app .steps i').length, 6);
  say('and it starts on the first of them', line.querySelector('.phase').textContent, 'Home');
  say('nothing draws a fraction of a swap', line.querySelectorAll('progress').length, 0);
  say('every tick names the firmware state behind it',
      qa('#app .steps i').every(e=>/channel_state \w+/.test(e.title)), true);
  // step 3 carries a live nozzle reading, which is what turns "heating" into "how far"
  // Positioned rather than waited for: the steps advance on a 1.5 s timer and this
  // checker is synchronous. Reaching into the study's own state is fair here - it is
  // the study's state, not the page's - and the alternative is a nine-second sleep.
  S.swap.at = 2; S.swap.nozzle = 178; render();
  say('the heat step reads the nozzle rather than captioning it',
      q('#app .actrow .phase').textContent, 'Heat nozzle 178/240 °C');
  say('and the ticks behind it are done', qa('#app .steps i.done').length, 2);
  S.swap.at = 3; render();
  say('the ACE half is one step, not a row for the fetch',
      q('#app .actrow .phase').textContent, 'Retract filament');
  say('a swap costs the body nothing', H(), idleH);
  say('the four cards are still the same height',
      new Set([...document.querySelectorAll('#app .tp')].map(t=>Math.round(R(t).height))).size, 1);
  // it lives in a band the card clips, so "it fits" is measured at every width
  const fits={};
  [900,830,760,700,640,580].forEach(w=>{ width(w);
    const card=aceCard(), l=card.querySelector('.actrow.beside'), art=R(card.querySelector('.slot'));
    fits[w]={over:Math.round(Math.max(0, R(l).bottom - R(card).bottom)),
             art:R(l).right > art.left ? 1 : 0, body:H()}; });
  out.push('    measured: '+JSON.stringify(fits));
  say('the in-flight line never overflows its card, at any width',
      Object.keys(fits).filter(k=>fits[k].over>0).join(',')||'none','none');
  say('and never reaches the artwork it sits beside',
      Object.keys(fits).filter(k=>fits[k].art).join(',')||'none','none');
  say('and the body stays inside its budget throughout',
      Object.keys(fits).filter(k=>fits[k].body>BUDGET).join(',')||'none','none');
  width(830);
  machine('make it fail').click();
  say('a failed swap shows the firmware state, not a sentence about it',
      document.querySelector('#app .actrow.is-fail .atext').textContent,
      'unload_fail');
  say('and names the step it stopped on',
      q('#app .actrow.is-fail .phase').textContent, 'Retract filament');
  say('and leaves the head where it was',
      aceCard().querySelectorAll('.bay')[2].classList.contains('fed'), true);
  say('a failure costs no height either', H(), idleH);
  machine('reset').click();
  say('reset puts the machine back', document.querySelectorAll('#app .actrow.beside').length, 0);

  // ---- the two open questions, each drawn rather than described --------------------
  machine('reset').click();
  const idle2=H();
  seg('place','menu');
  bay(0).click();
  say('with the verbs in the menu a bay opens nothing', !!q('#app .dlg'), false);
  q('#app .tp.viaace .icon-only').click();
  const mv=qa('#app .menu .menu-item').map(b=>b.querySelectorAll('span')[1].textContent);
  say('and the menu carries the two that take a slot',
      mv.filter(t=>/^Swap|^Background swap/.test(t)).length, 2);
  qa('#app .menu .menu-item').find(b=>/^Swap/.test(b.querySelectorAll('span')[1].textContent)).click();
  say('which opens a bay picker, because the slot still has to come from somewhere',
      /^Swap into Toolhead/.test(dlgTitle()), true);
  say('with one button per bay', qa('#app .pickbay').length, 4);
  qa('#app .pickbay')[1].click();
  say('and picking one starts the swap', qa('#app .bay.is-moving').length, 1);
  say('the menu placement costs no height', H(), idle2);
  machine('make it fail').click(); machine('reset').click();
  seg('place','row');
  const rowH=H();
  say('a row of verbs under the box costs height the body has not got', rowH > BUDGET, true);
  out.push(`    measured: the row placement puts the body at ${rowH} against ${BUDGET}`);
  seg('place','sheet');
  bay(0).click(); verb('Swap').click();
  seg('flight','row');
  const fr=H();
  say('reporting a swap in a row costs the same', fr > BUDGET, true);
  seg('flight','beside');
  say('and beside the toolhead costs nothing at all', H(), idle2);
  out.push(`    measured: flight in a row ${fr}, beside the head ${H()}`);
  machine('make it fail').click(); machine('reset').click();

  // ---- the pre-rendered copies ------------------------------------------------------
  const clipRefs=[...document.querySelectorAll('[clip-path]')].map(e=>{
    const m=/url\(#([^)]+)\)/.exec(e.getAttribute('clip-path'));
    return m ? {el:e, id:m[1], owner:document.getElementById(m[1])} : null;}).filter(Boolean);
  say('every clip-path resolves to something that exists',
      clipRefs.filter(r=>!r.owner).map(r=>r.id).join(',') || 'none', 'none');
  const src=document.documentElement.outerHTML;
  say('no script-looking string outside a real script tag',
      (src.match(/<script\b/g)||[]).length, document.querySelectorAll('script').length);
  document.documentElement.classList.remove('js-on');
  const vis=()=>[...document.querySelectorAll('.sblk')]
                  .filter(e=>getComputedStyle(e).display!=='none');
  say('without script the picker appears and the panel does not',
      getComputedStyle(document.querySelector('.spicker')).display !== 'none'
      && getComputedStyle(document.getElementById('rig')).display === 'none', true);
  say('and exactly one copy is visible', vis().length, 1);
  document.getElementById('o-w560').checked=true;
  say('the narrow copy really is the narrow one',
      !!vis()[0] && vis()[0].classList.contains('sb-w560'), true);
  document.getElementById('o-busy-swapping').checked=true;
  say('and the swapping copy was baked with a swap in flight',
      !!vis()[0].querySelector('.actrow.beside'), true);
  document.getElementById('o-w830').checked=true;
  document.documentElement.classList.add('js-on');

  // ---- themes -----------------------------------------------------------------------
  const probe=()=>({body:lum(getComputedStyle(document.body).backgroundColor),
                    ink:lum(getComputedStyle(document.body).color),
                    panel:lum(getComputedStyle(document.querySelector('#app .panel-body')).backgroundColor)});
  document.documentElement.setAttribute('data-theme','light'); const L=probe();
  say('light: ground is light', L.body>0.8, true);
  document.documentElement.setAttribute('data-theme','dark'); const D=probe();
  say('dark: ground is dark', D.body<0.15, true);
  say('dark: ink is light', D.ink>0.7, true);
  say('the panel stays white in both themes', L.panel>0.95 && D.panel>0.95, true);
  document.documentElement.removeAttribute('data-theme');
  let bad=0; document.querySelectorAll('table').forEach(t=>{
    if(t.scrollWidth > t.parentElement.clientWidth+1 &&
       getComputedStyle(t.parentElement).overflowX!=='auto') bad++; });
  say('no table overflows unscrollably', bad, 0);
  }catch(e){ out.push('FAIL  check threw: '+(e&&e.message||e)); }
  window.__report = out.join('\n');
})();
"""

# The visual standard now carries the Device page's own drawings at the Device page's own
# size, and the point of that is that one derives from the other. A claim like that is worth
# exactly what checks it: these assert the rendered numbers, so a cabinet that stops being
# 310 or a head that stops being 64x140 fails here rather than drifting quietly apart from
# `resources/web/device_page/css/device.css`.
CHECKS["ace-visual-standard.html"] = r"""
(function(){
  const out=[];
  try{
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const q=(s)=>document.querySelector(s);
  const qa=(s)=>[...document.querySelectorAll(s)];
  const box=(e)=>{const r=e.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)];};
  const wh=(s)=>{const e=q(s); return e?box(e).join('x'):'missing';};

  say('title', document.title, 'The ACE visual standard');
  say('no horizontal page scroll', document.documentElement.scrollWidth <= window.innerWidth+1, true);

  // ---- the six badges, and the sixth one's reason for existing --------------------
  // G and O5 are the standard now, so the settled row states those two and the deck
  // opens on them. A and O2 stay on the sheet as what they are corrections of.
  say('the settled row names G and O5',
      qa('#settled .spec .cap').slice(0,2).map(e=>e.textContent.split(' ')[0]).join(','),
      'G,O5');
  say('and the deck opens on them',
      [q('#segBadge button[aria-pressed="true"]').dataset.v,
       q('#segLine button[aria-pressed="true"]').dataset.v].join(','), 'g,o5');
  say('G carries the CHOSEN mark, and A does not',
      [/CHOSEN/.test(q('#badgeOpts [data-badge="g"] .why').textContent),
       /CHOSEN/.test(q('#badgeOpts [data-badge="a"] .why').textContent)].join(','), 'true,false');
  say('and O5 has it rather than O2',
      [/CHOSEN/.test(q('#lineOpts [data-line="o5"] .why').textContent),
       /CHOSEN/.test(q('#lineOpts [data-line="o2"] .why').textContent)].join(','), 'true,false');
  say('seven badge candidates are drawn', qa('#badgeOpts .opt').length, 7);
  say('and the deck offers all seven', qa('#segBadge button').length, 7);
  say('five outline candidates', qa('#lineOpts .opt').length, 5);
  const f=q('#badgeOpts [data-badge="f"]');
  say('F is on the sheet', !!f, true);
  const fsvg=f.querySelector('.ctx svg');
  say('F is the standard 44x26 like the rest', box(fsvg).join('x'), '44x26');
  // A's hood is inset 2 either side over a full-width base; F's halves are both 44,
  // which is the silhouette the Device page's cabinet actually has.
  const a=q('#badgeOpts [data-badge="a"] .ctx svg');
  say('A has a narrower top than its bottom',
      /M2 9a7/.test(a.innerHTML) && /width="44"/.test(a.innerHTML), true);
  say('F has no inset top at all', /M2 9a7/.test(fsvg.innerHTML), false);
  say('and both of F halves span the full width',
      (fsvg.innerHTML.match(/x="0"|M0 16/g)||[]).length >= 2, true);
  say('F still carries one bay per slot',
      fsvg.querySelectorAll('rect[rx="2.5"]').length, 4);

  // ---- G, and the one number it is about ------------------------------------------
  // The whole of G is that the spools are drawn last and the margin round them is ONE
  // number. Both are geometry, so both are checked rather than described.
  const g=q('#badgeOpts [data-badge="g"] .ctx svg');
  say('G is on the sheet', !!g, true);
  say('and is the standard 44x26', box(g).join('x'), '44x26');
  const gr=[...g.querySelectorAll('rect')].map(e=>
    ['x','y','width','height'].map(a=>Number(e.getAttribute(a))));
  const body=gr[0], bays=gr.slice(1);
  say('its body is the full width, like F', [body[0], body[2]].join(','), '0,44');
  say('four spools, 6x16 rather than 5x13',
      bays.length===4 && bays.every(b=>b[2]===6 && b[3]===16), true);
  const m={ left: bays[0][0], right: 44 - (bays[3][0] + bays[3][2]),
            top: bays[0][1] - body[1], bottom: (body[1]+body[3]) - (bays[0][1]+bays[0][3]) };
  say('and one margin on all four sides', [m.left,m.right,m.top,m.bottom].join(','), '4,4,4,4');
  say('which is the gap own number, as A states', bays[1][0] - (bays[0][0] + bays[0][2]), 4);
  say('the height is unchanged, so the spools took the difference', body[3], 24);
  // drawn LAST: the base path comes before them in document order, so nothing crops a spool
  const kids=[...g.children].map(e=>e.tagName.toLowerCase());
  say('the spools are drawn over the lower half, not under it',
      kids.indexOf('path') < kids.lastIndexOf('rect'), true);

  // ---- O5, the outlined twin of G --------------------------------------------------
  const o5=q('#lineOpts [data-line="o5"] .ctx svg');
  say('O5 is on the sheet', !!o5, true);
  say('and drops the step: a plain rounded body, not CAB',
      o5.querySelectorAll('path').length, 0);
  const o5b=[...o5.querySelectorAll('rect')].map(e=>
    ['x','y','width','height'].map(a=>Number(e.getAttribute(a))));
  say('its bays are G own, to the pixel',
      JSON.stringify(o5b.slice(1)), JSON.stringify(bays));
  say('and its body is inset by half a stroke so 1.6 does not clip',
      [o5b[0][0], o5b[0][2]].join(','), '0.8,42.4');

  // ---- what the Device page draws, at the Device page's size ----------------------
  // It lives in section 3 now, beside the two AMS boxes, because it is a third box for
  // the same spools and it is the one in use.
  const boxes=qa('.eyebrow')[2].closest('section');
  say('the cabinet sits with the other boxes, not in a section of its own',
      !!boxes.querySelector('#dpCabinet'), true);
  say('and is labelled as the one in use',
      /used today/.test(boxes.querySelector('#dpCabinet').closest('.spec').textContent), true);
  say('the sheet is five sections, not six', qa('.eyebrow').length, 5);
  say('the ACE cabinet is 310 wide', wh('#dpCabinet .dp-top'), '310x71');
  say('with four bays', qa('#dpCabinet .dp-bay').length, 4);
  say('a bay is .slot own 36 px disc', wh('#dpCabinet .dp-disc'), '36x36');
  say('over its 58x19 name pill', wh('#dpCabinet .dp-chip'), '58x19');
  say('and the column that fixes the width is 62', wh('#dpCabinet .dp-bay'), '62x61');
  // the seam is disc-relative: 5 px of padding plus half a disc
  const cab=q('#dpCabinet .dp-top');
  say('the seam runs through the middle of the roll',
      getComputedStyle(cab).getPropertyValue('--seam').trim(), 'calc(5px + 36px / 2)');
  say('the cabinet is #EEEEEE over #CECECE',
      /238, 238, 238/.test(getComputedStyle(cab).backgroundImage)
      && /206, 206, 206/.test(getComputedStyle(cab).backgroundImage), true);

  say('the feeder is the same drawing with one bay', qa('#dpFeeder .dp-bay').length, 1);
  say('and is 94 wide because of it', wh('#dpFeeder .dp-top'), '94x71');
  const feed=q('#dpFeeder .dp-top');
  say('drawn in #FFFFFF over #1F1F1F',
      /255, 255, 255/.test(getComputedStyle(feed).backgroundImage)
      && /31, 31, 31/.test(getComputedStyle(feed).backgroundImage), true);
  say('a feeder bay carries no address', q('#dpFeeder .dp-disc').textContent.trim(), '');

  // ---- the badges of both, at true size ------------------------------------------
  say('four badge specimens', qa('#dpBadges .spec').length, 4);
  const arts=qa('#dpBadges .dp-stage svg').map(box);
  say('the ACE badge is 44x26 and the feeder 17x17',
      [arts[0].join('x'), arts[2].join('x')].join(' / '), '44x26 / 17x17');
  say('and each is shown enlarged beside it',
      [arts[1].join('x'), arts[3].join('x')].join(' / '), '132x78 / 51x51');
  say('their captions line up',
      new Set(qa('#dpBadges .cap').map(e=>Math.round(e.getBoundingClientRect().top))).size, 1);
  say('and they sit on one baseline',
      new Set(qa('#dpBadges .dp-stage').map(e=>Math.round(e.getBoundingClientRect().bottom))).size, 1);

  // ---- the toolhead ---------------------------------------------------------------
  const heads=qa('#dpHead .dp-head').map(box);
  say('the toolhead is drawn at 64x140 and at half',
      heads.map(h=>h.join('x')).join(' / '), '64x140 / 32x70');
  // the marker is centred on the artwork's BODY (32, 72.5), not on its box (32, 70)
  const h1=q('#dpHead .dp-head'), m1=h1.querySelector('.dp-sensor');
  const hr=h1.getBoundingClientRect(), mr=m1.getBoundingClientRect();
  say('the marker is centred on the artwork body, not its box',
      [Math.round(mr.left+mr.width/2-hr.left), Math.round(mr.top+mr.height/2-hr.top)].join(','),
      '32,73');
  say('and it uses the shipped artwork rather than a redraw',
      !!q('#dpHead use[href="#u1head"]'), true);

  // ---- a bay that knows how much is left ------------------------------------------
  // With Spoolman bound there IS a weight, and the disc then follows the rule the AMS
  // column already follows: the colour from the bottom up to what is left.
  const discs=()=>qa('#dpCabinet .dp-disc').map(e=>e.style.background);
  const rem=(v)=>q(`#segRem button[data-v="${v}"]`).click();
  rem('spoolman');
  say('a bound slot draws its level bottom-up',
      discs().filter(b=>/linear-gradient\(to top/.test(b)).length, 3);
  say('and the one Spoolman has not bound is hatched, not empty',
      /repeating-linear-gradient/.test(discs()[2]), true);
  say('the weight is on the bay itself', /\d+ g/.test(qa('#dpCabinet .dp-bay')[0].title), true);
  rem('unknown');
  say('with no binding at all every bay is hatched',
      discs().every(b=>/repeating-linear-gradient/.test(b)), true);
  say('and none of them claims a level',
      discs().some(b=>/linear-gradient\(to top/.test(b)), false);
  rem('spoolman');
  // the badge deliberately does not follow: at 6x16 a level is not readable
  say('the badge stays colour-only whatever the level says',
      q('#dpBadges .dp-stage svg').innerHTML.indexOf('gradient'), -1);
  }catch(e){ out.push('FAIL  check threw: '+(e&&e.message||e)); }
  window.__report = out.join('\n');
})();
"""

CHECKS["multiace-modes.html"] = r"""
(function(){
  const out=[];
  try{
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const q=(s)=>document.querySelector(s);
  const qq=(s)=>[...document.querySelectorAll(s)];
  const R=(e)=>e?e.getBoundingClientRect():null;
  const H=()=>Math.round(R(q('#app .fbody')).height);
  const seg=(g,v)=>{const b=q(`#seg-${g} button[data-v="${v}"]`);
                    if(!b) throw new Error('no control '+g+'/'+v); b.click();};
  const pill=()=>q('#app .prefpill');
  const opts=(i)=>[...qq('#app .srcsel')[i].options].map(o=>o.textContent);
  const BUDGET=456;
  q('#mreset').click();

  say('title', document.title, 'Three Modes, One Cabinet');
  say('no horizontal page scroll', document.documentElement.scrollWidth <= window.innerWidth+1, true);
  say('body font names Plex', /Plex/.test(getComputedStyle(document.body).fontFamily), true);
  let dup=0; const seen={};
  qq('[id]').forEach(e=>{ if(seen[e.id]) dup++; seen[e.id]=1; });
  say('no duplicate ids', dup, 0);
  say('the static block exists for the no-script path', !!q('.staticwrap'), true);

  // ---- head mode: the settled reference ----
  say('head: panel is 830 wide', Math.round(R(q('#app .u1')).width), 830);
  say('head: the pill reports the mode', pill().textContent.indexOf('head')>=0, true);
  say('head: four cards, one on the cabinet', qq('#app .tp').length===4 && qq('#app .tp.viaace').length===1, true);
  say('head: the cabinet holds four bays', qq('#app .tp.viaace .bay').length, 4);
  say('head: A2 is the fed bay, as measured', qq('#app .tp.viaace .bay')[1].classList.contains('fed'), true);
  say('head: the selector offers feeder, ACE and hand-fed', opts(0).join('/'), 'Default feeder/ACE A/Hand-fed');
  say('head: body fits the 456 budget', H()<=BUDGET, true);

  // ---- multi, lanes, clean (cards is the settled default, so lanes is asked for) ----
  seg('mode','multi');
  say('multi: the pill follows', pill().textContent.indexOf('multi')>=0, true);
  say('multi: cards is the default drawing - it is the settled one',
      q('#seg-mlay button[aria-pressed="true"]').dataset.v, 'cards');
  seg('mlay','lanes');
  say('multi lanes: the cabinet is drawn once', qq('#app .cab').length, 1);
  say('multi lanes: four heads in a row', qq('#app .mlay .laneh').length, 4);
  say('multi lanes: the selector loses the feeder', opts(0).join('/'), 'Bay A1/Hand-fed');
  say('multi lanes: no card offers another lane', qq('#app .srcsel option').length, 8);
  const cores=()=>qq('#app .fan path').filter(p=>p.getAttribute('stroke-width')==='2.6');
  say('multi lanes clean: three cores for three loaded heads', cores().length, 3);
  // lane truth: core i leaves bay i and lands on lane i - start x equals its bay centre
  const bayx=(k)=>{const b=qq('#app .cab .bay')[k],m=q('#app .mlay');
    return Math.round(R(b).left+R(b).width/2-R(m).left);};
  const startx=(p)=>Math.round(Number(p.getAttribute('d').match(/^M([\d.]+)/)[1]));
  // cores are appended in head order (0, 1, 3), and clean means head i eats bay i -
  // so pair them exactly: a cross-lane core would start at somebody else's bay
  const cleanOk=cores().every((p,n)=>Math.abs(startx(p)-bayx([0,1,3][n]))<2);
  say('multi lanes clean: every core starts at its own bay', cleanOk, true);
  say('multi lanes: body fits', H()<=BUDGET, true);

  // ---- multi, cards, clean ----
  seg('mlay','cards');
  say('multi cards: the unit band sits above the grid',
      !!q('#app .fbody > .bandrow + .lay'), true);
  say('multi cards: one bay per card, four in all', qq('#app .tp .bay').length, 4);
  say('multi cards: body fits', H()<=BUDGET, true);

  // ---- multi, as measured: the cross-lane truth ----
  seg('mlay','lanes'); seg('mstate','measured');
  say('measured lanes: exactly one core - one recorded feed', cores().length, 1);
  say('measured lanes: the core leaves bay A2, not toolhead 4\'s own lane',
      Math.abs(startx(cores()[0])-bayx(1))<2, true);
  seg('mlay','cards');
  const lent=q('#app .bay.lent');
  say('measured cards: A2 is drawn once, on its own lane\'s card, marked',
      !!lent && lent.title.indexOf('feeding Toolhead 4')>=0, true);
  const chip=q('#app .fromchip');
  say('measured cards: toolhead 4 names what is in it and where from',
      !!chip && chip.textContent.indexOf('from A2')>=0, true);
  say('measured cards: no bay is drawn twice',
      qq('#app .tp .bay').filter(b=>b.title.indexOf('A2')===0).length, 1);

  // ---- multi, as the shipped model reads it: the bug, drawn ----
  seg('mstate','asbuilt');
  say('as-built: the exhibit is labelled wrong', !!q('#app .exnote') &&
      q('#app .exnote').textContent.indexOf('WRONG IN THIS MODE')>=0, true);
  say('as-built: it draws the head-mode picture on a multi machine',
      qq('#app .feed').length===3 && qq('#app .cab').length===1, true);
  say('as-built: the pill still says multi', pill().textContent.indexOf('multi')>=0, true);

  // ---- two units: the splitter picture ----
  seg('mstate','clean'); seg('mlay','lanes'); seg('units','2');
  say('2u lanes: two cabinets', qq('#app .cab').length, 2);
  say('2u lanes: body fits', H()<=BUDGET, true);
  seg('mlay','cards');
  say('2u cards: one bay per unit per card', qq('#app .tp .bay').length, 8);
  say('2u cards: two unit bands', qq('#app .ustrip.band').length, 2);
  say('2u cards: the selector names the lane SET, not one bay of it',
      opts(0).join('/'), 'Bay A1 · B1/Hand-fed');
  say('2u cards: body fits', H()<=BUDGET, true);

  // ---- 560, the single-column reality ----
  seg('units','1'); seg('mlay','lanes'); seg('width','560');
  say('560 lanes: the panel is 560', Math.round(R(q('#app .u1')).width), 560);
  say('560 lanes: the cabinet is not clipped',
      R(q('#app .cab .top')).right <= R(q('#app .u1')).right+1, true);
  say('560 lanes: body fits', H()<=BUDGET, true);
  seg('mlay','cards');
  const clip=qq('#app .tp').filter(tp=>{const box=tp.querySelector('.acebox,.bays');
    return box && R(box).right > R(tp).right+1;}).length;
  say('560 cards: no card clips its box', clip, 0);
  say('560 cards: body fits', H()<=BUDGET, true);

  // ---- normal ----
  seg('width','830'); seg('mode','normal');
  say('normal: the pill follows', pill().textContent.indexOf('normal')>=0, true);
  say('normal strip: the unit band carries Dry', !!q('#app .ustrip.band .drybtn'), true);
  say('normal: four feeder cards, no cabinet', qq('#app .feed').length===4 && qq('#app .cab').length===0, true);
  say('normal: the selector is feeder or hand-fed', opts(0).join('/'), 'Default feeder/Hand-fed');
  say('normal: body fits', H()<=BUDGET, true);
  seg('nlay','quiet');
  say('normal quiet: no unit band, no Dry anywhere', !q('#app .ustrip.band') && !q('#app .drybtn'), true);

  // ---- the switch, run from the panel's own pill ----
  seg('mode','head');
  pill().click();
  say('the mode list opens with three entries', qq('#app .menu-item').length, 3);
  say('every entry names its macro', qq('#app .menu-item .mcmd').every(c=>c.textContent.indexOf('SET_ACE_MODE')===0), true);
  say('the current mode is marked', qq('#app .menu-item')[2].querySelector('.now').textContent, '●');
  qq('#app .menu-item')[1].click();   // Multi - the live pair
  say('multi applies live, no dialog', pill().textContent.indexOf('multi')>=0 && !q('#app .dlg'), true);
  say('the console line is the confirmation', q('#log').textContent.indexOf('No reboot needed')>=0, true);
  pill().click(); qq('#app .menu-item')[2].click();   // Head - asks which head
  say('head asks which head, current marked', qq('#app .hrow').length===4 &&
      qq('#app .hrow')[3].textContent.indexOf('on the cabinet now')>=0, true);
  say('the head picker names the line it would send',
      q('#app .dlgcmd').textContent, 'SET_ACE_MODE MODE=head HEAD=3');
  qq('#app .hrow')[1].click();
  say('picking a head moves the line', q('#app .dlgcmd').textContent.indexOf('HEAD=1')>=0, true);
  qq('#app .hrow')[3].click(); q('#app .btn.primary').click();
  say('head applies live from multi', pill().textContent.indexOf('head')>=0, true);
  // refusal: filament is loaded, and the machine's own sentences are shown
  pill().click(); qq('#app .menu-item')[0].click();   // Normal
  say('normal opens a confirm that names the restart',
      q('#app .dlg .dlgnote').textContent.indexOf('restart')>=0, true);
  q('#app .btn.primary').click();
  say('refused: the machine\'s first sentence, verbatim',
      q('#app .dlgcon').textContent.indexOf('Cannot switch mode! Filament still loaded in: E0, E1, E3')>=0, true);
  say('refused: and the second', q('#app .dlgcon').textContent.indexOf('Please unload all toolheads first')>=0, true);
  q('#app .dlgx').click();
  // pending: unloaded, the success that arrives as an error
  q('#mloaded').click();
  pill().click(); qq('#app .menu-item')[0].click(); q('#app .btn.primary').click();
  say('pending: the pill draws the disagreement',
      pill().textContent.indexOf('head → normal · restart to finish')>=0, true);
  say('pending: the banner is the exception\'s own message',
      q('#app .banner').textContent.indexOf('Please reboot!')>=0, true);
  say('pending: the panel still draws the OLD mode - ace.mode has not moved',
      q('#app .u1').dataset.mode, 'head');
  q('#mreboot').click();
  say('the restart finishes it', pill().textContent.indexOf('normal')>=0 && !q('#app .banner'), true);
  q('#mreset').click();
  say('reset restores the measured machine', pill().textContent.indexOf('head')>=0, true);

  // ---- both themes resolve; the panel does not follow ----
  const lum=(c)=>{const m=c.match(/\d+/g);if(!m)return -1;const [r,g,b]=m.map(Number);
    return (0.2126*r+0.7152*g+0.0722*b)/255;};
  const docBgL=lum(getComputedStyle(document.body).backgroundColor);
  document.documentElement.setAttribute('data-theme','dark');
  const docBgD=lum(getComputedStyle(document.body).backgroundColor);
  say('dark: the document darkens', docBgD < docBgL, true);
  say('dark: the panel stays a fixed light design',
      lum(getComputedStyle(q('#app .panel-body')).backgroundColor) > 0.95, true);
  document.documentElement.removeAttribute('data-theme');
  let bad=0; qq('table').forEach(t=>{
    if(t.scrollWidth > t.parentElement.clientWidth+1 &&
       getComputedStyle(t.parentElement).overflowX!=='auto') bad++; });
  say('no table overflows unscrollably', bad, 0);
  }catch(e){ out.push('FAIL  check threw: '+(e&&e.message||e)); }
  window.__report = out.join('\n');
})();
"""

CHECKS["original-dialog-mockup.html"] = r"""
(function(){
  const out=[];
  try{
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const q=(s)=>document.querySelector(s);
  const qq=(s)=>[...document.querySelectorAll(s)];
  const R=(e)=>e?e.getBoundingClientRect():null;
  const W=(s)=>Math.round(R(q(s)).width), H=(s)=>Math.round(R(q(s)).height);
  const seg=(g,v)=>{const b=q(`#seg-${g} button[data-v="${v}"]`);
                    if(!b) throw new Error('no control '+g+'/'+v); b.click();};
  const dlg=()=>R(q('#dlg'));
  const at=(e)=>{const r=R(e),d=dlg();return [Math.round(r.left-d.left),Math.round(r.top-d.top)];};

  say('title', document.title, 'The Upload and Print dialog, as shipped');
  say('no horizontal page scroll', document.documentElement.scrollWidth <= window.innerWidth+1, true);
  let dup=0; const seen={};
  qq('[id]').forEach(e=>{ if(seen[e.id]) dup++; seen[e.id]=1; });
  say('no duplicate ids', dup, 0);

  // ---- the dialog is the size WebPreprintDialog opens ----
  say('dialog is 714 wide', Math.round(dlg().width), 714);
  say('dialog is 750 tall', Math.round(dlg().height), 750);

  // ---- the four cards, against the capture ----
  // preuploadandprint.png: card 1 border rows at y=16..142, card 2 top at y=152.
  seg('route','print'); seg('data','four'); seg('dev','one');
  say('four sections on path=4', qq('#dlg .card').length, 4);
  const c=qq('#dlg .card');
  say('card width 680, as captured (x=16..696)', Math.round(R(c[0]).width), 680);
  say('first card sits 16 below the top (B.aE)', at(c[0])[1], 17);   // +1 dialog border
  say('cards are 8 apart (B.aB)',
      Math.round(R(c[1]).top - R(c[0]).bottom), 8);
  say('card border is 2px (A.de(ax.ry,-1,2))',
      getComputedStyle(c[0]).borderTopWidth, '2px');
  say('card padding is 12 (B.ch)', getComputedStyle(c[0]).paddingTop, '12px');
  say('title column clamps to its 120 minimum (B.m4)',
      Math.round(R(q('#dlg .card > .title')).width), 120);

  // ---- Model Information ----
  say('thumbnail is 100x100 (A.cR ... 100, 100)',
      [W('#dlg .mi svg'),H('#dlg .mi svg')].join('x'), '100x100');
  const facts=qq('#dlg .facts .f').map(e=>e.textContent.split(':')[0]);
  say('three facts, in the shipped order', facts.join('/'),
      'Filename/Estimated Time/Estimated Materials');
  say('materials is two decimals (toStringAsFixed(2))',
      /31\.40 g$/.test(qq('#dlg .facts .f')[2].textContent), true);

  // ---- Select Printer ----
  say('printer dropdown is 300x50 (A.a2l(50,300,...))',
      [W('#dlg .picker'),H('#dlg .picker')].join('x'), '300x50');

  // ---- Edit Filament: the part no screenshot ever showed ----
  say('one card per file filament', qq('#dlg .fcard').length, 4);
  say('filament card is 80x100 (A.A0(...,80,100,8,...))',
      [W('#dlg .fcard'),H('#dlg .fcard')].join('x'), '80x100');
  say('card radius 8', getComputedStyle(q('#dlg .fcard')).borderTopLeftRadius, '8px');
  // flex 3 : 1px rule : flex 4 over 100px of card, less 2px border
  const sh=H('#dlg .fcard .swatch'), ph=H('#dlg .fcard .pickrow');
  say('colour block takes 3 of the 7 parts', Math.abs(sh-42)<=4, true);
  say('picker takes 4 of the 7 parts', Math.abs(ph-56)<=4, true);
  say('a 1px rule between them', H('#dlg .fcard .rule'), 1);
  say('target disc is 28 (A.aJO(...,28,...,28))', W('#dlg .fcard .disc'), 28);
  say('grid gap is 12 both ways (Wrap 12/12)',
      getComputedStyle(q('#dlg .grid')).gap, '12px');
  // a segmented spool paints one band per colour, a gradient paints none
  say('mode 0 paints one band per colour',
      qq('#dlg .fcard')[3].querySelectorAll('.swatch .bands span').length, 3);

  // ---- an unassigned filament ----
  seg('data','mismatch');
  say('an unassigned card is bordered in the warning colour',
      qq('#dlg .fcard.unset').length, 1);
  say('and shows ! where the toolhead number goes',
      q('#dlg .fcard.unset .disc .n').textContent, '!');
  say('mode 1 paints a gradient rather than bands',
      /linear-gradient/.test(getComputedStyle(
        qq('#dlg .fcard')[3].querySelector('.swatch')).backgroundImage), true);

  // ---- the fifth section: A.R5 ----
  // The plate wants 0.4 and every head has 0.4 or 0.2, so 0.4 IS present: no banner.
  say('no banner while the plate nozzle is one the machine has',
      qq('#dlg .nozwarn').length, 0);

  // ---- Print Preferences ----
  seg('data','four');
  say('three preferences', qq('#dlg .pref').length, 3);
  say('preference row is 220x20 (B.VS max)',
      [W('#dlg .pref'),H('#dlg .pref')].join('x'), '220x20');
  say('they stack one per line at this width',
      at(qq('#dlg .pref')[0])[1] !== at(qq('#dlg .pref')[1])[1], true);
  say('12 between rows (runSpacing)',
      Math.round(R(qq('#dlg .pref')[1]).top - R(qq('#dlg .pref')[0]).bottom), 12);
  say('only the first carries a help icon',
      qq('#dlg .pref .help').length, 1);
  say('toggle is 18x18', [W('#dlg .pref .box'),H('#dlg .pref .box')].join('x'), '18x18');
  qq('#dlg .pref')[2].click();
  say('a checked toggle turns B.fx green',
      getComputedStyle(qq('#dlg .pref')[2].querySelector('.box')).backgroundColor,
      'rgb(76, 175, 80)');
  qq('#dlg .pref')[2].click();

  // ---- the send bar ----
  say('progress bar is 8 tall', H('#dlg .track'), 8);
  say('Send is 120x40', [W('#dlg .send'),H('#dlg .send')].join('x'), '120x40');
  say('Send is #2196F3 when live',
      getComputedStyle(q('#dlg .send')).backgroundColor, 'rgb(33, 150, 243)');
  say('bar padding is 16 (B.bV)', getComputedStyle(q('#dlg .sendbar')).padding, '16px');
  say('percent reads zero decimals', q('#dlg .pct').textContent, '0%');

  // ---- path=5 drops the print half ----
  seg('route','upload');
  say('upload-only keeps two sections', qq('#dlg .card').length, 2);
  say('and names them', qq('#dlg .card > .title').length ? 
      qq('#dlg .card > .title').map(e=>e.firstChild.textContent).join('/') : '',
      'Model Information/Select Printer');

  // ---- as captured: no filament data ----
  seg('route','print'); seg('data','empty');
  say('with no filament requirements the grid is empty, as both captures show',
      qq('#dlg .fcard').length, 0);
  say('but the section is still drawn', qq('#dlg .card').length, 4);

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
# The actions study drives the panel rather than reading it - a 1 px walk of the width,
# every popup opened from its own control - so it takes longer than a sheet of assertions.
GLib.timeout_add(90000, lambda: (Gtk.main_quit(), False)[1])
Gtk.main()
sys.exit(state["rc"])
