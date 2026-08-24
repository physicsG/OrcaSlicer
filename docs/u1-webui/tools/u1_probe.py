#!/usr/bin/env python3
"""Talk to a real U1 and record what it actually sends back.

Three response shapes in the reconstruction are pass-throughs from the printer whose
field names appear nowhere in the Flutter bundle or in Orca's C++ - camera frames, file
thumbnails and discovery results. `pickFrame()` and `pickThumb()` sniff a list of
plausible names because nobody had seen the real thing. This closes that by asking the
printer directly.

It speaks the connect path documented in 02-device-page/06-connection.md, without Orca:
plain MQTT on :1884 to get keys, then mTLS on :8883 for the session. That makes it usable
as a regression probe as well - run it against a firmware update and diff the shapes.

Read-only. Every method it sends queries or subscribes; nothing moves the machine, starts
or cancels a print, or writes to the filesystem. Certificates never reach the report.

    python3 u1_probe.py                    # device read from Orca's config
    python3 u1_probe.py --ip 192.168.2.242 --sn <SN> --client-id <id>
    python3 u1_probe.py --out shapes.json  # keep the raw payloads
"""

import argparse
import glob
import json
import os
import ssl
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mqtt_min import MqttClient, MqttError          # noqa: E402

LAN_AUTH_CODE = "12345678"      # fixed, not a PIN - see 06-connection.md
PLAIN_PORT = 1884
TLS_PORT = 8883


# --------------------------------------------------------------------------- config

def device_from_orca_config():
    """The device record Orca saved. ca/cert/key are always blank there by design."""
    for path in glob.glob(os.path.expanduser("~/.config/Snapmaker_Orca/*.conf")):
        try:
            cfg = json.load(open(path))
        except Exception:
            continue
        for dev in cfg.get("devices", []):
            if dev.get("ip") and dev.get("sn"):
                return dev
    return None


# ----------------------------------------------------------------------- rpc plumbing

class Session:
    def __init__(self, ip, sn, client_id, verbose=True):
        self.ip, self.sn, self.client_id = ip, sn, client_id
        self.verbose = verbose
        self.cli = None
        self.rpc_id = 0
        self.inbox = []          # (topic, obj) seen while waiting for something else
        self._tmp = []

    def log(self, msg):
        if self.verbose:
            print(msg, flush=True)

    def envelope(self, method, params=None, rpc_id=None):
        """cli_time and dev_time are mandatory: without them the printer stays silent."""
        self.rpc_id += 1
        return {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
            "id": rpc_id if rpc_id is not None else self.rpc_id,
            "cli_time": int(time.time()),
            "dev_time": -1,
        }

    # -- phase 1 ---------------------------------------------------------

    def request_keys(self, timeout=20):
        """Plain MQTT on :1884, server.client_manager.request_lan_auth."""
        throwaway = f"orca-try-{int(time.time() * 1000) % 1000000}"
        self.log(f"  phase 1  mqtt://{self.ip}:{PLAIN_PORT}  as {throwaway}")
        c = MqttClient(self.ip, PLAIN_PORT, throwaway).connect()
        try:
            c.subscribe(f"{LAN_AUTH_CODE}/config/response")
            req = self.envelope(
                "server.client_manager.request_lan_auth",
                {"clientid": self.client_id, "app_id": f"orca-{int(time.time() * 1e6)}"},
            )
            c.publish(f"{LAN_AUTH_CODE}/config/request", req)
            self.log("  phase 1  sent request_lan_auth, waiting for keys")

            for topic, raw in c.messages(timeout):
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                res = msg.get("result", msg)
                if isinstance(res, dict) and res.get("ca") and res.get("cert"):
                    self.log(f"  phase 1  keys received (state={res.get('state')})")
                    return res
                if msg.get("error"):
                    raise MqttError(f"auth refused: {msg['error']}")
            raise MqttError("no keys within timeout (cli_time/dev_time missing?)")
        finally:
            c.close()

    # -- phase 2 ---------------------------------------------------------

    def _tls_context(self, auth):
        """The printer's cert is not issued for its IP, so verify the chain, not the name."""
        def tmp(text, suffix):
            fd, path = tempfile.mkstemp(suffix=suffix)
            os.write(fd, text.encode())
            os.close(fd)
            self._tmp.append(path)
            return path

        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.load_verify_locations(cafile=tmp(auth["ca"], ".ca.pem"))
        ctx.load_cert_chain(tmp(auth["cert"], ".crt.pem"), tmp(auth["key"], ".key.pem"))
        return ctx

    def open(self, auth):
        ctx = self._tls_context(auth)
        port = int(auth.get("port") or TLS_PORT)
        self.log(f"  phase 2  mqtts://{self.ip}:{port}  as {self.client_id}")
        self.cli = MqttClient(self.ip, port, self.client_id, tls=ctx).connect()
        for suffix in ("status", "response", "notification"):
            self.cli.subscribe(f"{self.sn}/{suffix}")
        self.log(f"  phase 2  subscribed {self.sn}/{{status,response,notification}}")
        return self

    def call(self, method, params=None, timeout=12, collect_pushes=False):
        """Send one JSON-RPC request; return (result_envelope, pushes_seen)."""
        req = self.envelope(method, params)
        self.cli.publish(f"{self.sn}/request", req)
        pushes, answer = [], None
        deadline = time.time() + timeout
        while time.time() < deadline:
            got = False
            for topic, raw in self.cli.messages(max(0.1, deadline - time.time())):
                got = True
                try:
                    msg = json.loads(raw)
                except Exception:
                    msg = {"_raw_non_json": raw[:200].decode("utf-8", "replace"),
                           "_bytes": len(raw)}
                if isinstance(msg, dict) and msg.get("id") == req["id"]:
                    answer = msg
                    if not collect_pushes:
                        return answer, pushes
                    deadline = min(deadline, time.time() + 3)
                else:
                    pushes.append((topic, msg))
            if not got:
                break
        return answer, pushes

    def drain(self, seconds):
        out = []
        for topic, raw in self.cli.messages(seconds):
            try:
                out.append((topic, json.loads(raw)))
            except Exception:
                out.append((topic, {"_raw_non_json": raw[:200].decode("utf-8", "replace"),
                                    "_bytes": len(raw)}))
        return out

    def close(self):
        if self.cli:
            self.cli.close()
        for p in self._tmp:
            try:
                os.unlink(p)
            except OSError:
                pass
        self._tmp = []


