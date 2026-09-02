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

/** An empty but structurally valid zip, so the send path has something to fetch. */
const ZIP_STUB = 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==';

/** A 1x1 PNG, so thumbnail plumbing can be exercised without real artwork. */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Install the simulated host.
 *
 * @param {object}  opts
 * @param {Function} opts.log       trace sink (kind, packet)
 * @param {object}  opts.handlers   extra commands: cmd -> (params, ctx) => data
 * @param {object}  opts.printer    override the simulated printer
 * @param {Function} opts.onDialogClose  called by sw_FinishFilamentMapping with the
 *                                    recorded outcome. There is no modal here to end,
 *                                    so this is how a surface learns it was closed.
 * @returns {{printer, stop}|null}  null if a real host is already present
 */
export function installMockHost({ log = () => {}, handlers = {}, printer: given = null,
                                  onDialogClose = null } = {}) {
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
        /*
         * `machine.system_info`, in the shape the printer answers it - one `system_info`
         * wrapper around `product_info` / `cpu_info` / `network` and the rest. Measured on
         * 811002511261022618B3, 2026-09-01. This used to return a flat
         * `{firmware_version, model, sn}`, which no U1 has ever sent, and a flat reply is
         * why the one field only this call carries went unnoticed:
         * `product_info.nozzle_diameter`, which Orca's filament record wants per slot.
         */
        case 'sw_GetMachineSystemInfo':
          return ok({ system_info: {
            product_info: {
              machine_type: 'Snapmaker U1',
              nozzle_diameter: printer.toolheads.map((t) => t.nozzle_diameter),
              serial_number: printer.sn,
              device_name: printer.name,
              firmware_version: printer.firmware,
              software_version: printer.firmware,
            },
            cpu_info: { cpu_count: 4, bits: '64bit', processor: 'aarch64',
                        total_memory: 983540, memory_units: 'kB' },
            network: { wlan0: { mac_address: '02:00:00:00:00:01',
                                ip_addresses: [{ family: 'ipv4', address: '192.168.1.42',
                                                 is_link_local: false }] } },
          } });
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
        case 'sw_GetMachineState': {
          const objs = printer.snapshot();
          // `ace` is not in the subscription - the shipped bundle does not subscribe it
          // and the page asks for it by name - so it comes back only when it is asked
          // for, which is also what makes "no multiACE here" a state a test can reach.
          if (params.objects && 'ace' in params.objects && printer.ace) objs.ace = printer.ace;
          // `ace_bg_swap` is a second object in the same call, and it answers a different
          // question: not what the ACE is, but which head may run a background swap.
          if (params.objects && 'ace_bg_swap' in params.objects && printer.aceBg)
            objs.ace_bg_swap = printer.aceBg;
          // And `save_variables`, a third object for one field: the mode multiACE has
          // SAVED, which is not the mode it is running until the machine is restarted.
          if (params.objects && 'save_variables' in params.objects && printer.saveVars)
            objs.save_variables = { variables: printer.saveVars };
          return ok(statusEnvelope(objs, 'query'));
        }
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
        case 'sw_SendGCodes': {
          printer.gcodeLog.push(params.script);
          // The macros the Filament panel sends actually move the simulated ACE, so a
          // control that waits to be told it happened has something to be told.
          let raised = null;
          if (printer.gcode) {
            String(params.script).split('\n')
              .forEach((l) => { raised = printer.gcode(l) || raised; });
          }
          // A macro that RAISES is an outcome and not a transport failure. SET_ACE_MODE's
          // normal transition succeeds AND raises, which is the whole reason this arm
          // exists: the page has to see the refusal to recognise the success.
          if (raised) return fail(raised);
          return ok({ executed: params.script });
        }

        /*
         * Orca's own filament record. NOT a printer command - it never leaves the host -
         * and the reason it is answered here at all is that the page's only sign of
         * getting it wrong is this reply.
         *
         * Validated exactly as `SSWCP_Instance::update_filament_info()` validates it,
         * because being lax here is what let a flat `print_task_config` patch look like a
         * working call for as long as it did: `objects` an array, `key` and `value`
         * strings, `value` parsing to an object carrying the seven fields the C++ reads,
         * and every array as long as `filament_official` - which the C++ loops over and
         * indexes the rest with. Orca has no try/catch around any of that.
         */
        case 'sw_UpdateMachineFilamentInfo': {
          const objs = params && params.objects;
          if (!Array.isArray(objs) || !objs.length) {
            return fail('param [objects] required or wrong type!');
          }
          const o = objs[0] || {};
          if (typeof o.key !== 'string') return fail('param [key] required or wrong type!');
          if (typeof o.value !== 'string') return fail('param [value] required or wrong type!');
          const dev = printer.devices.find((d) => d.sn === o.key);
          if (!dev) return fail('sn does not exist!');
          if (!dev.connected) return fail('The machine is not connected!');
          let v;
          try { v = JSON.parse(o.value); } catch (e) { return fail('value parse failed'); }
          const need = ['nozzle_diameters', 'filament_vendor', 'filament_type',
                        'filament_sub_type', 'extruder_map_table', 'filament_official'];
          const missing = need.filter((k) => !Array.isArray(v && v[k]));
          if (!Array.isArray(v && v.filament_color) && !Array.isArray(v && v.filament_color_rgba)) {
            missing.push('filament_color');
          }
          if (missing.length) return fail('value parse failed');
          const n = v.filament_official.length;
          const short = ['filament_vendor', 'filament_type', 'filament_sub_type',
                         'filament_color_rgba', 'nozzle_diameters']
            .filter((k) => Array.isArray(v[k]) && v[k].length && v[k].length < n);
          if (short.length) {
            // Out of range inside a wxWidgets event handler on the real host, so it is an
            // error here rather than something the simulator quietly tolerates.
            return fail(`arrays shorter than filament_official: ${short.join(', ')}`);
          }
          printer.orcaFilamentRecord = { sn: o.key, value: v };
          // Counted, not just kept: `load_current_presets()` rebuilds every combo box in
          // the sidebar, so "did it re-send an unchanged inventory" is a question a test
          // has to be able to ask.
          printer.orcaSyncCount = (printer.orcaSyncCount || 0) + 1;
          log('mock-note', { orcaFilamentSync: o.key, slots: n });
          return ok({});
        }

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

        /*
         * ---- the Snapmaker account -------------------------------------
         *
         * Orca answers `sw_UserLogin` and THEN opens a modal on id.snapmaker.com, so the
         * reply says nothing about whether anyone signed in. Modelled the same way here -
         * an immediate `ok`, and a session that appears a moment later - because that gap
         * is the whole reason the page polls the state afterwards instead of reading the
         * reply.
         */
        case 'sw_UserLogin':
          setTimeout(() => {
            printer.loginUser = { userid: 'mock-user-1', nickname: 'Mock Account' };
          }, 900);
          return ok({});
        case 'sw_GetUserLoginState':
          return ok(printer.loginUser
            ? { status: 'online', userid: printer.loginUser.userid,
                nickname: printer.loginUser.nickname, icon: '', token: '', account: '' }
            : { status: 'offline' });

        /* ---- logging / telemetry the real page emits constantly -------- */
        case 'sw_FileLog': case 'sw_Log': case 'sw_UploadEvent': case 'sw_SetLogLevel':
          return ok({});

        /* ---- Orca's side of the print-processing popup ---------------------
         *
         * These are answered by ORCA, not by the printer, so none of them is in
         * PRINTER_BACKED and none comes back inside a JSON-RPC envelope. They live here
         * rather than in the popup's own mock because the U1 they talk about is the one
         * simulated above: the machine half of every reply below is read off `printer`,
         * so the dialog cannot be shown a machine the rest of the simulation disagrees
         * with. See `printer.job`.
         */
        case 'sw_GetActiveFile': {
          const j = printer.job;
          if (!j.filepath || !j.filename) return fail('mock: no active file');
          if (params.is_zip) {
            return ok({ file_name: j.filename.replace(/\.gcode$/, '.zip'),
                        file_path: j.filepath.replace(/\.gcode$/, '.zip'),
                        origin_size: j.sizeBytes, metadata: {} });
          }
          return ok({ filename: j.filename, metadata: {} });
        }

        /*
         * The reply shape is SSWCP.cpp:3039's, verbatim: PARALLEL ARRAYS, plus the
         * rendered plate. Not `{filaments: [...]}` - see printer.job.
         */
        case 'sw_GetFileFilamentMapping': {
          const j = printer.job;
          const argb = (hex) => {
            const h = String(hex).replace('#', '');
            return parseInt(h.slice(0, 6), 16);
          };
          return ok({
            filename: j.filename,
            filepath: j.filepath,
            machine_model: j.presetModel,
            estimated_time: j.estimatedTime,
            filament_type: j.fileFilamentType.slice(),
            filament_color: j.fileFilamentColor.map(argb),
            filament_color_rgba: j.fileFilamentColor.slice(),
            filament_color_multi: j.fileFilamentColorMulti.slice(),
            filament_weight: j.fileFilamentWeight.slice(),
            filament_weight_total: j.fileFilamentWeight.reduce((a, b) => a + b, 0),
            filament_used_mm: j.fileFilamentUsedMm.slice(),
            nozzle_diameters: j.fileNozzle.slice(),
            nozzle_info: [...new Set(j.fileNozzle)],
            filament_extruder_map: Object.assign({}, j.extruderMap),
            // Absent unless the job has one, because absent is what a real Orca sends.
            ...(j.acePlan ? { ace_plan: j.acePlan } : {}),
            // `thumbnails[0].url` is a data: PNG. One pixel is enough to prove the
            // plumbing; what matters is that the popup reads it instead of a grey box.
            thumbnails: [{ url: `data:image/png;base64,${PNG_1PX}`, width: 512, height: 512 }],
          });
        }

        /*
         * The right door for the file. Returns a URL on Orca's own page server, the size
         * and a SHA-256 - NOT the zip's bytes. `sw_GetPrintZip` below is the other one,
         * and it is implemented honestly so the cost of using it is visible.
         */
        case 'sw_GetFileStream': {
          const j = printer.job;
          const zip = j.filename.replace(/\.gcode$/, '.zip');
          /*
           * A FETCHABLE url. It used to be `http://127.0.0.1:0/…` - port zero, which
           * nothing serves - so `fetch` failed with "Load failed" and the send path
           * could not be exercised in the simulator at all. That went unnoticed because
           * no check had ever pressed Send here; the first thing to try it was a script
           * being smoke-tested before it ran against a real machine.
           *
           * A `data:` URL is the honest stand-in: the page fetches it and gets a blob,
           * which is all it does with Orca's own localhost URL.
           */
          return ok({ file_name: params.is_zip ? zip : j.filename,
                      file_url: `data:application/zip;base64,${ZIP_STUB}`,
                      origin_size: j.sizeBytes,
                      checksum: j.checksum });
        }

        /*
         * `m_res_data["content"] = res["zip_data"]` where zip_data is a
         * std::vector<char>, which nlohmann serialises as one integer per byte. A 12 MB
         * zip crosses as ~40 MB of JSON. The mock returns a token array of the right
         * KIND rather than the right length - the point is that it is an array of
         * numbers, not a base64 string, which is what a client guesses.
         */
        case 'sw_GetPrintZip': {
          const j = printer.job;
          return ok({ name: `${j.filename}.zip`, content: [80, 75, 3, 4, 20, 0, 0, 0] });
        }

        case 'sw_GetPrintLegal': {
          const j = printer.job;
          const connected = params.connected_model || '';
          return ok({ preset_model: j.presetModel, legal: j.presetModel === connected });
        }

        /*
         * The precondition is the handler's own (SSWCP.cpp:2595). A mock that accepted
         * `{}` is exactly how the reconstruction came to send `{}` and never find out.
         */
        case 'sw_StartLocalPrint': {
          if (params.type == null || params.path == null) {
            return fail('param [type] or [path] required!');
          }
          printer.job.startedWith = { type: params.type, path: params.path };
          return ok({ task_id: 'mock-task-1' });
        }
        case 'sw_StartCloudPrint':
          printer.job.startedWith = Object.assign({ cloud: true }, params);
          return ok({ task_id: 'mock-task-1' });

        /*
         * The close protocol, in the host's own three parts. Recording the outcome and
         * ending the dialog are SEPARATE commands, and only the second closes anything -
         * SafeEndModal exists because the page, the window manager and OnClose can all
         * race to end the same dialog. See 03-print-processing/02-lifecycle.md
         */
        case 'sw_FinishPreprint':
          printer.job.preprintStatus = params.status || null;
          return ok({});
        case 'sw_SetFilamentMappingComplete': {
          const st = params.status;
          if (st !== 'success' && st !== 'canceled') {
            // Orca raises a native "setting failed" dialog and does NOT record anything.
            return fail(`mock: setting failed (status ${JSON.stringify(st)})`);
          }
          printer.job.mappingOutcome = st;
          return ok({});
        }
        case 'sw_FinishFilamentMapping':
          printer.job.closed = true;
          if (onDialogClose) onDialogClose(printer.job.mappingOutcome === 'success');
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

  return {
    printer,
    webcams: mockWebcams,
    // Not a bridge command: the page fetches this off the printer's own file server over
    // HTTP, so with no printer there is nothing to answer it. Same seam as the camera's
    // frames.
    aceOverrides: () => printer.aceOverrides,
    /**
     * Swap the job for a plate sliced onto the ACE.
     *
     * A function rather than a second fixture, so the machine half is untouched: the
     * plate has to be satisfiable by the SAME simulator the four-filament one runs on, or
     * a check of the match is a check of two fixtures agreeing with each other.
     */
    usePlan: (opts) => { Object.assign(printer.job, mockAceJobFields(opts)); },
    // Klipper's console, in Moonraker's own `server.gcode_store` shape. Same seam and the
    // same reason: it is an HTTP GET against the printer, and a refused mode switch says
    // so here and nowhere else.
    gcodeStore: (n) => ({
      result: { gcode_store: printer.console.slice(-(Number(n) || 20)) },
    }),
    stop() { clearInterval(timer); },
  };
}

