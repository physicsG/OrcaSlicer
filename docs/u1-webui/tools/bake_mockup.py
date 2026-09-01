#!/usr/bin/env python3
"""Re-render an interactive mockup's static copies into the file itself.

    python3 docs/u1-webui/tools/bake_mockup.py docs/u1-webui/02-device-page/multiace-f2-iterations.html

The interactive mockups draw their panel from a state object, which made the first of them
unreadable in a viewer that strips script tags: the box was simply empty, and a noscript
block never fired, because a removed tag is not the same as scripting being disabled. They
now carry a pre-rendered copy of every option, switched with radio inputs, and script swaps
them for the live panel when it runs.

One baker per file, keyed by basename - each drives a different rig.

Those copies are output, so they go stale the moment the renderer changes. This script is
how they are refreshed: it loads the page in WebKitGTK - the engine Orca renders with, and
the same one check_mockup.py uses - drives the rig through all sixteen combinations,
dumps `#app` for each, and rewrites the `.staticwrap` block in place.

Run it after ANY change to the mockup's JavaScript or to the panel CSS. check_mockup.py
fails if a copy no longer matches what the renderer produces, so a forgotten bake is
caught rather than shipped.
"""
import sys, os, re, json
import gi
gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib

PATH = os.path.abspath(sys.argv[1])

# One dump script per mockup, keyed by basename, because each drives a different rig.
# Each returns {blockId: {html, h}} and the block ids must match the radio ids the file
# already declares, minus their "o-" prefix.
BAKERS = {}

BAKERS["multiace-f2-iterations.html"] = r"""
(function(){
  const seg=(g,v)=>document.querySelector(`#seg-${g} button[data-v="${v}"]`).click();
  const out={};
  ['0','1','2','4'].forEach(n=>{
    seg('units',n);
    document.querySelector('#app .panel-head .prefpill').click();
    ['i1','i2','i3','i4'].forEach(k=>{
      seg('iter',k);
      out[k+'-u'+n]={html:document.getElementById('app').innerHTML,
        h:Math.round(document.querySelector('#app .fbody').getBoundingClientRect().height)};
    });
  });
  window.__report=JSON.stringify(out);
})();
"""

# The card study has five independent axes, so what is baked is one copy per OPTION with
# the other four at their recommended setting - which is how the options get compared
# anyway. The three marker copies turn the fault override on, because a marker with one
# state visible cannot be judged.
BAKERS["multiace-toolhead-card.html"] = r"""
(function(){
  const seg=(g,v)=>document.querySelector(`#seg-${g} button[data-v="${v}"]`).click();
  const DEF={frame:'below-s',bay:'s3',box:'b1',wire:'w3',mark:'m1'};
  const AX={frame:['below-s','below-f','beside-f'],bay:['s1','s2','s3','s4'],
            box:['b1','b2','b3','b4'],wire:['w1','w2','w3','w4'],mark:['m1','m2','m3']};
  const out={};
  seg('units','1');
  Object.keys(AX).forEach(ax=>{
    AX[ax].forEach(v=>{
      Object.keys(DEF).forEach(k=>seg(k, k===ax? v : DEF[k]));
      seg('faults', ax==='mark' ? '1' : '0');
      out[ax+'-'+v]={html:document.getElementById('app').innerHTML,
        h:Math.round(document.querySelector('#app .fbody').getBoundingClientRect().height),
        cap:document.getElementById('cap').innerHTML};
    });
  });
  window.__report=JSON.stringify(out);
})();
"""

def budget(h, allowed=456):
    pct = min(100, round(h / allowed * 100))
    cls = ' class="over"' if h > allowed else ''
    tail = f'{h-allowed} over' if h > allowed else f'{allowed-h} spare'
    return (f'<div class="budget"><span>body</span><span class="bar">'
            f'<i{cls} style="width:{pct}%"></i></span>'
            f'<span>{h} / {allowed} &middot; {tail}</span></div>')

def rewrite(blocks):
    src = open(PATH).read()
    # A baked copy carries every id the live panel had, so the file ends up with several
    # elements sharing one id - and a clipPath resolved document-wide then pointed at a
    # copy inside a display:none block, which clips nothing. Each block gets its own
    # namespace on the way in.
    for key, b in blocks.items():
        tag = re.sub(r'[^a-z0-9]', '', key.lower())
        b['html'] = re.sub(r'\b(dropclip\d*)\b', lambda m: tag + m.group(1), b['html'])
    out = ['<div class="staticwrap">']
    for k, b in blocks.items():
        cap = f'<p class="scap">{b["cap"]}</p>' if b.get('cap') else ''
        out.append(f'<div class="sblk sb-{k}">{b["html"]}{budget(b["h"])}{cap}</div>')
    out.append('</div>')
    new = '\n'.join(out)
    if 'class="staticwrap"' not in src:
        sys.exit('no .staticwrap block in that file - nothing to bake')
    src = re.sub(r'<div class="staticwrap">.*?\n</div>\n</div>',
                 new + '\n</div>', src, flags=re.S)
    # A script-looking string anywhere outside a real script tag lets a regex sanitiser
    # strip from there to the next closing tag and take every copy with it. That is how
    # this file was found broken, so it is checked on the way out too.
    looks = len(re.findall(r'<script\b', src))
    tags = len(re.findall(r'^<script>$', src, re.M))
    if looks != tags:
        sys.exit(f'{looks} script-looking strings but {tags} real tags - a sanitiser '
                 'would strip more than it should. Write "script tags" in prose instead.')
    open(PATH, 'w').write(src)
    print(f'baked {len(blocks)} copies: '
          + ', '.join(f'{k}={v["h"]}' for k, v in list(blocks.items())[:4]) + ' ...')

