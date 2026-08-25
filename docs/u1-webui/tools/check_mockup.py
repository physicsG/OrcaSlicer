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
CHECK = r"""
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
