/*
 * camera-commands.js - everything the Camera panel can ask for.
 *
 * There are two printers behind this panel and only one of them is the machine Orca was
 * written for.
 *
 * A stock U1 answers `camera.start_monitor` with a URL, then rewrites that one file
 * every CAMERA_INTERVAL seconds. Two seconds. **Half a frame per second**, and the whole
 * of what this panel could do before.
 *
 * A U1 running paxx12's Extended Firmware also runs a camera service: two real cameras,
 * a still endpoint per camera that answers in 44-81 ms, and two streaming transports.
 * Chained in WebKitGTK the case camera reached **14.0 fps at 1920x1080** - 28x the
 * monitor file - and neither streaming transport worked at all, because that engine has
 * no H.264 decoder and no RTCPeerConnection.
 *
 * So the shape of this module is: **detect, do not configure.** Ask Moonraker for the
 * camera list; if something answers, the extended firmware is there and the direct
 * transports are on offer. If nothing does, fall back to the monitor file, which is what
 * every stock machine has. Nobody is asked to know which firmware they are running.
 *
 * Three things measured on the machine that shape the code rather than just the comments:
 *
 *   - **nginx on :80 sends no CORS header; Moonraker on :7125 sends one.** So the list
 *     is fetched from 7125 and frames are only ever displayed through <img>, never
 *     fetched. An <img> loads a cross-origin still fine; `fetch()` of the identical URL
 *     fails "Load failed".
 *   - **The printer caps itself at 15 fps** (`target_fps` on every webcam entry), so the
 *     scale stops there and asking for 30 buys nothing.
 *   - **A grid is one poll per tile.** Three tiles at 15 fps is 4.7 MB/s and the case
 *     camera's 226 KB frame is nearly all of it, so only the focused tile polls fast.
 */
'use strict';

import { CMD, CAMERA_DOMAIN, CAMERA_INTERVAL, CAMERA_TRANSPORT, CAMERA_VIEW,
         CAMERA_VIEW_TILES, CAMERA_FPS_UNFOCUSED, CAMERA_FPS_DEFAULT,
         engineCaps, pickTransport, transportUsable, isCamera, snapshotUrl,
         webcamListUrl, CAMERA_SCREEN_NAME }
  from '../../../../../shared/js/protocol.js';
import { cameraFrameUrl, tileImage } from './camera-view.js';