# --------------------------------------------------------------------------- shaping

def describe(obj, depth=0, max_depth=4):
    """A field-name skeleton. Long strings become their length, so certificates and
    base64 frames are summarised rather than dumped."""
    pad = "  " * depth
    if isinstance(obj, dict):
        if depth >= max_depth:
            return pad + f"{{{len(obj)} keys: {', '.join(list(obj)[:8])}}}"
        return "\n".join(f"{pad}{k}: {describe(v, depth + 1, max_depth).lstrip()}"
                         for k, v in obj.items())
    if isinstance(obj, list):
        if not obj:
            return "[] (empty)"
        return f"[{len(obj)}] of\n" + describe(obj[0], depth + 1, max_depth)
    if isinstance(obj, str):
        return f"<str len={len(obj)}>" if len(obj) > 80 else repr(obj)
    return repr(obj)


def find_long_strings(obj, path="", out=None, minlen=256):
    """Where the payload's bulk actually lives - the candidate frame/thumbnail field."""
    if out is None:
        out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            find_long_strings(v, f"{path}.{k}" if path else k, out, minlen)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:4]):
            find_long_strings(v, f"{path}[{i}]", out, minlen)
    elif isinstance(obj, str) and len(obj) >= minlen:
        out.append((path, len(obj), obj[:48]))
    return out


# ----------------------------------------------------------------------------- probes

def probe_files(sess, report):
    """A directory listing first, because the thumbnail calls need a real filename."""
    print("\n[files] server.files.get_directory")
    ans, _ = sess.call("server.files.get_directory", {"path": "gcodes", "extended": True})
    report["server.files.get_directory"] = ans
    if not ans or "result" not in ans:
        print("  no result:", json.dumps(ans)[:300] if ans else "timeout")
        return None
    print(describe(ans["result"], max_depth=3)[:1200])

    files = ans["result"].get("files") or []
    names = [f.get("filename") or f.get("path") for f in files if isinstance(f, dict)]
    names = [n for n in names if n]
    print(f"  {len(names)} file(s): {names[:5]}")
    return names[0] if names else None


