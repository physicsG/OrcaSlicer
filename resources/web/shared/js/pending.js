/*
 * pending.js - hold what was asked for until the machine says it happened.
 *
 * The bug this exists to stop has now been found three times, in three unrelated
 * controls, and it is always the same sentence: **the request was stored in the thing
 * that mirrors the machine**, so the next state push wrote the pre-click value back over
 * what the user had just asked for.
 *
 *   - tool selection  - the click's own re-render put the old tool back
 *   - a temperature   - the push lands ~1s after the commit and the printer echoes in
 *                       552-1516ms, so a set target vanished or came back as 0
 *   - the chamber LED - measured over three runs against the printer: the echo took
 *                       236ms, 2029ms and 620ms, and the switch reverted to its old
 *                       value in two of the three
 *
 * Each was fixed on the spot with its own mechanism - a blocking dialog and a poll loop
 * in one case, DOM datasets and timers in another, nothing at all in the third. This is
 * the one mechanism, so the fourth control gets it for free.
 *
 * A pending request has exactly three ends:
 *
 *   confirmed  the machine reports the value that was asked for. Stop holding it.
 *   refused    the command itself failed. Stop immediately - there is nothing coming.
 *   lost       the command succeeded and the machine never reported the change. This is
 *              the dangerous one and the reason a timeout exists at all: an instant `ok`
 *              is indistinguishable from success, so a silently-ignored setpoint looks
 *              exactly like an applied one. It is reported, not hidden.
 *
 * Nothing here touches the DOM, so it runs in JavaScriptCore under unit_jsc.py against
 * whatever clock the test hands it.
 *
 * SHARED by both surfaces. The print dialog holds a filament assignment with it for
 * exactly the reason above: the machine echoes `print_task_config` a second later.
 */
'use strict';

/**
 * How long a sent value may go unechoed before the control stops claiming it.
 *
 * The bridge gives a command 15s; a control gives the machine 10s to report the result.
 * The shorter clock is deliberate - a request that is still in flight has not been lost,
 * and the command's own failure path stops the wait sooner than this ever will.
 */
export const CONFIRM_MS = 10000;

/** How long a control keeps saying a value did not take, before going quiet. */
export const LOST_MS = 8000;

/**
 * One value asked for, and the machine's answer.
 *
 * `state` is the vocabulary the rest of the page reads:
 *   ''      nothing outstanding; show the machine
 *   'sent'  waiting; show `asked`
 *   'lost'  it did not take; show the machine, and say which value was dropped
 */
export class Pending {
  /**
   * `onChange` fires when a request starts or is refused - the two moments the page has
   * something new to show and nothing on the stream to prompt a repaint. It is
   * deliberately NOT fired from `resolve`, which runs *inside* a repaint: a confirmation
   * that scheduled another repaint would never stop.
   */
  constructor({ confirmMs = CONFIRM_MS, lostMs = LOST_MS,
                now = () => Date.now(), onChange = null } = {}) {
    this.confirmMs = confirmMs;
    this.lostMs = lostMs;
    this.now = now;
    this.onChange = onChange;
    this.entries = new Map();
  }

  /** Record that `value` was asked for, replacing anything already outstanding. */
  set(key, value) {
    this.entries.set(key, { asked: value, at: this.now(), state: 'sent', until: 0 });
    if (this.onChange) this.onChange(key);
    return value;
  }

  /**
   * Give up on `value`, and say so.
   *
   * Guarded on the value still being the one outstanding: a refusal that arrives after
   * the user has moved on must not overwrite what they moved on to.
   */
  fail(key, value) {
    const e = this.entries.get(key);
    if (!e || e.state !== 'sent' || !same(e.asked, value)) return;
    e.state = 'lost';
    e.until = this.now() + this.lostMs;
    if (this.onChange) this.onChange(key);
  }

  /** Confirm without waiting for the mirror - for a control the machine cannot echo. */
  clear(key) { this.entries.delete(key); }

  /**
   * Wire a command's outcome in.
   *
   * `send()` resolves false rather than rejecting, so both shapes are handled: a false
   * resolution and a rejection mean the same thing to a control.
   */
  track(key, value, sent) {
    this.set(key, value);
    if (!sent || typeof sent.then !== 'function') return sent;
    return sent.then(
      (ok) => { if (ok === false) this.fail(key, value); return ok; },
      (e) => { this.fail(key, value); throw e; },
    );
  }

  /**
   * The tick: what should this control show, now that the machine reports `mirror`?
   *
   * Called on every frame, and it is where the state machine advances - a confirmation
   * and an expiry are both things that happen when a value is next looked at, not on a
   * timer of their own.
   */
  resolve(key, mirror) {
    const e = this.entries.get(key);
    if (!e) return { value: mirror, state: '', asked: undefined };

    const t = this.now();
    if (e.state === 'sent') {
      if (same(e.asked, mirror)) {
        this.entries.delete(key);
        return { value: mirror, state: '', asked: undefined };
      }
      if (t - e.at > this.confirmMs) {
        e.state = 'lost';
        e.until = t + this.lostMs;
      } else {
        return { value: e.asked, state: 'sent', asked: e.asked };
      }
    }
    if (t > e.until) {
      this.entries.delete(key);
      return { value: mirror, state: '', asked: undefined };
    }
    // Still saying it was dropped, but showing the machine: the value on screen must be
    // true even while the message explains why it is not what was asked for.
    return { value: mirror, state: 'lost', asked: e.asked };
  }

  /** Is anything outstanding for this key? Cheap, and does not advance the machine. */
  waiting(key) {
    const e = this.entries.get(key);
    return !!e && e.state === 'sent';
  }
}

/**
 * Machine values arrive as whatever the wire carried, so 200 and "200" are the same
 * answer and `Object.is` would go on waiting for one of them forever.
 */
function same(a, b) {
  if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return a === b;
}
