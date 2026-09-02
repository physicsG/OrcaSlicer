/*
 * send.js - packaging, uploading, starting, and ending the dialog.
 *
 * Four things this gets right that the previous reconstruction did not, all of them
 * read off the host rather than guessed:
 *
 * 1. THE FILE COMES AS A URL. `sw_GetFileStream {is_zip:true}` writes the zip to disk and
 *    returns `{file_name, file_url, origin_size, checksum}` - a localhost URL on Orca's
 *    own page server, the one already serving this document. `sw_GetPrintZip` returns
 *    the BYTES, from a `std::vector<char>` that nlohmann serialises as one integer per
 *    byte: a 12 MB zip crosses the webview bridge as ~40 MB of JSON. The URL is 90.
 *
 * 2. THE UPLOAD IS OURS. Orca does not upload; the LAN route is a multipart POST to
 *    `/server/files/upload` on the printer, which is why the bundle reads the LAN IP to
 *    do it. So the progress bar is a byte count from `XMLHttpRequest.upload.onprogress`
 *    and not a timer - the old one counted to 100 in 600ms whether or not anything was
 *    being sent.
 *
 * 3. `sw_StartLocalPrint` REFUSES `{}`. Its first statement wants `{type, path}` and
 *    fails the request without them (SSWCP.cpp:2595). The old page sent `{}`, which
 *    means the send stopped on its first real command every time.
 *
 * 4. CLOSING IS TWO COMMANDS AND ONLY THE SECOND CLOSES. `sw_SetFilamentMappingComplete`
 *    records the outcome and deliberately does not end the modal;
 *    `sw_FinishFilamentMapping` reads what was recorded and calls SafeEndModal. Doing
 *    them in one step is the race SafeEndModal exists to survive.
 *    See docs/u1-webui/03-print-processing/02-lifecycle.md
 */
'use strict';

import { CMD, MAPPING_STATUS } from '../../../shared/js/protocol.js';

/**
 * The Send button's eight states.
 *
 * `A.Jb.aKO()` switches on the view-model's state and returns a colour; `A.Jb.aEL()`
 * shows a spinner instead of a label whenever the state is "in flight". Both are the
 * bundle's, which is why there are five colours for eight states.
 */
export const SEND_STATE = {
  IDLE: 'idle',              // 7/0 -> grey
  PACKAGING: 'packaging',    // 2   -> amber
  UPLOADING: 'uploading',    // 3   -> amber
  STARTING: 'starting',      // 4   -> amber
  READY: 'ready',            // 1   -> blue
  DONE: 'done',              // 5   -> green
  FAILED: 'failed',          // 6   -> red
};

export const BUSY = new Set([SEND_STATE.PACKAGING, SEND_STATE.UPLOADING,
                             SEND_STATE.STARTING]);

/**
 * POST the file to the printer, reporting real bytes.
 *
 * Kept behind an injectable `xhrFactory` for one reason: the only honest way to test an
 * upload's progress is to drive the events, and a test that stubs `window.fetch` is
 * testing its own stub. A drive script hands in an XHR whose `upload` emits what it
 * wants to see.
 */
export function uploadToPrinter({ url, blob, filename, onProgress, xhrFactory }) {
  return new Promise((resolve, reject) => {
    const xhr = (xhrFactory || (() => new XMLHttpRequest()))();
    xhr.open('POST', url, true);
    xhr.upload.onprogress = (e) => {
      // `lengthComputable` is false for a chunked body; reporting a fraction we do not
      // have is how a bar comes to move on its own.
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve(xhr.responseText)
      : reject(new Error(`upload failed: HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('upload failed: network error'));
    const form = new FormData();
    form.append('file', blob, filename);
    // Moonraker prints on upload when told to; the popup starts the job itself so that
    // the mapping and the preferences are written first.
    form.append('print', 'false');
    xhr.send(form);
  });
}

/**
 * Run the whole send.
 *
 * `deps` is every seam that talks to something outside this module, so the sequence
 * itself can be driven without a printer, a host or a network.
 */
export async function runSend(deps) {
  const { bridge, device, onState, onProgress, fetchFn = fetch, upload = uploadToPrinter,
          withPrintSetup = true } = deps;
  const set = (s, detail) => onState && onState(s, detail);

  try {
    set(SEND_STATE.PACKAGING);
    const stream = await bridge.request(CMD.GET_FILE_STREAM, { is_zip: true });
    if (!stream || !stream.file_url) {
      throw new Error('sw_GetFileStream returned no file_url');
    }

    // Orca's own HTTP server, same origin family as this page.
    const res = await fetchFn(stream.file_url);
    if (!res.ok) throw new Error(`could not read the packaged file: HTTP ${res.status}`);
    const blob = await res.blob();

    set(SEND_STATE.UPLOADING);
    const host = printerHost(device);
    if (!host) throw new Error('no printer address to upload to');
    await upload({
      url: `${host}/server/files/upload`,
      blob,
      filename: stream.file_name,
      onProgress: (loaded, total) => onProgress && onProgress(loaded / total, loaded, total),
    });
    onProgress && onProgress(1, stream.origin_size, stream.origin_size);

    if (withPrintSetup) {
      set(SEND_STATE.STARTING);
      // The two parameters the handler will not run without.
      await bridge.request(CMD.START_LOCAL_PRINT, {
        type: 'local',
        path: `gcodes/${stream.file_name}`,
      });
    }

    await report(bridge, 'success');
    await close(bridge, MAPPING_STATUS.SUCCESS);
    set(SEND_STATE.DONE);
    return true;
  } catch (e) {
    // The outcome report is separate from closing, and a failure reports without
    // closing: `sw_FinishPreprint` with anything but "success" clears the dialog's
    // switch-to-device flag, and the operator keeps a dialog they can retry from.
    await report(bridge, 'failed').catch(() => {});
    set(SEND_STATE.FAILED, e.message);
    return false;
  }
}

async function report(bridge, status) {
  await bridge.request(CMD.FINISH_PREPRINT, { status });
}

/**
 * The close protocol. Record, then end - two commands, in that order.
 *
 * Exported because cancelling takes the same path with the other outcome, and a second
 * spelling of it is how the ordering gets lost.
 */
export async function close(bridge, status) {
  await bridge.request(CMD.SET_FILAMENT_MAPPING_COMPLETE, { status });
  await bridge.request(CMD.FINISH_FILAMENT_MAPPING, {});
}

/**
 * Where to POST.
 *
 * The device record is Orca's `DeviceInfo`, and the page already talks straight to the
 * printer elsewhere on this port - the ACE override store and the G-code console are
 * both plain HTTP against Moonraker on 7125.
 */
export function printerHost(device) {
  if (!device) return null;
  const ip = device.ip || device.dev_ip || device.address;
  if (!ip) return null;
  return `http://${ip}:7125`;
}
