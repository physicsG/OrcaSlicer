/*
 * multiACE.js - everything about multiACE, in one place.
 *
 * Named for the plugin and not for the hardware, because they are not the same thing and
 * the difference is load-bearing. The **ACE** is Snapmaker's own unit. **multiACE**
 * (github.com/decay71/multiACE) is the third-party Klipper plugin that drives up to four
 * of them, and it is what publishes the `ace` object, the macros, the override store and
 * the web service this page reads. None of it is official Snapmaker firmware: a stock U1
 * reports no `ace` object at all, which is the state the Filament panel degrades into.
 * Anything here can change with a plugin release; the ACE itself cannot.
 *
 * It lives apart from state.js because it is not one model but two, from two sources
 * that do not carry the same thing:
 *
 *   the `ace` Klipper object   topology, unit health, the dryer, occupancy, and the full
 *                              identity of what is LOADED in each head. Machine state,
 *                              read with everything else.
 *   the override store         what is in each BAY. The Klipper object carries none of
 *                              it - every raw slot reads {material:"", brand:"", rfid:0}
 *                              because these spools have no tags - and multiACE keeps
 *                              the names its own web UI shows in a file, merging them in
 *                              its `_parse_state()`. Not machine state: a file the PAGE
 *                              fetched, held in `store.aceBays`.
 *
 * The panel drew three of four bays as `?` on a machine that knew all four, because it
 * read only the first. Orca's own Prepare page polls the merged endpoint from C++ and saw
 * the names. Both were reading correctly, from two different things - which is exactly
 * why the merge, and the precedence it follows, is one function here rather than a rule
 * spread across a view and a command module.
 *
 * `MachineState.ace()` is a call into `parseAce()`, so the accessor still sits where every
 * other accessor does; the constants stay in protocol.js, which is the table of things
 * recovered from evidence. What is here is the modelling, and it is pure - no DOM, no
 * transport - so unit_jsc.py can hold the precedence rule to account in JavaScriptCore.
 */
'use strict';

import { TOOLHEADS, DEVICE, MOONRAKER_HTTP_PORT, cssColor } from './protocol.js';

/**
 * The multiACE this was written against, and verified on.
 *
 * A plugin, not firmware: `0.99.8b+9ba137e1` on a U1 running 1.5.2, publishing
 * `api_version: 1`, with `ace_bg_swap` at its own `v0.9`. Everything here can move with a
 * plugin release, which is why `parseAce()` reads defensively and why the version is
 * carried through into the model rather than only living in a comment.
 */
export const MULTIACE_VERIFIED = { web: '0.99.8b', apiVersion: 1, bgSwap: 'v0.9',
                                   on: '2026-08-26' };

/** Every ACE has four bays, whatever it is: multiACE's own SLOT_COUNT. */
const ACE_SLOTS = 4;

/**
 * How an ACE unit is drawn, in the three forms the visual standard defines.
 *
 * Lifted verbatim from `docs/ace-mmu/16-ace-visuals.md` and its interactive sheet, which
 * settled these against Orca's own `AMSItem.hpp` geometry rather than inventing them —
 * and which the C++ Prepare page draws from too. An ACE had been drawn four different
 * ways across the app; this panel had quietly made it five, with a badge of its own
 * shape. Geometry only, no DOM: a view builds the nodes, and there is one place that
 * says what an ACE looks like.
 *
 *   badge   44x26 fill  — a head box. ONE rounded body split by a hard colour stop, with
 *                         the four spools drawn LAST so none is cropped, and 4 px of
 *                         margin all round. Carries colour and emptiness only.
 *   glyph   44x26 line  — a popover row, a label. The badge's own silhouette in line: the
 *                         same body inset by half a stroke, the same bays filled.
 *   square  24x24 line  — a tab, a menu, a button: where the wide cabinet cannot go.
 *                         Deliberately NOT the same silhouette (body and bays, no hood),
 *                         because a third of the width has to say the same thing.
 *
 * Four bays is not a variable — multiACE's `SLOT_COUNT` is 4 and `slots[]` is always
 * four long — so the bay positions are a constant and not a computation.
 */
export const ACE_ART = {
  /*
   * x of each bay, in the wide forms: margin 4 == gap 4, Bambu's own proportion.
   *
   * It used to be [6, 15, 24, 33] with 5x14 bays, which is the drawing the standard calls
   * A - a narrower hood over a wider base, with the base painted OVER the bays so their
   * lower 2.5 px was cropped. The standard settled on G instead: the cabinet the Device
   * page actually draws has parallel sides and whole spools, so its portrait should too.
   * That left the margin unequal - 6 at the sides against 3.5 on top - and making it one
   * number took the width back out of the box and gave it to the spools.
   */
  bayX: [4, 14, 24, 34],
  badge: {
    w: 44, h: 26,
    /** One rounded body; the colour stop below is what makes it two halves. */
    body: { x: 0, y: 2, w: 44, h: 24, rx: 5 },
    bay: { y: 6, w: 6, h: 16, rx: 3 },
    /** The lower half, rounded at the bottom only - a stop, not a second box. */
    base: 'M0 16 h44 v5 a5 5 0 0 1 -5 5 h-34 a5 5 0 0 1 -5 -5 Z',
  },
  glyph: {
    w: 44, h: 26, stroke: 1.6,
    /** The badge's body, inset by half a stroke so 1.6 does not clip the viewBox. */
    body: { x: 0.8, y: 2.8, w: 42.4, h: 22.4, rx: 4.6 },
    bay: { y: 6, w: 6, h: 16, rx: 3 },
  },
  square: {
    w: 24, h: 24, stroke: 1.6,
    body: { x: 1.8, y: 4.4, w: 20.4, h: 15.2, rx: 3.2 },
    bay: { x0: 4.2, dx: 4.2, y: 7.4, w: 3.2, h: 9.2, rx: 1.6 },
  },
  /*
   * The badge's own neutrals, and they are the standard's own.
   *
   * These were bound to the drawn cabinet's #EEEEEE / #CECECE first, on the reasoning
   * that a badge which is a picture of the thing in the card should be the same two
   * greys. Wrong, and visibly: the cabinet sits on a white card body and the badge sits
   * on the header's #F5F6FA, where #EEEEEE all but disappears and the badge reads as four
   * bars on a plinth. The standard declares badge-specific values for exactly that
   * reason - it is 26 px tall and lands on chrome.
   */
  hood: '#E8E8E8',
  base: '#CFCFCF',
  emptyBay: '#FFFFFF',
  /** AMS_CONTROL_DISABLE_COLOUR: a unit that is configured and not answering. */
  disabled: '#CECECE',
};

