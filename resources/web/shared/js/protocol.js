/*
 * protocol.js - constants recovered by reverse engineering the shipped Flutter
 * bundle (orca 2.3.26, build 20260813142841).
 *
 * SHARED between both reconstructed surfaces:
 *   resources/web/device_page/       the Device tab       (?path=2)
 *   resources/web/print_processing/  the print popup      (?path=4 / ?path=5)
 *
 * Both surfaces are the same Flutter app at different routes, they reach Orca
 * over the same bridge, and they read the same machine-state objects - so the
 * command names, the state model and the fault decoder are common to both.
 * Anything that is genuinely one-surface-only is marked as such below.
 *
 * Every value here is traceable to docs/u1-webui/. Nothing is invented.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * SSWCP bridge commands (docs: 02-bridge-sswcp/02-command-reference.md)
 * ------------------------------------------------------------------ */
export const CMD = {
  // connection / identity
  GET_CONNECTED_MACHINE: 'sw_GetConnectedMachine',   // ONLY returns a device whose
                                                    // connected flag is true; empty
                                                    // otherwise. Use the list below
                                                    // to show saved-but-idle machines.
  GET_LOCAL_DEVICES: 'sw_GetLocalDevices',           // -> bare ARRAY of DeviceInfo
  SUBSCRIBE_LOCAL_DEVICES: 'sw_SubscribeLocalDevices',  // pushes the same bare array

  // ---- bringing a session up ---------------------------------------------
  // The page drives the transport; Orca only owns the socket. See
  // docs/u1-webui/02-device-page/06-connection.md
  FILE_LOG: 'sw_FileLog',            // { level, content } -> Orca's own log file
  GET_USER_LOGIN_STATE: 'sw_GetUserLoginState',  // -> { status, userid, nickname, ... }
  // Opens ORCA's own login dialog on Snapmaker's real login page (id.snapmaker.com).
  // The page never sees a credential; it asks for the dialog and re-reads the state.
  USER_LOGIN: 'sw_UserLogin',                   // { show }
  GET_PINCODE: 'sw_GetPincode',                 // { ip, userid, nickname, port=1884 }
  CREATE_MQTT_CLIENT: 'sw_create_mqtt_client',  // { server_address, clientId, ca?, cert?,
                                                //   key?, username?, password?,
                                                //   clean_session? } -> { type, id }
  MQTT_CONNECT: 'sw_mqtt_connect',              // { id }
  MQTT_DISCONNECT: 'sw_mqtt_disconnect',        // { id }
  MQTT_SUBSCRIBE: 'sw_mqtt_subscribe',          // { id, topic, qos } + event_id;
                                                //   pushes { topic, data } where
                                                //   data is the raw payload string
  MQTT_PUBLISH: 'sw_mqtt_publish',              // { id, topic, qos, payload }
  MQTT_SET_ENGINE: 'sw_mqtt_set_engine',        // { engine_id, ip, port, sn, code?, ca?,
                                                //   cert?, key?, user?, password?,
                                                //   need_reload? }
  GET_MACHINE_SYSTEM_INFO: 'sw_GetMachineSystemInfo',
  GET_PRINTER_INFO: 'sw_GetPrinterInfo',
  GET_SOFTWARE_INFO: 'sw_GetSoftwareInfo',

  // state
  SET_SUBSCRIBE_FILTER: 'sw_SetSubscribeFilter',      // params: { objects }
  SUBSCRIBE_MACHINE_STATE: 'sw_SubscribeMachineState', // needs event_id, no params
  GET_MACHINE_STATE: 'sw_GetMachineState',            // params: { objects }
  STOP_SUBSCRIPTION: 'sw_StopMachineStateSubscription',
  EXCEPTION_QUERY: 'sw_exception_query',

  // print job
  PRINT_PAUSE: 'sw_MachinePrintPause',
  PRINT_RESUME: 'sw_MachinePrintResume',
  PRINT_CANCEL: 'sw_MachinePrintCancel',
  PRINT_START: 'sw_MachinePrintStart',

  // hardware control
  CONTROL_BED_TEMP: 'sw_ControlBedTemp',           // { temp }
  CONTROL_EXTRUDER_TEMP: 'sw_ControlExtruderTemp', // { temp, index, map }
  CONTROL_MAIN_FAN: 'sw_ControlMainFan',           // { speed }
  CONTROL_GENERIC_FAN: 'sw_ControlGenericFan',     // { name, speed }
  CONTROL_LED: 'sw_ControlLed',                    // { name, white }
  CONTROL_PRINT_SPEED: 'sw_ControlPrintSpeed',     // { percentage }
  CONTROL_PURIFIER: 'sw_ControlPurifier',
  SEND_GCODES: 'sw_SendGCodes',                    // { script }

  // files on the machine
  FILES_ROOTS: 'sw_MachineFilesRoots',
  FILE_LIST_PAGE: 'sw_GetFileListPage',            // { root, page_number, files_per_page }
  FILES_GET_DIRECTORY: 'sw_MachineFilesGetDirectory',  // { path, extended }
  FILES_METADATA: 'sw_MachineFilesMetadata',       // { filename }
  FILES_THUMBNAILS: 'sw_MachineFilesThumbnails',   // { filename }
  DELETE_MACHINE_FILE: 'sw_DeleteMachineFile',     // { path }

  // camera + timelapse
  CAMERA_START: 'sw_CameraStartMonitor',           // { domain, interval, expect_pw }
                                                   // -> { state, url }; see CAMERA_* below
  CAMERA_STOP: 'sw_CameraStopMonitor',             // { domain }
  TIMELAPSE_LIST: 'sw_GetCameraTimelapseInstance', // { page_index, page_rows, thumbnail_direct }
  TIMELAPSE_DELETE: 'sw_DeleteCameraTimelapse',

  // completed jobs, from Moonraker's history store
  PRINT_HISTORY: 'sw_GetPrintHistory',            // { limit, start, order }

  // saved-device management
  RENAME_DEVICE: 'sw_RenameDevice',                // { dev_id, dev_name }
  DELETE_DEVICES: 'sw_DeleteDevices',              // { dev_ids }
  SET_DEVICE_NAME: 'sw_SetDeviceName',             // { name } - renames the machine itself
  STORAGE_SPACE: 'sw_GetDeviceDataStorageSpace',
  SYSTEM_DEVICE_INFO: 'sw_SystemGetDeviceInfo',
  DEFECT_DETECTION: 'sw_PrinterDefectDetection',
  DEFECT_CONFIG: 'sw_DefectDetactionConfig',       // note the vendor's spelling

  // diagnostics / system
  EXCEPTION_QUERY: 'sw_exception_query',           // -> the active fault, if any
  MACHINE_OBJECTS: 'sw_GetMachineObjects',         // what the printer exposes
  HEARTBEAT: 'sw_MachineHeartbeat',
  BEDMESH_ABORT: 'sw_BedMesh_AbortProbeMesh',

  // file transfer
  FILE_THUMBNAILS: 'sw_MachineFilesThumbnails',    // { filename }
  FILE_THUMBS_B64: 'sw_FilesThumbnailsBase64',     // { path }
  DOWNLOAD_MACHINE_FILE: 'sw_DownloadMachineFile', // { filename, url }
  FILE_STATUS: 'sw_FileGetStatus',

  // discovery / adding a machine
  FIND_START: 'sw_StartMachineFind',               // { last_time } - a SUBSCRIPTION
  FIND_STOP: 'sw_StopMachineFind',
  ADD_DEVICE: 'sw_AddDevice',                      // opens Orca's own dialog
  CONNECT_OTHER: 'sw_ConnectOtherMachine',         // opens Orca's own dialog

  // ---- print-processing popup only (?path=4 / ?path=5) ------------------
  GET_ACTIVE_FILE: 'sw_GetActiveFile',
  GET_PRINT_LEGAL: 'sw_GetPrintLegal',             // { connected_model } -> { legal, preset_model }
  // The RIGHT door for the file: { is_zip } -> { file_name, file_url, origin_size,
  // checksum }. `file_url` is a localhost URL on Orca's own page HTTP server - the one
  // already serving this document - so the page fetches the zip rather than being
  // handed it. NOT printer-backed: both branches build m_res_data and send_to_js().
  GET_FILE_STREAM: 'sw_GetFileStream',
  // The other one, kept named because it is what the reconstruction used to call:
  // `content` comes from a std::vector<char>, which serialises as one JSON integer per
  // byte. A 12 MB zip crosses as ~40 MB of JSON.
  GET_PRINT_ZIP: 'sw_GetPrintZip',                 // -> { name, content: number[] }
  GET_FILE_FILAMENT_MAPPING: 'sw_GetFileFilamentMapping',   // { filename }
  // Route C: re-address the ACE bays of the current plate's plan. { slots: {fil: bay} },
  // both 0-based. No re-slice - a bay is one argument on each swap line.
  SET_ACE_BAYS: 'sw_SetAceBays',
  UPDATE_MACHINE_FILAMENT_INFO: 'sw_UpdateMachineFilamentInfo',
  SET_FILAMENT_MAPPING_COMPLETE: 'sw_SetFilamentMappingComplete', // { status }
  FINISH_FILAMENT_MAPPING: 'sw_FinishFilamentMapping',
  FINISH_PREPRINT: 'sw_FinishPreprint',            // { status }
  START_LOCAL_PRINT: 'sw_StartLocalPrint',
  START_CLOUD_PRINT: 'sw_StartCloudPrint',
};

