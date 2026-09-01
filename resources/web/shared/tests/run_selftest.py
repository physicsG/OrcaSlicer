#!/usr/bin/env python3
"""Run tests/selftest.html in headless Chromium and report the result.

Exercises the SHARED modules (bridge, state store, protocol constants) against
the simulated host, so it guards both reconstructed surfaces.

Serves resources/web over loopback (ES modules need a real origin), drives the
self-test page, prints each assertion, and exits non-zero on any failure.

Requires playwright + a chromium build. Usage:
    python3 resources/web/shared/tests/run_selftest.py [--shots <dir>]
"""
import sys, os, threading, functools, http.server, socketserver, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.dirname(HERE)
WEB  = os.path.dirname(PAGE)

def serve(directory):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    class Q(socketserver.TCPServer):
        allow_reuse_address = True
        def log_message(self, *a): pass
    httpd = Q(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", help="directory to write screenshots into")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright
    httpd, port = serve(WEB)
    base = f"http://127.0.0.1:{port}/shared"
    print(f"serving {WEB} on {base}")

    rc = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("console", lambda m: m.type == "error" and print("  [console error]", m.text))
        page.on("pageerror", lambda e: print("  [page error]", e))

        page.goto(f"{base}/tests/selftest.html", wait_until="networkidle")
        page.wait_for_function("document.getElementById('sum').textContent !== ''",
                               timeout=90_000)

        for row in page.query_selector_all("#out .t"):
            cls = row.get_attribute("class") or ""
            print(("  PASS  " if "pass" in cls else "  FAIL  ") + row.inner_text())
        summary = page.inner_text("#sum")
        print("\n" + summary)
        if "fail" in (page.get_attribute("#sum", "class") or "") or \
           not summary.startswith(summary.split("/")[1].split()[0]):
            pass
        passed, total = summary.split()[0].split("/")
        rc = 0 if passed == total else 1

        if args.shots:
            os.makedirs(args.shots, exist_ok=True)
            page.screenshot(path=os.path.join(args.shots, "selftest.png"), full_page=True)
            print(f"wrote {args.shots}/selftest.png")

        browser.close()
    httpd.shutdown()
    return rc

if __name__ == "__main__":
    sys.exit(main())
