/*
 * store.js - everything the page knows that the machine does not.
 *
 * This was sixteen module-level `let`s in app.js, and nothing listed them. The registry
 * answers "what is on this page"; this answers "what does the page remember", which is
 * the other half of the same question and was the harder one to get at: a panel reading
 * `cam.error` gave no clue where `cam` was written, and eleven of the sixteen were
 * written from more than one place.
 *
 * What belongs here: state the *page* owns. What does not: the machine's own state,
 * which is `MachineState` and is a mirror rather than a memory, and the session's
 * internals - sockets, timers, subscription ids - which no panel reads and which stay
 * with the code that manages them.
 *
 * The distinction that matters, and the one this page kept getting wrong: **a request is
 * not a mirror**. Anything asked for and not yet confirmed belongs in `pending.js`, not
 * here and not in `MachineState` - see the note at the top of that file for the three
 * separate controls that learned it the hard way.
 */
'use strict';

/**
 * A plain declared object, deliberately not an observable one.
 *
 * Making every write notify is the obvious next step and it is not taken here, because
 * it would be a second way to ask for a repaint alongside `render()` - and one page with
 * two mechanisms for one job is the thing this restructure exists to undo. Mutation
 * sites call `render()`, as they already did. If that turns out to be forgotten in
 * practice, wrapping this in a Proxy is a change to this function and nothing else.
 */
export function createStore() {
  const s = {
    /** Which destination the rail is on. */
    view: 'control',

    /** Which of Storage's four kinds is showing. */
    storageKind: 'timelapses',

    /**
     * Which toolhead jog and extrude are aimed at.
     *
     * The user's choice, not the machine's - picking a head to jog does not change the
     * tool - so nothing on the stream ever sets it.
     */
    activeTool: 0,

    /**
     * Whether we are talking to a printer *right now*.
     *
     * Computed once per frame from live evidence, never from `DeviceInfo.connected`,
     * which AppConfig force-clears on every config save (AppConfig.cpp:887) and which is
     * therefore false on disk by construction.
     */
    reachable: false,

    /** The machine whose state we show. */
    device: null,

    /** Every machine Orca has saved, connected or not. */
    devices: [],

    /** Machines LAN discovery has turned up. */
    found: [],

    /** `{ userid, nickname }` - the pairing request wants both. */
    loginUser: {},

    /** The active fault, from `sw_exception_query`. */
    exception: null,

    /**
     * The camera. Frames are polled rather than pushed: `camera.start_monitor` returns a
     * URL and the printer then rewrites that one file at the monitor interval.
     */
    cam: { mode: 'live', streaming: false, frameUrl: null,
           timelapses: [], error: '' },

    /** A machine-file listing, for Storage's two file-backed kinds. */
    files: { loading: false, error: '', root: '', roots: [], items: [] },

    /** Finished prints, from Moonraker's history store. Paged, so `start` appends. */
    history: { loading: false, error: '', items: [], hasMore: false },

    /**
     * The printing file's thumbnail, keyed on the filename so a card that repaints every
     * second asks the printer nothing.
     */
    jobThumb: { file: null, data: null },
  };

  return s;
}