/**
 * The two outcome strings sw_SetFilamentMappingComplete accepts.
 *
 * Anything else is treated by the host as an error and raises a native
 * "setting failed" MessageDialog instead of closing the popup.
 * See docs/u1-webui/03-print-processing/02-lifecycle.md
 */
export const MAPPING_STATUS = { SUCCESS: 'success', CANCELED: 'canceled' };

/* ------------------------------------------------------------------ *
 * Machine state model (docs: 03-printer-protocol/03-state-model.md)
 * Recovered verbatim from the bundle's subscription list + field filter.
 * `null` means "every field of this object".
 * ------------------------------------------------------------------ */
export const EXTRUDER_FIELDS = [
  'temperature', 'target', 'power', 'can_extrude',
  'pressure_advance', 'smooth_time', 'state', 'nozzle_diameter',
];

export const SUBSCRIBE_OBJECTS = {
  'extruder':               EXTRUDER_FIELDS,
  'extruder1':              EXTRUDER_FIELDS,
  'extruder2':              EXTRUDER_FIELDS,
  'extruder3':              EXTRUDER_FIELDS,
  'heater_bed':             ['temperature', 'target'],
  'virtual_sdcard':         ['progress', 'file_position', 'is_active', 'file_size', 'file_path'],
  'print_stats':            ['filename', 'state', 'total_duration', 'print_duration',
                             'filament_used', 'message', 'info'],
  'display_status':         ['progress', 'message'],
  'gcode_move':             ['speed_factor', 'speed', 'extrude_factor'],
  'webhooks':               ['state', 'state_message'],
  'idle_timeout':           null,
  'job':                    null,
  'file_metadata':          null,
  'led cavity_led':         ['color_data'],
  'fan':                    ['speed'],
  'fan_generic cavity_fan': ['speed'],
  'print_task_config':      ['filament_vendor', 'filament_type', 'filament_sku',
                             'filament_official', 'filament_sub_type', 'filament_color',
                             'filament_color_rgba', 'extruder_map_table', 'extruders_used',
                             'auto_bed_leveling', 'flow_calibrate', 'flow_calib_extruders',
                             'shaper_calibrate', 'save', 'time_lapse_camera',
                             'auto_replenish_filament', 'can_auto_replenish',
                             'auto_replenish_index', 'filament_edit', 'filament_exist',
                             'filament_soft', 'filament_color_multi', 'extruders_replenished'],
  'motion_report':          null,
  'purifier':               ['power_detected', 'power_det_value', 'mode',
                             'exhaust_fan', 'inner_fan'],
  'filament_feed left':     null,
  'filament_feed right':    null,
  'machine_state_manager':  ['main_state', 'action_code'],
  'filament_detect':        null,
  'defect_detection':       null,
};