def probe_thumbnails(sess, report, filename):
    """The shape pickThumb() has been guessing at."""
    if not filename:
        print("\n[thumbnails] skipped - no file on the printer to ask about")
        report["_skipped_thumbnails"] = "no gcode file present"
        return
    for method, params in (("server.files.thumbnails", {"filename": filename}),
                           ("server.files.thumbnails_base64", {"path": filename})):
        print(f"\n[thumbnails] {method}  ({filename})")
        ans, _ = sess.call(method, params, timeout=20)
        report[method] = ans
        if not ans:
            print("  timeout")
            continue
        if "error" in ans:
            print("  error:", json.dumps(ans["error"])[:200])
            continue
        print(describe(ans.get("result"), max_depth=4)[:1500])
        for path, length, head in find_long_strings(ans.get("result"), minlen=64):
            print(f"  >> payload at result.{path}  len={length}  starts {head!r}")


def probe_camera(sess, report, watch=12):
    """start_monitor is a subscription: the answer is small, the frames arrive after."""
    print("\n[camera] camera.start_monitor")
    ans, pushes = sess.call("camera.start_monitor",
                            {"domain": "", "interval": 2, "expect_pw": False},
                            timeout=15, collect_pushes=True)
    report["camera.start_monitor"] = ans
    print("  ack:", json.dumps(ans)[:400] if ans else "timeout")

    print(f"  watching {watch}s for frames...")
    frames = pushes + sess.drain(watch)
    report["camera.frames"] = []
    seen = 0
    for topic, msg in frames:
        longs = find_long_strings(msg, minlen=256)
        if not longs:
            continue
        seen += 1
        if seen <= 2:
            print(f"\n  frame on {topic}:")
            print(describe(msg, max_depth=4)[:900])
            for path, length, head in longs:
                print(f"  >> frame data at {path}  len={length}  starts {head!r}")
            report["camera.frames"].append(
                {"topic": topic, "skeleton": describe(msg, max_depth=4),
                 "long_fields": longs})
    if not seen:
        print("  no frame-shaped push arrived "
              "(camera off, or frames travel outside MQTT)")
        report["camera.frames_none"] = [
            {"topic": t, "keys": list(m) if isinstance(m, dict) else str(type(m))}
            for t, m in frames[:12]]
    else:
        print(f"\n  {seen} frame push(es) seen")

    sess.call("camera.stop_monitor", {"domain": ""}, timeout=6)
    print("  monitor stopped")


def probe_state(sess, report):
    """Proves the session is real before anything is concluded from a silent probe."""
    print("\n[sanity] printer.objects.list")
    ans, _ = sess.call("printer.objects.list", {})
    report["printer.objects.list"] = ans
    if ans and "result" in ans:
        objs = ans["result"].get("objects", [])
        print(f"  {len(objs)} objects: {objs[:8]}")
        return True
    print("  no result:", json.dumps(ans)[:300] if ans else "timeout")
    return False


# ------------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ip")
    ap.add_argument("--sn")
    ap.add_argument("--client-id")
    ap.add_argument("--out", help="write the raw payloads here as JSON")
    ap.add_argument("--camera-watch", type=int, default=12,
                    help="seconds to watch for camera frames (default 12)")
    ap.add_argument("--skip-camera", action="store_true")
    args = ap.parse_args()

    ip, sn, client_id = args.ip, args.sn, args.client_id
    if not (ip and sn and client_id):
        dev = device_from_orca_config()
        if not dev:
            print("No device in Orca's config; pass --ip/--sn/--client-id.",
                  file=sys.stderr)
            return 2
        ip = ip or dev["ip"]
        sn = sn or dev["sn"]
        client_id = client_id or dev.get("clientId")
        print(f"device from Orca config: {dev.get('dev_name')} ({sn}) at {ip}")

    sess = Session(ip, sn, client_id)
    report = {"_device": {"ip": ip, "sn": sn}}
    try:
        auth = sess.request_keys()
        report["_auth_keys"] = {k: (f"<{len(v)} chars>" if isinstance(v, str) and len(v) > 80
                                    else v) for k, v in auth.items()}
        sess.open(auth)
    except (MqttError, OSError, ssl.SSLError) as e:
        print(f"\nconnect failed: {type(e).__name__}: {e}", file=sys.stderr)
        sess.close()
        return 1

    try:
        if not probe_state(sess, report):
            print("\nSession answered nothing - not probing shapes against a dead session.",
                  file=sys.stderr)
            return 1
        first = probe_files(sess, report)
        probe_thumbnails(sess, report, first)
        if not args.skip_camera:
            probe_camera(sess, report, args.camera_watch)
    finally:
        sess.close()
        if args.out:
            with open(args.out, "w") as fh:
                json.dump(report, fh, indent=2, default=str)
            print(f"\nraw payloads written to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
