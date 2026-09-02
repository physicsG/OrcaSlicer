#!/usr/bin/env python3
"""Capture screenshots of the Device page driving the simulated U1.

Serves resources/web over loopback, loads the page in ?mock=1, drives it into a
series of states through the exposed window.__devicePage handle, and writes PNGs.

Usage: python3 resources/web/device_page/tests/capture_screenshots.py <out_dir>
"""
import sys, os, threading, functools, http.server, socketserver, time

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.dirname(HERE)
WEB  = os.path.dirname(PAGE)

def serve(directory):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    class Q(socketserver.TCPServer):
        allow_reuse_address = True
    httpd = Q(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(PAGE, "screenshots")
    os.makedirs(out, exist_ok=True)
    from playwright.sync_api import sync_playwright

    httpd, port = serve(WEB)
    base = f"http://127.0.0.1:{port}/device_page"
    shots = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1240, "height": 1000},
                                device_scale_factor=2)
        page.goto(f"{base}/index.html?mock=1", wait_until="networkidle")
        page.wait_for_function("window.__devicePage && window.__devicePage.mock", timeout=30_000)
        # let the job advance so the progress bar is not at zero
        page.wait_for_timeout(6000)

        def shot(name, sel=None, note=""):
            path = os.path.join(out, name)
            if sel:
                page.locator(sel).screenshot(path=path)
            else:
                page.screenshot(path=path, full_page=True)
            shots.append((name, note))
            print(f"  wrote {name}  {note}")

        shot("01-device-page-printing.png", None, "full page, job running, 4 toolheads live")
        shot("02-toolheads.png", "#toolheads", "four-toolhead grid with filament colours")
        shot("03-bed-and-chamber.png", "#environment", "bed, fans, LED, purifier controls")
        shot("04-sswcp-trace.png", "#trace", "live SSWCP protocol trace")

        # paused
        page.evaluate("window.__devicePage.handlers.pause()")
        page.wait_for_timeout(1800)
        shot("05-paused.png", "#job", "job card after sw_MachinePrintPause")
        page.evaluate("window.__devicePage.handlers.resume()")
        page.wait_for_timeout(1500)

        # fault banner: a real code from the catalogue (toolhead 3 filament runout)
        page.evaluate("window.__devicePage.mock.printer.actionCode = '0002052300020000'")
        page.wait_for_timeout(1800)
        shot("06-fault-banner.png", "#banner", "decoded fault 0002052300020000")
        page.evaluate("window.__devicePage.mock.printer.actionCode = null")
        page.wait_for_timeout(1500)

        # a control round-trip: raise bed target and show it followed
        page.evaluate("window.__devicePage.handlers.setBedTemp(85)")
        page.wait_for_timeout(2500)
        shot("07-control-roundtrip.png", "#environment", "bed target 85C after sw_ControlBedTemp")

        # self test
        page2 = browser.new_page(viewport={"width": 1000, "height": 1100},
                                 device_scale_factor=2)
        page2.goto(f"{base}/tests/selftest.html", wait_until="networkidle")
        page2.wait_for_function("document.getElementById('sum').textContent !== ''",
                                timeout=90_000)
        page2.screenshot(path=os.path.join(out, "08-selftest.png"), full_page=True)
        shots.append(("08-selftest.png", "28/28 browser assertions"))
        print("  wrote 08-selftest.png")

        browser.close()
    httpd.shutdown()
    print(f"\n{len(shots)} screenshots -> {out}")

if __name__ == "__main__":
    main()