/*
 * DeviceInfo, as Orca stores it in app_config and hands back over the bridge.
 * Field names are snake_case and come straight from the C++ struct
 * (src/libslic3r/AppConfig.hpp) - NOT the camelCase a JS client might assume.
 */
export const DEVICE = {
  NAME: 'dev_name',
  MODEL: 'model_name',
  SN: 'sn',
  IP: 'ip',
  CONNECTED: 'connected',
  ID: 'dev_id',
  PRESET: 'preset_name',
  NOZZLES: 'nozzle_sizes',
  // TLS material, empty until the machine has been paired
  CA: 'ca',
  CERT: 'cert',
  KEY: 'key',
  CLIENT_ID: 'clientId',
  USER: 'user',
  PASSWORD: 'password',
  PORT: 'port',
  LINK_MODE: 'link_mode',
};

/** The port the printer listens on for plain-MQTT pairing. */
export const PAIR_PORT = 1884;

/**
 * The LAN authorisation code.
 *
 * NOT a user-entered PIN for an already-bound printer: it is a fixed literal in
 * the shipped bundle (18 occurrences, alongside port 1884), and it is the value
 * the real Device page uses. A captured connect from Orca subscribes
 * `12345678/config/response` and `12345678/config/notification`, which are
 * exactly the topics Moonraker_Mqtt::ask_for_tls_info() derives from
 * `<auth_code>/config/...`.
 *
 * Using it is what lets a bound machine reconnect with no human in the loop.
 * A PIN is only needed when the printer does not already trust our client id.
 */
export const LAN_AUTH_CODE = '12345678';

/** The shipped page sends this on every create; keep parity. */
export const MQTT_KEEPALIVE = 30;

/**
 * The camera does not stream, and it does not push frames.
 *
 * Measured against a U1 (2026-08-24), not inferred: `camera.start_monitor` answers
 * `{ state: 'success', url: '/files/camera/monitor.jpg' }` and then nothing else
 * arrives over MQTT. The printer rewrites that one file at `interval` seconds - which
 * is what the flood of `notify_filelist_changed` for `monitor.jpg` is - and the frame
 * is fetched over HTTP.
 *
 * The `url` it hands back is relative to the printer's own web UI on :80, which serves
 * that path as its single-page shell (2,934 bytes of text/html, not an image). The bytes
 * live on Moonraker's file server instead, under the `timelapse` root that
 * `notify_filelist_changed` names. Verified by fetching it: 96,001 bytes, JPEG SOI.
 *
 * See 05-printer-protocol/06-mqtt-topics.md.
 */
export const CAMERA_DOMAIN = 'lan';        // '' is refused: -32000 "Start monitor failed"
export const MOONRAKER_HTTP_PORT = 7125;

/**
 * Where a recording actually plays from.
 *
 * An instance carries `video_local_url_suffix` - `/files/camera/<name>.mp4` - which is
 * relative to Moonraker's file server, NOT to the printer's web UI. Measured on the
 * machine:
 *
 *   http://<ip>:7125/server/files/camera/<name>.mp4   200 video/mp4  23 MB
 *   http://<ip>/files/camera/<name>.mp4               200 text/html  2.9 KB  <- the SPA
 *
 * The second is the same trap the camera frame hit: port 80 answers any path with its
 * own shell, so a player pointed there fails with nothing useful to say.
 */
export function timelapseUrl(device, instance) {
  const ip = device && device[DEVICE.IP];
  const suffix = instance && (instance.video_local_url_suffix || instance.video_url);
  if (!ip || !suffix) return null;
  if (/^https?:/i.test(suffix)) return suffix;
  return `http://${ip}:${MOONRAKER_HTTP_PORT}/server${suffix}`;
}

