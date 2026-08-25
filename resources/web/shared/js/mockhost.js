/*
 * mockhost.js - a simulated Orca host + Snapmaker U1, shared by both surfaces.
 *
 * Installs window.wx.postMessage and answers with correctly-shaped WCP packets,
 * including the ack-then-push subscription behaviour and the
 * data:{data:{...},method:""} status envelope Orca produces.
 *
 * Split so the two reconstructions share one simulation:
 *   - the envelope machinery, the subscription bookkeeping, the U1 model and
 *     the commands BOTH surfaces use live here;
 *   - each surface passes its own `handlers` for the commands only it needs.
 *
 * Replies use OK_CODE (200), the same code real Orca sends. A mock that replied
 * 0 would pass its own tests and then fail against the real host.
 */
'use strict';

import { SUBSCRIBE_OBJECTS, TOOLHEADS, PRINTER_BACKED } from './protocol.js';
import { OK_CODE } from './sswcp.js';

const TICK_MS = 1000;

/** A 1x1 PNG, so thumbnail plumbing can be exercised without real artwork. */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Install the simulated host.
 *
 * @param {object}  opts
 * @param {Function} opts.log       trace sink (kind, packet)
 * @param {object}  opts.handlers   extra commands: cmd -> (params, ctx) => data
 * @param {object}  opts.printer    override the simulated printer
 * @returns {{printer, stop}|null}  null if a real host is already present
 */