/* ------------------------------------------------------------------ *
 * multiACE
 *
 * Every control on the Filament panel is a plain G-code macro with documented
 * arguments, read out of `printer.gcode.help` on the machine on 2026-08-25, and the
 * page already owns sw_SendGCodes - so none of this needs a new bridge command.
 *
 * Names only. What each one takes lives beside the call in filament-commands.js,
 * because an argument list written twice is an argument list that drifts.
 * ------------------------------------------------------------------ */
export const ACE = {
  SET_MODE:        'SET_ACE_MODE',            // MODE=normal|multi|head [HEAD=n]
  SET_HEAD_FEEDER: 'ACE_SET_HEAD_FEEDER',     // HEAD=n ENABLE=0|1   (head mode only)
  SET_HEAD_ACE:    'ACE_SET_HEAD_ACE',        // HEAD=n ACE=a        (head mode only)
  SET_HEAD_MANUAL: 'ACE_SET_HEAD_MANUAL',     // HEAD=n ENABLE=0|1
  LOAD_HEAD:       'ACE_LOAD_HEAD',           // HEAD=n [ACE=a] [SLOT=s]
  UNLOAD_HEAD:     'ACE_UNLOAD_HEAD',         // HEAD=n [RETRACT_LENGTH=] [KEEP_HEAT=]
  SWAP_HEAD:       'ACE_SWAP_HEAD',           // HEAD=n ACE=a [SLOT=s]
  DRY:             'ACE_DRY',                 // ACE=a [TEMP=C] [DURATION=MINUTES]
  // NOT ACED__DRY_STOP, which stops "the current ACE" - on a machine with two units that
  // is whichever one is active, and not necessarily the one whose chip was pressed.
  DRY_STOP:        'ACE_STOP_DRYING',         // [ACE=a]
  SET_AUTO_DRY:    'ACE_SET_AUTO_DRY',        // ACE=a ENABLE=0|1 [RH_START=%]
  UNLOAD_ALL:      'ACE_UNLOAD_ALL_HEADS',    // no arguments
  SET_PURGE:       'ACE_SET_PURGE',           // LENGTH=<mm> | RESET=1
  SET_CONFIRM:     'ACE_SET_CONFIRM_COMMANDS',// ENABLE=0|1
  SET_SPOOLMAN:    'ACE_SET_SPOOLMAN',        // URL= AUTO=0|1
  CLEAR_HEADS:     'ACE_CLEAR_HEADS',         // [HEAD=n]
  /*
   * The background family, and the gate in front of it.
   *
   * ACE_BG_SWAP's own help spells out what it needs: head mode, 1:1 wiring, an OPEN dock
   * below the head - it purges ~60 mm through it - and the head docked for the whole ~3
   * min sequence. None of that is in the `ace` object; `ace_bg_swap` is a Klipper object
   * of its own, and `enabled_heads` is the list ACE_BG_SET_HEAD writes.
   */
  BG_SWAP:         'ACE_BG_SWAP',            // HEAD=0-3 SLOT=0-3 [ACE=n] [TEMP=] ...
  BG_UNLOAD:       'ACE_BG_UNLOAD',          // HEAD=0-3 [TEMP=]
  BG_SET_HEAD:     'ACE_BG_SET_HEAD',        // HEAD=n ENABLE=0|1
};

/*
 * ------------------------------------------------------------------ *
 * What can be done to one filament, and what the machine is doing about it
 * ------------------------------------------------------------------ *
 *
 * Both settled in docs/u1-webui/02-device-page/multiace-actions.html, and both PURE, so
 * unit_jsc.py holds them to account with no DOM - the same reason the override precedence
 * lives here rather than in the panel.
 */

/** The one refusal that can be lifted, spelled once so a caller can match on it. */
/*
 * The U1's OWN feeder macro, which is not multiACE's and is here because aceVerbs() is
 * the one place that knows a head has no ACE behind it.
 *
 * A stock feeder head was being offered `ACE_LOAD_HEAD HEAD=n` with no ACE= and no SLOT=,
 * and that macro's own help says what it does: "Load a toolhead FROM ACE". There is no
 * ACE. The load was accepted and nothing happened, which is the machine's usual way of
 * saying no - `ACE_SET_AUTO_DRY THRESHOLD=` answers `ok` and changes nothing too.
 *
 * `AUTO_FEEDING EXTRUDER=n` is the wrapper the printer's own config defines: it maps the
 * extruder to a (module, channel) through `_FILAMENT_FEED_VARIABLE` and calls `FEED_AUTO`.
 * The UNLOAD form is the machine's own usage, read out of its config -
 * `SM_PRINT_END_AUTO_UNLOAD_FILAMENT` runs exactly this at the end of every print:
 *
 *     AUTO_FEEDING EXTRUDER={i} UNLOAD=1 STAGE=prepare
 *     AUTO_FEEDING EXTRUDER={i} UNLOAD=1 STAGE=doing
 *
 * `STAGE` is the same vocabulary `channel_state` reports back in - `unload_prepare`,
 * `unload_doing` - so the step bar follows a feeder verb without being told anything new.
 *
 * The LOAD form is INFERRED and is the one thing here that no macro on the machine
 * spells out: `LOAD=1` is from `SM_PRINT_AUTO_FEED` (`FEED_AUTO ... LOAD=1 PRINTING=1`)
 * and the two stages are from the unload above. Everything else on this page was settled
 * by sending it and reading the object back; this one is waiting for the same treatment.
 */
export const FEEDER = {
  FEED: 'AUTO_FEEDING',                       // EXTRUDER=n LOAD=1|UNLOAD=1 STAGE=prepare|doing
};

export const NOT_DECLARED = 'not enabled for this toolhead';

/**
 * The verbs, in the state the machine is actually in.
 *
 * The first design listed all five always and greyed whatever did not apply. That is
 * right for a verb the MACHINE is refusing - a background swap on a head nobody has
 * declared, where the reason names a macro you can send - and wrong for a verb that is
 * not a thing at all in this state. Loading a head that is already loaded is not a load,
 * it is a swap; swapping to the bay you are already fed from is a three-minute no-op.
 *
 *   not applicable here    left out. There is no reason to show for a verb that does not
 *                          exist.
 *   applicable, refused    listed, with `off` set and `cmd` naming the macro that would
 *                          lift the refusal.
 *
 * `slot` may be null, which asks "what could be done with SOME other bay" - what a menu
 * needs before a bay has been picked.
 *
 * @param ace     parseAce()'s model
 * @param head    toolhead index
 * @param slot    bay index within that head's unit, or null
 * @param loaded  whether the head holds filament. Passed in rather than read: a feeder
 *                head's answer lives in `print_task_config`, which is not multiACE's.
 */