/**
 * A print job's own thumbnail, on the printer's file server.
 *
 * `server.history.list` carries `metadata.thumbnails` as
 * `[{width, height, size, relative_path}]` - **paths, no bytes**, the same trap the
 * file browser hit. The bytes are fetched over HTTP from Moonraker, the way the camera
 * frame is. `relative_path` is relative to the gcode's own directory, so a job at the
 * gcodes root resolves under `gcodes/`.
 *
 * Returns null when the file is gone (`exists: false`), because its .thumbs entry went
 * with it and an <img> pointed at a 404 renders as a broken image.
 */
export function jobThumbUrl(device, job, want = 300) {
  const ip = device && device[DEVICE.IP];
  const thumbs = job && job.metadata && job.metadata.thumbnails;
  if (!ip || job.exists === false || !Array.isArray(thumbs) || !thumbs.length) return null;
  // The largest that is not larger than asked for, else the smallest there is.
  const fit = thumbs.filter((t) => Number(t.width) <= want)
                    .sort((a, b) => Number(b.width) - Number(a.width))[0]
           || thumbs.slice().sort((a, b) => Number(a.width) - Number(b.width))[0];
  const rel = fit && fit.relative_path;
  if (!rel) return null;
  const dir = String(job.filename || '').split('/').slice(0, -1).join('/');
  const path = [dir, rel].filter(Boolean).join('/');
  return `http://${ip}:${MOONRAKER_HTTP_PORT}/server/files/gcodes/`
       + path.split('/').map(encodeURIComponent).join('/');
}
export const CAMERA_FRAME_ROOT = 'timelapse';
export const CAMERA_FRAME_FILE = 'monitor.jpg';
export const CAMERA_INTERVAL = 2;         // seconds; what the shipped page asks for

/* ------------------------------------------------------------------ *
 * Cameras, beyond the one monitor file
 *
 * The stock path above is half a frame per second: the printer rewrites ONE file every
 * CAMERA_INTERVAL and the page fetches it. A U1 running paxx12's Extended Firmware
 * serves the same sensor as fast as the client will take it, serves a second USB camera
 * beside it, and offers two streaming transports on top.
 *
 * Measured on 811002511261022618B3, 2026-08-25, and none of this is inferred:
 *
 *   GET :7125/server/webcams/list   ->  4 entries, and only two are cameras:
 *     case      webrtc-camerastreamer  /webcam/snapshot.jpg   1920x1080  226 KB   81 ms
 *     usb       webrtc-camerastreamer  /webcam2/snapshot.jpg  1280x720    87 KB   44 ms
 *     gui       iframe                 /screen/snapshot        480x320   710 B  <- the
 *                                        printer's own touchscreen, not a camera
 *     multiACE  iframe                 (no snapshot_url)      <- a web panel entirely
 *
 * So the list is Moonraker's and anything may register in it. An entry is a camera when
 * it has a snapshot_url; `gui` is offered last and labelled, and multiACE never appears.
 *
 * Chained in WebKitGTK - the engine Orca renders with - the case camera reached
 * **14.0 fps**, which is 28x the monitor file. The webcam entries report
 * `target_fps: 15`, so that IS the printer's cap and asking for 30 buys nothing.
 * ------------------------------------------------------------------ */

/** Moonraker's own camera list. It sends CORS headers; nginx on :80 does not. */
export const MOONRAKER_WEBCAMS = '/server/webcams/list';

/**
 * How a frame gets here. Ordered best-first: `pickTransport` walks this and takes the
 * first the engine can actually do.
 *
 * The two streaming transports are **dead in WebKitGTK** and it is not close - measured
 * in the engine rather than assumed:
 *
 *   canPlayType('video/mp4; codecs="avc1.42E01E")   ->  ""        (empty = no)
 *   MediaSource.isTypeSupported(same)               ->  false     (VP8 is true, so MSE
 *                                                                  is fine; the codec
 *                                                                  is what is missing)
 *   typeof RTCPeerConnection                        ->  "undefined"
 *
 * Windows (WebView2) and macOS (WKWebView) ship both, so this is a per-platform question
 * and never a global answer. It is why AUTO probes rather than picking.
 */
export const CAMERA_TRANSPORT = {
  AUTO:     'auto',
  WEBRTC:   'webrtc',      // POST /webcam/webrtc  -> RTCPeerConnection
  H264:     'h264',        // GET  /webcam/stream.h264 -> MSE
  SNAPSHOT: 'snapshot',    // GET  /webcam/snapshot.jpg, re-pointed on load
  MONITOR:  'monitor',     // camera.start_monitor -> timelapse/monitor.jpg
};

/** Best first. AUTO is not in it: AUTO is the act of walking it. */
export const CAMERA_TRANSPORT_ORDER = [
  CAMERA_TRANSPORT.WEBRTC, CAMERA_TRANSPORT.H264,
  CAMERA_TRANSPORT.SNAPSHOT, CAMERA_TRANSPORT.MONITOR,
];

/**
 * What each one is called and why it might not be offered.
 *
 * The name IS the transport, deliberately. Naming these Smooth/Sharp/Saver reads better
 * until one is greyed out, at which point "not on Linux" is a worse explanation than
 * "this engine has no H.264 decoder" for someone who has to act on it.
 */
