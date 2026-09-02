#!/usr/bin/env python3
"""Serve the harness tree and accept the page's bridge recording back over POST."""
import http.server, os, sys

ROOT = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
OUTDIR = sys.argv[3] if len(sys.argv) > 3 else ROOT

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        if self.path.startswith("/wcp-dump"):
            name = self.path.split("name=", 1)[1].split("&")[0] if "name=" in self.path else "dump"
            with open(os.path.join(OUTDIR, f"{name}.json"), "wb") as f:
                f.write(body)
            sys.stderr.write(f"[dump] {name}: {len(body)} bytes\n"); sys.stderr.flush()
        self.send_response(204); self.end_headers()
    def end_headers(self):
        # Harness files are edited between runs; never let the browser reuse a copy.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()
    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