export function installMockHost({ log = () => {}, handlers = {}, printer: given = null } = {}) {
  if (window.wx && window.wx.__isMock !== true && typeof window.wx.postMessage === 'function') {
    return null;   // a real host is present; never shadow it
  }

  const printer = given || makePrinter();
  const subs = new Map();      // event_id -> true
  let filter = null;

  /**
   * Commands the PRINTER answers come back wrapped in their JSON-RPC envelope, because
   * Orca passes the reply through verbatim (SSWCP.cpp:1194 -> :946). Commands Orca
   * answers itself do not. The simulator used to unwrap everything, which is precisely
   * why a page that read fields off the envelope passed every browser test and showed
   * nothing on hardware.
   */
  let rpcId = 0;

  function reply(header, code, message, data, cmd) {
    let out = data;
    if (cmd && PRINTER_BACKED.has(cmd) && data && typeof data === 'object'
        && !Array.isArray(data) && !('jsonrpc' in data)) {
      out = { jsonrpc: '2.0', result: data, id: ++rpcId,
              cli_time: Math.floor(Date.now() / 1000), dev_time: -1 };
    }
    const packet = { header, payload: { code, message, data: out } };
    log('mock-tx', packet);
    setTimeout(() => window.postMessage(JSON.stringify(packet), '*'), 0);
  }

  const statusEnvelope = (objectMap, method = '') => ({ data: objectMap, method });

  window.wx = {
    __isMock: true,
    postMessage(text) {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      const header = msg.header || {};
      const p = msg.payload || {};
      const { cmd, params = {}, event_id: eventId } = p;
      log('mock-rx', msg);

      const ok = (data) => reply(header, OK_CODE, 'success',
                                 data === undefined ? {} : data, cmd);
      // an optional code, so a handler can reproduce the printer's own
      // (camera.start_monitor answers -32000, not a generic failure)
      const fail = (m, code = -1) => reply(header, code, m, {}, cmd);
      const ctx = { printer, ok, fail, header, eventId, subs, push };

      // A surface's own handlers win, so it can also override a shared one.
      if (Object.prototype.hasOwnProperty.call(handlers, cmd)) {
        const out = handlers[cmd](params, ctx);
        if (out === undefined) return;       // handler replied itself
        return ok(out);
      }

      switch (cmd) {
        /* ---- identity ------------------------------------------------ */
        case 'sw_GetLocalDevices':
          // Real Orca replies with a BARE ARRAY (m_res_data = devices), so the
          // simulation must too, or a client that works here breaks there.
          return ok(printer.devices);
        case 'sw_SubscribeLocalDevices':
          if (eventId) subs.set(eventId, true);
          return ok(printer.devices);

        case 'sw_GetConnectedMachine': {
          // Orca returns the DeviceInfo record of whichever saved device has its
          // connected flag set, and an empty object when none has. Same here, so a
          // client cannot come to depend on fields Orca does not send.
          const conn = printer.devices.find((d) => d.connected);
          return ok(conn ? conn : {});
        }
        case 'sw_GetMachineSystemInfo':
          return ok({ firmware_version: printer.firmware, model: 'Snapmaker U1', sn: printer.sn });
        case 'sw_GetPrinterInfo':
          return ok({ state: 'ready', state_message: 'Printer is ready',
                      hostname: 'snapmaker-u1', software_version: printer.firmware });
        case 'sw_GetSoftwareInfo':
          // Mirrors what Orca reports; the build badge prefers this over version.json.
          return ok({ version: printer.orcaVersion, build_number: printer.orcaBuild,
                      app_name: 'orca' });

        /* ---- state --------------------------------------------------- */
        case 'sw_SetSubscribeFilter':
          filter = params.objects || null;
          return ok({ accepted: Object.keys(filter || SUBSCRIBE_OBJECTS).length });
        case 'sw_GetMachineState':
          return ok(statusEnvelope(printer.snapshot(), 'query'));
        case 'sw_SubscribeMachineState': {
          if (!eventId) return fail('sw_SubscribeMachineState requires an event_id');
          subs.set(eventId, true);
          ok({ subscribed: true });                       // the ack
          setTimeout(() => push(eventId, printer.snapshot()), 30);   // then a full frame
          return;
        }
        case 'sw_StopMachineStateSubscription':
        case 'sw_UnSubscribeMachineState':
        case 'sw_Webview_Unsubscribe':
          if (params.event_id) subs.delete(params.event_id);
          return ok({});
        case 'sw_UnsubscribeAll':
          subs.clear();
          return ok({});

        /* ---- print job ------------------------------------------------ */
        case 'sw_MachinePrintPause':  printer.pause();  return ok({});
        case 'sw_MachinePrintResume': printer.resume(); return ok({});
        case 'sw_MachinePrintCancel': printer.cancel(); return ok({});

        /* ---- hardware ------------------------------------------------- */
        case 'sw_ControlBedTemp':
          printer.bed.target = Number(params.temp) || 0; return ok({});
        case 'sw_ControlExtruderTemp': {
          const i = Number(params.index) || 0;
          if (printer.toolheads[i]) printer.toolheads[i].target = Number(params.temp) || 0;
          return ok({});
        }
        case 'sw_ControlMainFan':
          printer.fanMain = clamp01(Number(params.speed) / 100); return ok({});
        case 'sw_ControlGenericFan':
          printer.fanCavity = clamp01(Number(params.speed) / 100); return ok({});
        case 'sw_ControlLed':
          printer.ledWhite = clamp01(Number(params.white)); return ok({});
        case 'sw_ControlPrintSpeed':
          printer.speedFactor = (Number(params.percentage) || 100) / 100; return ok({});
        case 'sw_ControlPurifier':
          if (params.mode != null) printer.purifierMode = params.mode; return ok({});
        case 'sw_SendGCodes':
          printer.gcodeLog.push(params.script); return ok({ executed: params.script });

        /* ---- bringing a session up ------------------------------------- */
        // Mirrors the real sequence: the printer shows a PIN, the page hands it
        // back with sw_mqtt_set_engine, and Orca stores keys and flips the
        // device's connected flag. See docs/u1-webui/02-device-page/06-connection.md
        case 'sw_GetPincode':
          printer.pendingPin = '4271';
          log('mock-note', { pin: printer.pendingPin });
          return ok({ state: 'success', code: printer.pendingPin });

        case 'sw_create_mqtt_client': {
          if (!params.server_address) return fail('param [server_address] is required');
          if (!params.clientId) return fail('param [clientId] is required');
          const tls = !!(params.ca && params.cert && params.key);
          printer.engineId = 'engine-' + (printer.engineSeq = (printer.engineSeq || 0) + 1);
          printer.engineAddress = params.server_address;
          return ok({ type: tls ? 'mqtts' : 'mqtt', id: printer.engineId });
        }
        case 'sw_mqtt_connect':
          if (params.id !== printer.engineId) return fail('id is illegal');
          return ok({});
        case 'sw_mqtt_disconnect':
          if (params.id && params.id !== printer.engineId) return fail('id is illegal');
          printer.engineId = null;
          printer.devices.forEach((d) => { d.connected = false; });
          setTimeout(() => pushDevices(), 30);
          return ok({});

        case 'sw_mqtt_set_engine': {
          if (params.engine_id !== printer.engineId) return fail('invalid engine');
          const dev = printer.devices.find((d) => d.sn === params.sn);
          if (!dev) return fail('unknown sn');
          const prePaired = !!(params.ca && params.cert && params.key);
          if (!prePaired) {
            // The pairing path needs the code the printer displayed.
            if (!params.code) return fail('pairing requires the code shown on the printer');
            // A bound machine accepts the fixed LAN code with no human involved;
            // an unbound one only accepts the PIN it is displaying.
            const okCode = printer.bound ? '12345678' : printer.pendingPin;
            if (params.code !== okCode) return fail('incorrect pairing code');
            // What ask_for_tls_info() receives back and Orca then stores.
            dev.ca = '-----BEGIN CERTIFICATE-----mock-ca-----END CERTIFICATE-----';
            dev.cert = '-----BEGIN CERTIFICATE-----mock-cert-----END CERTIFICATE-----';
            dev.key = '-----BEGIN PRIVATE KEY-----mock-key-----END PRIVATE KEY-----';
            dev.port = 8883;
            dev.clientId = params.engine_id;
          }
          printer.devices.forEach((d) => { d.connected = d.sn === params.sn; });
          setTimeout(() => pushDevices(), 30);
          return ok({});
        }

        /* ---- machine files --------------------------------------------- */
        case 'sw_MachineFilesRoots':
          return ok(printer.roots);
        case 'sw_GetFileListPage':
          return ok({ files: printer.files, total: printer.files.length });
        case 'sw_MachineFilesGetDirectory':
          return ok({ files: printer.files });
        case 'sw_MachineFilesMetadata':
          return ok(printer.files.find((f) => f.path === params.filename) || {});
        case 'sw_DeleteMachineFile':
          printer.files = printer.files.filter((f) => f.path !== params.path);
          return ok({});
        case 'sw_MachinePrintStart':
          printer.filename = params.filename || printer.filename;
          printer.printState = 'printing';
          printer.mainState = 'printing';
          printer.filePosition = 0;
          return ok({});

        /* ---- camera ----------------------------------------------------- */
        // The camera LIST is not a bridge command on a real printer - it is plain HTTP
        // to Moonraker, which a simulator has none of. It is answered here anyway,
        // because otherwise the camera is the one panel a simulated run cannot exercise
        // at all: with no printer, `discover()` gets a failed fetch and every run falls
        // back to the monitor file, so the tile grid, the transport list and the focus
        // rule would never be executed by any test. See mockWebcams() below, which is
        // what the client actually calls.

        case 'sw_CameraStartMonitor': {
          if (!eventId) return fail('sw_CameraStartMonitor requires an event_id');
          if (params.domain !== 'lan') {
            // what the real firmware does with domain: '' - see 06-mqtt-topics.md
            return fail('Start monitor failed', -32000);
          }
          subs.set(eventId, true);
          // The monitor answers once with a URL and pushes nothing. A real printer
          // names a file on its own HTTP server; a simulator has none, so it hands
          // back a data: URI - which cameraFrameUrl() passes through unchanged
          // precisely so this works without inventing a fake host.
          const FRAME = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL'
                      + 'DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/'
                      + '2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy'
                      + 'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QA'
                      + 'HwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF'
                      + 'BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK'
                      + 'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1'
                      + 'dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG'
                      + 'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+'
                      + 'iiigD//Z';
          return ok({ state: 'success', url: `data:image/jpeg;base64,${FRAME}` });
        }
        case 'sw_CameraStopMonitor':
          return ok({ stopped: true });
        case 'sw_GetCameraTimelapseInstance':
          // `instances` is the printer's own spelling, and thumbnail_base64 only
          // appears when the request asked for thumbnail_direct.
          return ok({ count: printer.timelapses.length, instances: printer.timelapses });
        case 'sw_GetPrintHistory': {
          // server.history.list's own shape: newest first, `jobs`, with the job's
          // metadata nested. status is Klipper's, not a PRINT_STATE.
          const jobs = printer.history || [];
          const start = Number(params.start) || 0;
          const limit = Number(params.limit) || 20;
          const page = jobs.slice(start, start + limit);
          // `count` is the size of THIS page, as the printer reports it - not the total
          return ok({ count: page.length, jobs: page });
        }
        case 'sw_DeleteCameraTimelapse':
          printer.timelapses = printer.timelapses.filter(
            (t) => t.name !== params.name && t.date_index !== params.date_index);
          return ok({});

        /* ---- saved devices ---------------------------------------------- */
        case 'sw_RenameDevice': {
          const d = printer.devices.find((x) => x.dev_id === params.dev_id
                                             || x.sn === params.dev_id);
          if (d) d.dev_name = params.dev_name;
          setTimeout(() => pushDevices(), 20);
          return ok({});
        }
        case 'sw_SetDeviceName':
          return ok({});
        case 'sw_DeleteDevices': {
          const ids = params.dev_ids || [];
          printer.devices = printer.devices.filter(
            (x) => !ids.includes(x.dev_id) && !ids.includes(x.sn));
          setTimeout(() => pushDevices(), 20);
          return ok({});
        }
        case 'sw_GetDeviceDataStorageSpace':
          return ok({ free_space: 5.2, total_space: 8.0, units: 'GB' });
        case 'sw_PrinterDefectDetection':
          Object.assign(printer.defect, params);
          return ok(printer.defect);

        /* ---- diagnostics / system --------------------------------------- */
        case 'sw_exception_query':
          return ok(printer.fault ? { code: printer.fault } : {});
        case 'sw_GetMachineObjects':
          return ok({ objects: Object.keys(printer.snapshot()) });
        case 'sw_MachineHeartbeat':
          printer.heartbeats = (printer.heartbeats || 0) + 1;
          return ok({ alive: true });
        case 'sw_BedMesh_AbortProbeMesh':
          printer.mainState = 'idle';
          return ok({});
        case 'sw_DefectDetactionConfig':
          Object.assign(printer.defect, params);
          return ok(printer.defect);

        /* ---- file transfer ---------------------------------------------- */
        case 'sw_MachineFilesThumbnails':
        case 'sw_FilesThumbnailsBase64':
          return ok({ thumbnail: PNG_1PX });
        case 'sw_DownloadMachineFile':
          printer.transfer = 0;
          return ok({ started: true });
        case 'sw_FileGetStatus':
          printer.transfer = Math.min(1, (printer.transfer ?? 1) + 0.34);
          return ok({ progress: printer.transfer });

        /* ---- discovery --------------------------------------------------- */
        case 'sw_StartMachineFind': {
          if (!eventId) return fail('sw_StartMachineFind requires an event_id');
          subs.set(eventId, true);
          ok({ searching: true });
          // Discovery trickles results in, so push twice.
          const send1 = (list) => {
            if (!subs.has(eventId)) return;
            const packet = { header: { event_id: eventId },
                             payload: { code: OK_CODE, message: 'success', data: list } };
            log('mock-push', packet);
            window.postMessage(JSON.stringify(packet), '*');
          };
          setTimeout(() => send1(printer.discoverable.slice(0, 1)), 500);
          setTimeout(() => send1(printer.discoverable), 1400);
          return;
        }
        case 'sw_StopMachineFind':
          return ok({});
        case 'sw_AddDevice':
        case 'sw_ConnectOtherMachine':
          // Both open a native Orca dialog; there is nothing to simulate.
          return ok({ opened: true });

        /* ---- logging / telemetry the real page emits constantly -------- */
        case 'sw_FileLog': case 'sw_Log': case 'sw_UploadEvent': case 'sw_SetLogLevel':
          return ok({});

        default:
          return fail(`mock: unhandled command ${cmd}`);
      }
    },
  };

  /** The device-card push: a bare array, exactly as GUI_App::device_card_notify sends. */
  function pushDevices() {
    for (const eventId of subs.keys()) {
      const packet = { header: { event_id: eventId },
                       payload: { code: OK_CODE, message: 'success', data: printer.devices } };
      log('mock-push', packet);
      window.postMessage(JSON.stringify(packet), '*');
    }
  }

  function push(eventId, objectMap, method = 'notify_status_update') {
    if (!subs.has(eventId)) return;
    const packet = {
      header: { event_id: eventId },
      payload: { code: OK_CODE, message: 'success',
                 data: statusEnvelope(objectMap, method) },
    };
    log('mock-push', packet);
    window.postMessage(JSON.stringify(packet), '*');
  }

  const timer = setInterval(() => {
    const delta = printer.tick();
    for (const eventId of subs.keys()) push(eventId, delta);
  }, TICK_MS);

  return { printer, webcams: mockWebcams, stop() { clearInterval(timer); } };
}