export const CAMERA_TRANSPORT_TEXT = {
  [CAMERA_TRANSPORT.AUTO]:     { name: 'Auto',            hint: 'the best this computer can decode' },
  [CAMERA_TRANSPORT.WEBRTC]:   { name: 'WebRTC',          hint: '/webcam/webrtc \u00b7 30 fps',
                                 absent: 'this engine has no WebRTC' },
  [CAMERA_TRANSPORT.H264]:     { name: 'H.264 stream',    hint: '/webcam/stream.h264 \u00b7 30 fps',
                                 absent: 'this engine has no H.264 decoder' },
  [CAMERA_TRANSPORT.SNAPSHOT]: { name: 'Direct snapshot', hint: '/webcam/snapshot.jpg \u00b7 up to 15 fps',
                                 absent: 'this printer has no camera service' },
  [CAMERA_TRANSPORT.MONITOR]:  { name: 'Monitor file',    hint: 'camera.start_monitor \u00b7 0.5 fps' },
};

/** How many pictures at once. */
export const CAMERA_VIEW = { SINGLE: 'single', SPLIT: 'split', GRID: 'grid', PIP: 'pip' };

/** How many tiles each view draws. */
export const CAMERA_VIEW_TILES = {
  [CAMERA_VIEW.SINGLE]: 1, [CAMERA_VIEW.SPLIT]: 2,
  [CAMERA_VIEW.GRID]: 4,   [CAMERA_VIEW.PIP]: 2,
};

/**
 * Frames per second the page asks for.
 *
 * The scale stops at 15 because the printer does: every webcam entry reports
 * `target_fps: 15`, and the 14.0 measured in the engine is that cap rather than a client
 * limit. Offering 30 would offer nothing.
 */
export const CAMERA_FPS_CHOICES = [1, 5, 10, 15];
export const CAMERA_FPS_DEFAULT = 15;

/**
 * What an unfocused tile drops to.
 *
 * A grid is one poll per tile - there is no multiplexed stream to share - so three tiles
 * at 15 fps is 4.7 MB/s, dominated entirely by the case camera's 226 KB frame (the USB
 * camera is 87 KB and the touchscreen is 710 bytes). Polling only the focused tile fast
 * brings that to 3.5 MB/s, and it is one number rather than a policy.
 */
export const CAMERA_FPS_UNFOCUSED = 1;

/** Moonraker registers non-cameras in the same list. A camera has a still to fetch. */
export function isCamera(w) {
  return !!(w && w.enabled !== false && w.snapshot_url);
}

/**
 * The touchscreen is in the webcam list and is not a camera.
 *
 * It is genuinely useful as a tile - it shows what the printer thinks it is doing - so
 * it is offered, last, under its own name rather than sitting in the camera list
 * unexplained.
 */
export const CAMERA_SCREEN_NAME = 'gui';
export const CAMERA_LABELS = { case: 'Case', usb: 'USB', gui: 'Screen' };
export function cameraLabel(w) {
  const n = String((w && w.name) || '');
  return CAMERA_LABELS[n] || (n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Camera');
}

/**
 * A camera's still, absolute.
 *
 * `snapshot_url` is relative to the printer's web UI on **:80**, which is where it
 * genuinely lives - unlike the monitor file, whose reply names a :80 path that answers
 * with the SPA shell. nginx there sends no `Access-Control-Allow-Origin` at all, so an
 * `<img>` loads it (images are not CORS-restricted unless their pixels are read) and a
 * `fetch()` of the identical URL fails "Load failed". Both measured. Display with
 * `<img>`; never fetch a frame.
 */
export function snapshotUrl(device, w) {
  const ip = device && device[DEVICE.IP];
  const rel = w && w.snapshot_url;
  if (!rel) return null;
  // Absolute already, which is also how the simulator hands back a frame: a data: URI,
  // the same shape the monitor reply uses.
  if (/^(data:|blob:|https?:)/i.test(rel)) return rel;
  if (!ip) return null;
  return `http://${ip}${rel.startsWith('/') ? '' : '/'}${rel}`;
}

/** Where the camera list is asked for. Moonraker, because :80 refuses cross-origin. */
export function webcamListUrl(device) {
  const ip = device && device[DEVICE.IP];
  return ip ? `http://${ip}:${MOONRAKER_HTTP_PORT}${MOONRAKER_WEBCAMS}` : null;
}

/**
 * What this engine can decode. Three one-line tests, run once.
 *
 * Deliberately not cached across reloads: it is a property of the running webview, and
 * Orca's is WebKitGTK on Linux, WebView2 on Windows and WKWebView on macOS. A value
 * remembered from one is wrong on the next.
 */
export function engineCaps() {
  const mp4 = 'video/mp4; codecs="avc1.42E01E"';
  let h264 = false;
  try {
    h264 = (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mp4))
        || document.createElement('video').canPlayType(mp4) !== '';
  } catch { h264 = false; }
  return { h264, webrtc: typeof RTCPeerConnection !== 'undefined' };
}

/**
 * The best transport that both ends can do.
 *
 * `direct` says the printer answered the webcam list with at least one camera, which is
 * how the extended firmware is DETECTED rather than configured. Without it the only
 * thing on offer is the monitor file, which is what every stock U1 has and what this
 * page did before.
 */
export function pickTransport(caps, direct) {
  return CAMERA_TRANSPORT_ORDER.find((t) => transportUsable(t, caps, direct))
      || CAMERA_TRANSPORT.MONITOR;
}

