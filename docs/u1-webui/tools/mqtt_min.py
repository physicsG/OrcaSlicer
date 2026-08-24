"""A minimal MQTT 3.1.1 client, enough to talk to a U1.

paho-mqtt is not available here and there is no pip, so this implements the four
packet types the connect path needs: CONNECT, SUBSCRIBE, PUBLISH and PINGREQ. It is
deliberately small and synchronous - a probe, not a library.

Both transports the U1 uses are supported: plain TCP for the :1884 authorisation leg
and mTLS for the :8883 session.
"""

import json
import socket
import ssl
import struct
import time

CONNECT, CONNACK, PUBLISH, PUBACK = 1, 2, 3, 4
SUBSCRIBE, SUBACK, PINGREQ, PINGRESP, DISCONNECT = 8, 9, 12, 13, 14

CONNACK_ERRORS = {
    1: "unacceptable protocol version",
    2: "identifier rejected",
    3: "server unavailable",
    4: "bad username or password",
    5: "not authorised",
}


def _rem_len(n):
    """MQTT's variable byte integer."""
    out = bytearray()
    while True:
        b = n % 128
        n //= 128
        if n:
            b |= 0x80
        out.append(b)
        if not n:
            return bytes(out)


def _str(s):
    b = s.encode("utf-8")
    return struct.pack("!H", len(b)) + b


class MqttError(Exception):
    pass


class MqttClient:
    """One connection. Not thread-safe; the probe drives it from a single loop."""

    def __init__(self, host, port, client_id, tls=None, keepalive=30):
        self.host, self.port, self.client_id = host, port, client_id
        self.tls, self.keepalive = tls, keepalive
        self.sock = None
        self.buf = b""
        self.pid = 0
        self.last_sent = 0.0

    # -- wire ------------------------------------------------------------

    def _next_pid(self):
        self.pid = self.pid % 65535 + 1
        return self.pid

    def _send(self, ptype, flags, payload):
        pkt = bytes([ptype << 4 | flags]) + _rem_len(len(payload)) + payload
        self.sock.sendall(pkt)
        self.last_sent = time.time()

    def _recv_packet(self, timeout):
        """Return (type, flags, body) or None on timeout."""
        deadline = time.time() + timeout
        while True:
            # a complete packet may already be buffered
            if len(self.buf) >= 2:
                n, mult, i = 0, 1, 1
                while True:
                    if i >= len(self.buf):
                        i = None
                        break
                    b = self.buf[i]
                    n += (b & 0x7F) * mult
                    i += 1
                    if not b & 0x80:
                        break
                    mult *= 128
                    if mult > 128 ** 3:
                        raise MqttError("malformed remaining length")
                if i is not None and len(self.buf) >= i + n:
                    head = self.buf[0]
                    body = self.buf[i:i + n]
                    self.buf = self.buf[i + n:]
                    return head >> 4, head & 0x0F, body

            left = deadline - time.time()
            if left <= 0:
                return None
            self.sock.settimeout(min(left, 1.0))
            try:
                chunk = self.sock.recv(65536)
            except socket.timeout:
                self._maybe_ping()
                continue
            except ssl.SSLWantReadError:
                continue
            if not chunk:
                raise MqttError("connection closed by peer")
            self.buf += chunk

    def _maybe_ping(self):
        if self.keepalive and time.time() - self.last_sent > self.keepalive / 2:
            self._send(PINGREQ, 0, b"")

    # -- session ---------------------------------------------------------

    def connect(self, clean_session=False, timeout=15):
        raw = socket.create_connection((self.host, self.port), timeout=timeout)
        self.sock = self.tls.wrap_socket(raw, server_hostname=self.host) if self.tls else raw

        flags = 0x02 if clean_session else 0x00
        payload = (_str("MQTT") + bytes([4, flags]) + struct.pack("!H", self.keepalive)
                   + _str(self.client_id))
        self._send(CONNECT, 0, payload)

        pkt = self._recv_packet(timeout)
        if not pkt:
            raise MqttError("no CONNACK")
        ptype, _, body = pkt
        if ptype != CONNACK or len(body) < 2:
            raise MqttError(f"expected CONNACK, got packet type {ptype}")
        if body[1]:
            raise MqttError(f"CONNACK refused: {CONNACK_ERRORS.get(body[1], body[1])}")
        return self

    def subscribe(self, topic, qos=1, timeout=10):
        pid = self._next_pid()
        self._send(SUBSCRIBE, 0x02, struct.pack("!H", pid) + _str(topic) + bytes([qos]))
        deadline = time.time() + timeout
        held = []
        while time.time() < deadline:
            pkt = self._recv_packet(deadline - time.time())
            if not pkt:
                break
            if pkt[0] == SUBACK:
                for h in held:                      # keep anything that raced in
                    self._stash(h)
                if pkt[2][2:3] == b"\x80":
                    raise MqttError(f"subscribe refused: {topic}")
                return True
            held.append(pkt)
        raise MqttError(f"no SUBACK for {topic}")

    _pending = None

    def _stash(self, pkt):
        if self._pending is None:
            self._pending = []
        self._pending.append(pkt)

    def publish(self, topic, payload, qos=1):
        if isinstance(payload, (dict, list)):
            payload = json.dumps(payload)
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        head = _str(topic)
        if qos:
            head += struct.pack("!H", self._next_pid())
        self._send(PUBLISH, qos << 1, head + payload)

    def messages(self, timeout):
        """Yield (topic, payload_bytes) until timeout elapses."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            pkt = None
            if self._pending:
                pkt = self._pending.pop(0)
            else:
                pkt = self._recv_packet(deadline - time.time())
            if not pkt:
                return
            ptype, flags, body = pkt
            if ptype != PUBLISH:
                continue
            tlen = struct.unpack("!H", body[:2])[0]
            topic = body[2:2 + tlen].decode("utf-8", "replace")
            rest = body[2 + tlen:]
            qos = (flags >> 1) & 0x03
            if qos:
                pid = struct.unpack("!H", rest[:2])[0]
                rest = rest[2:]
                self._send(PUBACK, 0, struct.pack("!H", pid))
            yield topic, rest

    def close(self):
        try:
            if self.sock:
                self._send(DISCONNECT, 0, b"")
                self.sock.close()
        except Exception:
            pass
        self.sock = None