function clamp01(v) { return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0)); }

/* ------------------------------------------------------------------ *
 * A small but honest U1 simulation: four toolheads, one active at a
 * time, heaters that ramp toward target, a job that progresses.
 * ------------------------------------------------------------------ */
export function makePrinter() {
  const p = {
    sn: 'U1MOCK0000000001',
    name: 'Snapmaker U1 (mock)',
    // What app_config->get_devices() would hold. Field names are the C++
    // struct's, snake_case - see DeviceInfo in src/libslic3r/AppConfig.hpp.
    // One connected and one saved-but-idle, so both paths get exercised.
    devices: [
      // already paired: carries mTLS material, so it reconnects without a PIN
      { ip: '192.168.1.42', dev_id: 'U1MOCK0000000001', dev_name: 'U1 Mock',
        model_name: 'Snapmaker U1', preset_name: 'Snapmaker U1 0.4 nozzle',
        connected: true, sn: 'U1MOCK0000000001', protocol: 1, port: 8883,
        link_mode: 'lan', nozzle_sizes: ['0.4', '0.4', '0.4', '0.4'],
        clientId: 'orca-mock-0001', user: '', password: '',
        ca: '-----BEGIN CERTIFICATE-----mock-ca-----END CERTIFICATE-----',
        cert: '-----BEGIN CERTIFICATE-----mock-cert-----END CERTIFICATE-----',
        key: '-----BEGIN PRIVATE KEY-----mock-key-----END PRIVATE KEY-----' },
      { ip: '192.168.1.77', dev_id: 'U1MOCK0000000002', dev_name: 'U1 Spare',
        model_name: 'Snapmaker U1', preset_name: 'Snapmaker U1 0.4 nozzle',
        connected: false, sn: 'U1MOCK0000000002', protocol: 1, port: 8883,
        link_mode: 'lan', nozzle_sizes: ['0.4', '0.4', '0.4', '0.4'] },
    ],
    firmware: '1.0.0-mock',
    // What sw_GetSoftwareInfo reports - the real bundle's shipped values, so the
    // build badge shows the same number with or without a host.
    orcaVersion: '2.3.26',
    orcaBuild: '20260813142841',
    bed: { temperature: 24, target: 0 },
    toolheads: TOOLHEADS.map((_, i) => ({
      temperature: 24, target: 0, power: 0, can_extrude: false,
      pressure_advance: 0.035, smooth_time: 0.04,
      state: i === 0 ? 'ready' : 'idle', nozzle_diameter: 0.4,
    })),
    active: 0,
    fanMain: 0, fanCavity: 0, ledWhite: 1, speedFactor: 1,
    purifierMode: 'inner',
    printState: 'printing',
    filename: 'mock_multicolor_benchy.gcode',
    printDuration: 0, totalDuration: 0, filamentUsed: 0,
    fileSize: 4_200_000, filePosition: 0,
    mainState: 'printing', actionCode: null,
    exceptions: [],
    gcodeLog: [],
    roots: [{ name: 'gcodes', path: '/data/gcodes' }, { name: 'timelapse', path: '/data/timelapse' }],
    files: [
      { path: 'benchy_4colour.gcode', size: 19341122, modified: 1787300000 },
      { path: 'calibration_cube.gcode', size: 2841100, modified: 1787200000 },
      { path: 'bracket_v3.gcode', size: 7733001, modified: 1787100000 },
    ],
    // shaped like camera.get_timelapse_instance's own reply
    timelapses: [{ gcode_name: 'benchy_4colour', date_index: '20260813182603',
                   generate_date: '2026-08-13', video_duration: '00:13',
                   video_file_size: 23227748, thumbnail_base64: '' }],
    // shaped like server.history.list's own reply
    history: [
      { job_id: '0000F9', filename: 'XYZ Test Cube_PLA_3h58m.gcode', status: 'completed',
        start_time: 1786615464.9, end_time: 1786629800.1, print_duration: 14180.2,
        total_duration: 14335.2, filament_used: 12043.5, user: 'No User' },
      { job_id: '0000F8', filename: 'bracket_v3.gcode', status: 'cancelled',
        start_time: 1786515464.9, end_time: 1786516477.3, print_duration: 900.4,
        total_duration: 1012.4, filament_used: 812.0, user: 'No User' },
      { job_id: '0000F7', filename: 'benchy_4colour.gcode', status: 'klippy_shutdown',
        start_time: 1786415464.9, end_time: 1786415477.3, print_duration: 0.0,
        total_duration: 12.7, filament_used: 0.0, user: 'No User' },
    ],
    defect: { enable: true, sensitivity: 1 },
    // A real 16-hex fault so the banner can be exercised: toolhead subsystem
    // 0523, unit 1 -> "Toolhead 2".
    fault: null,
    transfer: 1,
    heartbeats: 0,
    // already bound to this client id, as the user's U1 is
    bound: true,
    discoverable: [
      { dev_name: 'U1 Bench', ip: '192.168.1.90', sn: 'U1DISCOVER000001', model_name: 'Snapmaker U1' },
      { dev_name: 'U1 Annex', ip: '192.168.1.91', sn: 'U1DISCOVER000002', model_name: 'Snapmaker U1' },
    ],
  };

  // Start mid-job and already up to temperature: an idle printer is a poor
  // exercise of the UI, and a real Device page is almost always opened on a
  // machine that is already running.
  p.bed.target = 60;
  p.bed.temperature = 60;
  p.toolheads[0].target = 220;
  p.toolheads[0].temperature = 219.6;
  p.toolheads[1].target = 215;
  p.toolheads[1].temperature = 214.4;
  p.filePosition = Math.round(p.fileSize * 0.37);
  p.printDuration = 2843;
  p.totalDuration = 2975;
  p.filamentUsed = 4831.5;
  p.fanMain = 0.85;
  p.fanCavity = 0.4;

  p.pause  = () => { p.printState = 'paused';   p.mainState = 'paused'; };
  p.resume = () => { p.printState = 'printing'; p.mainState = 'printing'; };
  p.cancel = () => {
    p.printState = 'cancelled'; p.mainState = 'standby';
    p.bed.target = 0; p.toolheads.forEach((t) => { t.target = 0; });
  };

  function ramp(cur, target) {
    if (target <= 0) return Math.max(24, cur - 1.6);
    const d = target - cur;
    if (Math.abs(d) < 0.6) return target;
    return cur + Math.sign(d) * Math.min(Math.abs(d), 3.2);
  }

  p.tick = () => {
    p.bed.temperature = round1(ramp(p.bed.temperature, p.bed.target));
    p.toolheads.forEach((t, i) => {
      t.temperature = round1(ramp(t.temperature, t.target));
      t.can_extrude = t.temperature > 170;
      t.power = t.target > 0 ? round2(Math.min(1, Math.max(0, (t.target - t.temperature) / 40))) : 0;
      t.state = i === p.active ? (p.printState === 'printing' ? 'printing' : 'ready') : 'idle';
    });

    if (p.printState === 'printing') {
      p.printDuration += 1;
      p.totalDuration += 1;
      p.filamentUsed = round1(p.filamentUsed + 1.7 * p.speedFactor);
      p.filePosition = Math.min(p.fileSize, p.filePosition + Math.round(9000 * p.speedFactor));
      if (p.printDuration % 25 === 0) p.active = (p.active + 1) % 4;
      if (p.filePosition >= p.fileSize) { p.printState = 'complete'; p.mainState = 'standby'; }
    } else if (p.printState !== 'complete') {
      p.totalDuration += 1;
    }
    return p.snapshot();
  };

  p.snapshot = () => {
    const objs = {
      heater_bed: { temperature: p.bed.temperature, target: p.bed.target },
      virtual_sdcard: {
        progress: p.fileSize ? p.filePosition / p.fileSize : 0,
        file_position: p.filePosition, is_active: p.printState === 'printing',
        file_size: p.fileSize, file_path: p.filename,
      },
      print_stats: {
        filename: p.filename, state: p.printState,
        total_duration: p.totalDuration, print_duration: p.printDuration,
        filament_used: p.filamentUsed, message: '', info: {},
      },
      display_status: {
        progress: p.fileSize ? p.filePosition / p.fileSize : 0,
        message: p.printState === 'paused' ? 'Paused' : '',
      },
      gcode_move: { speed_factor: p.speedFactor, speed: 100 * p.speedFactor, extrude_factor: 1 },
      webhooks: { state: 'ready', state_message: 'Printer is ready' },
      fan: { speed: p.fanMain },
      'fan_generic cavity_fan': { speed: p.fanCavity },
      'led cavity_led': { color_data: [[0, 0, 0, p.ledWhite]] },
      purifier: {
        power_detected: true, power_det_value: 12.4, mode: p.purifierMode,
        exhaust_fan: { delay: 0, speedThreshold: 30 },
        inner_fan: { rpm: 2400, delay: 0, work: true, speedThreshold: 30 },
      },
      machine_state_manager: { main_state: p.mainState, action_code: p.actionCode },
      print_task_config: {
        filament_vendor: ['Snapmaker', 'Snapmaker', 'Snapmaker', 'Generic'],
        filament_type: ['PLA', 'PLA', 'PETG', 'ABS'],
        // As the wire carries them: filament_color is an ARGB integer and
        // filament_color_rgba is hex with NO leading '#'. Measured on a U1.
        filament_color: [0xFFE03131, 0xFF1971C2, 0xFF2F9E44, 0xFFF08C00],
        filament_color_rgba: ['E03131FF', '1971C2FF', '2F9E44FF', 'F08C00FF'],
        filament_exist: [true, true, true, true],
        extruders_used: [0, 1, 2, 3],
        extruder_map_table: { 0: 0, 1: 1, 2: 2, 3: 3 },
        flow_calibrate: true,
        time_lapse_camera: false,
        auto_bed_leveling: true,
      },
    };
    TOOLHEADS.forEach((k, i) => { objs[k] = Object.assign({}, p.toolheads[i]); });
    return objs;
  };

  return p;
}