export function transportUsable(t, caps, direct) {
  if (t === CAMERA_TRANSPORT.MONITOR) return true;
  if (!direct) return false;
  if (t === CAMERA_TRANSPORT.WEBRTC) return !!(caps && caps.webrtc);
  if (t === CAMERA_TRANSPORT.H264) return !!(caps && caps.h264);
  return true;                                   // SNAPSHOT, once there is a camera
}

/** True when a saved device already carries the mTLS material to connect directly. */
export function hasTlsMaterial(d) {
  return !!(d && d[DEVICE.CA] && d[DEVICE.CERT] && d[DEVICE.KEY]);
}

/**
 * Normalise a device-list response.
 *
 * `sw_GetLocalDevices` replies with a bare array (`m_res_data = devices`), and so
 * does the `sw_SubscribeLocalDevices` push. Accept the `{devices: [...]}` wrapper
 * too, so a hand-written mock that guessed wrong still works.
 */
export function asDeviceList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.devices)) return data.devices;
  return [];
}

/** A human label for a device, preferring the name the user gave it. */
export function deviceLabel(d) {
  if (!d) return 'Unconnected';
  return d[DEVICE.NAME] || d[DEVICE.MODEL] || d[DEVICE.SN] || 'Unknown device';
}

/** Klipper names the first toolhead `extruder`, not `extruder0`. */
export const TOOLHEADS = ['extruder', 'extruder1', 'extruder2', 'extruder3'];

/*
 * `print_task_config` is the single biggest thing the two surfaces share.
 *
 * The Device tab READS it - to label each toolhead with the filament loaded.
 * The print popup WRITES it - the filament mapping and the three preference
 * toggles are edits to these same fields. Same object, different verb.
 */
/**
 * Filament colour -> a CSS colour, from any of the three forms that reach us.
 *
 * Measured on a U1: `filament_color` is an **ARGB integer** (4294198070 = 0xFFF44336)
 * and `filament_color_rgba` is hex **without a leading #** ("F44336FF", RRGGBBAA). The
 * simulator used to send '#E03131FF', which is why assigning the value straight to
 * `style.background` worked in tests and silently did nothing on hardware - an invalid
 * CSS colour is dropped, not reported.
 *
 * Returns null when there is no usable colour, so callers can fall back deliberately
 * rather than painting an empty string.
 *
 * **A fully transparent value is NOT black.** The alpha is carried in both forms and was
 * being discarded, so `00000000` - which is the machine's way of saying *no colour* -
 * came back `#000000` and got painted. multiACE writes exactly that:
 * `_clear_filament_display()` sends
 * `SET_PRINT_FILAMENT_CONFIG FILAMENT_TYPE="" FILAMENT_COLOR_RGBA=00000000 VENDOR=""`
 * to every feeder head when the machine enters head mode, and the panel drew four black
 * spools. Reported as "switching between ACE modes switches filaments, blacks them".
 *
 * Opaque black is `FF000000` as an ARGB integer and `000000FF` as RRGGBBAA, and both
 * still come back `#000000` - it is only alpha ZERO that is an absence.
 */
export function cssColor(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    // ARGB: the alpha rides in the top byte and the rest is plain RGB
    const n = v >>> 0;
    if ((n >>> 24) === 0) return null;          // alpha 0 - an absence, not black
    return '#' + (n & 0xFFFFFF).toString(16).padStart(6, '0').toUpperCase();
  }
  const t = String(v).trim().replace(/^#/, '');
  if (/^[0-9a-f]{8}$/i.test(t)) {
    return /^00$/i.test(t.slice(6)) ? null : '#' + t.slice(0, 6).toUpperCase();
  }
  if (/^[0-9a-f]{6}$/i.test(t)) return '#' + t.slice(0, 6).toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(t)) return '#' + t.replace(/./g, (c) => c + c).toUpperCase();
  return null;
}

