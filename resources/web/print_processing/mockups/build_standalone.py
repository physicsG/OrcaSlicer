#!/usr/bin/env python3
"""
Bundle the three multiACE mockups into ONE self-contained HTML file.

Why this exists: the mockups run under `run_webkit.py`, which needs a display, a checkout
and WebKitGTK. The people who have to choose between three designs do not all have those.
This inlines the CSS and flattens the ES modules into one document so the same designs -
the same code, not a redrawing of it - open in any browser.

It is a GENERATOR, never a second copy. Every byte comes from the files beside it, so the
standalone cannot drift from what `run_webkit.py` drives. Re-run it after any edit:

    python3 resources/web/print_processing/mockups/build_standalone.py

Each option goes in its own iframe via `srcdoc`, which is what makes the flattening safe:
the three option modules all define `model`, `paint` and `fnum`, and one realm each keeps
them apart exactly as the module scope did.
"""
import pathlib, re, json, html

HERE = pathlib.Path(__file__).resolve().parent
SHARED = HERE.parent.parent / 'shared'

# Dependency order. `shared/js/multiACE.js` brings `protocol.js` with it.
CHAIN = [SHARED / 'js' / 'protocol.js', SHARED / 'js' / 'multiACE.js',
         HERE / 'ace-art.js', HERE / 'ace-fixture.js', HERE / 'ace-shell.js']
CSS = [SHARED / 'css' / 'base.css', HERE / 'mockup.css', HERE / 'ace-mockup.css']

# Modules are kept as MODULES. Flattening them into one script does not work and the
# failure is silent: `multiACE.js` and `ace-art.js` both have a private `r1`, and two
# `const r1` in one scope is a SyntaxError that takes the whole bundle down with it. So
# each file is handed to the page as source and turned into a blob URL at load time, with
# its import specifiers rewritten to the blobs of its own dependencies - which is exactly
# what the module loader would have done with real files.
CHAIN_NAMES = ['protocol.js', 'multiACE.js', 'ace-art.js', 'ace-fixture.js',
               'ace-shell.js']

# base.css guards its dark block as `:root:not([data-theme="light"])`, so an explicit
# LIGHT choice already beats a dark OS. What it has no reason to carry is the other
# stamp: inside Orca the host owns the theme and nothing writes `data-theme="dark"`. A
# standalone page is opened in someone else's browser, where a reader who has chosen dark
# on a light OS gets exactly that stamp - so the bundle adds the mirror rule rather than
# putting a viewer-specific concern into the shared stylesheet.
DARK_STAMP = """
/* added by build_standalone.py - see the note beside DARK_STAMP */
:root[data-theme="dark"] {
  --bg: #0e1319; --panel: #161d26; --panel-2: #1d2732;
  --ink: #e6ecf3; --ink-2: #b3c0cf; --muted: #7f8d9d; --line: #26313d;
  --accent: #4fbecd; --accent-in: #08181c;
  --ok: #4cc38a; --warn: #d79a4f; --err: #e07070;
}
"""

LOADER = """
const SRC = window.__MODULES, ORDER = window.__ORDER, urls = {};
for (const name of ORDER) {
  // Rewrite every specifier this module imports to the blob its dependency already got.
  // Bottom-up, so a dependency is always built first; the chain is a DAG.
  const src = SRC[name].replace(/from\\s+'([^']+)'/g, (m, spec) => {
    const base = spec.split('/').pop();
    return urls[base] ? "from '" + urls[base] + "'" : m;
  });
  urls[name] = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
}
import(urls[ORDER[ORDER.length - 1]]);
"""


def option(key: str) -> str:
    """One option as a complete document, for an iframe's srcdoc.

    `key` is the option letter. Any switch the page reads - the scenario, and option G's
    `icon` variant - arrives at load time through `window.__SWITCHES`, so one document
    serves every combination and the bundle does not grow a copy per variant.
    """
    css = '\n'.join(p.read_text(encoding='utf-8') for p in CSS)
    css += '\n' + (HERE / f'option-{key}.css').read_text(encoding='utf-8')
    css += DARK_STAMP
    body = re.search(r'<body[^>]*>([\s\S]*?)</body>',
                     (HERE / f'option-{key}.html').read_text(encoding='utf-8')).group(1)
    body = re.sub(r'<script[\s\S]*?</script>', '', body)

    names = CHAIN_NAMES + [f'option-{key}.js']
    src = {}
    for n in CHAIN_NAMES:
        src[n] = (SHARED / 'js' / n).read_text(encoding='utf-8') if (SHARED / 'js' / n).exists() \
            else (HERE / n).read_text(encoding='utf-8')
    src[f'option-{key}.js'] = (HERE / f'option-{key}.js').read_text(encoding='utf-8')

    return ('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
            f'<style>{css}</style></head><body class="mock-dialog">{body}'
            f'<script>window.__MODULES={safe_json(src)};'
            f'window.__ORDER={safe_json(names)};</script>'
            f'<script type="module">{LOADER}</script></body></html>')