# The cabinet study has six axes; the same rule applies - one copy per OPTION with the
# others at their recommended setting, which is how options get compared anyway.
BAKERS["multiace-cabinet.html"] = r"""
(function(){
  const seg=(g,v)=>document.querySelector(`#seg-${g} button[data-v="${v}"]`).click();
  const grab=()=>({html:document.getElementById('app').innerHTML,
    h:Math.round(document.querySelector('#app .fbody').getBoundingClientRect().height),
    cap:document.getElementById('cap').innerHTML});
  const out={};
  seg('units','1'); seg('faults','0');
  // Every choice is settled, so what is baked is STATES rather than options - and the
  // dialog is opened the way a person opens it, by clicking the Dry chip.
  seg('hold','0'); seg('drying','0');            out['state-rest']=grab();
  seg('hold','1');                               out['state-hover']=grab();
  seg('hold','0'); seg('drying','1');            out['state-drying']=grab();
  seg('drying','0');
  document.querySelector('#app .drybtn').click(); out['state-dialog']=grab();
  document.querySelector('#app .dlg .dlgx').click();
  seg('drying','1');
  document.querySelector('#app .drybtn').click(); out['state-dialogrun']=grab();
  document.querySelector('#app .dlg .dlgx').click(); seg('drying','0');
  window.__report=JSON.stringify(out);
})();
"""

# The modes study bakes STATES: the three modes, multi's rival drawings and its two
# hardware truths (the measured cross-lane feed, the shipped model's wrong resolution),
# the two-unit and 560px cases, and the switch's own four moments - the last three
# reached the way a person reaches them, through the panel's pill and the machine strip.
BAKERS["multiace-modes.html"] = r"""
(function(){
  const q=(s)=>document.querySelector(s);
  const qq=(s)=>[...document.querySelectorAll(s)];
  const seg=(g,v)=>q(`#seg-${g} button[data-v="${v}"]`).click();
  const pill=()=>q('#app .prefpill').click();
  const item=(n)=>qq('#app .menu-item')[n].click();
  const grab=()=>({html:document.getElementById('app').innerHTML,
    h:Math.round(q('#app .fbody').getBoundingClientRect().height),
    cap:document.getElementById('cap').innerHTML});
  const out={};
  q('#mreset').click();
  out['mode-head']=grab();
  seg('mode','multi');                       out['multi-cards']=grab();
  seg('mlay','lanes');                       out['multi-lanes']=grab();
  seg('mstate','measured');                  out['multi-measured']=grab();
  seg('mstate','asbuilt');                   out['multi-asbuilt']=grab();
  seg('mstate','clean'); seg('units','2');   out['multi-2u-lanes']=grab();
  seg('mlay','cards');                       out['multi-2u-cards']=grab();
  seg('units','1'); seg('mlay','lanes'); seg('width','560'); out['multi-560-lanes']=grab();
  seg('mlay','cards');                       out['multi-560-cards']=grab();
  seg('width','830'); seg('mode','normal');  out['normal-strip']=grab();
  seg('nlay','quiet');                       out['normal-quiet']=grab();
  seg('nlay','strip'); seg('mode','head');
  pill();                                    out['switch-list']=grab();
  item(2);                                   out['switch-headpick']=grab();
  q('#app .dlgx').click();
  pill(); item(0); q('#app .btn.primary').click(); out['switch-refused']=grab();
  q('#app .dlgx').click();
  q('#mloaded').click();
  pill(); item(0); q('#app .btn.primary').click(); out['switch-pending']=grab();
  q('#mreset').click();
  window.__report=JSON.stringify(out);
})();
"""

EXPECT = {"multiace-f2-iterations.html": 16, "multiace-toolhead-card.html": 18,
          "multiace-cabinet.html": 5, "multiace-actions.html": 19,
          "multiace-modes.html": 15}

