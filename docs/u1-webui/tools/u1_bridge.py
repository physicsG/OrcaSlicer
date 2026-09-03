#!/usr/bin/env python3
"""Answer the page's bridge commands by talking to a real U1. No Orca.

The Device page speaks to Orca over SSWCP - `window.wx.postMessage` out, a `message`
event back - and Orca turns most of those commands into one JSON-RPC call to the
printer. This is that middle layer, in Python: give it a `send` callback and hand it
the packets the page posts, and the page runs against real hardware.

    from u1_bridge import Bridge
    b = Bridge(send=lambda msg: post_to_page(msg))
    b.handle(text_from_window_wx)

Three kinds of command, and the split is not a design choice - it is what Orca does:

  transport     sw_create_mqtt_client / connect / subscribe / publish / disconnect /
                set_engine. THE PAGE drives the connection itself, including the key
                exchange; Orca only owns the socket. So does this. See connection.js.
  printer       37 of the commands the page issues are one JSON-RPC method with the
                parameters passed nearly straight through. That mapping is read out of
                the C++ by extract_bridge_methods.py, not written down here.
  local         the device book, the login state, discovery. Answered from Orca's own
                config file where that is honest, and refused in as many words where
                it is not.

**Orca must not be running.** It authenticates with the same saved `clientId`, and a
broker evicts the older holder of a duplicate id - so the two fight, and neither wins.

**This does not test Orca's bridge.** It is a second host speaking the same contract.
It proves the page and the printer agree; whether ORCA agrees is a different question
and still needs the app. See STATUS.md, "What to pick up next", item 1.
"""
import glob
import json
import socket
import os
import zipfile
import hashlib
import base64
import queue
import re
import ssl
import sys
import tempfile
import threading
import time
from concurrent.futures import Future

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
sys.path.insert(0, HERE)
from mqtt_min import MqttClient, MqttError          # noqa: E402

OK = 200                       # Orca's success code. 200, not 0 - see sswcp.js.

# Commands Orca answers out of its own state, which this host will not pretend to.
# Each is refused in as many words: to the page, a silent refusal and an unimplemented
# command look identical, and the whole point of running outside Orca is to be able to
# tell which is which. Anything added here has to say why, the same rule check_coverage
# holds the reconstruction to.
REFUSED = {
    "sw_AddDevice": "adds a printer to Orca's config; this host only reads it",
    "sw_DeleteDevices": "removes a printer from Orca's config; this host only reads it",
    "sw_RenameDevice": "renames a printer in Orca's config; this host only reads it",
    "sw_ConnectOtherMachine": "switches Orca's connected device; there is no such "
                              "state here - the page picks its own",
    "sw_UpdateMachineFilamentInfo": "writes Orca's per-device filament record",
    "sw_DownloadMachineFile": "saves through Orca's download manager. The file is "
                              "reachable directly at http://<ip>:7125/server/files/",
    "sw_StartMachineFind": "Orca's own Bonjour sweep (SSWCP.cpp:1789), not a printer "
                           "command - nothing on MQTT can answer it",
    "sw_StopMachineFind": "the other half of Orca's Bonjour sweep",
}
# What Orca waits for a printer reply: add_response_target's default, MoonRaker.hpp:344.
# NOT the client's 15s (sswcp.js) - that is the page giving up on the BRIDGE, and the
# two must not be confused. Guessing 12s here answered before the page's own clock did,
# and turned a 31s toolchange that was working into "the printer refused the command".
RPC_TIMEOUT = 80.0
POLL = 0.1                     # how long a client thread blocks reading, per turn


def _log(msg):
    # Flushed: the interesting use of this is watching a live session scroll past, and
    # a buffered pipe holds the whole conversation back until the process ends.
    print(msg, flush=True)


# --------------------------------------------------------------------------- config

def reachable(ip, port, timeout=1.5):
    """Can this host open a socket to the machine? Cheap, and it is real evidence."""
    try:
        socket.create_connection((ip, int(port or 8883)), timeout=timeout).close()
        return True
    except OSError:
        return False


def orca_devices():
    """Every device Orca has saved. ca/cert/key are always blank there by design."""
    for path in sorted(glob.glob(os.path.expanduser("~/.config/Snapmaker_Orca/*.conf"))):
        try:
            cfg = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        devs = [d for d in cfg.get("devices", []) if d.get("ip") and d.get("sn")]
        if devs:
            return devs
    return []


# ------------------------------------------------------------------------ transport

class Client(threading.Thread):
    """One MQTT connection, with every socket operation on this one thread.

    mqtt_min is not thread-safe and does not pretend to be: `subscribe` reads packets
    until its SUBACK arrives, so a reader running concurrently would eat it. Rather
    than lock around that, all work is queued to the thread that owns the socket.
    """

    def __init__(self, cid, host, port, client_id, tls, on_message, log):
        super().__init__(daemon=True, name=f"mqtt-{cid}")
        self.cid, self.host, self.port = cid, host, port
        self.client_id, self.tls = client_id, tls
        self.on_message, self.log = on_message, log
        self.cli = None
        self.q = queue.Queue()
        self.alive = True

    def submit(self, fn):
        """Run fn(cli) on this client's thread. Returns a Future."""
        f = Future()
        self.q.put((fn, f))
        return f

    def _drain(self):
        while True:
            try:
                fn, f = self.q.get_nowait()
            except queue.Empty:
                return
            try:
                f.set_result(fn(self.cli))
            except Exception as e:                                   # noqa: BLE001
                f.set_exception(e)

    def run(self):
        while self.alive:
            self._drain()
            if self.cli is None:
                time.sleep(0.02)
                continue
            try:
                for topic, raw in self.cli.messages(POLL):
                    try:
                        self.on_message(self.cid, topic, raw)
                    except Exception as e:                           # noqa: BLE001
                        self.log(f"[bridge] push handler: {e}")
            except MqttError as e:
                self.log(f"[bridge] {self.cid}: {e}")
                self.alive = False
            except Exception as e:                                   # noqa: BLE001
                self.log(f"[bridge] {self.cid}: {e}")
                self.alive = False
        self._shut()

    def _shut(self):
        cli, self.cli = self.cli, None
        if cli:
            try:
                cli.close()
            except Exception:                                        # noqa: BLE001
                pass

    def open(self):
        self.cli = MqttClient(self.host, self.port, self.client_id, tls=self.tls).connect()
        return {}

    def stop(self):
        """Signal, and let the thread close its own socket.

        Closing it from here yanks the descriptor out from under a `messages()` call
        that is mid-read, which surfaces as a spurious "Bad file descriptor" on every
        ordinary disconnect.
        """
        self.alive = False
        if not self.is_alive():
            self._shut()


