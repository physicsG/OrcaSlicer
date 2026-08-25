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
import os
import queue
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

class Bridge:
    def __init__(self, send, log=_log, devices=None):
        self.send, self.log = send, log
        self.devices = devices if devices is not None else orca_devices()
        self.clients = {}          # id -> Client
        self.subs = {}             # (client id, topic) -> [event_id]
        self.status_events = []    # from sw_SubscribeMachineState
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
            # Orca answers this about itself, so the honest answer here is us.
            "sw_GetSoftwareInfo": lambda s, p, e: self._ok(
                s, {"version": "u1_bridge", "build_number": ""}),
        }
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
            self.log(f"[bridge] {cmd} {json.dumps(params)[:120]}")

        fn = self.local.get(cmd)
        if fn:
            try:
                fn(seqid, params, event_id)
            except Exception as e:                                   # noqa: BLE001
                self._err(seqid, -1, f"{cmd}: {e}")
            return

        if cmd in REFUSED:
            return self._err(seqid, -1, f"{cmd}: {REFUSED[cmd]}")

        entry = self.table.get(cmd)
        if entry and entry.get("method"):
            self._call(seqid, cmd, entry, params)
            return
        why = (entry or {}).get("why", "not dispatched by Orca either")
        self._err(seqid, -1, f"{cmd} is answered inside Orca, not by the printer ({why})")

    # ---- transport ------------------------------------------------------

    def _create(self, seqid, params, event_id):
        addr = params.get("server_address") or ""
        scheme, _, rest = addr.partition("://")
        host, _, port = rest.partition(":")
        secure = scheme == "mqtts"
        tls = None
        if secure:
            tls = tls_context(params.get("ca"), params.get("cert"), params.get("key"),
                              self._tmp)
        self._n += 1
        cid = f"c{self._n}"
        client_id = params.get("clientId") or params.get("clientid") or f"orca-{cid}"
        self.clients[cid] = Client(cid, host, int(port or (8883 if secure else 1883)),
                                   client_id, tls, self._on_mqtt, self.log)
        self.log(f"[bridge] client {cid} = {scheme}://{host}:{port} as {client_id}")
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

    # ---- the device book ------------------------------------------------

    def _get_devices(self, seqid, params, event_id):
        # Orca replies with a BARE ARRAY here (m_res_data = devices).
        self._ok(seqid, self.devices)

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
                # Orca hands the printer's reply to the page STILL WRAPPED in its
                # JSON-RPC envelope (SSWCP.cpp:946 puts m_res_data straight into
                # payload.data). The page unwraps it itself. Do not help.
                self._ok(got[0], msg)
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