function clamp01(v) { return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0)); }

/* ------------------------------------------------------------------ *
 * A small but honest U1 simulation: four toolheads, one active at a
 * time, heaters that ramp toward target, a job that progresses.
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 * The ACE, as the printer reports it
 *
 * Copied field for field off 811002511261022618B3 on 2026-08-25: one ACE 2 Pro on
 * `protocol: "v2"`, head mode, feeding Toolhead 4 from bay 3, four PETG spools, 38 % RH
 * at 31 C. Including the two things about it that are easy to get wrong, because a
 * simulator that smooths them over is a simulator that lets the bug through:
 *
 *   `head_ace` reads {0:0, 1:1, 2:2, 3:0} with ONE unit attached, so heads 2 and 3 name
 *   units that are not there. A page that trusts it draws three cabinets that do not
 *   exist. The resolver has to reach for head_manual and head_feeder first, and this is
 *   the state that proves it does.
 *
 *   Every raw slot reads {material:"", brand:"", rfid:0}. The hardware carries no
 *   per-bay identity at all - these spools have no tags and their names live in
 *   multiACE's own store, behind CORS - so the panel's job is to draw
 *   occupied-and-unnamed as exactly that. Only the bay that is LOADED has a name, and it
 *   comes from head_source.
 *
 * A drive script that wants a tagged spool, a second unit or a running dryer sets them
 * on `mock.printer.ace` directly. Invented state belongs in the test that wants it, not
 * in the record of what the machine said.
 * ------------------------------------------------------------------ */
