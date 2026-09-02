/*
 * sswcp.js - client for Orca's SSWCP bridge.
 *
 * Wire format (docs: 02-bridge-sswcp/01-wire-protocol.md), recovered from the
 * Dart classes WcpPacket / RequestPayload / ResponsePayload:
 *
 *   request  { header:{seqid:"N"}, payload:{cmd, event_id, params, metadata:null} }
 *   response { header:{seqid:"N"} | {event_id:"E"}, payload:{code, message, data} }
 *
 * SUCCESS IS code 200, NOT 0. SSWCP.hpp defaults `m_status = 200` and the shipped
 * bundle compares payload.code against the literal 200 in eleven places and against
 * no other value. A client that accepts 0 rejects every real response from Orca.
 * See docs/u1-webui/04-bridge-wcp/01-envelope.md.
 *
 * A request carrying a non-null event_id becomes a subscription: Orca replies
 * once with the original seqid (the ack), then pushes N further messages keyed
 * by event_id only.
 */
'use strict';

import { PRINTER_BACKED } from './protocol.js';

/**
 * How long to wait for a reply.
 *
 * TWO clocks, because there are two very different things being waited for, and using
 * one number for both is a mistake this project has now made twice at two layers.
 *
 * A command Orca answers out of its own state comes back in milliseconds or not at all;
 * 15 s is generous. A command that reaches the PRINTER is queued, and Klipper runs
 * G-code sequentially - it answers when the queue drains, not when it is asked.
 *
 * Measured on 811002511261022618B3, with `G4` blocking the queue by a known amount and
 * nothing else running:
 *
 *     queue empty        sw_MachinePrintCancel   197 ms
 *     behind G4 P3000                           3323 ms
 *     behind G4 P6000                           6213 ms
 *
 * The round trip is the queue plus about a quarter of a second, every time. So a cancel
 * sent to a print that has just started waits for the homing move - which is exactly
 * what happened: the machine reached `cancelled` in ~10 s while the client gave up at
 * 15 and reported a failure on a cancel that had worked.
 *
 * `u1_bridge.py` learned this once already and set its own RPC_TIMEOUT to 80 s, after a
 * 31 s toolchange came back as "the printer refused the command". This is the same
 * lesson one layer up, and PRINTER_BACKED is exactly the set it applies to: those are
 * the commands whose replies come back through the printer's own envelope.
 */
const TIMEOUT_MS = 15000;          // Orca answers it, or nothing does
const PRINTER_TIMEOUT_MS = 80000;  // the printer answers it, when it gets to it

const timeoutFor = (cmd) => (PRINTER_BACKED.has(cmd) ? PRINTER_TIMEOUT_MS : TIMEOUT_MS);

/** Orca's success code. 200, not 0 - see the note above. */
export const OK_CODE = 200;

/**
 * True when a response payload.code means success.
 *
 * `200` is the real contract. `0` and absent are accepted too, but only so a
 * hand-written or older mock host does not silently fail; Orca itself never
 * sends them on a success path.
 */
export function isOk(code) {
  return code === OK_CODE || code === 0 || code === undefined || code === null;
}

/**
 * Strip the printer's JSON-RPC envelope, if there is one.
 *
 * Orca hands a printer reply to the page verbatim: `on_mqtt_msg_arrived` sets
 * `m_res_data = response` (SSWCP.cpp:1194) and `send_to_js` puts that straight into
 * `payload.data` (SSWCP.cpp:946). So a command answered by the printer resolves to
 * `{jsonrpc, result, id, cli_time, dev_time}` and the payload the caller wants is one
 * level down - while a command answered inside Orca resolves to the payload itself.
 *
 * Callers were reading fields off the envelope and getting `undefined` on hardware; the
 * simulator hid it by replying with the unwrapped result. Unwrapping once here is the
 * only place that knows about the transport, so every caller can read its own fields.
 *
 * Guarded on `jsonrpc` so a C++-answered payload that merely happens to carry a `result`
 * key is left alone. An `error` envelope is passed through untouched: the bridge has
 * already decided the command succeeded, and the caller is owed the detail.
 */
export function unwrapRpc(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  // The shape Orca ACTUALLY delivers for a printer command:
  // Moonraker_Mqtt::on_response_arrived reshapes the reply to
  // `{data: <result>, method: <name or "">}` for every target that is not
  // `passthrough`, which is all of the ordinary ones. Guarded on the pair, because a
  // payload that merely happens to carry a `data` key is not this.
  if (typeof data.method === 'string' && ('data' in data || 'error' in data)) {
    return 'data' in data ? data.data : data;
  }
  // The raw JSON-RPC envelope, which is what a `passthrough` target hands over.
  if (typeof data.jsonrpc !== 'string') return data;
  if ('result' in data) return data.result;
  return data;
}

