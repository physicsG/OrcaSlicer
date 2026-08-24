#!/usr/bin/env python3
"""A dependency-free Chrome DevTools Protocol client.

Only what a screenshot harness needs: connect to a target, call methods, read
results. WebSocket framing is implemented inline because the environment has no
websocket package and pulling one in for ~60 lines of framing is not worth it.
"""
import base64, json, os, socket, struct, subprocess, time, urllib.request


class WS:
    def __init__(self, url):
        # ws://127.0.0.1:PORT/devtools/page/ID
        rest = url.split("://", 1)[1]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.s = socket.create_connection((host, int(port)), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
               f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
               f"Sec-WebSocket-Version: 13\r\n\r\n")
        self.s.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        if b"101" not in buf.split(b"\r\n")[0]:
            raise RuntimeError("websocket handshake failed: " + buf[:200].decode("latin1"))
        self.buf = buf.split(b"\r\n\r\n", 1)[1]

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise RuntimeError("socket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, text):
        payload = text.encode()
        n = len(payload)
        hdr = b"\x81"
        if n < 126:
            hdr += struct.pack("!B", 0x80 | n)
        elif n < (1 << 16):
            hdr += struct.pack("!BH", 0x80 | 126, n)
        else:
            hdr += struct.pack("!BQ", 0x80 | 127, n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.s.sendall(hdr + mask + masked)

    def recv(self):
        """Return one complete text message (reassembling continuation frames)."""
        out = b""
        while True:
            b0, b1 = self._read(2)
            fin, opcode = b0 & 0x80, b0 & 0x0F
            masked, ln = b1 & 0x80, b1 & 0x7F
            if ln == 126:
                ln = struct.unpack("!H", self._read(2))[0]
            elif ln == 127:
                ln = struct.unpack("!Q", self._read(8))[0]
            mask = self._read(4) if masked else None
            data = self._read(ln)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            if opcode == 0x8:
                raise RuntimeError("websocket closed by peer")
            if opcode == 0x9:      # ping -> pong
                continue
            out += data
            if fin:
                return out.decode("utf-8", "replace")


class Chrome:
    def __init__(self, binary, port=9333, extra=(), env=None):
        self.port = port
        self.proc = subprocess.Popen(
            [binary, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
             f"--remote-debugging-port={port}", "--remote-allow-origins=*",
             "about:blank", *extra],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
        for _ in range(120):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1).read()
                break
            except Exception:
                time.sleep(0.25)
        else:
            raise RuntimeError("chrome did not expose the devtools endpoint")
        self._id = 0

    def open(self, url):
        """Attach to the browser's existing page target and navigate it.

        /json/new is a PUT-only endpoint in current Chrome and returns 405 for a
        GET/POST, so drive the target that --headless already opened instead.
        """
        targets = json.loads(
            urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json", timeout=10).read())
        page = next(t for t in targets if t.get("type") == "page")
        self.ws = WS(page["webSocketDebuggerUrl"])
        self.call("Page.enable")
        self.call("Page.navigate", url=url)
        return page

    def call(self, method, timeout=60, **params):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
        raise TimeoutError(method)

    def eval(self, expr, timeout=60):
        r = self.call("Runtime.evaluate", timeout=timeout, expression=expr,
                      returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")

    def shot(self, path, full=False):
        r = self.call("Page.captureScreenshot", format="png", captureBeyondViewport=full)
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        return os.path.getsize(path)

    def close(self):
        try:
            self.proc.terminate(); self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()


import urllib.parse  # noqa: E402  (used in open())