export function aceVerbs(ace, head, slot, loaded) {
  const h = (ace.heads || [])[head];
  if (!h) return [];
  const unit = h.source === 'ace' ? (ace.units || [])[h.unitIndex] : null;
  const list = [];

  // A stock feeder has no second bay, so swap and both background verbs are not
  // operations it has - and it either holds filament or it does not, never both verbs.
  if (!unit) {
    list.push({ name: loaded ? 'Unload' : 'Load', macro: FEEDER.FEED, slotted: false,
                args: loaded ? { EXTRUDER: head, UNLOAD: 1 } : { EXTRUDER: head, LOAD: 1 },
                stages: ['prepare', 'doing'] });
    return list.map(withCmd);
  }

  /*
   * `loaded` is the authority on whether there is filament in the head, and `fed` only on
   * where it CAME FROM - which is meaningful only while something is there.
   *
   * This read `fed == null && !loaded`, so a head whose `head_source` still named a bay
   * was never empty however the sensor answered. That is the same trap one level down
   * from the one that started this: `head_source` is multiACE's record of the last feed
   * and it does not stop naming a bay because the filament came out, exactly as
   * `print_task_config.filament_exist` does not stop existing.
   */
  const fed = h.bay;
  const bay = slot == null ? null : (unit.bays || [])[slot];
  const empty = !loaded;
  const same = loaded && slot != null && fed != null && slot === fed;
  const there = slot == null ? true : !!(bay && bay.occupied);
  const bgOk = (ace.bgHeads || []).indexOf(head) >= 0;
  const gate = { macro: ACE.BG_SET_HEAD, args: { HEAD: head, ENABLE: 1 } };

  if (empty) {
    list.push({ name: 'Load', macro: ACE.LOAD_HEAD, slotted: true,
                args: { HEAD: head, ACE: unit.index, SLOT: slot },
                off: there ? null : 'that bay is empty' });
  } else if (!same) {
    list.push({ name: 'Swap', macro: ACE.SWAP_HEAD, slotted: true,
                args: { HEAD: head, ACE: unit.index, SLOT: slot },
                off: there ? null : 'that bay is empty' });
    list.push({ name: 'Background swap', macro: ACE.BG_SWAP, slotted: true, bg: true,
                args: { HEAD: head, SLOT: slot, ACE: unit.index },
                off: !there ? 'that bay is empty' : bgOk ? null : NOT_DECLARED,
                gate: bgOk ? null : gate });
  }
  if (!empty) {
    // An ACE pulls the filament back into its bay, which a stock feeder cannot - that is
    // what RETRACT_LENGTH is for, and why this verb is not called `Unload` here.
    list.push({ name: 'Unload and retract', macro: ACE.UNLOAD_HEAD, slotted: false,
                args: { HEAD: head, RETRACT_LENGTH: null } });
    list.push({ name: 'Background unload', macro: ACE.BG_UNLOAD, slotted: false, bg: true,
                args: { HEAD: head },
                off: bgOk ? null : NOT_DECLARED, gate: bgOk ? null : gate });
  }
  return list.map(withCmd);
}

/*
 * A verb carries the line it would send, and an unavailable one carries the line that
 * would make it available instead - so what a control says and what it does cannot
 * disagree. A null argument renders as a placeholder rather than being dropped: the sheet
 * is showing the shape of the command, not sending it yet.
 */
function withCmd(v) {
  const args = {};
  Object.entries(v.args || {}).forEach(([k, x]) => {
    args[k] = x === null ? (k === 'RETRACT_LENGTH' ? '<mm>' : '<n>') : x;
  });
  const gate = v.gate ? aceLine(v.gate.macro, v.gate.args) : null;
  // A verb with stages is two lines and not one - the machine runs the feeder that way
  // in its own config, and `sw_SendGCodes` takes a newline-separated script.
  const cmd = v.stages
    ? v.stages.map((st) => aceLine(v.macro, Object.assign({}, args, { STAGE: st }))).join('\n')
    : aceLine(v.macro, args);
  return Object.assign({}, v, { cmd: gate || cmd });
}

/**
 * What the printer is doing, in its own words.
 *
 * NOT `swap_phase`, which is multiACE's and has never been captured on hardware. The U1's
 * own `channel_state` names the step - `filament_feed left|right` -> `extruder<n>`,
 * already on this page's subscription and already parsed by `feedChannels()`. The table
 * below is HelixScreen's classification of that field; its Snapmaker backend drives a U1
 * touchscreen from it, and taking it rather than re-deriving it is what stops the two
 * disagreeing about one machine.
 */
export const ACE_STEPS = {
  unload: ['Home', 'Select', 'Heat nozzle', 'Retract filament'],
  load: ['Home', 'Select', 'Heat nozzle', 'Feed filament', 'Purge'],
  /*
   * A swap on an ACE-fed head is ONE bar with two halves. The load half's own Home /
   * Select / Heat are deliberately absent: the head is mounted and already hot by then,
   * so they pass straight through.
   *
   * And there is no step for the ACE fetching the new bay. Measured on a live U1 that is
   * a ~4 s blip in a ~100 s operation, because the bay is already staged at its gate - a
   * row complete before it is read is worse than no row, so the bar holds on `Retract
   * filament` across it.
   */
  swap: ['Home', 'Select', 'Heat nozzle', 'Retract filament', 'Feed filament', 'Purge'],
};

/** Where each direction's step lands on the swap bar. `null` holds rather than jumps. */
const SWAP_AT = { unload: [0, 1, 2, 3], load: [null, null, null, 4, 5] };

const CHANNEL_STATES = {
  /*
   * The idle words, and an idle machine does not say `none`.
   *
   * Read off 811002511261022618B3 with everything settled: two heads said `load_finish`
   * and two said `wait_insert`. So a terminal state IS the resting state - the field holds
   * the last operation's ending rather than returning to a neutral word - and both draw
   * nothing, which is what makes an idle panel quiet.
   *
   * `wait_insert` is not a reliable "this head is empty", either: the head reading it was
   * fed from bay 2. The step bar does not care, because terminal states draw nothing -
   * and nothing else should read this field for occupancy. `headOccupied()` below is
   * where that question goes, and `channel_action_state` is what answers it.
   */
  none: null, inited: null, wait_insert: null, test: null,
  unload_prepare: ['unload', 0], unload_homing: ['unload', 0],
  unload_picking: ['unload', 1],
  unload_heating: ['unload', 2], unload_heat_finish: ['unload', 2],
  unload_doing: ['unload', 3],
  load_prepare: ['load', 0], load_homing: ['load', 0],
  load_picking: ['load', 1],
  load_heating: ['load', 2],
  load_feeding: ['load', 3], load_extruding: ['load', 3],
  load_flushing: ['load', 4],
  preload_prepare: ['load', 0], preload_feeding: ['load', 3],
};

