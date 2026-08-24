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
  GET_PRINT_ZIP: 'sw_GetPrintZip',                 // -> { name, content }
  GET_FILE_FILAMENT_MAPPING: 'sw_GetFileFilamentMapping',   // { filename }
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
export const CAMERA_FRAME_ROOT = 'timelapse';
export const CAMERA_FRAME_FILE = 'monitor.jpg';
export const CAMERA_INTERVAL = 2;         // seconds; what the shipped page asks for

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

/** The popup's three toggles, in the order the shipped UI lists them. */
export const PRINT_PREFERENCES = [
  { key: TASK_CONFIG.FLOW_CALIBRATE, label: 'Extrusion Flow Calibration' },
  { key: TASK_CONFIG.TIME_LAPSE, label: 'Time-lapse Camera' },
  { key: TASK_CONFIG.AUTO_LEVEL, label: 'Auto Leveling' },
];

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
