/*
 * commands/camera.js - Commands the Camera panel issues.
 *
 * Frames are polled, not pushed. camera.start_monitor needs domain "lan" ("" is rejected
 * -32000) and returns a URL; the printer then rewrites that one file at the monitor
 * interval and the frame is fetched over HTTP from Moonraker's file server.
 *
 * check_coverage.py reads the CMD references out of this file to answer "can a user
 * reach this command", and attributes them to the camera panel because this is the module
 * that panel is handed. That makes the attribution a fact about the imports rather than
 * a promise in a declaration - which is the difference that let a handler nothing called
 * count as implemented for as long as it did.
 */
'use strict';

import { CMD, CAMERA_DOMAIN, CAMERA_INTERVAL }
  from '../../../shared/js/protocol.js';
import * as ui from '../ui.js';

export function create(deps) {
  // `bridge` is deliberately NOT destructured: it does not exist yet when these are
  // built - boot() decides between the real host and the simulator - so it is reached
  // through deps each time rather than captured as null once.
  const { state, store, pending, session, cmd,
          send, setpoint, setStatus, render } = deps;

  let camPump = null;     // re-points the live <img>; frames are polled, not pushed
  let camSub = null;

  /**
   * Poll the live frame.
   *
   * The printer overwrites one file in place, so the URL never changes and the browser
   * would serve its cache forever - hence the cache-buster. The <img> is re-pointed
   * rather than re-created so the visible frame is only replaced once the next one has
   * decoded, which is what keeps the panel from flickering.
   */
  function startCamPump() {
    stopCamPump();
    const tick = () => {
      if (!store.cam.streaming || !store.cam.frameUrl) return stopCamPump();
      const im = ui.$('#cam-live');
      if (im) im.src = `${store.cam.frameUrl}?t=${Date.now()}`;
    };
    camPump = setInterval(tick, CAMERA_INTERVAL * 1000);
  }

  function stopCamPump() {
    if (camPump) clearInterval(camPump);
    camPump = null;
  }

  return {
    startCamera: async () => {
      store.cam.error = '';
      store.cam.streaming = true;
      store.cam.frameUrl = null;
      render();

      // Not a stream and not a frame push. The monitor answers once with a URL, then the
      // printer rewrites that one file every `interval` seconds and the frames are ours
      // to fetch. domain must be 'lan' - '' is refused -32000. See protocol.js CAMERA_*.
      //
      // That answer can arrive down either channel: SSWCP.cpp hands the printer's reply to
      // on_mqtt_msg_arrived, which is the push path, but the bridge also acks the command.
      // Only the MQTT leg has been watched directly, so take the URL from whichever
      // channel produces it first and ignore the second.
      const useUrl = (payload) => {
        const url = ui.cameraFrameUrl(payload, store.device);
        if (!url || url === store.cam.frameUrl) return;
        store.cam.frameUrl = url;
        render();
        startCamPump();
      };

      try {
        camSub = await deps.bridge.subscribe(CMD.CAMERA_START,
          { domain: CAMERA_DOMAIN, interval: CAMERA_INTERVAL, expect_pw: false },
          (data, payload) => useUrl(data !== undefined ? data : payload));
        if (camSub && camSub.ack !== undefined && camSub.ack !== null) useUrl(camSub.ack);
      } catch (e) {
        store.cam.streaming = false;
        store.cam.error = `camera failed: ${e.message}`;
        render();
      }
    },

    stopCamera: async () => {
      store.cam.streaming = false;
      store.cam.frameUrl = null;
      stopCamPump();
      if (camSub && camSub.cancel) camSub.cancel();
      camSub = null;
      render();
      try {
        await deps.bridge.request(CMD.CAMERA_STOP, { domain: CAMERA_DOMAIN });
      } catch { /* already off */ }
    },

    /**
     * Completed jobs from Moonraker's store.history store.
     *
     * `start` pages rather than replacing, so "load more" appends.
     *
     * Measured: the reply's `count` is the number of jobs IN THIS PAGE, not the total -
     * asking for 7 returns count 7 on a machine with 240 jobs. The real total only comes
     * from server.history.totals, which has no bridge command, so paging stops when a
     * short page comes back rather than counting up to a known end.
     */
  };
}