/**
 * One `channel_state` string, classified against the bar being drawn.
 *
 * Unknown states fall through to a prefix heuristic rather than being dropped: this is a
 * firmware that has grown states before, and a future `unload_something` should hold the
 * bar in the right half rather than reset it.
 *
 * @param kind 'swap' | 'load' | 'unload' - which bar is on screen
 */
/**
 * Whether a head is HOLDING FILAMENT - and every sensor on the channel answers something
 * else.
 *
 * Read off 811002511261022618B3 with toolhead 1 unloaded by hand a moment before, which
 * is the one head in the row whose true state was known:
 *
 *   head  channel_state   channel_action_state  detected inAce inTool atExt exist  TRUTH
 *   0     unload_finish   unload_finish         T        T     T      T     T      empty
 *   1     wait_insert     unload_finish         F        T     F      T     T      empty
 *   2     wait_insert     none                  F        T     F      F     F      empty
 *   3     wait_insert     none                  T        T     F      T     T      LOADED
 *
 * Four fields read like presence and none of them is:
 *
 *   `filament_in_ace`      true on all four, the empty one included - a module is there,
 *                          not filament.
 *   `filament_at_extruder` true on three, two of them empty. It tracks the PATH having
 *                          filament available, not the head having it, and it does not
 *                          go false when a head is emptied.
 *   `filament_in_toolhead` true on the head just emptied and false on the loaded one,
 *                          which is not a sensor reading anyone should build on.
 *   `channel_state`        `wait_insert` on an empty head AND on a loaded one - already
 *                          recorded above, and the reason this needed a second look.
 *
 * `channel_action_state` separates them, because it is not a sensor: it is the last
 * operation the channel FINISHED. `unload_finish` on the two heads that had been
 * unloaded, `none` on the two that had not been touched since boot.
 *
 * So: the sticky field first, then the live one, then the topology - multiACE names the
 * bay it fed a head from, and a stock feeder has only the job record.
 *
 * That order is by what each field is FOR, not by which is fresher, and the two differ.
 * `channel_state` is the more recent value, but it is the one that goes to a word
 * carrying no occupancy at all; `channel_action_state` is the one that exists to record
 * the answer, and on the machine it never lags - it held `unload_finish` on both heads
 * that had been unloaded, one of them still reading it live and one already settled. So
 * it is asked first, and `channel_state` is read only where nothing has finished since
 * boot and it is still holding a terminal word of its own.
 *
 * `*_fail` deliberately decides nothing: a load that failed may have got anywhere, and
 * the topology is a better guess than either half of a guess.
 *
 * This is the third field this question has been asked of and the second that was wrong.
 * It is asked in ONE place for that reason.
 */
export function headOccupied(feed, head, jobLoaded) {
  for (const st of [feed && feed.actionState, feed && feed.channelState]) {
    const s = String(st || '').toLowerCase();
    if (s === 'load_finish' || s === 'preload_finish') return true;
    if (s === 'unload_finish') return false;
  }
  if (head && head.source === 'ace') return !!(head.loaded || head.bay != null);
  return !!jobLoaded;
}

/**
 * The resting and terminal channel words, in words.
 *
 * `channelStep()` names the steps INSIDE an operation and answers null for everything
 * else, which left the page with nothing to say for the states a channel actually sits in
 * - so it said `wait_insert`, `unload_fail`, `channel_state load_flushing` in hovers and
 * dialogs. A field name says where the page read something, which is the page's business
 * and not the reader's. `activity.js` does exactly this for `action_code`; this is the
 * same table for the other field.
 *
 * Anything not here answers null, and a caller with nothing to say says nothing.
 */
const CHANNEL_WORDS = {
  none: 'Idle', inited: 'Idle', test: 'Self-test',
  wait_insert: 'Waiting for filament',
  load_finish: 'Loaded', preload_finish: 'Loaded', unload_finish: 'Unloaded',
  load_fail: 'Load failed', preload_fail: 'Load failed', unload_fail: 'Unload failed',
};

export function channelWord(state) {
  const s = String(state || '').toLowerCase();
  return CHANNEL_WORDS[s] || null;
}

export function channelStep(state, kind) {
  const s = String(state || '').toLowerCase();
  if (!s) return null;
  if (/_fail$/.test(s)) return { state: s, failed: true, at: null };
  if (/_finish$/.test(s)) return { state: s, done: true, at: null };
  // `in`, not truthiness: the table maps the idle words to null ON PURPOSE, and `||`
  // sent them to the heuristic below - which happens to answer null for the ones this
  // firmware uses, and would not for a future idle word beginning `load`.
  const hit = s in CHANNEL_STATES ? CHANNEL_STATES[s]
    : /^unload/.test(s) ? ['unload', 0]
    : /^(load|preload|manual)/.test(s) ? ['load', 0] : null;
  if (!hit) return null;
  const [dir, at] = hit;
  const steps = ACE_STEPS[kind] || ACE_STEPS[dir];
  // Resolved THROUGH the list, never used as a position: on a swap the two halves carry
  // different ids, and a step this bar does not declare must hold rather than jump back.
  const idx = kind === 'swap' ? SWAP_AT[dir][at] : at;
  return { state: s, dir, at: idx, total: steps.length,
           label: idx == null ? null : steps[idx],
           heat: idx != null && steps[idx] === 'Heat nozzle' };
}

/**
 * Units are addressed by index on the wire and by letter on screen, the way Bambu
 * addresses an AMS - so a bay is A1..D4 and the address fits inside its own disc.
 */
export const ACE_UNIT_IDS = ['A', 'B', 'C', 'D'];
export const aceUnitId = (i) => ACE_UNIT_IDS[i] || String((i | 0) + 1);
export const aceBayAddr = (unit, slot) => `${aceUnitId(unit)}${(slot | 0) + 1}`;

/** SET_ACE_MODE's three, in the order the macro help lists them. */
export const ACE_MODES = ['normal', 'multi', 'head'];
export const ACE_MODE_LABELS = { normal: 'Normal', multi: 'Multi', head: 'Head' };

/**
 * What the dryer dialog offers, and what the macro will take.
 *
 * The presets are the common answers; the limits are there because ACE_DRY takes a
 * number and not a menu, and a spool whose tag says 65 C for 8 h should not have to be
 * rounded to the nearest chip.
 */
export const DRY_TEMPS = [45, 55, 65, 70];
export const DRY_HOURS = [2, 4, 6, 12];
export const DRY_LIMITS = { temp: [35, 80], hours: [1, 24] };
export const AUTO_DRY_THRESHOLDS = [45, 55, 65];

