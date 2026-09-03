#!/usr/bin/env python3
"""
Bake ONE module-based mockup into a single self-contained HTML file.

`build_standalone.py` beside this does the same for the three-across chooser and carries
a fixed dependency chain. This is the general form: it walks the imports of whatever page
it is given, so a mockup that mounts the popup's own panels - a dozen modules deep -
bundles without anybody maintaining a list.

    python3 resources/web/print_processing/mockups/bake_page.py plan-choice.html

It is a GENERATOR, never a second copy: every byte comes from the files it reads, so the
bundle cannot drift from what `run_webkit.py` drives. Re-run it after any edit.

Modules stay MODULES. Flattening them into one script fails silently - two files with a
private `r1` is a SyntaxError that takes the page down with it - so each is turned into a
blob URL at load time with its specifiers rewritten to its dependencies' blobs, which is
what the module loader would have done with real files. Modules are keyed by BASENAME,
which the tree keeps unique; a duplicate is an error here rather than a mystery later.
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
IMPORT_RE = re.compile(r"""(?:from|import)\s+['"]([^'"]+)['"]""")
LINK_RE = re.compile(r"""<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>""")

LOADER = """
const SRC = window.__MODULES, ORDER = window.__ORDER, urls = {};
for (const name of ORDER) {
  const src = SRC[name].replace(/(?:from|import)\\s+['"]([^'"]+)['"]/g, (m, spec) => {
    const base = spec.split('/').pop();
    return urls[base] ? m.replace(/['"][^'"]+['"]/, "'" + urls[base] + "'") : m;
  });
  urls[name] = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
}
import(urls[ORDER[ORDER.length - 1]]);
"""


def safe_json(obj) -> str:
    """JSON that can sit inside a <script>: an embedded `</script>` would close it."""
    return json.dumps(obj).replace('</', '<\\/')


def walk(entry_src: str, entry_dir: pathlib.Path, seen: dict, order: list) -> None:
    """Depth-first over the import graph, appending each module after its dependencies."""
    for spec in IMPORT_RE.findall(entry_src):
        if not spec.startswith('.'):
            continue                       # bare specifiers are not used on this surface
        path = (entry_dir / spec).resolve()
        name = path.name
        if name in seen:
            if seen[name] != path:
                raise SystemExit(f'two different modules named {name}: {seen[name]} and {path}')
            continue
        seen[name] = path
        src = path.read_text(encoding='utf-8')
        walk(src, path.parent, seen, order)
        order.append((name, src))


def bake(page: pathlib.Path) -> pathlib.Path:
    html = page.read_text(encoding='utf-8')

    css = []
    for href in LINK_RE.findall(html):
        if href.startswith('http'):
            continue
        css.append((page.parent / href).resolve().read_text(encoding='utf-8'))
    html = LINK_RE.sub('', html)

    # The page's own <style> stays where it is; the linked sheets go in front of it.
    html = html.replace('<style>', '<style>\n' + '\n'.join(css) + '\n', 1) if css else html

    m = re.search(r'<script type="module">([\s\S]*?)</script>', html)
    if not m:
        raise SystemExit(f'{page.name}: no inline module to bake')
    entry = m.group(1)

    seen, order = {}, []
    walk(entry, page.parent, seen, order)
    order.append((page.name.replace('.html', '.entry.js'), entry))

    modules = {name: src for name, src in order}
    names = [name for name, _ in order]
    shim = (f'<script>window.__MODULES={safe_json(modules)};'
            f'window.__ORDER={safe_json(names)};</script>'
            f'<script type="module">{LOADER}</script>')
    html = html[:m.start()] + shim + html[m.end():]

    out = page.with_name(page.stem + '-standalone.html')
    out.write_text(html, encoding='utf-8')
    return out


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__.strip().splitlines()[0] + '\n\nusage: bake_page.py <mockup.html>')
    page = (HERE / sys.argv[1]).resolve()
    out = bake(page)
    print(f'{out.relative_to(HERE.parents[3])}  {out.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
