// Canned host responses, so the page can be driven into states that otherwise
// need a real printer. Shapes come from SSWCP.cpp (the C++ that normally answers)
// and from the subscription field filters in data/state-model.json.
(function () {
  const SN = 'U1SIM0000000001';

  const DEVICE = {
    ip: '192.168.1.87', dev_id: SN, dev_name: 'Snapmaker U1', model_name: 'Snapmaker U1',
    preset_name: 'Snapmaker U1 0.4 nozzle', connected: true, img: '',
    nozzle_sizes: ['0.4', '0.4', '0.4', '0.4'], sn: SN, protocol: 1, api_key: '',
    user: '', password: '', ca: '', cert: '', key: '', clientId: 'orca-sim',
    port: 8883, link_mode: 'lan', userid: '10001', id: SN
  };

  const USER = {
    status: 'online', nickname: 'Simulated User', icon: '',
    token: 'sim-token', userid: '10001', account: 'sim@example.com'
  };

  // Klipper/Moonraker object status, filtered exactly as the page subscribes.
  function extruder(temp, target, nozzle) {
    return { temperature: temp, target: target, power: 0.4, can_extrude: true,
             pressure_advance: 0.02, smooth_time: 0.04, state: 'ready', nozzle_diameter: nozzle };
  }
  const STATUS = {
    extruder:  extruder(221.4, 220, 0.4),
    extruder1: extruder(28.9, 0, 0.4),
    extruder2: extruder(29.4, 0, 0.4),
    extruder3: extruder(28.1, 0, 0.4),
    heater_bed: { temperature: 59.8, target: 60 },
    print_stats: {
      filename: 'benchy_4colour.gcode', state: 'printing',
      total_duration: 3182, print_duration: 2955,
      filament_used: 4821.5, message: '', info: { current_layer: 84, total_layer: 210 }
    },
    virtual_sdcard: { progress: 0.42, file_position: 8123456, is_active: true,
                      file_size: 19341122, file_path: '/data/gcodes/benchy_4colour.gcode' },
    display_status: { progress: 0.42, message: '' },
    gcode_move: { speed_factor: 1.0, speed: 7200, extrude_factor: 1.0 },
    webhooks: { state: 'ready', state_message: 'Printer is ready' },
    fan: { speed: 0.85 },
    'fan_generic cavity_fan': { speed: 0.35 },
    'led cavity_led': { color_data: [[1, 1, 1, 1]] },
    motion_report: { live_position: [110.2, 98.4, 16.8, 0], live_velocity: 62.1 },
    purifier: { power_detected: true, power_det_value: 1, mode: 1, exhaust_fan: 0.5, inner_fan: 0.4 },
    machine_state_manager: { main_state: 'working', action_code: 0 },
    filament_detect: { detected: true },
    'filament_feed left': { state: 'idle' },
    'filament_feed right': { state: 'idle' },
    toolhead: { position: [110.2, 98.4, 16.8, 0], homed_axes: 'xyz',
                extruder: 'extruder', max_velocity: 500, max_accel: 10000 },
    print_task_config: {
      filament_vendor: ['Snapmaker', 'Snapmaker', 'Snapmaker', 'Snapmaker'],
      filament_type: ['PLA', 'PLA', 'PETG', 'PLA'],
      filament_colour: ['#E4572E', '#17BEBB', '#FFC914', '#2E282A'],
      filament_color: ['#E4572E', '#17BEBB', '#FFC914', '#2E282A'],
      filament_color_rgba: ['#E4572EFF', '#17BEBBFF', '#FFC914FF', '#2E282AFF'],
      extruder_map_table: [0, 1, 2, 3], extruders_used: [0, 1, 2, 3],
      auto_bed_leveling: true, flow_calibrate: true, shaper_calibrate: false,
      save: true, time_lapse_camera: true, auto_replenish_filament: false,
      can_auto_replenish: true, filament_exist: [true, true, true, true]
    },
    defect_detection: { enable: true, sensitivity: 1 },
    idle_timeout: { state: 'Printing', printing_time: 2955 }
  };

  window.__wcpFixtures = {
    // Logging and telemetry: accept silently.
    sw_FileLog: {}, sw_Log: {}, sw_UploadEvent: {}, sw_SetLogLevel: {},

    sw_GetUserLoginState: USER,
    sw_SubscribeUserLoginState: USER,
    sw_GetUserUpdatePrivacy: { agree: true },
    sw_SubUserUpdatePrivacy: { agree: true },

    sw_GetConnectedMachine: DEVICE,
    sw_GetLocalDevices: { devices: [DEVICE] },
    sw_SubscribeLocalDevices: { devices: [DEVICE] },
    sw_GetPrinterInfo: { state: 'ready', hostname: 'snapmaker-u1',
                         software_version: 'v1.4.2', model: 'Snapmaker U1', sn: SN },
    sw_GetMachineSystemInfo: { cpu_info: { model: 'U1' }, distribution: { name: 'Snapmaker OS' } },
    sw_SystemGetDeviceInfo: { sn: SN, model: 'Snapmaker U1', firmware: 'v1.4.2' },
    sw_GetDeviceDataStorageSpace: { free_space: 5.2, total_space: 8.0, units: 'GB' },

    sw_GetMachineObjects: { objects: Object.keys(STATUS) },
    sw_GetMachineState: { status: STATUS, eventtime: 12345.6 },
    sw_SubscribeMachineState: { status: STATUS, eventtime: 12345.6 },
    sw_SetSubscribeFilter: {},

    sw_SubscribePageStateChange: { state: 'active' },
    sw_SubscribeRecentFiles: { files: [] },
    sw_GetRecentProjects: { projects: [] },
    sw_SubscribeCacheKey: function (p) { return { key: (p && p.key) || '', value: null }; },
    sw_GetCache: function (p) { return { key: (p && p.key) || '', value: null }; },
    sw_SetCache: {},
    sw_GetSoftwareInfo: { version: '2.3.6', name: 'Snapmaker Orca' },
    sw_GetActiveFile: { filename: 'benchy_4colour.gcode' },
    sw_MachineHeartbeat: { alive: true },
    sw_GetPrintLegal: { legal: true, preset_model: 'Snapmaker U1' },

    // MQTT agent: the page drives the transport itself, so acknowledge each step.
    sw_create_mqtt_client: { client_id: 'orca-sim' },
    sw_mqtt_connect: { connected: true },
    sw_mqtt_disconnect: { connected: false },
    sw_mqtt_subscribe: { subscribed: true },
    sw_mqtt_unsubscribe: { subscribed: false },
    sw_mqtt_publish: { published: true },
    sw_mqtt_set_engine: {},
    sw_Connect: DEVICE,
    sw_Test_connect: { ok: true },
    sw_GetPincode: { pincode: '123456' },
    sw_StartMachineFind: { devices: [DEVICE] },
    sw_StopMachineFind: {},

    // Print-processing surface.
    sw_GetFileFilamentMapping: {
      filename: 'benchy_4colour.gcode',
      filaments: [
        { id: 0, type: 'PLA',  colour: '#E4572E', color: '#E4572E', used_g: 12.4, extruder: 0 },
        { id: 1, type: 'PLA',  colour: '#17BEBB', color: '#17BEBB', used_g: 9.1,  extruder: 1 },
        { id: 2, type: 'PETG', colour: '#FFC914', color: '#FFC914', used_g: 6.7,  extruder: 2 },
        { id: 3, type: 'PLA',  colour: '#2E282A', color: '#2E282A', used_g: 3.2,  extruder: 3 }
      ],
      prediction_time: 3182, weight: 31.4
    },
    sw_SetFilamentMappingComplete: {},
    sw_FinishFilamentMapping: {},
    sw_FinishPreprint: {},
    sw_GetPrintZip: { name: 'benchy_4colour.zip', content: '' },
    sw_StartLocalPrint: { task_id: 'sim-task-1' },
    sw_StartCloudPrint: { task_id: 'sim-task-1' },
    sw_MachineFilesRoots: { roots: [{ name: 'gcodes', path: '/data/gcodes' }] },
    sw_GetFileListPage: { files: [], total: 0 },
    sw_UpdateMachineFilamentInfo: {}
  };

  // Repeat pushes for the machine-state subscription so the UI animates/settles.
  window.__wcpPush = {
    sw_SubscribeMachineState: [{ status: STATUS, eventtime: 12346.6 }]
  };
})();