def tls_context(ca, cert, key, tmp):
    """An SSLContext from PEM text. load_cert_chain wants files, so files it gets."""
    def write(text, suffix):
        fd, path = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, "w") as f:
            f.write(text)
        tmp.append(path)
        return path

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE          # the printer's cert names an internal host
    if ca:
        ctx.load_verify_locations(write(ca, ".ca.pem"))
    if cert and key:
        ctx.load_cert_chain(write(cert, ".crt.pem"), write(key, ".key.pem"))
    return ctx


# ----------------------------------------------------------------------------- host


class PreprintJob:
    """Orca's half of the print dialog, read out of a real sliced .gcode.

    The dialog asks Orca four things about the job - which file, what filaments it needs,
    whether the preset matches the machine, and where to fetch the packaged file - and
    outside Orca there is no sliced plate to ask. There IS a .gcode, and Orca's own
    slicer wrote everything the dialog wants into its trailing comment block:

        ; filament_type = PLA;PLA;PETG;ABS
        ; filament colour = #E03131;#1971C2;...
        ; filament used [g] = 12.40,9.10,...
        ; nozzle_diameter = 0.4,0.4,0.4,0.4
        ; estimated printing time (normal mode) = 1h 13m 32s
        ; printer_model = Snapmaker U1
        ; thumbnail begin 512x512 ...  (base64, one comment per line)

    So this parses rather than invents, which is the difference between exercising the
    dialog and exercising a fixture. A field the file does not carry is left out of the
    reply, exactly as the C++ leaves it out - `sw_GetFileFilamentMapping` builds its
    response key by key from whatever the config has.
    """

    # `; key = value` at the end of an Orca/PrusaSlicer gcode.
    _KV = re.compile(r"^;\s*([^=;]+?)\s*=\s*(.*)$")

    def __init__(self, path, log=_log):
        self.path = os.path.abspath(path)
        self.log = log
        self.name = os.path.basename(self.path)
        self.size = os.path.getsize(self.path)
        self.meta, self.thumbnails, self.ace_plan = self._parse()
        self.zip_path = None
        # What the page reported through the close protocol, so a drive script can read
        # back what the dialog actually said rather than trusting that it said it.
        self.preprint_status = None
        self.mapping_outcome = None
        self.closed = False
        self.started_with = None

    # ---- parsing ---------------------------------------------------------

    def _parse(self):
        """Read the trailing comment block and any embedded thumbnails.

        Only the tail is read: a sliced plate is tens of megabytes of moves and the
        metadata is in the last few kilobytes. The thumbnails are near the HEAD, so
        they get their own bounded scan.
        """
        meta = {}
        with open(self.path, "rb") as fh:
            fh.seek(max(0, self.size - 65536))
            tail = fh.read().decode("utf-8", "replace")
        for line in tail.splitlines():
            m = self._KV.match(line)
            if m:
                meta[m.group(1).strip()] = m.group(2).strip()

        thumbs = []
        with open(self.path, "rb") as fh:
            head = fh.read(2 * 1024 * 1024).decode("utf-8", "replace")
        cur = None
        for line in head.splitlines():
            t = line.strip()
            if t.startswith("; thumbnail begin"):
                bits = t.split()
                dims = bits[3] if len(bits) > 3 else "0x0"
                w, _, h = dims.partition("x")
                cur = {"w": w, "h": h, "b64": []}
            elif t.startswith("; thumbnail end"):
                if cur:
                    thumbs.append(cur)
                cur = None
            elif cur is not None and t.startswith(";"):
                cur["b64"].append(t[1:].strip())
        return meta, thumbs, self._parse_plan(head)

    # `; multiACE plan: T0:H3S3 T1:H3S0 … swaps:300 optimal:1`
    _PLAN_STEP = re.compile(r"\bT(\d+):H(\d+)S(\d+)\b")
    _PLAN_SWAPS = re.compile(r"\bswaps:(\d+)\b")
    # The preload block the emitter writes at the top, one line per ACE-fed head.
    _PRELOAD = re.compile(r"^ACE_SWAP_HEAD\s+HEAD=(\d+)\s+ACE=(\d+)", re.M)

    def _parse_plan(self, head):
        """The ACE plan, out of the file's OWN header.

        The emitter writes one summary line - `T<filament>:H<head>S<slot>` per filament,
        plus `swaps:` and `optimal:` - and a preload block of `ACE_SWAP_HEAD HEAD=h ACE=u
        SLOT=0` immediately after it, one line per ACE-fed head. Between them that is the
        whole plan, and it is read here rather than invented: the same discipline the rest
        of this class follows for the filament list and the thumbnails.

        A head that appears in a preload line is ACE-fed and the line says which unit; any
        other head carrying filament is on its stock feeder. `ace_plan` in the page's
        shape is a straight rearrangement of those two facts.

        Returns None when the file has no plan, which is every plate this branch's slicer
        can produce - and then the popup is the four-card dialog, as it should be.
        """
        line = None
        for raw in head.splitlines():
            if raw.startswith("; multiACE plan:") and "{" not in raw:
                line = raw
                break
        if not line:
            return None
        steps = self._PLAN_STEP.findall(line)
        if not steps:
            return None

        units = {int(h): int(u) for h, u in self._PRELOAD.findall(head)}
        swaps = self._PLAN_SWAPS.search(line)

        by_head = {}
        for fil, h, s in steps:
            by_head.setdefault(int(h), []).append((int(fil), int(s)))

        heads = []
        for h in sorted(by_head):
            aced = h in units
            # Ordered by SLOT, which is the bay order and not the print order - the
            # summary does not carry the sequence, and inventing one would be a claim.
            run = sorted(by_head[h], key=lambda x: x[1] if aced else x[0])
            heads.append({
                "head": h,
                "feeder": not aced,
                "unit": units.get(h),
                "run": [({"filament": f, "unit": units[h], "slot": s} if aced
                         else {"filament": f}) for f, s in run],
            })
        plan = {"mode": "head", "heads": heads,
                "swaps": int(swaps.group(1)) if swaps else 0}
        self.log(f"[gcode] multiACE plan: {len(steps)} filaments over "
                 f"{len(heads)} heads, {plan['swaps']} swaps")
        return plan

    def _list(self, key, sep=None):
        raw = self.meta.get(key)
        if raw is None:
            return None
        # Orca writes filament_type with ';' and the numeric lists with ','.
        parts = raw.split(sep) if sep else re.split(r"[;,]", raw)
        return [p.strip() for p in parts if p.strip() != ""]

    def _seconds(self):
        """`estimated printing time (normal mode) = 1h 13m 32s` -> 4412."""
        raw = self.meta.get("estimated printing time (normal mode)") \
            or self.meta.get("estimated printing time")
        if not raw:
            return None
        total = 0
        for n, unit in re.findall(r"(\d+)\s*([dhms])", raw):
            total += int(n) * {"d": 86400, "h": 3600, "m": 60, "s": 1}[unit]
        return total or None

    # ---- what the dialog asks --------------------------------------------

    def active_file(self, is_zip=False):
        if is_zip:
            return {"file_name": os.path.splitext(self.name)[0] + ".zip",
                    "file_path": self.zip(), "origin_size": self.size, "metadata": {}}
        return {"filename": self.name, "metadata": {}}

    def filament_mapping(self):
        """`sw_GetFileFilamentMapping`'s reply, key for key as SSWCP.cpp:3039 builds it.

        PARALLEL ARRAYS. There is no `filaments[]` here and there never has been.
        """
        out = {"filename": self.name, "filepath": self.path}

        types = self._list("filament_type")
        if types:
            out["filament_type"] = types

        colors = self._list("filament colour") or self._list("filament_colour")
        if colors:
            out["filament_color_rgba"] = colors
            out["filament_color"] = [
                int(c.lstrip("#")[:6], 16) if re.fullmatch(r"#?[0-9a-fA-F]{6,8}", c) else 0
                for c in colors]

        used_g = self._list("filament used [g]", sep=",")
        if used_g:
            out["filament_weight"] = [float(x) for x in used_g]
            out["filament_weight_total"] = round(sum(out["filament_weight"]), 4)
        used_mm = self._list("filament used [mm]", sep=",")
        if used_mm:
            out["filament_used_mm"] = [float(x) for x in used_mm]

        nozzles = self._list("nozzle_diameter", sep=",")
        if nozzles:
            # The reply carries them per FILAMENT; a single-value header means one
            # nozzle for all of them, which is what the C++ ends up with too.
            n = len(types or nozzles)
            out["nozzle_diameters"] = (nozzles * n)[:n] if len(nozzles) == 1 else nozzles
            out["nozzle_info"] = sorted(set(nozzles))

        secs = self._seconds()
        if secs:
            out["estimated_time"] = secs
        model = self.meta.get("printer_model") or self.meta.get("printer_settings_id")
        if model:
            out["machine_model"] = model

        if self.thumbnails:
            t = self.thumbnails[-1]           # the largest Orca wrote
            out["thumbnails"] = [{"url": "data:image/png;base64," + "".join(t["b64"]),
                                  "width": int(t["w"] or 0), "height": int(t["h"] or 0)}]
        else:
            out["thumbnails"] = []

        # PROPOSED - `ace_plan`. No Orca sends this yet; this host can, because the file
        # itself carries it. Absent on a plate with no plan, which is what a real Orca
        # sends for every plate its slicer can currently produce.
        if self.ace_plan:
            out["ace_plan"] = self.ace_plan

        # Orca's own filament->extruder map lives in its config, which this host does not
        # have; identity is what the popup falls back to when the key is absent.
        return out

    def zip(self):
        """Package the gcode the way `generate_zip_path` / `create_zip_with_miniz` do.

        One entry, named after the DISPLAY name. Cached, because the real one is too -
        `get_or_create_zip_json` reuses an existing zip rather than rebuilding it.
        """
        if self.zip_path and os.path.exists(self.zip_path):
            return self.zip_path
        out = os.path.join(tempfile.gettempdir(),
                           os.path.splitext(self.name)[0] + ".zip")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(self.path, arcname=self.name)
        self.zip_path = out
        self.log(f"[bridge] packaged {self.name} -> {out} "
                 f"({os.path.getsize(out)} bytes)")
        return out

    def checksum(self):
        h = hashlib.sha256()
        with open(self.path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return base64.b64encode(h.digest()).decode()


class Bridge:
    def __init__(self, send, log=_log, devices=None, trace=120, gcode=None,
                 allow_print=False):
        # send(msg, as_string=True) - the WCP envelope travels as a JSON string, which
        # is what send_to_js posts; the legacy `command` messages travel as an object.
        self.send, self.log = send, log
        self.trace = trace         # how much of each command's params to log
        self.devices = devices if devices is not None else orca_devices()
        # The print dialog's Orca half. `gcode` is a real sliced file; everything the
        # dialog asks about the job is read out of it rather than invented. Without one,
        # those commands refuse in as many words - see PreprintJob.
        self.job = PreprintJob(gcode, log=log) if gcode else None
        # sw_StartLocalPrint STARTS A PRINT on a real machine. Off unless asked for.
        self.allow_print = allow_print
        # How a local path becomes a URL the page can fetch. run_webkit already serves
        # resources/ over HTTP and passes a function in; without one, sw_GetFileStream
        # says so rather than handing back a URL that goes nowhere.
        self.file_url = None
        self.clients = {}          # id -> Client
        self.subs = {}             # (client id, topic) -> [event_id]
        self.status_events = []    # from sw_SubscribeMachineState
        self.cache = {}            # the page's own key/value store; Orca only holds it
        self.cache_subs = {}       # key -> [event_id]
        self.pending = {}          # rpc id -> (seqid, deadline, cmd)
        self.engine = None
        self.sn = None
        self._n = 0
        self._rpc = int(time.time()) % 100000
        self._tmp = []
        self._lock = threading.Lock()
        self.table = json.load(open(os.path.join(DATA, "bridge-methods.json"),
                                    encoding="utf-8"))
        self.local = {
            "sw_create_mqtt_client": self._create,
            "sw_mqtt_connect": self._connect,
            "sw_mqtt_disconnect": self._disconnect,
            "sw_mqtt_subscribe": self._subscribe,
            "sw_mqtt_publish": self._publish,
            "sw_mqtt_set_engine": self._set_engine,
            "sw_SubscribeMachineState": self._sub_state,
            "sw_StopMachineStateSubscription": self._unsub_state,
            "sw_UnSubscribeMachineState": self._unsub_state,
            "sw_GetLocalDevices": self._get_devices,
            "sw_SubscribeLocalDevices": self._get_devices,
            "sw_GetConnectedMachine": self._connected_machine,
            "sw_GetUserLoginState": self._login_state,
            "sw_FileLog": self._file_log,
            "sw_SetLogLevel": lambda s, p, e: self._ok(s, {}),
            # --- what the SHIPPED bundle asks for and the reconstruction never did.
            # All Orca-side facilities rather than printer commands: subscription
            # registrations it pushes to later, a key/value store the page owns and
            # Orca only holds, and a telemetry sink.
            "sw_Connect": self._connect_device,
            "sw_Disconnect": self._disconnect_device,
            "sw_SubscribePageStateChange": self._ack_sub,
            "sw_UnsubscribePageStateChange": self._ack_sub,
            "sw_SubscribeUserLoginState": self._sub_login,
            "sw_SubscribeRecentFiles": self._sub_recent,
            "sw_GetRecentProjects": lambda s, p, e: self._ok(s, []),
            "sw_SubUserUpdatePrivacy": self._ack_sub,
            "sw_GetUserUpdatePrivacy": lambda s, p, e: self._ok(s, {"status": 1}),
            "sw_UploadEvent": lambda s, p, e: self._ok(s, {}),
            "sw_SubscribeCacheKey": self._sub_cache,
            "sw_UnsubscribeCacheKeys": self._ack_sub,
            "sw_GetCache": self._get_cache,
            "sw_SetCache": self._set_cache,
            "sw_RemoveCache": self._remove_cache,
            # ---- the print dialog's Orca half. Everything here is answered out of
            # the .gcode handed to --gcode, so the dialog sees a real plate rather than
            # a fixture; without one they refuse and say why.
            "sw_GetActiveFile": self._active_file,
            "sw_GetFileFilamentMapping": self._file_filament_mapping,
            "sw_GetFileStream": self._file_stream,
            "sw_GetPrintZip": self._print_zip,
            "sw_GetPrintLegal": self._print_legal,
            "sw_FinishPreprint": self._finish_preprint,
            "sw_SetFilamentMappingComplete": self._mapping_complete,
            "sw_FinishFilamentMapping": self._finish_mapping,
            # Orca answers this about itself, so the honest answer here is us.
            "sw_GetSoftwareInfo": lambda s, p, e: self._ok(
                s, {"version": "u1_bridge", "build_number": ""}),
        }
        # Before anything is listening: this opens sockets, and doing it from a
        # command handler would block the main loop the replies travel on - which the
        # page reads as a timeout, having waited all of 3 seconds.
        self.probe_devices()
        threading.Thread(target=self._expire, daemon=True).start()

    # ---- to the page ----------------------------------------------------

    def _ok(self, seqid, data=None):
        self.send({"header": {"seqid": str(seqid)},
                   "payload": {"code": OK, "message": "", "data": {} if data is None else data}})

    def _err(self, seqid, code, message):
        self.log(f"[bridge] -> {message}")
        self.send({"header": {"seqid": str(seqid)},
                   "payload": {"code": code, "message": message, "data": None}})

    def _push(self, event_id, data):
        # A push carries event_id and NO seqid; the client keys on exactly that.
        self.send({"header": {"event_id": event_id},
                   "payload": {"code": OK, "message": "", "data": data}})

    def _settle(self, future, seqid, shape=lambda r: {}):
        def done(f):
            try:
                self._ok(seqid, shape(f.result()))
            except Exception as e:                                   # noqa: BLE001
                self._err(seqid, -1, str(e))
        future.add_done_callback(done)

    # ---- from the page --------------------------------------------------

    def handle(self, text):
        try:
            packet = json.loads(text)
            seqid = packet["header"]["seqid"]
            p = packet["payload"]
            cmd = p["cmd"]
        except Exception as e:                                       # noqa: BLE001
            self.log(f"[bridge] unparseable packet: {e}")
            return
        params = p.get("params") or {}
        event_id = p.get("event_id")
        # sw_FileLog travels over the bridge being watched; logging it is a feedback loop
        if cmd != "sw_FileLog":
            self.log(f"[bridge] {cmd} {json.dumps(params)[:self.trace]}")

        fn = self.local.get(cmd)
        if fn:
            try:
                fn(seqid, params, event_id)
            except Exception as e:                                   # noqa: BLE001
                self._err(seqid, -1, f"{cmd}: {e}")
            return

        if cmd in REFUSED:
            return self._err(seqid, -1, f"{cmd}: {REFUSED[cmd]}")

        # The one command on this host that MOVES A MACHINE. Everything else here reads,
        # lists or subscribes; this one starts a print, and a suite that can start a
        # print is a suite that will, on somebody's bed, at 3am. Off unless asked for.
        if cmd in ("sw_StartLocalPrint", "sw_StartCloudPrint") and not self.allow_print:
            return self._err(seqid, -1,
                             f"{cmd} would START A PRINT on the real machine. "
                             f"Pass --allow-print to let it through; without it the "
                             f"dialog's send path is exercised right up to this point.")
        if cmd == "sw_StartLocalPrint":
            # Its own precondition, enforced here too - a host that accepted `{}` is how
            # the reconstruction came to send `{}` and never find out.
            if params.get("type") is None or params.get("path") is None:
                return self._err(seqid, -1, "param [type] or [path] required!")
            if self.job:
                self.job.started_with = {"type": params.get("type"),
                                         "path": params.get("path")}

        entry = self.table.get(cmd)
        if entry and entry.get("method"):
            self._call(seqid, cmd, entry, params)
            return
        why = (entry or {}).get("why", "not dispatched by Orca either")
        self._err(seqid, -1, f"{cmd} is answered inside Orca, not by the printer ({why})")

    # ---- transport ------------------------------------------------------

    def _create(self, seqid, params, event_id):
        addr = params.get("server_address") or ""
        _, _, rest = addr.partition("://")
        host, _, port = rest.partition(":")
        ca, cert, key = (params.get(k) or "" for k in ("ca", "cert", "key"))
        # TLS is decided by the CREDENTIALS, not the scheme - `if (ca != "" && cert !=
        # "" && key != "")` in sw_create_mqtt_client. The shipped bundle asks for
        # `mqtt://<ip>:8883`, plain scheme on the TLS port, and expects a TLS client
        # back; reading the scheme instead opened a bare socket against a TLS listener.
        secure = bool(ca and cert and key)
        tls = tls_context(ca, cert, key, self._tmp) if secure else None
        self._n += 1
        cid = f"c{self._n}"
        client_id = params.get("clientId") or params.get("clientid") or f"orca-{cid}"
        self.clients[cid] = Client(cid, host, int(port or (8883 if secure else 1883)),
                                   client_id, tls, self._on_mqtt, self.log)
        self.log(f"[bridge] client {cid} = {host}:{port} "
                 f"{'TLS' if secure else 'plain'} as {client_id}")
        self._ok(seqid, {"type": "mqtt", "id": cid})

    def _client(self, params):
        c = self.clients.get(params.get("id"))
        if not c:
            raise KeyError(f"unknown client id {params.get('id')!r}")
        return c

    def _connect(self, seqid, params, event_id):
        c = self._client(params)
        if not c.is_alive():
            c.start()
        self._settle(c.submit(lambda _: c.open()), seqid)

    def _disconnect(self, seqid, params, event_id):
        c = self.clients.pop(params.get("id"), None)
        if c:
            c.stop()
        self._ok(seqid, {})

    def _subscribe(self, seqid, params, event_id):
        c = self._client(params)
        topic, qos = params["topic"], int(params.get("qos", 1))
        if event_id:
            self.subs.setdefault((c.cid, topic), []).append(event_id)
        self._settle(c.submit(lambda cli: cli.subscribe(topic, qos)),
                     seqid, lambda r: {"topic": topic})

    def _publish(self, seqid, params, event_id):
        c = self._client(params)
        topic, payload = params["topic"], params.get("payload", "")
        qos = int(params.get("qos", 1))
        self._settle(c.submit(lambda cli: cli.publish(topic, payload, qos)), seqid)

    def _set_engine(self, seqid, params, event_id):
        # SSWCP.cpp:6643 hardcodes `bool res = true;` - Orca connects nothing here and
        # expects an already-connected engine. Matching that exactly, including the
        # part where it cannot fail.
        self.engine = self.clients.get(params.get("engine_id"))
        self.sn = params.get("sn")
        self.log(f"[bridge] engine = {params.get('engine_id')} sn = {self.sn}")
        self._ok(seqid, {"result": True})

    # ---- machine state --------------------------------------------------

    def _sub_state(self, seqid, params, event_id):
        if event_id and event_id not in self.status_events:
            self.status_events.append(event_id)
        self._ok(seqid, {})

    def _unsub_state(self, seqid, params, event_id):
        self.status_events.clear()
        self._ok(seqid, {})

    # ---- a session of the host's own -------------------------------------

    def self_connect(self):
        """Bring up an mTLS session this host owns, and attach it as the engine.

        Orca keeps its own connection to the printer - `get_connect_host()` - which is
        what answers sw_GetMachineState and every other printer command. It is NOT the
        MQTT clients the page creates: the shipped bundle makes its own and never calls
        sw_mqtt_set_engine, because in Orca there is already a host attached.

        The reconstruction hands one over instead, which is why this was never needed
        until the bundle ran. Same connect path either way, just driven from here:
        LAN auth on :1884 for keys, then mTLS on the port the printer names.
        """
        dev = next((d for d in self.devices if d.get("connected")), None)
        if not dev or self.engine:
            return
        ip, sn = dev.get("ip"), dev.get("sn")
        client_id = dev.get("clientId") or f"orca-{sn}"
        try:
            sys.path.insert(0, HERE)
            from u1_probe import Session                              # noqa: PLC0415
            sess = Session(ip, sn, client_id, verbose=False)
            self.log(f"[bridge] host session: asking {ip} for keys")
            auth = sess.request_keys()
            port = int(auth.get("port") or 8883)

            self._n += 1
            cid = f"h{self._n}"
            tls = tls_context(auth.get("ca"), auth.get("cert"), auth.get("key"),
                              self._tmp)
            c = Client(cid, ip, port, client_id, tls, self._on_mqtt, self.log)
            self.clients[cid] = c
            c.start()
            c.submit(lambda _: c.open()).result(20)
            for suffix in ("status", "response", "notification"):
                c.submit(lambda cli, t=f"{sn}/{suffix}": cli.subscribe(t, 1)).result(10)
            self.sn = sn
            self.engine = c
            self.log(f"[bridge] host session up on {ip}:{port} as engine {cid}")
        except Exception as e:                                       # noqa: BLE001
            self.log(f"[bridge] host session failed: {e}")

    # ---- what the shipped bundle needs ----------------------------------

    def _disconnect_device(self, seqid, params, event_id):
        """Orca drops its own host here. The page calls it before making its own."""
        self.log(f"[bridge] host session released ({params.get('dev_id')})")
        self._ok(seqid, {})

    def _connect_device(self, seqid, params, event_id):
        threading.Thread(target=self.self_connect, daemon=True).start()
        self._ok(seqid, {})


    def _ack_sub(self, seqid, params, event_id):
        """A subscription Orca registers and pushes to later. Registering is the whole
        contract; a page that never gets a push is a page nothing changed for."""
        self._ok(seqid, {})

    def _sub_login(self, seqid, params, event_id):
        self._ok(seqid, {"status": "offline"})

    def _sub_recent(self, seqid, params, event_id):
        self._ok(seqid, [])

    def _sub_cache(self, seqid, params, event_id):
        keys = params.get("keys") or params.get("key") or []
        if isinstance(keys, str):
            keys = [keys]
        for k in keys:
            self.cache_subs.setdefault(str(k), []).append(event_id)
        self._ok(seqid, {})

    def _get_cache(self, seqid, params, event_id):
        """`{keys: [...]}` in, an ARRAY out, positionally, `{}` for anything missing.

        The store is `SSWCP_Instance::m_wcp_cache`, a static held in memory and shared
        by every surface Orca opens - not a file, and not seeded. `deviceList` and
        `deviceFilamentInfo` get there because a page PUT them there; the Device tab
        only reads them. That is why opening the Device tab on its own leaves it with
        no device: in Orca as much as here, nothing has written the list yet.
        """
        keys = params.get("keys")
        if not isinstance(keys, list) or not keys:
            return self._err(seqid, -1, "sw_GetCache wants a non-empty keys array")
        self._ok(seqid, [self.cache.get(str(k), {}) for k in keys])

    def _set_cache(self, seqid, params, event_id):
        """`{objects: [{key, value}, ...]}`.

        Orca uses `m_wcp_cache.insert(...)`, which does NOT overwrite an existing key -
        so a second write of the same key is dropped while its notification still goes
        out with the new value. That is faithfully reproduced: a host standing in for
        Orca has to be wrong in the same places, or it is testing something else.
        """
        objects = params.get("objects")
        if not isinstance(objects, list) or not objects:
            return self._err(seqid, -1, "sw_SetCache wants a non-empty objects array")
        for o in objects:
            key, value = str(o.get("key", "")), o.get("value")
            self.cache.setdefault(key, value)          # insert(), not assignment
            self.log(f"[bridge] cache {key} = {json.dumps(value)[:120]}")
            # The notification carries the value that was offered, whether or not the
            # store took it, and is shaped { <key>: <value> } - keyed by name.
            for ev in self.cache_subs.get(key, []):
                self._push(ev, {key: value})
        self._ok(seqid, {})

    def _remove_cache(self, seqid, params, event_id):
        for k in (params.get("keys") or []):
            self.cache.pop(str(k), None)
        self._ok(seqid, {})

    # ---- the device book ------------------------------------------------

    def probe_devices(self):
        """Say which saved devices are actually there.

        `connected` is what the shipped bundle gates on: sw_GetConnectedMachine returns
        the first device carrying it, and with no device the page sits at `sn=` and
        never starts the session it would otherwise drive itself. Orca sets the flag
        when Orca has a connection; this host sets it when the machine answers a
        socket, which is the same claim made on evidence it can actually check.
        """
        for d in self.devices:
            up = reachable(d.get("ip"), d.get("port"))
            d["connected"] = up
            self.log(f"[bridge] {d.get('dev_name')} at {d.get('ip')}: "
                     f"{'reachable' if up else 'not answering'}")

    # ---- the print dialog's Orca half -----------------------------------
    #
    # These are answered by ORCA, never by the printer, so none of them is forwarded and
    # none comes back in a JSON-RPC envelope. What they say about the JOB comes out of
    # the real .gcode passed to --gcode. Without one they refuse in as many words: to
    # the page a silent refusal and an unimplemented command look identical, and being
    # able to tell them apart is the whole point of running outside Orca.

    def _need_job(self, seqid, cmd):
        if self.job:
            return True
        self._err(seqid, -1,
                  f"{cmd} needs a sliced plate, which lives inside Orca. "
                  f"Pass --gcode <file.gcode> to answer it from a real one.")
        return False

    def _active_file(self, seqid, params, event_id):
        if not self._need_job(seqid, "sw_GetActiveFile"):
            return
        self._ok(seqid, self.job.active_file(bool(params.get("is_zip"))))

    def _file_filament_mapping(self, seqid, params, event_id):
        if not self._need_job(seqid, "sw_GetFileFilamentMapping"):
            return
        reply = self.job.filament_mapping()
        self.log(f"[bridge] mapping: {len(reply.get('filament_type') or [])} filament(s), "
                 f"{len(reply.get('thumbnails') or [])} thumbnail(s)")
        self._ok(seqid, reply)

    def _file_stream(self, seqid, params, event_id):
        """The right door for the file: a URL, a size and a SHA-256.

        Orca returns a localhost URL on its own page server. This host serves the zip
        over the same HTTP server the page itself came from - run_webkit passes one in -
        so the page's `fetch` works unchanged.
        """
        if not self._need_job(seqid, "sw_GetFileStream"):
            return
        want_zip = bool(params.get("is_zip"))
        path = self.job.zip() if want_zip else self.job.path
        name = os.path.basename(path)
        if not self.file_url:
            self._err(seqid, -1, "no local file server to hand the page a URL from")
            return
        self._ok(seqid, {"file_name": name,
                         "file_url": self.file_url(path),
                         "origin_size": os.path.getsize(path),
                         "checksum": self.job.checksum()})

    def _print_zip(self, seqid, params, event_id):
        """The other door, implemented honestly so its cost is visible.

        `m_res_data["content"] = res["zip_data"]` where zip_data is a std::vector<char>,
        which nlohmann serialises as ONE JSON INTEGER PER BYTE. This sends the same
        shape; a 12 MB zip really does cross as ~40 MB of JSON here too.
        """
        if not self._need_job(seqid, "sw_GetPrintZip"):
            return
        path = self.job.zip()
        data = open(path, "rb").read()
        self.log(f"[bridge] sw_GetPrintZip: {len(data)} bytes as a JSON array of "
                 f"integers - this is the door the dialog should NOT use")
        self._ok(seqid, {"name": os.path.basename(path), "content": list(data)})

    def _print_legal(self, seqid, params, event_id):
        """Orca compares the EDITED printer preset against the connected model.

        Outside Orca there is no edited preset; the plate's own `printer_model` is what
        it was sliced for, which is the same question asked of the file instead of the
        application.
        """
        if not self._need_job(seqid, "sw_GetPrintLegal"):
            return
        preset = self.job.meta.get("printer_model") \
            or self.job.meta.get("printer_settings_id") or ""
        connected = params.get("connected_model") or ""
        self._ok(seqid, {"preset_model": preset, "legal": preset == connected})

    # The close protocol. There is no modal to end here, so these RECORD what the page
    # reported - which is what a drive script needs to check the ordering.
    def _finish_preprint(self, seqid, params, event_id):
        if self.job:
            self.job.preprint_status = params.get("status")
        self.log(f"[bridge] sw_FinishPreprint status={params.get('status')!r}")
        self._ok(seqid, {})

    def _mapping_complete(self, seqid, params, event_id):
        status = params.get("status")
        if status not in ("success", "canceled"):
            # Orca raises a native "setting failed" dialog and records nothing.
            self._err(seqid, -1, f"setting failed (status {status!r})")
            return
        if self.job:
            self.job.mapping_outcome = status
        self.log(f"[bridge] sw_SetFilamentMappingComplete status={status!r} "
                 f"- recorded, dialog NOT closed")
        self._ok(seqid, {})

    def _finish_mapping(self, seqid, params, event_id):
        if self.job:
            self.job.closed = True
        self.log("[bridge] sw_FinishFilamentMapping - this is the one that closes it")
        self._ok(seqid, {})

    def _get_devices(self, seqid, params, event_id):
        if event_id:
            self.subs.setdefault(("__devices__", ""), []).append(event_id)
        # Orca replies with a BARE ARRAY here (m_res_data = devices).
        self._ok(seqid, self.devices)
        if event_id:
            # Orca does BOTH of these every time the device list changes, and they are
            # different channels: device_card_notify() pushes on the WCP subscription,
            # and a raw window.postMessage carries the legacy `command` shape. The
            # reconstruction reads neither - it takes the reply - so the second channel
            # went unimplemented until the shipped bundle sat at `sn=` waiting for it.
            threading.Timer(0.5, self.announce_devices).start()

    def announce_devices(self):
        """Say the device list has arrived, on both channels Orca uses.

        `sequece_id` is spelled that way in SSWCP.cpp. It is not a typo here.
        """
        for ev in self.subs.get(("__devices__", ""), []):
            self._push(ev, self.devices)
        # Orca posts this too, and it is kept for fidelity - but the Flutter bundle
        # does not listen for it: `local_devices_arrived` appears zero times in
        # main.dart.js. It is for Orca's own non-Flutter device cards.
        self.send({"command": "local_devices_arrived",
                   "sequece_id": "10001",
                   "data": self.devices}, as_string=False)

    def _connected_machine(self, seqid, params, event_id):
        conn = next((d for d in self.devices if d.get("connected")), None)
        self._ok(seqid, conn or {})

    def _login_state(self, seqid, params, event_id):
        self._ok(seqid, {"status": "offline"})

    def _file_log(self, seqid, params, event_id):
        line = str(params.get("content", ""))[:400]
        self.log(f"[page] {line}")
        self._ok(seqid, {})

    # ---- the printer ----------------------------------------------------

    def _shape(self, cmd, entry, params):
        """The parameters Orca would have sent, not the ones the page happened to send.

        Each async_ builds its params from a named handful; forwarding the page's whole
        object instead would be a different request than Orca makes. Dropped keys are
        logged rather than swallowed - a silently missing parameter is exactly the kind
        of difference that takes an afternoon to find.
        """
        if entry.get("forwarded"):
            return dict(params)
        keep = {k: params[k] for k in entry.get("params", []) if k in params}
        dropped = sorted(set(params) - set(keep))
        if dropped:
            self.log(f"[bridge] {cmd}: not forwarding {dropped} "
                     f"(Orca sends only {entry.get('params')})")
        return keep

    def _call(self, seqid, cmd, entry, params):
        if not self.engine or not self.sn:
            return self._err(seqid, -1, f"{cmd}: no engine attached yet "
                                        "(sw_mqtt_set_engine has not run)")
        with self._lock:
            self._rpc += 1
            rid = self._rpc
        body = {"jsonrpc": "2.0", "method": entry["method"], "id": rid,
                # Mandatory. Without them the printer neither answers nor errors.
                "cli_time": int(time.time()), "dev_time": -1}
        shaped = self._shape(cmd, entry, params)
        if shaped:
            body["params"] = shaped          # the C++ omits an empty params too
        self.pending[rid] = (seqid, time.time() + RPC_TIMEOUT, cmd)
        topic = f"{self.sn}/request"
        eng = self.engine

        def sent(f):
            if f.exception():
                self.pending.pop(rid, None)
                self._err(seqid, -1, f"{cmd}: {f.exception()}")
        eng.submit(lambda cli: cli.publish(topic, body, 1)).add_done_callback(sent)

    def _on_mqtt(self, cid, topic, raw):
        """Called on a client's own thread for every message that arrives."""
        text = raw.decode("utf-8", "replace")

        # raw subscriptions get the {topic, data} shape Orca pushes, data still a string
        for ev in self.subs.get((cid, topic), []):
            self._push(ev, {"topic": topic, "data": text})

        if not self.sn:
            return
        try:
            msg = json.loads(text)
        except Exception:                                            # noqa: BLE001
            return
        if not isinstance(msg, dict):
            return

        if topic == f"{self.sn}/response":
            got = self.pending.pop(msg.get("id"), None)
            if got:
                if self.trace > 1000:
                    err = msg.get("error")
                    body = json.dumps(msg.get("result", msg))
                    self.log(f"[bridge] <- {got[2]} "
                             + (f"ERROR {json.dumps(err)}" if err
                                else f"{len(body)}B {body[:400]}"))
                # Orca RESHAPES a printer reply before the page sees it -
                # Moonraker_Mqtt::on_response_arrived, the `passthrough == false` arm,
                # which every ordinary command takes:
                #
                #     {"data": <the JSON-RPC result>, "method": <method or "">}
                #
                # not the raw envelope. The shipped bundle reads `status` off that one
                # level down and calls the envelope an error - which is what left it
                # showing a single toolhead while holding all four.
                out = {"method": msg.get("method", "")}
                if "result" in msg:
                    out["data"] = msg["result"]
                elif "error" in msg:
                    # An RPC error still arrives as a SUCCESSFUL bridge reply whose
                    # data carries the error; the bridge decided the command was sent.
                    out["error"] = msg["error"]
                self._ok(got[0], out)
            return

        if topic in (f"{self.sn}/status", f"{self.sn}/notification"):
            # Moonraker_Mqtt::on_status_arrived, field for field.
            if "params" in msg:
                data = msg["params"]
            elif isinstance(msg.get("result"), dict) and "status" in msg["result"]:
                data = msg["result"]["status"]
            else:
                return
            for ev in list(self.status_events):
                self._push(ev, {"data": data, "method": msg.get("method", "")})

    def _expire(self):
        while True:
            time.sleep(0.5)
            now = time.time()
            for rid, (seqid, deadline, cmd) in list(self.pending.items()):
                if now > deadline:
                    self.pending.pop(rid, None)
                    # Orca's exact shape: handle_general_fail(-2, "time out"). The page
                    # keys on both, so inventing a friendlier message here would make
                    # this host behave differently from the one it stands in for. The
                    # detail goes to the terminal instead.
                    self.log(f"[bridge] {cmd} (rpc {rid}) got no reply in "
                             f"{RPC_TIMEOUT:.0f}s")
                    self._err(seqid, -2, "time out")

    # ---- teardown -------------------------------------------------------

    def stop(self):
        for c in list(self.clients.values()):
            c.stop()
        self.clients.clear()
        for p in self._tmp:
            try:
                os.unlink(p)
            except OSError:
                pass
        self._tmp = []
