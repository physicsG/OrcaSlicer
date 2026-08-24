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

const TIMEOUT_MS = 15000;

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
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(seqid);
        reject(new Error(`${cmd} timed out after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);
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
        // subscription alive rather than tearing it down on a slow ack.
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
        try { sub.onPush(payload.data, payload); }
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
    if (isOk(code)) p.resolve(payload.data);
    else p.reject(new SswcpError(code, payload.message, p.cmd));
  }
}