# The actions study has an axis the others had not: WIDTH. One copy per option with the
# others at rest - and the two sheet copies are opened the way a person opens them, by
# clicking a bay, because a dialog nobody clicked is a dialog that proves nothing.
BAKERS["multiace-actions.html"] = r"""
(function(){
  // No rig to drive: this study is dragged and clicked, so the baker drags and clicks
  // it. What is baked is the STATES the panel can be in, not a set of design options.
  const grip=document.getElementById('grip');
  const width=(w)=>{ grip.focus();
    // the control's own keyboard step, walked to the target - the same path a person
    // takes with the arrow keys, and no private API
    let guard=0;
    while(Math.round(document.querySelector('#app .u1').getBoundingClientRect().width)!==w
          && guard++ < 400){
      const now=Math.round(document.querySelector('#app .u1').getBoundingClientRect().width);
      grip.dispatchEvent(new KeyboardEvent('keydown',
        {key: now<w ? 'ArrowRight':'ArrowLeft', shiftKey: Math.abs(now-w)>=10, bubbles:true}));
    }
  };
  const grab=()=>({html:document.getElementById('app').innerHTML,
    h:Math.round(document.querySelector('#app .fbody').getBoundingClientRect().height),
    cap:document.getElementById('cap').innerHTML});
  const shut=()=>{const x=document.querySelector('#app .dlg .dlgx'); if(x) x.click();};
  const bay=(n)=>document.querySelectorAll('#app .tp.viaace .bay')[n];
  const verbs=()=>[...document.querySelectorAll('#app .verb')];
  // By NAME, never by index: what a bay offers now depends on the state the head is in -
  // a loaded head offers Swap where an empty one offers Load - so position means nothing.
  const verb=(n)=>verbs().find(v=>v.querySelector('.vname').textContent.indexOf(n)===0);
  const machine=(label)=>[...document.querySelectorAll('#machine button')]
    .find(b=>b.textContent===label);
  const seg=(g,v)=>document.querySelector(`#seg-${g} button[data-v="${v}"]`).click();
  const out={};
  width(830);
  [902,830,782,708,662,560].forEach(w=>{ width(w); out['w'+w]=grab(); });
  width(830);
  // the two open questions, each drawn rather than described
  ['sheet','head','menu','row'].forEach(v=>{ seg('place',v); out['place-'+v]=grab(); });
  seg('place','sheet');
  bay(0).click(); verb('Swap').click();        // a swap, so there is something to report
  ['beside','row'].forEach(v=>{ seg('flight',v); out['flight-'+v]=grab(); });
  seg('flight','beside');
  // a swap is running, so the printer's line offers finish/fail rather than reset
  machine('finish it').click();
  machine('reset').click();
  out['busy-idle']=grab();
  bay(0).click(); verb('Swap').click();                 // Swap: a real one, from the sheet
  out['busy-swapping']=grab();
  machine('make it fail').click();
  out['busy-failed']=grab();
  machine('reset').click();
  out['bg-off']=grab();
  bay(0).click();
  document.querySelector('#app .verb .venable').click();   // ACE_BG_SET_HEAD, as sent
  out['bg-on']=grab();
  shut();
  bay(2).click(); out['sheet-bay']=grab(); shut();
  document.querySelector('#app .tp:not(.viaace) .bay').click();
  out['sheet-feeder']=grab(); shut();
  machine('reset').click();
  window.__report=JSON.stringify(out);
})();
"""

DUMP = BAKERS.get(os.path.basename(PATH))
if DUMP is None:
    sys.exit(f"no baker for {os.path.basename(PATH)}. Known: {', '.join(sorted(BAKERS))}")

win = Gtk.OffscreenWindow(); win.set_default_size(1400, 1000)
view = WebKit2.WebView(); win.add(view); win.show_all()
view.load_uri("file://" + PATH)
state = {"tries": 0}

def got(v, res, *_):
    try:
        val = v.evaluate_javascript_finish(res)
        txt = val.to_string() if val else ""
    except Exception as e:
        txt = ""
    if not txt and state["tries"] < 40:
        state["tries"] += 1
        GLib.timeout_add(300, lambda: (view.evaluate_javascript(
            "window.__report || ''", -1, None, None, None, got, None), False)[1])
        return
    if not txt:
        sys.exit("the page never reported - does it still have the rig?")
    blocks = json.loads(txt)
    want = EXPECT[os.path.basename(PATH)]
    if len(blocks) != want:
        sys.exit(f"expected {want} blocks, got {len(blocks)}")
    ids = re.findall(r'\bid="([^"]+)"', open(PATH).read())
    if 'selected' not in list(blocks.values())[0]['html']:
        sys.exit("the dumped markup has no `selected` attribute - the source selector "
                 "must setAttribute('selected'), because the property does not reflect")
    rewrite(blocks)
    Gtk.main_quit()

def go(v, ev):
    if ev != WebKit2.LoadEvent.FINISHED: return
    def run():
        view.evaluate_javascript(DUMP, -1, None, None, None, lambda *a: None, None)
        GLib.timeout_add(400, lambda: (view.evaluate_javascript(
            "window.__report || ''", -1, None, None, None, got, None), False)[1])
        return False
    GLib.timeout_add(900, run)

view.connect("load-changed", go)
GLib.timeout_add(40000, lambda: (sys.exit("timed out"), False)[1])
Gtk.main()