function mockAce() {
  const slot = (i) => ({ index: i, status: 'unknown', sku: '', material: '', subtype: '',
                         rfid: 0, brand: '', color: [0, 0, 0] });
  return {
    api_version: 1,
    mode: 'head',
    status: 'ready',
    temp: 30,
    device_count: 1,
    active_device: 0,
    ace_head: 3,
    ace_heads: [3],
    swap_in_progress: false,
    swap_phase: 'idle',
    last_swap_result: null,
    event_seq: 0,
    gate_status: [1, 1, 1, 1],
    // The settings a person sets once - all reported, which is what makes the panel's
    // dialogs able to open on the machine's own values instead of on a default.
    confirm_commands: false,
    spoolman_url: 'http://192.168.2.30:7912',
    spoolman_auto: false,
    purge_matrix: true,
    spool_mode: 'spoolman',
    spool_binding: {},
    spools: {},
    dryer_status: { status: 'stop', target_temp: 0, duration: 0, remain_time: 0 },
    auto_dry_masters: [0],
    head_manual: { 0: false, 1: false, 2: false, 3: false },
    head_feeder: { 0: true, 1: true, 2: true, 3: false },
    head_ace: { 0: 0, 1: 1, 2: 2, 3: 0 },
    head_reader_spool: { 0: 0, 1: 0, 2: 0, 3: 0 },
    head_tag_seen: {},
    head_source: {
      0: null, 1: null, 2: null,
      3: { ace_index: 0, slot: 2, type: 'PETG', subtype: 'Basic',
           color: '632C2C', brand: 'Generic' },
    },
    aces: [{
      idx: 0, connected: true, protocol: 'v2', model: 'ACE 2 Pro', firmware: 'V1.1.26',
      status: 'ready', temp: 30, humidity: 38, feed_assist: -1, fw_hold: false,
      auto_dry: { enabled: false, rh_start: 45, rh_end: 35, temp: 50,
                  master: -1, add_time: 60 },
      auto_dry_running: false,
      dryer_status: { status: 'stop', target_temp: 0, duration: 0, remain_time: 0 },
      gate_status: [1, 1, 1, 1],
      slots: [slot(0), slot(1), slot(2), slot(3)],
    }],
  };
}

/**
 * An ACE plate, on THIS simulator's own machine.
 *
 * Seven filaments where the machine has four heads, which is the whole shape the popup is
 * being rebuilt for. It is built to agree with the rest of the fixture rather than
 * beside it:
 *
 *   T0 T1 T2   the three stock feeders, carrying what `filamentType` /
 *              `filamentColorRgba` already say is in heads 0-2
 *   T3         the ACE-fed head - `head_feeder[3]` is false and `head_ace[3]` is 0 - and
 *              its four filaments are the four bays that `mockAceOverrides` names
 *
 * So the default ACE plate is SATISFIABLE and a check that wants a mismatch has to make
 * one, exactly as the four-filament default does. `mismatch: true` is that: it moves one
 * file filament off the bay that holds it, so bay 0_1 disagrees and nothing else does.
 */