/** Is a CSS colour dark enough to need light text on top? */
export function isDarkColor(v) {
  const c = cssColor(v);
  if (!c) return false;
  const n = parseInt(c.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 140;
}

/*
 * multiACE has a module of its own: shared/js/multiACE.js.
 *
 * Its macro names, unit letters, dryer presets, humidity buckets, override-store URL and
 * state model were here and in state.js and in a view, which is three places to look for
 * one subsystem - and is how the panel came to read bay identity from a source that does
 * not carry it. Everything about the ACE is in that one file now, and it is what every
 * part that touches an ACE calls.
 */

/**
 * purifier.mode is an INTEGER on the wire, not the 'inner'/'exhaust' strings the page
 * used to send - which is why the status row showed a bare "0".
 *
 * Only `0` is measured (an idle U1 with no purifier attached: power_detected false).
 * The names for 1 and 2 are inferred from the two modes the shipped page offers and are
 * NOT verified - confirming them means changing the mode on a real machine, which is a
 * physical action rather than a read. Treat the labels as provisional; the integer is
 * what goes on the wire either way.
 */
export const PURIFIER_MODES = { 0: 'Off', 1: 'Recirculation Mode', 2: 'Exhaust Mode' };

/**
 * The commands the PRINTER answers, as opposed to the ones Orca answers itself.
 *
 * It matters because their replies arrive shaped differently. A printer-backed handler
 * routes the reply through `on_mqtt_msg_arrived`, which assigns the JSON-RPC envelope
 * verbatim (`m_res_data = response`, SSWCP.cpp:1194) into `payload.data` (:946) - so the
 * caller receives `{jsonrpc, result, id}` and the payload it wants is one level down.
 * Everything else answers with its payload directly.
 *
 * Derived from SSWCP.cpp by finding every handler whose body reaches
 * `on_mqtt_msg_arrived`, and re-derived by the conformance suite so it cannot drift.
 *
 * Two were wrong until the derivation learned to end a handler at its own closing brace
 * rather than at the next `sw_*` signature: `sw_GetFileStream` and
 * `sw_UnsubscribeCacheKeys` both build `m_res_data` and call `send_to_js()`, and were
 * credited with an `on_mqtt_msg_arrived` belonging to a function declared between them
 * and the next handler the regex could see. The list and the check were written from the
 * same derivation, so they agreed with each other and not with the C++. `sw_GetFileStream`
 * is the one that would have bitten: it is how the print dialog fetches the file, and a
 * client unwrapping it looks one level too deep for `file_url`.
 */
export const PRINTER_BACKED = new Set([
  'sw_BedMesh_AbortProbeMesh', 'sw_CameraStartMonitor', 'sw_CameraStopMonitor',
  'sw_CancelPullCloudFile', 'sw_ControlBedTemp', 'sw_ControlExtruderTemp',
  'sw_ControlGenericFan', 'sw_ControlLed', 'sw_ControlMainFan', 'sw_ControlPrintSpeed',
  'sw_ControlPurifier', 'sw_DefectDetactionConfig', 'sw_DeleteCameraTimelapse',
  'sw_DeleteMachineFile', 'sw_FileGetStatus', 'sw_FilesThumbnailsBase64',
  'sw_GetCameraTimelapseInstance', 'sw_GetDeviceDataStorageSpace', 'sw_GetFileListPage',
  'sw_GetMachineObjects', 'sw_GetMachineState', 'sw_GetPrintHistory', 'sw_GetPrintInfo',
  'sw_GetSystemInfo', 'sw_MachineFilesGetDirectory', 'sw_MachineFilesMetadata',
  'sw_MachineFilesRoots', 'sw_MachineFilesThumbnails', 'sw_MachineHeartbeat',
  'sw_MachinePrintCancel', 'sw_MachinePrintPause', 'sw_MachinePrintResume',
  'sw_MachinePrintStart', 'sw_PrinterDefectDetection', 'sw_PullCloudFile', 'sw_SendGCodes',
  'sw_ServerClientManagerSetUserinfo', 'sw_SetDeviceName', 'sw_SetMachineSubscribeFilter',
  'sw_StartCloudPrint', 'sw_StartLocalPrint', 'sw_SystemGetDeviceInfo',
  'sw_UnSubscribeMachineState',
  'sw_UploadAsyncTimelapseInstance', 'sw_UploadCameraTimelapse', 'sw_exception_query'
]);

export const TASK_CONFIG = {
  // filament, per toolhead slot (parallel arrays)
  VENDOR: 'filament_vendor',
  TYPE: 'filament_type',
  COLOR: 'filament_color',
  COLOR_RGBA: 'filament_color_rgba',
  EXISTS: 'filament_exist',
  // mapping
  MAP_TABLE: 'extruder_map_table',
  USED: 'extruders_used',
  // the popup's three Print Preferences toggles
  FLOW_CALIBRATE: 'flow_calibrate',
  TIME_LAPSE: 'time_lapse_camera',
  AUTO_LEVEL: 'auto_bed_leveling',
};

/**
 * The three toggles, in the order the shipped UI lists them.
 *
 * `key` reads the state, `arg` writes it, and they are two fields because for one of the
 * three they are not the same word: the machine reports `auto_bed_leveling` and the macro
 * that sets it takes `BED_LEVEL`. Recovered from the shipped bundle, where the toggle
 * writes into a map literally keyed `["bed_level", "flow_calibrate", "time_lapse_camera"]`
 * and that map is what `SET_PRINT_PREFERENCES` is built from. Sending `AUTO_BED_LEVELING=`
 * is an argument the macro does not have, which a G-code macro answers `ok` to.
 */
export const PRINT_PREFERENCES = [
  { key: TASK_CONFIG.FLOW_CALIBRATE, arg: 'flow_calibrate', label: 'Extrusion Flow Calibration' },
  { key: TASK_CONFIG.TIME_LAPSE, arg: 'time_lapse_camera', label: 'Time-lapse Camera' },
  { key: TASK_CONFIG.AUTO_LEVEL, arg: 'bed_level', label: 'Auto Leveling' },
];

/* ------------------------------------------------------------------ *
 * Writing print_task_config
 *
 * `print_task_config` is READ off the state stream and WRITTEN with G-code macros - four
 * of them, none of which appears in `printer.gcode.help` and all four recovered verbatim
 * from the shipped bundle (`setPrintFilamentConfig` / `setPrePrintConfiguration` in
 * main.dart.js; see docs/u1-webui/02-device-page/12-orca-integration.md).
 *
 * They are here rather than in a panel because two surfaces send them and because the
 * quoting differs between the two families, which is exactly the kind of detail that
 * gets re-derived slightly wrong the second time:
 *
 *   SET_PRINT_FILAMENT_CONFIG   KEY='value'   single-quoted; a vendor with a space in it
 *                                             is one argument only because of the quotes
 *   SET_PRINT_PREFERENCES       KEY=value     bare, and the key is upper-cased from the
 *                                             `print_task_config` field name
 *
 * What does NOT write print_task_config is `sw_UpdateMachineFilamentInfo`. That name
 * reads like the write and is not one: it never reaches the printer. See
 * device_page/js/core/orcasync.js.
 * ------------------------------------------------------------------ */
export const PRINT_TASK = {
  FILAMENT_CONFIG: 'SET_PRINT_FILAMENT_CONFIG',
  PREFERENCES: 'SET_PRINT_PREFERENCES',
  EXTRUDER_MAP: 'SET_PRINT_EXTRUDER_MAP',
  USED_EXTRUDERS: 'SET_PRINT_USED_EXTRUDERS',
};

/**
 * `SET_PRINT_FILAMENT_CONFIG` + `{CONFIG_EXTRUDER: 3, FILAMENT_TYPE: 'PETG'}`
 * -> `SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER='3' FILAMENT_TYPE='PETG'`
 *
 * Null and undefined are dropped, as the bundle drops them - the macro treats an absent
 * argument as "leave this field alone", so passing an empty string instead would clear
 * the field rather than skip it. An empty string is therefore kept: it is a value.
 */
export function quotedLine(macro, args) {
  return [macro].concat(
    Object.entries(args || {})
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}='${v}'`)).join(' ');
}

/** `SET_PRINT_EXTRUDER_MAP` + `{CONFIG_EXTRUDER: 0}` -> `SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=0`. */
export function plainLine(macro, args) {
  return [macro].concat(
    Object.entries(args || {})
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${v}`)).join(' ');
}