function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }

/**
 * What `/server/webcams/list` answers, shaped exactly as the real one does.
 *
 * Copied from a U1 running paxx12's Extended Firmware on 2026-08-25, down to the
 * `service` strings and the fact that **two of the four entries are not cameras**: the
 * printer registers its own touchscreen as `gui` and the multiACE web panel as
 * `multiACE`. Keeping both here is the point - `isCamera()` has to reject the one with
 * no `snapshot_url`, and a simulator that only ever returned real cameras would never
 * exercise that.
 *
 * `snapshot_url` is a data: URI rather than the real `/webcam/snapshot.jpg`, for the
 * same reason the monitor reply is: there is no HTTP server behind a simulated printer,
 * and `snapshotUrl()` passes an absolute URL through unchanged.
 */
const MOCK_FRAME =
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">'
    + '<rect width="640" height="360" fill="#12181f"/>'
    + '<path d="M120 300 H520 L440 190 H200 Z" fill="#1b2530"/>'
    + '<rect x="290" y="150" width="60" height="42" fill="#8d453c"/>'
    + '<rect x="300" y="96" width="44" height="46" fill="#39434f"/>'
    + '</svg>');

export function mockWebcams() {
  return [
    { name: 'case', enabled: true, service: 'webrtc-camerastreamer',
      target_fps: 15, target_fps_idle: 5, aspect_ratio: '16:9',
      stream_url: '/webcam/webrtc', snapshot_url: MOCK_FRAME,
      extra_data: { resolution: '1920x1080' } },
    { name: 'usb', enabled: true, service: 'webrtc-camerastreamer',
      target_fps: 15, target_fps_idle: 5, aspect_ratio: '16:9',
      stream_url: '/webcam2/webrtc', snapshot_url: MOCK_FRAME,
      extra_data: { resolution: '1280x720' } },
    { name: 'gui', enabled: true, service: 'iframe',
      target_fps: 15, aspect_ratio: '480:320',
      stream_url: '/screen/', snapshot_url: MOCK_FRAME,
      extra_data: { resolution: '480x320' } },
    // No snapshot_url: a web panel, not a camera. isCamera() must drop it.
    { name: 'multiACE', enabled: true, service: 'iframe',
      stream_url: '/multiace/?panel=1', snapshot_url: '', extra_data: {} },
  ];
}