function mockAcePlan({ mismatch = false } = {}) {
  return {
    mode: 'head',
    swaps: 300,
    purge_g: 40.4,
    saved_swaps: 212,
    saved_purge_g: 28.6,
    heads: [
      { head: 0, feeder: true, run: [{ filament: 0 }] },
      { head: 1, feeder: true, run: [{ filament: 1 }] },
      { head: 2, feeder: true, run: [{ filament: 2 }] },
      { head: 3,
        feeder: false,
        unit: 0,
        run: [{ filament: 3, unit: 0, slot: 0 }, { filament: 4, unit: 0, slot: 1 },
              { filament: 5, unit: 0, slot: 2 }, { filament: 6, unit: 0, slot: 3 }] },
    ],
    _mismatch: mismatch,
  };
}

/** The seven-filament file that plan describes. */
function mockAceJobFields({ mismatch = false } = {}) {
  const colors = ['#E03131', '#1971C2', '#2F9E44',
                  '#83AFFF', '#8FA7C8', '#632C2C', '#C47053'];
  // One file filament moved off the spool that is actually in its bay.
  if (mismatch) colors[4] = '#11CC55';
  return {
    filename: 'colour_cube_7.gcode',
    filepath: '/tmp/SnapmakerOrca/plate_1.gcode',
    estimatedTime: 14232,
    fileFilamentType: ['PLA', 'PLA', 'PETG', 'PETG', 'PETG', 'PETG', 'PETG'],
    fileFilamentColor: colors,
    fileFilamentColorMulti: [null, null, null, null, null, null, null],
    fileFilamentWeight: [12.4, 9.1, 6.7, 6.6, 7.2, 6.9, 7.1],
    fileFilamentUsedMm: [4123, 3027, 2229, 2210, 2431, 2240, 2173],
    fileNozzle: ['0.4', '0.4', '0.4', '0.4', '0.4', '0.4', '0.4'],
    extruderMap: { 0: '0', 1: '1', 2: '2', 3: '3', 4: '3', 5: '3', 6: '3' },
    acePlan: mockAcePlan({ mismatch }),
  };
}

/**
 * What multiACE says is in each bay — and the reason it is a separate thing.
 *
 * The `ace` object above reports four blank slots, because that is what the hardware
 * reports: no tags, no identity. multiACE keeps the names its own web UI shows in this
 * store and merges them in `_parse_state()`. Copied from the printer on 2026-08-26,
 * where three of these four bays were being drawn as `?` while Orca's Prepare page —
 * which polls the merged endpoint from C++ — showed them named.
 *
 * Keeping both halves in the simulator is the point: the blank slots AND the store that
 * fills them. A simulator that only had the merged answer would never have shown the
 * gap.
 */
function mockAceOverrides() {
  const bay = (slot, brand, color) => ({ ace: 0, slot, material: 'PETG', brand,
                                         subtype: 'Basic', color });
  return {
    '0_0': bay(0, 'Kingroon', '#83AFFF'),
    '0_1': bay(1, 'Kingroon', '#8FA7C8'),
    '0_2': bay(2, 'Generic', '#632c2c'),
    '0_3': bay(3, 'Kingroon', '#C47053'),
  };
}

/**
 * `ACE_DRY TEMP=55 DURATION=4` -> {TEMP: '55', DURATION: '4'}.
 *
 * Quoted values are kept whole, quotes stripped: the shipped page writes
 * `SET_PRINT_FILAMENT_CONFIG VENDOR='Kingroon Filament'`, and splitting on whitespace
 * made that two arguments and a vendor of `'Kingroon`.
 */