/**
 * `SET_PRINT_PREFERENCES` + `{flow_calibrate: true}` -> `... FLOW_CALIBRATE=1`.
 *
 * Keyed by PRINT_PREFERENCES `arg`, not by the state field name. Booleans go out as 1/0
 * because that is what the bundle sends: it keeps two parallel maps of the same three
 * toggles, bools for the checkboxes and ints for the wire, and the int one is the one
 * the macro line is built from.
 */
export function prefsLine(prefs) {
  const args = Object.entries(prefs || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k.toUpperCase()}=${typeof v === 'boolean' ? (v ? 1 : 0) : v}`);
  return args.length ? [PRINT_TASK.PREFERENCES].concat(args).join(' ') : '';
}

/* ------------------------------------------------------------------ *
 * Control limits - DEVICE TAB ONLY.
 * (docs: 02-device-page/03-strings-and-controls.md)
 * Taken from the shipped validation strings, not guessed.
 * ------------------------------------------------------------------ */
export const LIMITS = {
  // "Heated bed temperature must be set between 0°C and 100°C"
  bedTemp:    { min: 0,  max: 100, unit: '°C' },
  // "Print speed must be set between 50% and 150%"
  printSpeed: { min: 50, max: 150, unit: '%' },
  // not stated in the bundle's validation strings; Klipper's own range
  fanSpeed:   { min: 0,  max: 100, unit: '%' },
  nozzleTemp: { min: 0,  max: 350, unit: '°C' },
};

export const NAMED = {
  cavityLed: 'cavity_led',
  cavityFan: 'cavity_fan',
};

/* ------------------------------------------------------------------ *
 * Error codes (docs: 05-errors/01-error-codes.md)
 * 16 hex digits: SSSS MMMM UUUU EEEE
 * ------------------------------------------------------------------ */
export const SUBSYSTEMS = {
  '0522': 'system / motion',
  '0523': 'toolhead',
  '0525': 'filament',
  '0526': 'heated bed',
  '0527': 'chamber',
  '0528': 'homing / axis',
  '0530': 'calibration / detection',
  '0531': 'job / storage',
  '0532': 'defect detection (vision)',
  '0533': 'top cover / chamber',
};

/** Decode a 16-hex-digit U1 error code into its four groups. */
export function decodeErrorCode(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim();
  if (!/^[0-9A-Fa-f]{16}$/.test(c)) return null;
  const subsystem = c.slice(4, 8);
  return {
    code: c.toUpperCase(),
    errorClass: c.slice(0, 4),
    subsystem,
    subsystemName: SUBSYSTEMS[subsystem] || 'unknown',
    unitIndex: parseInt(c.slice(8, 12), 16),
    specific: c.slice(12, 16),
    // per-head faults number their toolhead from the unit group
    toolhead: (subsystem === '0523' || subsystem === '0525')
      ? parseInt(c.slice(8, 12), 16) + 1
      : null,
  };
}

/*
 * print_stats.state values.
 *
 * Recovered from the PrintState enum's ordinal->wire-string getter in the
 * bundle, which is the authority here. Note the trap: the Dart enum *member*
 * for ordinal 7 is named `completed`, but the value it puts on the wire is
 * `complete` (Klipper's own spelling). Matching on `completed` never fires.
 */
export const PRINT_STATE = {
  UNKNOWN: 'unknown',     // 0
  READY: 'ready',         // 1
  STANDBY: 'standby',     // 2
  PRINTING: 'printing',   // 3
  PAUSED: 'paused',       // 4
  CANCELLED: 'cancelled', // 5
  ERROR: 'error',         // 6
  COMPLETE: 'complete',   // 7  - enum member is `completed`, wire value is `complete`
};