/**
 * ACE_DRY's DURATION is in MINUTES, and the panel offers hours.
 *
 * Measured, because it had to be: `DURATION=3` came back as `duration: 180` and
 * `DURATION=240` as `14400`, both in seconds. Sending the panel's `4` unconverted asked
 * for four MINUTES of drying and the machine answered `ok`, which is the whole reason
 * this constant exists rather than a bare multiplication somewhere.
 */
export const DRY_MINUTES_PER_HOUR = 60;

/**
 * Where multiACE keeps what is in each bay, and why it is a file.
 *
 * The `ace` Klipper object carries NO per-bay identity: every raw slot reads
 * `{material:"", brand:"", rfid:0}` because these spools have no tags. multiACE keeps
 * the names its own web UI shows in an override store and merges them in `_parse_state()`
 * — which is why `/multiace/api/state` shows four named bays where the Klipper object
 * shows four blanks, and why Orca's own AceMmuProvider (which polls that endpoint from
 * C++) sees filament this page could not.
 *
 * That endpoint is not reachable from a browser: nginx serves `/multiace/` with **no
 * CORS header at all**, measured. What IS reachable is the store itself — Moonraker's
 * file server on :7125 reflects the Origin, the same server this page already fetches
 * camera frames and job thumbnails from, and the override store lives under its `config`
 * root. So this needs no proxy, no new bridge command and no C++.
 *
 * Keyed `"<ace>_<slot>"` -> `{ace, slot, material, brand, subtype, color}`.
 */
export const ACE_OVERRIDES_FILE = 'config/extended/multiace/slot_overrides.json';

/**
 * Moonraker's console history, which is where the printer says what went wrong.
 *
 * `sw_SendGCodes` answers `ok` for a macro that failed: multiACE printed
 * `!! Must home Z axis first` and set `last_swap_result.status` to `error`, and the reply
 * carried neither. The `!!` line is Klipper's error channel and it is the only place the
 * REASON exists - so the panel reads it rather than inventing a sentence about what
 * probably happened.
 *
 * Same host and same port as the override store, and Moonraker reflects the Origin here
 * too (checked: `Access-Control-Allow-Origin: http://127.0.0.1:13619`).
 */
export function gcodeStoreUrl(device, count = 20) {
  const ip = device && device[DEVICE.IP];
  if (!ip) return null;
  return `http://${ip}:${MOONRAKER_HTTP_PORT}/server/gcode_store?count=${count | 0}`;
}

/** The most recent `!!` line in a gcode_store answer, without its marker. */
export function lastPrinterError(raw) {
  const list = raw && raw.result && Array.isArray(raw.result.gcode_store)
    ? raw.result.gcode_store : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = String((list[i] || {}).message || '');
    if (m.startsWith('!!')) return m.replace(/^!!\s*/, '').split('\n')[0].trim() || null;
  }
  return null;
}

export function aceOverridesUrl(device) {
  const ip = device && device[DEVICE.IP];
  if (!ip) return null;
  return `http://${ip}:${MOONRAKER_HTTP_PORT}/server/files/${ACE_OVERRIDES_FILE}`;
}

/**
 * multiACE's own precedence for where a bay's identity came from, and its own words for
 * it: `rfid | override | derived | empty`. Worth keeping verbatim - the panel draws the
 * difference (an eye for what may only be read, a pencil for what may be edited) and
 * inventing a second vocabulary for the same fact is how two of them drift apart.
 */
export const BAY_SOURCES = ['rfid', 'override', 'derived', 'unknown', 'empty'];

/**
 * Orca's own humidity buckets - `hum_level1..5` at <=20, <=35, <=50, <=65, >65.
 *
 * The same thresholds AMSinfo uses to pick its droplet, so a tinted pill on this page
 * and the C++ widget cannot disagree about the same number.
 */
export function humidityLevel(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return 0;
  return n <= 20 ? 1 : n <= 35 ? 2 : n <= 50 ? 3 : n <= 65 ? 4 : 5;
}

/**
 * One macro line: `ACE_DRY` + {ACE: 0, TEMP: 55} -> `ACE_DRY ACE=0 TEMP=55`.
 *
 * Here rather than in the panel's commands because the panel is not the only thing that
 * will ever send one, and because the argument names are the half of this subsystem that
 * has actually been wrong: `THRESHOLD=` was accepted, acked and ignored.
 */