export function create(deps) {
  // `bridge` is deliberately NOT destructured: it does not exist yet when these are
  // built - boot() decides between the real host and the simulator - so it is reached
  // through deps each time rather than captured as null once.
  const { store, render } = deps;

  let camSub = null;
  /** name -> {timer, url, gen}. One poller per visible tile, never one for the panel. */
  const pumps = new Map();
  /** Bumped on every stop, so a frame that decodes late cannot restart a dead pump. */
  let generation = 0;

  /* ---- what is available ------------------------------------------------ */

  /**
   * Ask the printer what cameras it has.
   *
   * Answering at all is the detection: a stock U1 has no camera service and this fails,
   * which is not an error worth showing - it just means the monitor file is the only
   * transport. `AbortSignal.timeout` rather than an open-ended fetch, because an
   * unreachable printer would otherwise hold the panel at "looking" until TCP gave up.
   */
  async function discover() {
    // With no printer there is nothing to answer plain HTTP, so a simulated run would
    // always fall back to the monitor file and never execute the tile grid, the
    // transport list or the focus rule. The simulator answers this one directly.
    if (deps.mock && deps.mock.webcams) {
      return deps.mock.webcams().filter(isCamera).sort(
        (a, b) => (a.name === CAMERA_SCREEN_NAME) - (b.name === CAMERA_SCREEN_NAME));
    }
    const url = webcamListUrl(store.device);
    if (!url) return [];
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return [];
      const body = await r.json();
      const list = (body && body.result && body.result.webcams) || [];
      // Moonraker's list is a registry, not a camera list: this machine also carries the
      // printer's own touchscreen and a multiACE web panel in it. A still to fetch is
      // what makes an entry usable; the touchscreen has one and is kept, labelled and
      // sorted last, because it does show what the machine is doing.
      return list.filter(isCamera).sort(
        (a, b) => (a.name === CAMERA_SCREEN_NAME) - (b.name === CAMERA_SCREEN_NAME));
    } catch {
      return [];                       // no camera service; the monitor file still works
    }
  }

  /** Which transport is actually in use, resolving AUTO against what both ends can do. */
  function activeTransport() {
    const caps = store.cam.caps || (store.cam.caps = engineCaps());
    const direct = store.cam.cams.length > 0;
    if (store.cam.transport === CAMERA_TRANSPORT.AUTO) return pickTransport(caps, direct);
    return transportUsable(store.cam.transport, caps, direct)
      ? store.cam.transport
      : pickTransport(caps, direct);
  }

  /** The cameras this view draws, in tile order, capped at what the view can show. */
  function tiles() {
    const want = CAMERA_VIEW_TILES[store.cam.view] || 1;
    const by = new Map(store.cam.cams.map((c) => [c.name, c]));
    const chosen = store.cam.picked.map((n) => by.get(n)).filter(Boolean);
    // Anything not explicitly picked fills the remaining tiles in the printer's own
    // order, so a fresh page shows pictures rather than empty cells.
    const rest = store.cam.cams.filter((c) => !store.cam.picked.includes(c.name));
    return chosen.concat(rest).slice(0, want);
  }

  /* ---- polling ---------------------------------------------------------- */

  /**
   * Defeat the cache, but only where there is a cache to defeat.
   *
   * Every transport here overwrites one file in place, so the URL never changes and the
   * browser would serve its first frame forever. A `data:` URL has no cache and no query
   * string: appending `?t=` to one appends to the DATA, which silently corrupts it -
   * base64 often survives the trailing bytes, and an SVG never does. That is exactly how
   * the simulated cameras rendered nothing while every other check passed.
   */
  const bust = (url) => (/^(data:|blob:)/i.test(url)
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);

  /**
   * Re-point one tile's <img> as fast as it will decode, and no faster.
   *
   * The next fetch is scheduled from `onload`, not from a fixed interval: a timer that
   * fires faster than the frames decode queues requests the engine has to serve anyway,
   * and on a slow link that turns into unbounded lag rather than dropped frames. Waiting
   * for the decode makes the rate self-limiting - it settles at whatever the printer and
   * the network can actually do, which measured at 14.0 fps against a 15 fps cap.
   *
   * The element is re-pointed rather than replaced so the visible frame is only swapped
   * once the next one has decoded, which is what keeps a tile from flickering.
   */
  function pumpTile(cam, index) {
    const base = snapshotUrl(store.device, cam);
    if (!base) return;
    const gen = generation;
    const rec = { timer: null, url: base, gen };
    pumps.set(cam.name, rec);

    const step = () => {
      if (rec.gen !== generation || !store.cam.streaming) return;
      const im = tileImage(cam.name);
      // render() is rAF-batched, so the first attempt usually lands before the paint.
      if (!im) { rec.timer = setTimeout(step, 100); return; }
      const focused = index === store.cam.focus;
      const fps = Math.max(1, focused ? (store.cam.fps || CAMERA_FPS_DEFAULT)
                                      : CAMERA_FPS_UNFOCUSED);
      const wait = Math.max(0, Math.round(1000 / fps));
      const again = () => {
        if (rec.gen !== generation) return;
        rec.timer = setTimeout(step, wait);
      };
      im.onload = again;
      // A camera that stops answering must not spin: back off to a second, and keep
      // trying, because the usual cause is the printer rebooting rather than the URL
      // being wrong.
      im.onerror = () => {
        im.dataset.failed = '1';
        if (rec.gen === generation) rec.timer = setTimeout(step, 1000);
      };
      delete im.dataset.failed;
      im.src = bust(base);
    };
    step();
  }

  function stopPumps() {
    generation += 1;
    pumps.forEach((r) => { if (r.timer) clearTimeout(r.timer); });
    pumps.clear();
  }

  /** Start a poller for every visible tile, and none for anything else. */
  function startPumps() {
    stopPumps();
    tiles().forEach((cam, i) => pumpTile(cam, i));
  }

  /* ---- the monitor file, for a printer with no camera service ----------- */

  function startMonitorPump() {
    const gen = generation;
    const rec = { timer: null, gen };
    pumps.set('__monitor', rec);
    const step = () => {
      if (rec.gen !== generation || !store.cam.streaming || !store.cam.frameUrl) return;
      const im = tileImage('__monitor');
      if (im) im.src = bust(store.cam.frameUrl);
      rec.timer = setTimeout(step, CAMERA_INTERVAL * 1000);
    };
    step();
  }

  async function startMonitor() {
    // Not a stream and not a frame push. The monitor answers once with a URL, then the
    // printer rewrites that one file every `interval` seconds and the frames are ours
    // to fetch. domain must be 'lan' - '' is refused -32000. See protocol.js CAMERA_*.
    //
    // That answer can arrive down either channel: SSWCP.cpp hands the printer's reply to
    // on_mqtt_msg_arrived, which is the push path, but the bridge also acks the command.
    // Only the MQTT leg has been watched directly, so take the URL from whichever
    // channel produces it first and ignore the second.
    const useUrl = (payload) => {
      const url = cameraFrameUrl(payload, store.device);
      if (!url || url === store.cam.frameUrl) return;
      store.cam.frameUrl = url;
      render();
      startMonitorPump();
    };

    camSub = await deps.bridge.subscribe(CMD.CAMERA_START,
      { domain: CAMERA_DOMAIN, interval: CAMERA_INTERVAL, expect_pw: false },
      (data, payload) => useUrl(data !== undefined ? data : payload));
    if (camSub && camSub.ack !== undefined && camSub.ack !== null) useUrl(camSub.ack);
  }

  /* ---- what the panel calls --------------------------------------------- */

  /**
   * Turn the camera on.
   *
   * Discovery happens here rather than at boot: a printer that is not reachable at boot
   * would answer nothing, and the panel would then believe forever that this machine has
   * no cameras. Asking when the user presses play means the answer is as old as the press.
   *
   * A local function rather than a method reached through the returned object, because
   * changing transport has to do all of this again and a module that calls itself
   * through its own export is one the reachability check cannot read.
   */
  async function start() {
    store.cam.error = '';
    store.cam.streaming = true;
    store.cam.frameUrl = null;
    store.cam.caps = store.cam.caps || engineCaps();
    render();

    try {
      if (!store.cam.cams.length) store.cam.cams = await discover();
      if (activeTransport() === CAMERA_TRANSPORT.MONITOR) {
        await startMonitor();
      } else {
        render();                      // paint the tiles before pointing them anywhere
        startPumps();
      }
    } catch (e) {
      store.cam.streaming = false;
      store.cam.error = `camera failed: ${e.message}`;
      render();
    }
  }

  return {
    startCamera: start,

    stopCamera: async () => {
      store.cam.streaming = false;
      store.cam.frameUrl = null;
      stopPumps();
      if (camSub && camSub.cancel) camSub.cancel();
      camSub = null;
      render();
      try {
        await deps.bridge.request(CMD.CAMERA_STOP, { domain: CAMERA_DOMAIN });
      } catch { /* already off, or never a monitor in the first place */ }
    },

    /** Re-ask the printer what cameras it has. The only reason the gear needs a button. */
    rescanCameras: async () => {
      store.cam.cams = await discover();
      store.cam.caps = engineCaps();
      if (store.cam.streaming) startPumps();
      render();
    },

    setCameraView: (view) => {
      if (!Object.values(CAMERA_VIEW).includes(view)) return;
      store.cam.view = view;
      if (store.cam.focus >= (CAMERA_VIEW_TILES[view] || 1)) store.cam.focus = 0;
      render();
      if (store.cam.streaming) startPumps();
    },

    /**
     * Put a camera in a tile.
     *
     * Picking one already on screen swaps it to the front rather than adding it twice -
     * the same click means "show me this one" whether or not it is already up.
     */
    pickCamera: (name, slot = 0) => {
      const order = store.cam.picked.filter((n) => n !== name);
      order.splice(Math.max(0, slot), 0, name);
      store.cam.picked = order;
      render();
      if (store.cam.streaming) startPumps();
    },

    setCameraTransport: (t) => {
      store.cam.transport = t;
      // A transport change is a restart: the pumps, the subscription and the tile shape
      // all belong to the one that was running.
      stopPumps();
      render();
      if (store.cam.streaming) start();
    },

    setCameraFps: (n) => {
      store.cam.fps = Math.max(1, Number(n) || CAMERA_FPS_DEFAULT);
      render();
    },

    /** Which tile gets the full frame rate. Everything else drops to 1 fps. */
    focusTile: (i) => {
      if (store.cam.focus === i) return;
      store.cam.focus = i;
      render();
      if (store.cam.streaming) startPumps();
    },

    /** For the view and the settings sheet, which both need to say what is in use. */
    cameraStatus: () => ({
      transport: activeTransport(),
      caps: store.cam.caps || (store.cam.caps = engineCaps()),
      direct: store.cam.cams.length > 0,
      tiles: tiles(),
    }),
  };
}