def safe_json(obj) -> str:
    """JSON that can sit inside a <script> element.

    `json.dumps` leaves `/` alone, so an embedded document's own `</script>` closes the
    OUTER script tag and the page dies with no error anyone sees - which is exactly what
    happened the first time. Splitting the sequence is the standard fix.
    """
    return json.dumps(obj).replace('</', '<\\/')


def build(shell_name: str, out_name: str, title: str, keys, frame_attr: str,
          switches_js: str) -> None:
    """One chooser page, with its frames inlined.

    `frame_attr` is the data attribute the chooser's iframes are keyed by - `data-key`
    for the four designs, `data-icon` for G's three marks - and `switches_js` is the
    expression that builds each frame's query string from the controls on the page.
    """
    shell = (HERE / shell_name).read_text(encoding='utf-8')
    # The chooser's own <style> and its markup are reused verbatim; only the frames change.
    style = re.search(r'<style>([\s\S]*?)</style>', shell).group(1)
    body = re.search(r'<body>([\s\S]*?)<script type="module">', shell).group(1)
    base = (SHARED / 'css' / 'base.css').read_text(encoding='utf-8')
    docs = {k: option(v) for k, v in keys.items()}

    # Each option is rendered once per scenario change, by rewriting srcdoc - the same
    # thing the chooser does by rewriting src.
    script = """
const DOCS = %s;
const NOTES = %s;
const deck = document.getElementById('deck');
const scenario = document.getElementById('scenario');
const mode = document.getElementById('mode');
const note = document.getElementById('scn-note');
const KEY = '%s';

function load() {
  // ace-shell.js and option-g.js both read `window.__SWITCHES` when it is a string,
  // because a srcdoc document has no query string of its own to read. It is built per
  // frame, since G's three marks differ by a switch and not by a document.
  deck.querySelectorAll('iframe').forEach((f) => {
    const q = '<scr' + `ipt>window.__SWITCHES=${JSON.stringify(%s)}</scr` + 'ipt>';
    f.srcdoc = DOCS[f.dataset[KEY]].replace('<body class="mock-dialog">',
      '<body class="mock-dialog">' + q);
  });
  if (note) note.textContent = NOTES[scenario.value] || '';
}
scenario.onchange = load;
// The four-design page has a mode switch and G's does not; a page without one must not
// die reading `.value` off null, which is exactly how the first G bundle loaded nothing.
if (mode) mode.onchange = load;
document.getElementById('focus').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#focus button').forEach((x) => x.classList.toggle('on', x === b));
  const only = b.dataset.only;
  deck.querySelectorAll('.slot').forEach((s) => {
    s.classList.toggle('hidden', !!only && s.dataset.key !== only);
  });
};
load();
""" % (safe_json(docs), safe_json(NOTES), frame_attr, switches_js)

    for k in 'defg':
        body = body.replace(f'data-src="option-{k}.html"', f'data-key="{k}"')

    out = (f'<title>{title}</title>\n'
           f'<style>{base}\n{DARK_STAMP}\n{style}</style>\n'
           f'{body}\n<script type="module">{script}</script>\n')
    dest = HERE / out_name
    dest.write_text(out, encoding='utf-8')
    print(f'{dest}  {len(out) / 1024:.0f} KB')


def main() -> None:
    # The four designs. One document per option, switched by scenario and mode.
    build('multiace.html', 'multiace-standalone.html', 'multiACE print dialog',
          {k: k for k in 'defg'}, 'key',
          '`?scenario=${scenario.value}&mode=${mode.value}`')

    # The three ACE modes. Same three designs, switched by how the printer is WIRED -
    # which is what decides whether a head has a cabinet or a lane.
    build('multiace-g.html', 'multiace-g-standalone.html', 'The three ACE modes',
          {k: k for k in 'deg'}, 'key', '`?scenario=${scenario.value}`')


NOTES = {
  'ready': 'All seven places hold what the plate was sliced for, and every ACE bay is either tag-read or named by hand. The comparison here is what each design costs when there is nothing to say.',
  'swapped': 'A2 holds white and A3 holds red; the plate wants the reverse. Both are named, so the machine is sure - this is the case a design has to make obvious, because the two spools are both present and both correct in isolation.',
  'unnamed': 'A4 holds a spool with no tag and no override. Its identity is derived, not asserted, so the honest verdict is "cannot tell". A design that calls this wrong is crying wolf; one that calls it fine is lying.',
  'wrong': 'A2 has Kingroon PETG where the plate wants PLA, and A4 is empty. Emptiness is never a judgement call. This is the scenario worth looking at.',
  'noace': 'The file was sliced for an ACE-fed head and the printer reports no `ace` object at all. Nothing can be checked - and a tick meaning "could not check" is worse than no tick.',
  'plain': 'Four filaments, four heads, nothing in the file about an ACE - which is EVERY plate the slicer can produce today. All three must degrade to the dialog that already ships.',
}

if __name__ == '__main__':
    main()