export function aceLine(macro, args) {
  return [macro].concat(
    Object.entries(args || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${v}`)).join(' ');
}


/* ------------------------------------------------------------------ *
 * Drawing one
 *
 * The only part of this module that touches a document. It is here rather than in the
 * panel because an ACE is drawn on more than one surface and had been drawn four
 * different ways across the app - the standard exists to allow one, and one place to
 * call is what makes that hold. Nothing below runs at module scope, so the pure half
 * still evaluates in JavaScriptCore for unit_jsc.py.
 * ------------------------------------------------------------------ */

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * What a badge is drawn at when nobody says.
 *
 * The forms are nominal - badge and glyph 44x26, square 24x24 - and the standard's own
 * builders take a zoom, which is how one drawing serves a 26 px row and a 17 px one
 * rather than two sets of proportions. 17 is what the Device page's unit row is, because
 * that panel's body is 456: measured, and the one number on it that cannot move. A
 * surface with room passes `1`.
 */
export const BADGE_ROW = 17;
const BADGE_Z = BADGE_ROW / 26;

/*
 * The three forms an ACE is drawn in, from ACE_ART - which is the visual standard the
 * C++ Prepare page draws from. This panel had a badge of its own shape before, which
 * made five drawings of one object across the app where the standard exists to allow
 * one.
 *
 * `z` zooms the wide forms. That is the standard's own mechanism - its builders take a
 * zoom and multiply the nominal 44x26 - and it is how a 26px-tall unit row gets the same
 * drawing as a 44px one rather than a different one.
 */

/**
 * Badge: one body, a colour stop, and four spools drawn OVER both.
 *
 * Filled with that unit's own bays, so the thing in the header is a picture of the thing
 * in the card. Colour and emptiness are all that survive at this size, which is why it
 * carries no outline, no address, no state - and no level, even where Spoolman has bound
 * one: at 6x16 a level is not readable.
 *
 * Draw order is the whole of the change from A: the spools go on LAST, so a spool is a
 * whole spool rather than one with its lower 2.5 px painted over by the base.
 */
export function aceBadge(bays, z = BADGE_Z) {
  const A = ACE_ART.badge;
  // Sized here rather than in CSS: an SVG carrying only a viewBox has no intrinsic ratio
  // to give `width: auto`, and it came out square - 17x17 for a 44x26 drawing.
  const s = svgEl('svg', { width: r1(A.w * z), height: r1(A.h * z),
                         viewBox: `0 0 ${A.w} ${A.h}`,
                         'aria-hidden': 'true', class: 'ace-badge' });
  s.appendChild(svgEl('rect', { x: A.body.x, y: A.body.y, width: A.body.w,
                              height: A.body.h, rx: A.body.rx, fill: ACE_ART.hood }));
  s.appendChild(svgEl('path', { d: A.base, fill: ACE_ART.base }));
  bays.forEach((b, i) => s.appendChild(svgEl('rect', {
    x: ACE_ART.bayX[i], y: A.bay.y, width: A.bay.w, height: A.bay.h, rx: A.bay.rx,
    fill: (b.occupied && cssColor(b.color)) || (b.occupied ? '#B7BDC6' : ACE_ART.emptyBay),
  })));
  return s;
}

/**
 * Glyph: the badge's silhouette in line, bays filled. Takes the ink from `currentColor`.
 *
 * It used to be a stepped path - A's silhouette, hood shoulders on top and a base stepping
 * out at the bottom. When the badge stopped stepping this had to stop too, or the pair say
 * two different things about one object.
 */
export function aceGlyph(z = 1) {
  const A = ACE_ART.glyph;
  const s = svgEl('svg', { width: A.w * z, height: A.h * z, viewBox: `0 0 ${A.w} ${A.h}`,
                         fill: 'none', stroke: 'currentColor', 'stroke-width': A.stroke,
                         'stroke-linejoin': 'round', 'stroke-linecap': 'round',
                         'aria-hidden': 'true', class: 'ace-glyph-wide' });
  s.appendChild(svgEl('rect', { x: A.body.x, y: A.body.y, width: A.body.w,
                              height: A.body.h, rx: A.body.rx }));
  ACE_ART.bayX.forEach((x) => s.appendChild(svgEl('rect', {
    x, y: A.bay.y, width: A.bay.w, height: A.bay.h, rx: A.bay.rx,
    fill: 'currentColor', stroke: 'none' })));
  return s;
}

/**
 * Glyph, square: body and four bays, no hood.
 *
 * For an icon slot the wide cabinet cannot go in — a menu row, a pill. Not the same
 * silhouette on purpose: the family is carried by the bay treatment and the stroke,
 * because a third of the width has to say the same thing.
 */
export function aceGlyphSquare(px = ACE_ART.square.w) {
  const A = ACE_ART.square;
  const s = svgEl('svg', { width: px, height: px, viewBox: `0 0 ${A.w} ${A.h}`,
                         fill: 'none', stroke: 'currentColor', 'stroke-width': A.stroke,
                         'stroke-linejoin': 'round', 'stroke-linecap': 'round',
                         'aria-hidden': 'true', class: 'ace-glyph-sq' });
  s.appendChild(svgEl('rect', { x: A.body.x, y: A.body.y, width: A.body.w,
                              height: A.body.h, rx: A.body.rx }));
  for (let i = 0; i < 4; i += 1) {
    s.appendChild(svgEl('rect', { x: A.bay.x0 + i * A.bay.dx, y: A.bay.y, width: A.bay.w,
                                height: A.bay.h, rx: A.bay.rx,
                                fill: 'currentColor', stroke: 'none' }));
  }
  return s;
}

/**
 * The `ace` Klipper object, unpacked.
 *
 * Measured on 811002511261022618B3 (2026-08-25, again 2026-08-26): one ACE 2 Pro,
 * `protocol: "v2"`, `mode: "head"`, `device_count: 1`, 38 % RH at 30 C, feeding Toolhead 4
 * from bay 3, four PETG spools. `head_feeder {0,1,2 true, 3 false}`,
 * `gate_status [1,1,1,1]`, and every raw slot `{material:"", brand:"", color:[0,0,0],
 * rfid:0}`.
 *
 * Two things that only hardware said, and both change what this returns:
 *
 *   `head_ace` is NOT the answer to "what feeds this head". It reads
 *   `{0:0, 1:1, 2:2, 3:0}` on a machine with `device_count: 1`, so heads 2 and 3 name
 *   units that do not exist. A head's source resolves `head_manual`, then `head_feeder`,
 *   and `head_ace` only for what is left - and only when the unit it names is actually
 *   there. Same bug class as `toolhead.extruder` naming a parked head.
 *
 *   No bay has a level. `spool_mode` is `spoolman` and `spool_binding` is `{}`, so
 *   nothing is bound and no bay has a weight behind it. A bay carries a colour, not a
 *   gauge; anything drawing a fill height here would be drawing a number the machine did
 *   not give it.
 */
export function parseAce(objects) {
    const o = (objects || {})['ace'];
    const present = !!o && typeof o === 'object' && !Array.isArray(o);
    if (!present) {
      return { present: false, mode: null, unitCount: 0, activeUnit: 0,
               swapping: false, swapPhase: null, lastSwap: null, bgHeads: [], bgVersion: null,
               units: [], heads: TOOLHEADS.map((_k, i) => ({
                 index: i, source: 'feeder', unitIndex: null, unitId: null,
                 bay: null, loaded: null })),
               apiVersion: null,
               settings: { confirmCommands: false, spoolmanUrl: '', spoolmanAuto: false,
                           purgeMatrix: false, spoolMode: null, bound: 0 } };
    }

    const rawUnits = Array.isArray(o.aces) ? o.aces : [];
    // `device_count` is the authority on how many units to draw - it is what ace.cfg
    // declares - and `aces[]` may be longer or shorter than it.
    const count = Number.isFinite(Number(o.device_count))
      ? Math.max(0, Math.min(ACE_UNIT_IDS.length, Number(o.device_count)))
      : rawUnits.length;

    const units = [];
    for (let i = 0; i < count; i += 1) units.push(aceUnit(rawUnits[i] || {}, i));

    const heads = TOOLHEADS.map((_k, i) => {
      const src = headSource(o, i, units.length);
      const from = mapAt(o.head_source, i);
      const loaded = spoolOf(from);
      if (src.source === 'ace' && loaded && units[src.unitIndex]) {
        // The one identity the raw object does carry. Every unloaded bay reads
        // `{material:"", brand:"", rfid:0}`, but `head_source[n]` names what is IN the
        // head - which is also what is in the bay it came from, so the bay it came from
        // stops being "occupied, not named".
        const bay = units[src.unitIndex].bays[src.bay];
        if (bay && bay.occupied && !bay.material) {
          // multiACE's own word for this: the identity was DERIVED from what is loaded,
          // not read off a tag and not typed against the bay. It is the weakest of the
          // three, so an override read off the printer replaces it - see the panel.
          Object.assign(bay, loaded, { known: true, source: bay.rfid ? 'rfid' : 'derived' });
        }
      }
      return { index: i, ...src, loaded };
    });

    return {
      present: true,
      /*
       * Which multiACE this is talking to.
       *
       * The whole surface below belongs to a plugin someone chose to install, not to the
       * U1's firmware, and it is pre-1.0: `api_version` is the contract the object
       * claims, and `ace_bg_swap.version` its own. Carried so a mismatch is something
       * the page can SAY rather than something a user discovers when a control does
       * nothing - and so the version this was verified against is checkable rather than
       * only written in a document.
       */
      apiVersion: numOrNull(o.api_version),
      mode: o.mode || null,
      unitCount: units.length,
      activeUnit: Number(o.active_device) || 0,
      swapping: !!o.swap_in_progress || (o.swap_phase && o.swap_phase !== 'idle'),
      swapPhase: nonEmpty(o.swap_phase),
      lastSwap: o.last_swap_result != null ? o.last_swap_result : null,
      /*
       * Which heads a background swap may run on.
       *
       * NOT from the `ace` object - all 38 of its top-level keys were read on the machine
       * and there is no `bg_swap` among them. `ace_bg_swap` is a Klipper object of its
       * own, so it is a second key in the same sw_GetMachineState call rather than a
       * second request. Measured 2026-08-26: `{"version":"v0.9","enabled_heads":[], ...}`
       * - no head is declared on that machine, which is why the panel's first duty is to
       * draw the refusal well.
       */
      ...parseBgSwap(objects),
      units,
      heads,
      /*
       * The settings a person sets once, AS THE MACHINE REPORTS THEM.
       *
       * These were written as write-only - "the machine does not report this back, so
       * this sets it rather than shows it" - and that was simply wrong: three of the four
       * are right there in the object. A dialog that sets a value it could have shown is
       * a dialog that asks you to remember what you chose.
       *
       * The flush LENGTH really is absent. `purge_matrix` is the boolean that says
       * whether the per-pair stamps from the slicer's flush matrix are honoured; the
       * length itself lives in the config and is not in this object.
       */
      settings: {
        confirmCommands: o.confirm_commands === true,
        spoolmanUrl: nonEmpty(o.spoolman_url) || '',
        spoolmanAuto: o.spoolman_auto === true,
        purgeMatrix: o.purge_matrix === true,
        spoolMode: nonEmpty(o.spool_mode),
        // Empty on this machine, which is why no bay has a level. When it is not, the
        // entry it points at carries `weight_g` - remaining grams, an estimate from
        // extruded length. There is still no original weight, so a PERCENTAGE is not
        // derivable and a disc stays a colour rather than a gauge.
        bound: Object.keys(o.spool_binding || {}).length,
      },
    };
}

/**
 * The override store, as it comes off the printer's file server.
 *
 * The file is the map itself; multiACE's own API wraps it in `{overrides: ...}`. Both are
 * accepted, because the two are the same data and a caller should not have to know which
 * end it came from.
 */
/**
 * `ace_bg_swap`, which is a different object from `ace` and answers a different question.
 *
 * A head is background-capable only when someone has DECLARED it with ACE_BG_SET_HEAD,
 * and the help for that macro says what the declaration means physically: the dock below
 * that head is open, and the cold-pull purges ~60 mm through it. So an undeclared head is
 * not a control to grey out quietly - it is the one mistake on this panel that costs
 * filament and a bed.
 */
function parseBgSwap(objects) {
  const o = (objects || {})['ace_bg_swap'];
  if (!o || typeof o !== 'object') return { bgHeads: [], bgVersion: null, bgBusy: [] };
  const ints = (v) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : []);
  return { bgHeads: ints(o.enabled_heads), bgVersion: nonEmpty(o.version),
           bgBusy: ints(o.busy) };
}

export function parseAceOverrides(raw) {
  const map = (raw && typeof raw === 'object' && raw.overrides) ? raw.overrides : raw;
  return (map && typeof map === 'object' && !Array.isArray(map)) ? map : null;
}

/**
 * What is actually in one unit's bays.
 *
 * multiACE's precedence, kept verbatim: **rfid, then the override, then derived.** A tag
 * is the hardware's own answer and beats a name someone typed against the bay; both beat
 * an identity inferred from what happens to be loaded in the head. Those are multiACE's
 * own words (`rfid | override | derived`) and using the same ones is what stops the two
 * vocabularies drifting apart.
 *
 * Pure, and returns a new array rather than touching the unit: with no store there is
 * nothing to merge and the bays are handed straight back, which is the same answer as a
 * printer that has no multiACE web service at all.
 */
export function mergeAceBays(unit, overrides) {
  if (!unit || !overrides) return (unit && unit.bays) || [];
  return unit.bays.map((b) => {
    if (!b.occupied || b.source === 'rfid') return b;
    const o = overrides[`${unit.index}_${b.index}`];
    const material = (o && typeof o === 'object' && typeof o.material === 'string')
      ? o.material.trim() : '';
    if (!material) return b;
    return Object.assign({}, b, {
      known: true,
      material,
      subType: ((o.subtype || '').trim()) || b.subType,
      vendor: ((o.brand || '').trim()) || b.vendor,
      color: o.color || b.color,
      source: 'override',
    });
  });
}

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

/* ---- the `ace` object, unpacked ------------------------------------- */

/**
 * `head_manual`, `head_feeder`, `head_ace` and `head_source` are maps keyed by head
 * index. multiACE builds them as dicts with integer keys, which JSON carries as
 * strings, and a Klipper object that happened to be a list would read the same way -
 * so both are accepted rather than one assumed.
 */
function mapAt(m, i) {
  if (!m) return undefined;
  if (Array.isArray(m)) return m[i];
  if (typeof m !== 'object') return undefined;
  return m[i] !== undefined ? m[i] : m[String(i)];
}

/**
 * What feeds one head, resolved in the only order that is true.
 *
 * Written one rule per line, because the fallbacks are the whole point: `head_ace`
 * answers for every head whether or not that head is on an ACE, and whether or not the
 * unit it names exists.
 */
function headSource(o, i, unitCount) {
  const none = { source: 'feeder', unitIndex: null, unitId: null, bay: null };
  if (mapAt(o.head_manual, i)) return { source: 'manual', unitIndex: null, unitId: null, bay: null };
  if (mapAt(o.head_feeder, i)) return none;
  const u = Number(mapAt(o.head_ace, i));
  if (!Number.isInteger(u) || u < 0 || u >= unitCount) return none;
  const from = mapAt(o.head_source, i);
  const slot = from && Number.isInteger(Number(from.slot)) ? Number(from.slot) : null;
  return { source: 'ace', unitIndex: u, unitId: aceUnitId(u), bay: slot };
}

/**
 * ACE Pro and ACE 2 Pro are different machines.
 *
 * The unit names itself - `model: "ACE 2 Pro"`, measured 2026-08-26 - so that is what is
 * used. `protocol` is the fallback for a firmware that does not, and it is the field the
 * distinction actually rides on: v2 is the ACE 2 Pro, v1 the ACE Pro.
 */
function aceModel(u) {
  const named = nonEmpty(u.model);
  if (named) return named;
  const p = String(u.protocol || '').toLowerCase();
  if (p === 'v2') return 'ACE 2 Pro';
  if (p === 'v1') return 'ACE Pro';
  return 'ACE';
}

/**
 * A colour as the ACE reports it: `[r, g, b]` in the raw slots, `"632C2C"` in
 * `head_source`. Both are handed on as something cssColor() will take.
 */
function aceColor(c) {
  if (Array.isArray(c)) {
    if (c.length < 3 || c.every((v) => !Number(v))) return null;   // [0,0,0] is "none"
    return '#' + c.slice(0, 3)
      .map((v) => Math.max(0, Math.min(255, Number(v) | 0)).toString(16).padStart(2, '0'))
      .join('').toUpperCase();
  }
  if (typeof c === 'string' && c.trim()) return c.trim();
  return null;
}

const nonEmpty = (v) => (typeof v === 'string' && v.trim() && v.trim() !== 'NONE'
  ? v.trim() : null);

/** What `head_source[n]` says is loaded at a head - or null when it says nothing. */
function spoolOf(from) {
  if (!from || typeof from !== 'object') return null;
  const material = nonEmpty(from.type) || nonEmpty(from.material);
  const color = aceColor(from.color);
  if (!material && !color) return null;
  return {
    material,
    subType: nonEmpty(from.subtype) || nonEmpty(from.sub_type),
    vendor: nonEmpty(from.brand) || nonEmpty(from.vendor),
    color,
    rfid: Number(from.rfid) || 0,
  };
}

/**
 * One unit, its four bays, and its dryer.
 *
 * A bay is occupied when the hardware says so - `gate_status[k]` is the gate sensor and
 * `slots[k].state` is multiACE's naming of the same thing - and *named* only when
 * something carries an identity for it. Those are two different questions and the panel
 * draws the difference, because on this machine the answer to the second is almost
 * always no: the spools have no tags and multiACE keeps typed-in names in its own store,
 * behind CORS. Occupied-and-unnamed is drawn as exactly that rather than as empty.
 */
function aceUnit(u, index) {
  const gates = Array.isArray(u.gate_status) ? u.gate_status : [];
  const rawSlots = Array.isArray(u.slots) ? u.slots : [];
  const bays = [];
  for (let k = 0; k < ACE_SLOTS; k += 1) {
    const s = rawSlots[k] || {};
    const state = nonEmpty(s.state) || nonEmpty(s.status);
    const gate = gates[k];
    const occupied = gate !== undefined ? Number(gate) !== 0 : (!!state && state !== 'empty');
    const material = nonEmpty(s.material) || nonEmpty(s.type);
    const rfid = Number(s.rfid) || 0;
    bays.push({
      index: k,
      addr: aceBayAddr(index, k),
      occupied,
      known: !!material,
      material,
      subType: nonEmpty(s.subtype) || nonEmpty(s.sub_type),
      vendor: nonEmpty(s.brand) || nonEmpty(s.vendor),
      sku: nonEmpty(s.sku),
      color: aceColor(s.color !== undefined ? s.color : s.color_rgb),
      rfid,
      // Where the name came from decides what may be done to it: a tag can be read and
      // not written, so it gets an eye where a typed value gets a pencil.
      source: rfid ? 'rfid' : (material ? 'typed' : (occupied ? 'unknown' : 'empty')),
    });
  }
  return {
    index,
    id: aceUnitId(index),
    model: aceModel(u),
    firmware: nonEmpty(u.firmware) || nonEmpty(u.fw) || nonEmpty(u.version),
    connected: u.connected !== false,
    humidity: numOrNull(u.humidity),
    temperature: numOrNull(u.temp !== undefined ? u.temp : u.temperature),
    dryer: aceDryer(u.dryer_status || u.dryer),
    // Its own object on the unit, not part of dryer_status - measured
    // `{enabled, rh_start, rh_end, temp, master, add_time}`. rh_start is the humidity it
    // starts at and rh_end the one it stops at, so the panel's "above" is rh_start.
    autoDry: {
      enabled: !!(u.auto_dry || {}).enabled,
      running: !!u.auto_dry_running,
      rhStart: numOrNull((u.auto_dry || {}).rh_start),
      rhEnd: numOrNull((u.auto_dry || {}).rh_end),
      temp: numOrNull((u.auto_dry || {}).temp),
    },
    bays,
  };
}

/**
 * The dryer.
 *
 * Every field below was measured on 811002511261022618B3 on 2026-08-26, by running the
 * dryer at its mildest setting for ten seconds - which is the only way to see any of it,
 * and the reason two of the three guesses this replaced were wrong:
 *
 *   {"status": "stop",    "target_temp": 0,  "duration": 0,     "remain_time": 0}
 *   {"status": "keeping", "target_temp": 45, "duration": 180,   "remain_time": 179}
 *
 * `duration` and `remain_time` are **seconds**: `DURATION=3` gave 180 and `DURATION=240`
 * gave 14400, which also settles that ACE_DRY's own argument is in **minutes**. The
 * running word is `keeping`, not `running` or `drying`.
 *
 * The word sets below are still open at one end on purpose. `stop` and `keeping` are the
 * two that have been seen; a firmware with a third word for "heating up to target" would
 * otherwise read as idle, so anything that is neither empty nor a known stopped word
 * counts as running.
 */
const DRYER_STOPPED = new Set(['', 'stop', 'stopped', 'idle', 'off', 'none']);

function aceDryer(d) {
  const off = { running: false, target: null, totalMin: null, remainingMin: null,
                doneMin: null, pct: null, status: null };
  if (!d || typeof d !== 'object') return off;
  const status = String(d.status || d.state || '').toLowerCase();
  const running = d.running === true || (!!status && !DRYER_STOPPED.has(status));
  const target = numOrNull(d.target_temp !== undefined ? d.target_temp
    : (d.target !== undefined ? d.target : d.temp));
  const totalMin = secondsToMin(d.duration !== undefined ? d.duration : d.total);
  const remainingMin = secondsToMin(d.remain_time !== undefined ? d.remain_time
    : (d.remaining !== undefined ? d.remaining : d.left));
  const doneMin = (totalMin != null && remainingMin != null)
    ? Math.max(0, totalMin - remainingMin) : null;
  return {
    running,
    status: status || null,
    target,
    totalMin,
    remainingMin,
    doneMin,
    pct: (totalMin && doneMin != null) ? Math.round((doneMin / totalMin) * 100) : null,
  };
}

/** Seconds on the wire, minutes on the panel. A dash for anything unreadable. */
function secondsToMin(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n / 60);
}