/**
 * True when a rejection means "still working", not "refused".
 *
 * Two clocks produce one, and they are different questions:
 *
 *   the client's   this file, 15s - the page giving up on the BRIDGE
 *   Orca's         80s waiting on the PRINTER (MoonRaker.hpp:344), which fails the
 *                  request as code -2, message "time out"
 *
 * Note the space: matching only /timed out/ - the client's wording - misses Orca's
 * own. It stayed hidden because the client's clock is the shorter of the two and
 * normally fires first, so Orca's -2 arrives after the request has been forgotten.
 * A host that answers sooner brings it straight out, and a working 31s toolchange
 * gets reported as a refusal.
 *
 * Either way the machine is still moving. Telling the user to retry would be wrong.
 */
export function isTimeout(e) {
  if (!e) return false;
  return e.code === -2 || /tim(?:e|ed)\s?out/i.test(String(e.message || ''));
}

export class SswcpError extends Error {
  constructor(code, message, cmd) {
    super(`${cmd} failed (code ${code})${message ? ': ' + message : ''}`);
    this.name = 'SswcpError';
    this.code = code;
    this.cmd = cmd;
  }
}

export class Sswcp {
  constructor(options = {}) {
    this._seq = Math.floor(Date.now() % 100000);
    this._eventSeq = 0;
    this._pending = new Map();      // seqid -> {resolve, reject, timer, cmd}
    this._subs = new Map();         // event_id -> {onPush, cmd}
    this._log = options.log || (() => {});
    this._onMessage = this._onMessage.bind(this);
    window.addEventListener('message', this._onMessage);
  }

  /** True when running inside Orca's webview (or a mock that installs window.wx). */
  static hasHost() {
    return !!(window.wx && typeof window.wx.postMessage === 'function');
  }

  dispose() {
    window.removeEventListener('message', this._onMessage);
    for (const p of this._pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('bridge disposed'));
    }
    this._pending.clear();
    this._subs.clear();
  }

  _post(packet) {
    const text = JSON.stringify(packet);
    this._log('tx', packet);
    if (!Sswcp.hasHost()) throw new Error('window.wx bridge not available');
    window.wx.postMessage(text);
  }

  /** Fire a one-shot command. Resolves with payload.data. */
  request(cmd, params = {}) {
    const seqid = String(this._seq++);
    const packet = {
      header: { seqid },
      payload: { cmd, event_id: null, params, metadata: null },
    };
    const wait = timeoutFor(cmd);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(seqid);
        reject(new Error(`${cmd} timed out after ${wait}ms`));
      }, wait);
      this._pending.set(seqid, { resolve, reject, timer, cmd });
      try {
        this._post(packet);
      } catch (e) {
        clearTimeout(timer);
        this._pending.delete(seqid);
        reject(e);
      }
    });
  }

  /**
   * Start a subscription. `onPush(data, payload)` fires for every later message.
   * Resolves with { eventId, ack, cancel }.
   */
  subscribe(cmd, params = {}, onPush = () => {}) {
    const eventId = `dp_${Date.now()}_${this._eventSeq++}`;
    const seqid = String(this._seq++);
    const packet = {
      header: { seqid },
      payload: { cmd, event_id: eventId, params, metadata: null },
    };
    this._subs.set(eventId, { onPush, cmd });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(seqid);
        // The ack is best-effort: some builds push before acking. Keep the
        // subscription alive rather than tearing it down on a slow ack. A subscription
        // ack is not queued behind machine work, so it keeps the short clock.
        resolve({ eventId, ack: null, cancel: () => this.cancel(eventId) });
      }, TIMEOUT_MS);
      this._pending.set(seqid, {
        resolve: (data) => resolve({ eventId, ack: data, cancel: () => this.cancel(eventId) }),
        reject,
        timer,
        cmd,
      });
      try {
        this._post(packet);
      } catch (e) {
        clearTimeout(timer);
        this._pending.delete(seqid);
        this._subs.delete(eventId);
        reject(e);
      }
    });
  }

  cancel(eventId) {
    this._subs.delete(eventId);
  }

  _onMessage(ev) {
    let msg = ev.data;
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg); } catch { return; }
    }
    if (!msg || typeof msg !== 'object') return;
    const header = msg.header;
    const payload = msg.payload;
    if (!header || !payload) return;   // not ours

    this._log('rx', msg);

    // subscription push - keyed by event_id only
    if (header.event_id != null && !header.seqid) {
      const sub = this._subs.get(header.event_id);
      if (sub) {
        try { sub.onPush(unwrapRpc(payload.data), payload); }
        catch (e) { console.error('[sswcp] push handler threw', e); }
      }
      return;
    }

    // reply to a request (or a subscription ack)
    const seqid = header.seqid != null ? String(header.seqid) : null;
    if (seqid == null) return;
    const p = this._pending.get(seqid);
    if (!p) return;
    clearTimeout(p.timer);
    this._pending.delete(seqid);

    const code = payload.code;
    if (isOk(code)) p.resolve(unwrapRpc(payload.data));
    else p.reject(new SswcpError(code, payload.message, p.cmd));
  }
}
