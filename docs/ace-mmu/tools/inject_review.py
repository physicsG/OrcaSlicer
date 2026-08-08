#!/usr/bin/env python3
"""Inject (or refresh) the review overlay in the ace-mmu mockups.

The mockups are published as standalone artifacts, so the overlay has to be inlined
rather than linked. Keeping one source (review-overlay.js) and injecting it means the
mockups cannot drift apart.

    python3 docs/ace-mmu/tools/inject_review.py [file.html ...]

With no arguments it refreshes every mockup in docs/ace-mmu/.
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
DOCS = HERE.parent
BEGIN = "<!-- review-overlay:begin -->"
END = "<!-- review-overlay:end -->"


def inject(path: pathlib.Path, script: str) -> bool:
    html = path.read_text(encoding="utf-8")
    block = f"{BEGIN}\n<script>\n{script}\n</script>\n{END}\n"
    if BEGIN in html and END in html:
        head, rest = html.split(BEGIN, 1)
        _, tail = rest.split(END, 1)
        new = head + block + tail.lstrip("\n")
    else:
        new = html.rstrip() + "\n\n" + block
    if new == html:
        return False
    path.write_text(new, encoding="utf-8")
    return True


def main() -> int:
    script = (HERE / "review-overlay.js").read_text(encoding="utf-8").strip()
    targets = [pathlib.Path(a) for a in sys.argv[1:]] or sorted(DOCS.glob("*mockup*.html"))
    for t in targets:
        if not t.exists():
            print(f"  missing: {t}")
            continue
        print(f"  {'updated' if inject(t, script) else 'unchanged'}: {t.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