function gcodeArgs(script) {
  const out = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*('[^']*'|"[^"]*"|[^\s]*)/g;
  const body = String(script).trim().replace(/^\S+\s*/, '');
  let m;
  while ((m = re.exec(body)) !== null) {
    const v = m[2];
    out[m[1].toUpperCase()] = (v.length > 1 && (v[0] === "'" || v[0] === '"'))
      ? v.slice(1, -1) : v;
  }
  return out;
}

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
    /** How many times Orca's filament record has been written. See sw_UpdateMachineFilamentInfo. */
    orcaSyncCount: 0,
    /** Who is signed in, or null. Orca's, not the printer's - see sw_UserLogin. */
    loginUser: null,
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
    // Which slots have filament in them. State rather than a literal in snapshot(),
    // because a test that wants an empty head has to be able to say so: setting it on
    // the mirror instead was overwritten by the next tick, which made the check pass or
    // fail on how long the script before it took.
    filamentExist: [true, true, true, true],
    // No slot's record is the spool's own by default - the mock ships four untagged
    // spools, so every one of them is a slot a person may edit. A drive script sets one
    // true (with `filament_detect` to match) to reach the read-only branch.
    filamentOfficial: [false, false, false, false],
    filamentSubType: ['Basic', 'Basic', 'Basic', 'Basic'],
    /*
     * The identity per head, settable, so a drive script can reach the state multiACE
     * puts a feeder head in when the machine enters head mode.
     *
     * `_clear_filament_display()` sends `FILAMENT_TYPE="" VENDOR=""
     * FILAMENT_COLOR_RGBA=00000000` to every feeder head, and 00000000 is RRGGBBAA with
     * alpha ZERO - the machine saying "no colour", not "black". These were three
     * hard-coded literals, so the panel could not be shown that state at all.
     */
    filamentVendor: ['Snapmaker', 'Snapmaker', 'Snapmaker', 'Generic'],
    filamentType: ['PLA', 'PLA', 'PETG', 'ABS'],
    filamentColorRgba: ['E03131FF', '1971C2FF', '2F9E44FF', 'F08C00FF'],

    /*
     * ---- the JOB: what Orca is about to send -------------------------------
     *
     * The print dialog's whole purpose is to match the FILE's filaments against the
     * MACHINE's, so those two lists must not be invented separately. They are not: the
     * machine's are `filamentType` / `filamentColorRgba` / `toolheads[].nozzle_diameter`
     * above, and the file's default to the same values here - so the default job is
     * satisfiable, and a check that wants a mismatch has to CREATE one by moving one of
     * them. That is the difference between a match test and a self-fulfilling one.
     *
     * The previous mock for this surface invented `{filaments: [{type, color, used_g}]}`,
     * a shape `sw_GetFileFilamentMapping` has never returned. It agreed with the client
     * that was written from the same head, so the popup drew four rows in the simulator
     * and none in Orca. The arrays below are the handler's own - SSWCP.cpp:3039.
     */
    job: {
      filepath: '/tmp/SnapmakerOrca/plate_1.gcode',
      filename: 'benchy_4colour.gcode',
      // sw_GetPrintLegal compares this against the CONNECTED machine's model_name.
      presetModel: 'Snapmaker U1',
      estimatedTime: 4412,
      // one entry per FILE filament; the defaults mirror the four heads
      fileFilamentType: ['PLA', 'PLA', 'PETG', 'ABS'],
      fileFilamentColor: ['#E03131', '#1971C2', '#2F9E44', '#F08C00'],
      // Read but never drawn by the shipped popup: a gradient or segmented spool.
      // `null` for a plain one; `{mode, colors}` otherwise, mode 0 bands / 1 gradient.
      fileFilamentColorMulti: [null, null, null, null],
      fileFilamentWeight: [12.4, 9.1, 6.7, 3.2],
      fileFilamentUsedMm: [4123, 3027, 2229, 1064],
      // what the FILE was sliced for, per filament - checked against the head's own
      fileNozzle: ['0.4', '0.4', '0.4', '0.4'],
      // Orca's own filament -> extruder map, from AppConfig. The popup starts here.
      extruderMap: { 0: '0', 1: '1', 2: '2', 3: '3' },
      /*
       * PROPOSED - `ace_plan`, and null is the honest default.
       *
       * No Orca sends this today: the slicer on this branch has no planner and no ACE
       * emitter, so every plate it can produce has no plan and the popup must be the
       * dialog that already ships. `usePlan()` below switches the job to one that does,
       * which is the only way to exercise the ACE half at all.
       *
       * See docs/u1-webui/03-print-processing/06-multiace.md §3 item 1.
       */
      acePlan: null,
      sizeBytes: 12684221,
      checksum: 'kBqDdG0mZ0nH0mockCHECKSUMbase64PADDINGxxxxxxx=',
      /** Set by the close protocol so a check can read what the page reported. */
      preprintStatus: null, mappingOutcome: null, closed: false,
      /** What sw_StartLocalPrint was actually given. */
      startedWith: null,
    },
    /*
     * The three job toggles, mutable because SET_PRINT_PREFERENCES writes them. Keyed by
     * the field name the machine REPORTS them under; the macro's own argument for the
     * third one is `BED_LEVEL`, and the translation is the page's business, not this
     * side's - see PRINT_PREFERENCES in protocol.js.
     */
    prefs: { flow_calibrate: true, time_lapse_camera: false, auto_bed_leveling: true },
    /** What multiACE does to a feeder head on entering head mode. */
    clearFilamentDisplay(head) {
      this.filamentVendor[head] = '';
      this.filamentType[head] = '';
      this.filamentSubType[head] = '';
      this.filamentColorRgba[head] = '00000000';
      this.filamentOfficial[head] = false;
    },
    /*
     * What each head's feed channel is doing, as the machine reports it at rest.
     *
     * NOT `none`, which was the guess. Read off 811002511261022618B3 with everything
     * settled: `load_finish` on the two heads that had finished loading and `wait_insert`
     * on the two that had not. A terminal state is the resting state here - the field
     * holds the last operation's ending rather than returning to a neutral word.
     *
     * A drive script sets one of the `load_*` / `unload_*` states to exercise the step
     * bar, which is the only way to reach it without a three-minute physical swap.
     */
    /*
     * `state` and `act` are `channel_state` and `channel_action_state`, and `at` is the
     * `filament_*` booleans - three answers that the machine gives independently and
     * that the simulator must therefore be able to give independently too.
     *
     * It could not, twice. `at` was first computed from `filamentExist`, so the sensor
     * and the job record could never disagree - and a head that had just been unloaded
     * went on offering Unload. Splitting them fixed the simulator and not the printer,
     * where `filament_at_extruder` stayed TRUE on both emptied heads and the field that
     * moved was `channel_action_state`. So `at` is now what it is on the machine - the
     * path having filament, true on empty heads included - and `act` is occupancy.
     * Anything that reads occupancy from `at` will now fail here the way it failed there.
     */
    channels: [
      { state: 'load_finish', error: 'ok', act: 'load_finish', at: true },
      { state: 'load_finish', error: 'ok', act: 'load_finish', at: true },
      { state: 'wait_insert', error: 'ok', act: 'none', at: false },
      // Toolhead 4, the ACE-fed one, exactly as 811002511261022618B3 reports it: an
      // idle word, no action since boot, and the path reading full. Nothing in the feed
      // channel says this head is loaded - the TOPOLOGY does, and that fallback is only
      // exercised if the simulator is allowed to be this uninformative.
      { state: 'wait_insert', error: 'ok', act: 'none', at: true },
    ],
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
    // The multiACE state, as the machine reports it - see mockAce() above. Null is a
    // machine with no multiACE plugin, which is the other half the panel has to draw.
    ace: mockAce(),
    /*
     * `ace_bg_swap`, exactly as the machine answered on 2026-08-26. A different Klipper
     * object from `ace`, and the one that says which head may run a background swap.
     * `enabled_heads` really is empty there: nobody has declared a head, so every
     * background verb is refused - which is the state the panel has to draw well, and so
     * the state the simulator opens in.
     */
    aceBg: { version: 'v0.9', enabled_heads: [], busy: [], state: {} },
    /*
     * `save_variables`, for one field: the mode multiACE has SAVED, which is a different
     * question from the mode it is running.
     *
     * A normal-mode switch writes this immediately, swaps three Klipper extras on disk and
     * then raises - so `ace.mode` goes on reporting the old mode until the machine is
     * restarted, and the disagreement between the two is the only thing that says a restart
     * is owed. Read off the machine on 2026-09-01, where the two agreed; they disagree here
     * the moment a normal switch is sent.
     */
    saveVars: { ace__mode: 'head', ace__revision: 62 },
    /*
     * Klipper's console, which is where a refused mode switch says so and nowhere else.
     * `//` is a note and `!!` an error; the two are different channels and the page reads
     * both, for different things.
     */
    console: [],
    // And what is IN each bay, which the ace object does not carry. Null is a printer
    // with no override store, where every occupied bay stays unnamed.
    aceOverrides: mockAceOverrides(),
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

  p.say = (line) => {
    p.console.push({ message: line, time: 1000 + p.console.length, type: 'response' });
    if (p.console.length > 60) p.console.shift();
  };

  /**
   * Which heads the ACE drives, computed the way the plugin computes it - QUIRK INCLUDED.
   *
   * `head_uses_ace()` has no branch for normal mode: manual is False, head mode tests
   * `head_feeder`, and everything else returns True. So a normal-mode machine publishes
   * `ace_heads: [0,1,2,3]`, naming every head in the mode whose definition is that none of
   * them is ACE-driven. That is what the source says and it has never been observed, so it
   * is what the simulator answers - a simulator can only be wrong in the ways it was
   * written to be wrong, and tidying this one up here would hide whether the page reads the
   * MODE for normal rather than the list.
   */
  const aceHeadsNow = (ace) => [0, 1, 2, 3].filter((h) => {
    if (ace.head_manual[h]) return false;
    if (ace.mode === 'head') return !ace.head_feeder[h];
    return true;
  });

  /*
   * Entering head mode clears every feeder head's display identity - multiACE's own
   * `_clear_filament_display`: empty type, empty vendor, `FILAMENT_COLOR_RGBA=00000000` -
   * while the filament stays physically in the head. It does not touch `filament_exist`,
   * which is why the panel has to ask the sensor about occupancy and the record about
   * identity, and why they can disagree.
   */
  p.wipeFeederHeads = () => {
    [0, 1, 2, 3].forEach((h) => {
      if (p.ace.head_manual[h] || !p.ace.head_feeder[h]) return;
      p.filamentType[h] = '';
      p.filamentVendor[h] = '';
      p.filamentSubType[h] = '';
      p.filamentColorRgba[h] = '00000000';
      p.filamentOfficial[h] = false;
    });
  };

  /*
   * And entering multi pushes each BAY's identity onto its lane's head - measured
   * 2026-09-01, where `filament_type` went from `["","","","PETG"]` to four PETGs and
   * `filament_exist` from `[T,T,F,T]` to all true, including a head whose extruder is
   * empty. In multi the U1's display model mirrors the bays, and it believes the mode's
   * claim instantly whether or not the tubes agree.
   */
  p.pushLanesToHeads = () => {
    const unit = p.ace.aces[p.ace.active_device] || p.ace.aces[0];
    const store = p.aceOverrides || {};
    [0, 1, 2, 3].forEach((h) => {
      const o = store[`${unit ? unit.idx : 0}_${h}`] || {};
      const raw = (unit && unit.slots && unit.slots[h]) || {};
      p.filamentType[h] = o.material || raw.material || 'PETG';
      p.filamentVendor[h] = o.brand || raw.brand || 'Generic';
      p.filamentSubType[h] = o.subtype || raw.subtype || '';
      p.filamentColorRgba[h] = `${(o.color || '8FA7C8').replace('#', '')}FF`;
      p.filamentExist[h] = true;
    });
  };

  /**
   * What an ACE macro does to the simulated machine.
   *
   * The page never awaits one of these - an instant `ok` is indistinguishable from
   * success, and ACE_BG_UNLOAD's own help says ~3 min - so it confirms what it asked for
   * against machine state instead. That only means anything if the state actually moves,
   * which is what this is for: the simulator answers `ok` AND changes, so
   * shared/pending.js has something to resolve against.
   *
   * Deliberately instant. Modelling the three minutes belongs in a test that wants to
   * watch a wait time out, not in the default path.
   */
  p.gcode = (script) => {
    const line = String(script || '').trim();
    const name = line.split(/\s+/)[0].toUpperCase();
    const a = gcodeArgs(line);

    /*
     * Snapmaker's own print_task_config macros come FIRST, because they are the printer's
     * and not multiACE's: a stock U1 with no ACE at all still answers them, and the guard
     * below would otherwise drop every one of them on such a machine.
     *
     * None of the four appears in `printer.gcode.help`; all four were recovered from the
     * shipped bundle. Absence from the help table is not evidence - the T-commands are not
     * in it either.
     */
    switch (name) {
      case 'SET_PRINT_FILAMENT_CONFIG': {
        const ch = Number(a.CONFIG_EXTRUDER);
        if (!Number.isInteger(ch) || ch < 0 || ch > 3) return;
        // The machine's own gate, and the reason the panel reads `filament_edit`:
        // an official slot is refused unless FORCE=1.
        if (p.filamentOfficial[ch] && String(a.FORCE || '0') !== '1') {
          return '[print_task_config] filament_config, official filament, not configurable!';
        }
        if (a.FILAMENT_TYPE !== undefined) p.filamentType[ch] = a.FILAMENT_TYPE;
        if (a.VENDOR !== undefined) p.filamentVendor[ch] = a.VENDOR;
        if (a.FILAMENT_SUBTYPE !== undefined) p.filamentSubType[ch] = a.FILAMENT_SUBTYPE;
        if (a.FILAMENT_COLOR_RGBA !== undefined) {
          p.filamentColorRgba[ch] = String(a.FILAMENT_COLOR_RGBA).toUpperCase();
        }
        // Every write clears the flag, in the firmware's own words - which is what makes
        // `filament_edit` a latch rather than a property of the spool.
        p.filamentOfficial[ch] = false;
        return;
      }
      case 'SET_PRINT_PREFERENCES': {
        const set = (arg, field) => {
          if (a[arg] === undefined) return;
          p.prefs[field] = a[arg] === '1' || String(a[arg]).toLowerCase() === 'true';
        };
        set('FLOW_CALIBRATE', 'flow_calibrate');
        set('TIME_LAPSE_CAMERA', 'time_lapse_camera');
        set('BED_LEVEL', 'auto_bed_leveling');
        return;
      }
      // The two the print popup sends. Accepted and ignored here: nothing in this
      // simulator reads the map back, and a handler that pretended to would be claiming
      // more than has been measured.
      case 'SET_PRINT_EXTRUDER_MAP':
      case 'SET_PRINT_USED_EXTRUDERS':
        return;
      default:
        break;
    }

    const ace = p.ace;
    if (!ace) return;
    const head = Number(a.HEAD);
    const unit = Number(a.ACE);
    const slot = Number(a.SLOT);
    switch (name) {
      /*
       * The mode, and all three of the things sending it does. Measured on
       * 811002511261022618B3 on 2026-09-01 by switching a live machine to `multi` and back.
       *
       *   multi <-> head     LIVE. Exactly two keys of the 38 move - `mode` and
       *                      `ace_heads` - and `head_feeder`, `head_ace` and `head_source`
       *                      are left byte-identical, just ignored. Filament may stay
       *                      loaded: the macro's `needs_unload` guard is only on the other
       *                      transition. Entering multi PUSHES each bay's identity onto its
       *                      lane's head in `print_task_config`; entering head wipes the
       *                      feeder heads back out again.
       *   normal <-> either  refused outright with filament in any head, on the console and
       *                      nowhere else - the RPC still answers `ok`. Otherwise it swaps
       *                      three Klipper extras, writes the saved `ace__mode`, and RAISES:
       *                      `ace.mode` goes on reporting the old mode until a restart.
       */
      case 'SET_ACE_MODE': {
        // The macro's own four words, and its own aliasing: `single` is accepted and
        // treated as `multi`. Written out here rather than imported from the page's model,
        // because this is the printer's side and it should not agree with the page by
        // sharing a constant with it.
        let to = String(a.MODE || '').toLowerCase();
        if (to === 'single') to = 'multi';
        if (['normal', 'multi', 'head'].indexOf(to) < 0) break;
        const restart = (to === 'normal') !== (ace.mode === 'normal');
        if (restart) {
          const loaded = [0, 1, 2, 3].filter((h) => p.filamentExist[h]);
          if (loaded.length) {
            p.say(`// Cannot switch mode! Filament still loaded in: `
                + `${loaded.map((h) => `E${h}`).join(', ')}`);
            p.say('// Please unload all toolheads first, then try again.');
            return;                      // `ok` on the wire, and nothing happened
          }
          // The saved variable moves NOW and `ace.mode` does not - which is the whole of
          // the restart-pending state, and the only thing that reports it.
          p.saveVars.ace__mode = to;
          p.say(`[multiACE] Switched to ${to.toUpperCase()} mode. Please reboot!`);
          // Returned rather than thrown: it is the macro's own outcome and has to reach the
          // page as a refused sw_SendGCodes, which is what the real one does.
          return `[multiACE] Switched to ${to.toUpperCase()} mode. `
               + 'Please reboot the printer to activate!';
        }
        const was = ace.mode;
        ace.mode = to;
        p.saveVars.ace__mode = to;
        ace.ace_heads = aceHeadsNow(ace);
        if (to === 'head' && was !== 'head') p.wipeFeederHeads();
        if (to === 'multi' && was !== 'multi') p.pushLanesToHeads();
        p.say(`// Switching to ${to.toUpperCase()} mode...`);
        p.say(`[multiACE] Switched to ${to.toUpperCase()} mode. No reboot needed.`);
        break;
      }
      // Each of the three re-computes `ace_heads`, because the machine does: it is derived
      // live from the mode and the wiring rather than stored, so a simulator that leaves it
      // where it was would let a page that reads it go on drawing the state before.
      case 'ACE_SET_HEAD_MANUAL':
        if (Number.isInteger(head)) {
          ace.head_manual[head] = a.ENABLE !== '0';
          if (ace.head_manual[head]) ace.head_feeder[head] = false;
          ace.ace_heads = aceHeadsNow(ace);
        }
        break;
      case 'ACE_SET_HEAD_FEEDER':
        if (Number.isInteger(head)) {
          ace.head_feeder[head] = a.ENABLE !== '0';
          if (ace.head_feeder[head]) ace.head_manual[head] = false;
          ace.ace_heads = aceHeadsNow(ace);
        }
        break;
      case 'ACE_SET_HEAD_ACE':
        // Binding a head to a unit is the one that has to clear the other two, because
        // head_feeder is what head mode's resolver reads FIRST.
        if (Number.isInteger(head) && Number.isInteger(unit)) {
          ace.head_ace[head] = unit;
          ace.head_feeder[head] = false;
          ace.head_manual[head] = false;
          ace.ace_heads = aceHeadsNow(ace);
        }
        break;
      case 'ACE_LOAD_HEAD':
      case 'ACE_SWAP_HEAD': {
        if (!Number.isInteger(head)) break;
        const u = Number.isInteger(unit) ? unit : ace.active_device;
        const s = Number.isInteger(slot) ? slot : 0;
        const bay = (ace.aces[u] || {}).slots ? ace.aces[u].slots[s] : null;
        ace.head_source[head] = {
          ace_index: u, slot: s,
          type: (bay && bay.material) || 'PETG',
          subtype: (bay && bay.subtype) || '',
          color: (bay && bay.color) || [99, 44, 44],
          brand: (bay && bay.brand) || 'Generic',
        };
        break;
      }
      case 'ACE_UNLOAD_HEAD':
        delete ace.head_source[head];
        break;
      case 'ACE_UNLOAD_ALL_HEADS':
        ace.head_source = {};
        break;
      case 'ACE_CLEAR_HEADS':
        if (Number.isInteger(head)) delete ace.head_source[head];
        else ace.head_source = {};
        break;
      case 'ACE_DRY': {
        // As measured: DURATION is MINUTES on the wire, and the object reports seconds.
        // `status` is `keeping` while it runs and `stop` when it does not.
        const d = ace.aces[Number.isInteger(unit) ? unit : 0];
        if (!d) break;
        const secs = (Number(a.DURATION) || 240) * 60;
        d.dryer_status = { status: 'keeping', target_temp: Number(a.TEMP) || 55,
                           duration: secs, remain_time: secs };
        ace.dryer_status = d.dryer_status;
        break;
      }
      case 'ACE_STOP_DRYING':
      case 'ACED__DRY_STOP': {
        // ACE_STOP_DRYING takes the unit; ACED__DRY_STOP stops the active one. The
        // simulator answers both, because both exist on the machine.
        const only = name === 'ACE_STOP_DRYING' && Number.isInteger(unit) ? unit : null;
        ace.aces.forEach((d, k) => {
          if (only !== null && k !== only) return;
          d.dryer_status = { status: 'stop', target_temp: 0, duration: 0, remain_time: 0 };
        });
        ace.dryer_status = { status: 'stop', target_temp: 0, duration: 0, remain_time: 0 };
        break;
      }
      case 'ACE_SET_AUTO_DRY': {
        // ENABLE and RH_START, both settled against the machine. THRESHOLD= was the
        // guess before that: the printer answered `ok` and changed nothing, so the
        // simulator ignores it exactly as the printer does.
        const d = ace.aces[Number.isInteger(unit) ? unit : 0];
        if (!d) break;
        if (a.ENABLE !== undefined) d.auto_dry.enabled = a.ENABLE !== '0';
        if (a.RH_START !== undefined) d.auto_dry.rh_start = Number(a.RH_START);
        if (a.RH_END !== undefined) d.auto_dry.rh_end = Number(a.RH_END);
        break;
      }
      case 'ACE_SET_CONFIRM_COMMANDS':
        if (a.ENABLE !== undefined) ace.confirm_commands = a.ENABLE !== '0';
        break;
      case 'ACE_SET_SPOOLMAN':
        if (a.URL !== undefined) ace.spoolman_url = a.URL;
        if (a.AUTO !== undefined) ace.spoolman_auto = a.AUTO !== '0';
        break;
      case 'ACE_SET_PURGE':
        if (a.MATRIX !== undefined) ace.purge_matrix = a.MATRIX !== '0';
        break;
      default:
        break;                                    // any other script is just logged
    }
  };

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

    // A running dryer counts down. Nothing pushes `ace` - it is not on the stream - so
    // this is only seen when the page next asks for it, which is exactly how the real
    // one behaves.
    (p.ace ? p.ace.aces : []).forEach((d) => {
      const st = d.dryer_status;
      if (st && st.status === 'keeping' && st.remain_time > 0) st.remain_time -= 1;
    });
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
        filament_vendor: p.filamentVendor.slice(),
        filament_type: p.filamentType.slice(),
        // As the wire carries them: filament_color is an ARGB integer and
        // filament_color_rgba is hex with NO leading '#'. Measured on a U1.
        filament_color: p.filamentColorRgba.map(
          (h) => (parseInt(String(h).slice(6, 8), 16) << 24 >>> 0)
                 | parseInt(String(h).slice(0, 6), 16)),
        filament_color_rgba: p.filamentColorRgba.slice(),
        filament_sub_type: p.filamentSubType.slice(),
        /*
         * The machine's own two answers about each slot's identity, in the shape it
         * reports them - read off 811002511261022618B3 on 2026-08-28, where a tagged
         * head that had been overridden came back `official: false, edit: true`.
         *
         * `filamentOfficial` is the simulated printer's, so a drive script can put a
         * slot in either state; `filament_edit` follows the machine's own rule - a
         * loaded slot whose record is NOT the spool's own may be edited - rather than
         * being a second knob that can be set to disagree with itself.
         */
        filament_official: p.filamentOfficial.slice(),
        filament_edit: p.filamentExist.map(
          (e, i) => e !== false && !p.filamentOfficial[i]),
        filament_exist: p.filamentExist.slice(),
        filament_sku: [0, 0, 0, 0],
        /*
         * Both of these were the wrong SHAPE, and the shape is the half that matters to
         * anything reading them off the wire. Read off 811002511261022618B3, 2026-09-01:
         * `extruders_used` is one BOOLEAN per toolhead, and `extruder_map_table` is a
         * flat array of THIRTY-TWO - one entry per possible tool, not one per slot. The
         * simulator had them as four small integers and a four-key object, so a reader
         * that indexes the table past the fourth entry, or treats it as an array at all,
         * agreed with the mock and not with the printer.
         */
        extruders_used: [false, false, false, false],
        extruder_map_table: Array.from({ length: 32 }, (_, i) => (i < 4 ? i : 0)),
        flow_calibrate: p.prefs.flow_calibrate,
        time_lapse_camera: p.prefs.time_lapse_camera,
        auto_bed_leveling: p.prefs.auto_bed_leveling,
        shaper_calibrate: false,
        auto_replenish_filament: true,
        can_auto_replenish: false,
        auto_replenish_index: 0,
        filament_color_multi: p.filamentColorRgba.map((h) => ({
          nums: 1, alpha: parseInt(String(h).slice(6, 8), 16),
          mode: 0, colors: [String(h).slice(0, 6)],
        })),
      },
    };
    TOOLHEADS.forEach((k, i) => { objs[k] = Object.assign({}, p.toolheads[i]); });
    /*
     * The feed channels, which the simulator did not have at all - so the head's own
     * sensor marker had nothing to read and neither did the step bar beside it.
     *
     * `filament_feed left|right` -> `extruder0..3` gives four positions along the path
     * plus a fault, and `channel_state` names the step the printer is on. WHICH side
     * carries which head has never been measured, and `feedChannels()` does not depend on
     * it - it scans both and indexes by the number in the key - so everything is put on
     * one side here rather than a split being invented.
     */
    objs['filament_feed left'] = {};
    objs['filament_feed right'] = {};
    p.channels.forEach((c, i) => {
      // Heads 0-1 on the left object and 2-3 on the right, which is where the machine
      // puts them. Putting all four on one side worked because feedChannels() reads both
      // and keys off the extruder number - so it proved nothing about the other side.
      objs[i < 2 ? 'filament_feed left' : 'filament_feed right']['extruder' + i] = {
        index: i,
        module_exist: true,
        filament_detected: !!c.at,
        // The ACE side has filament whether or not the head does - measured `ace/-/-` on
        // the one empty head, so this stays true where the other two go false.
        filament_in_ace: true,
        filament_in_toolhead: !!c.at,
        filament_at_extruder: !!c.at,
        channel_state: c.state,
        // The last operation that FINISHED, which outlives `channel_state` settling back
        // to `wait_insert` and is what says whether the head is holding filament.
        channel_action_state: c.act || 'none',
        channel_error: c.error,
        channel_error_state: 'none',
      };
    });
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
