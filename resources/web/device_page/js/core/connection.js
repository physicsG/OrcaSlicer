/*
 * connection.js - bring an MQTT session to the printer up.
 *
 * The page owns the transport; Orca owns the socket. Every step below is a
 * bridge command, and the whole sequence is recovered from SSWCP.cpp and
 * MoonRaker.cpp - see docs/u1-webui/02-device-page/06-connection.md
 *
 * Two paths, chosen by whether the saved device already carries mTLS material:
 *
 *   already paired          first-time LAN pairing
 *   --------------          ----------------------
 *                           sw_GetPincode        printer shows a PIN
 *                           (user reads it off the machine)
 *   sw_create_mqtt_client   sw_create_mqtt_client   mqtts:// vs mqtt://:1884
 *   sw_mqtt_connect         sw_mqtt_connect
 *   sw_mqtt_set_engine      sw_mqtt_set_engine      + code: <PIN>
 *
 * `sw_mqtt_set_engine` is where the real work happens on the C++ side: it builds
 * a Moonraker_Mqtt host, attaches the engine, and - when a `code` is supplied -
 * runs Moonraker_Mqtt::ask_for_tls_info(), which publishes `server.request_key`
 * and receives {state, sn, clientid, ca, cert, key, port}. Orca then stores that
 * on the device record and flips `connected` to true, which reaches us as a
 * push on sw_SubscribeLocalDevices.
 */
'use strict';

import { CMD, DEVICE, PAIR_PORT, LAN_AUTH_CODE, MQTT_KEEPALIVE, hasTlsMaterial }
  from '../../../shared/js/protocol.js';

/*
 * Cloud hosts. The `.com` / `.cn` split is region selection; Orca appends the
 * locale to this page's own URL, so the region can be read from there.
 * docs/u1-webui/05-printer-protocol/05-cloud-api.md
 */
function cloudBase() {
  const loc = new URLSearchParams(location.search).get('locale') || '';
  return /(^|-)(cn|CN)$/.test(loc) || /zh/i.test(loc)
    ? 'https://api.snapmaker.cn/api'
    : 'https://api.snapmaker.com/api';
}

/**
 * Ask the cloud for a device's mTLS material.
 *
 * This is the counterpart of the LAN `server.request_key` handshake: both end
 * with {ca, cert, key, port, clientId}, after which the transport is identical.
 * Used when the user is signed in and the saved device has no keys of its own —
 * which is the normal state, because Orca force-clears `connected` on every
 * config save and never persists cloud-issued keys.
 */
export async function fetchCloudCert(device, user) {
  if (!user || !user.token) return null;
  const sn = device[DEVICE.SN];
  const url = `${cloudBase()}/user/device/getMqttCert?sn=${encodeURIComponent(sn)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${user.token}`, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`cloud responded ${r.status}`);
  const j = await r.json();
  const d = (j && (j.data || j.result)) || j;
  if (!d || !d.ca || !d.cert || !d.key) return null;
  return {
    [DEVICE.CA]: d.ca,
    [DEVICE.CERT]: d.cert,
    [DEVICE.KEY]: d.key,
    [DEVICE.PORT]: d.port || 8883,
    [DEVICE.CLIENT_ID]: d.clientId || d.clientid || device[DEVICE.CLIENT_ID],
  };
}

/**
 * Ask the printer for its mTLS material over the plain connection.
 *
 * This has to happen here, in the page. `sw_mqtt_set_engine` looks like it would
 * do it — Moonraker_Mqtt::connect() calls ask_for_tls_info() — but that path is
 * dead: SSWCP.cpp:6643 hardcodes `bool res = true;` and never calls connect().
 * The host expects to be handed an ALREADY-CONNECTED mTLS engine, which is
 * exactly what a captured session from the shipped page shows it doing.
 *
 * Wire form, both on `<auth code>/config/...`:
 *   → {"jsonrpc":"2.0","method":"server.request_key","params":{"clientid":…},"id":n}
 *   ← {"jsonrpc":"2.0","id":n,"result":{state,sn,clientid,ca,cert,key,port}}
 */
async function requestKeys(bridge, engineId, clientId, trace, timeoutMs = 30000) {
  const reqTopic = `${LAN_AUTH_CODE}/config/request`;
  const resTopic = `${LAN_AUTH_CODE}/config/response`;
  const id = Date.now() % 100000000;

  let resolveKeys;
  const keys = new Promise((res) => { resolveKeys = res; });

  await bridge.subscribe(CMD.MQTT_SUBSCRIBE,
    { id: engineId, topic: resTopic, qos: 1, event_id: resTopic },
    (data) => {
      // The push carries the raw MQTT payload as a string.
      const raw = (data && (data.data !== undefined ? data.data : data)) || '';
      let msg;
      try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
      const r = msg && (msg.result || msg.params || msg);
      trace(`config/response payload: ${JSON.stringify(msg).slice(0, 300)}`);
      if (r && r.ca && r.cert && r.key) {
        trace(`request_key: got material (state=${r.state || '?'}, port=${r.port || '?'})`);
        resolveKeys(r);
      }
    });
  trace(`subscribed ${resTopic}`);

  // TimeSyncManager::addTimeFields stamps every request the C++ sends, and the
  // printer expects them: cli_time in unix seconds, dev_time -1 until the clocks
  // have been synced. Without these the request is ignored silently.
  // Which auth method a firmware implements is not recoverable from the bundle —
  // it ships call sites for several. The printer is the oracle: an unsupported
  // method comes back as -32601, so try each and keep the one it accepts.
  //
  // request_lan_auth is first because it is the one verified against real
  // hardware; server.request_key — the method the C++ itself sends — is answered
  // with "Method not found" by this firmware.
  const appId = `orca-${Date.now() * 1000}`;
  const candidates = [
    { method: 'server.client_manager.request_lan_auth',
      params: { clientid: clientId, app_id: appId } },
    { method: 'server.client_manager.request_pin_code',
      params: { userid: '', nickname: 'Snapmaker Orca', app_id: appId } },
    { method: 'server.request_key', params: { clientid: clientId } },
  ];

  for (const c of candidates) {
    const body = JSON.stringify({
      jsonrpc: '2.0', method: c.method, params: c.params, id: id + candidates.indexOf(c),
      // TimeSyncManager stamps every request the C++ sends and the printer
      // expects them: cli_time in unix seconds, dev_time -1 until synced.
      cli_time: Math.floor(Date.now() / 1000),
      dev_time: -1,
    });
    await bridge.request(CMD.MQTT_PUBLISH,
                         { id: engineId, topic: reqTopic, qos: 1, payload: body });
    trace(`tried ${c.method}`);
    const got = await Promise.race([
      keys,
      new Promise((r) => setTimeout(() => r(null), 6000)),
    ]);
    if (got) return got;
  }

  return Promise.race([
    keys,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`no key material within ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

/** The create payload the shipped page sends, minus the credentials. */
function mqttParams(address, clientId, device, sn, user) {
  return {
    server_address: address,
    clientId,
    // The shipped page sends both spellings.
    clientid: clientId,
    keepAlivePeriod: MQTT_KEEPALIVE,
    clean_session: false,
    link_mode: device[DEVICE.LINK_MODE] || 'lan',
    sn,
    userid: (user && user.userid) || '',
    nickname: (user && user.nickname) || '',
    id: device[DEVICE.ID] || '',
  };
}

export class ConnectError extends Error {
  constructor(step, cause) {
    super(`${step}: ${cause}`);
    this.name = 'ConnectError';
    this.step = step;
  }
}

/** A client id is required; reuse the saved one so the printer recognises us. */
function clientIdFor(device) {
  const saved = device[DEVICE.CLIENT_ID];
  if (saved) return saved;
  const rnd = (crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(16).slice(2);
  return `orca-${rnd}`;
}

/**
 * Optional diagnostic sink. Set `opts.trace` and every step reports its params
 * and the host's reply, which is the only way to see what a real printer said
 * when the simulator disagrees with it.
 */
let TRACE = () => {};

async function step(name, promise) {
  try {
    const r = await promise;
    TRACE(`${name}: ok ${summarise(r)}`);
    return r;
  } catch (e) {
    TRACE(`${name}: FAILED ${e.message || String(e)}`);
    throw new ConnectError(name, e.message || String(e));
  }
}

/** Short, and never leaks key material into a log file. */
function summarise(v) {
  if (v == null) return '(no data)';
  if (typeof v !== 'object') return String(v).slice(0, 120);
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (/^(ca|cert|key|password|token)$/i.test(k)) {
      out[k] = val ? `<${String(val).length} chars>` : '<empty>';
    } else if (typeof val === 'string') {
      out[k] = val.length > 60 ? `${val.slice(0, 60)}…` : val;
    } else if (typeof val !== 'object') {
      out[k] = val;
    }
  }
  return JSON.stringify(out).slice(0, 300);
}

/**
 * Connect to `device`.
 *
 * @param bridge      the WCP client
 * @param device      a DeviceInfo record from sw_GetLocalDevices
 * The key exchange needs no human for a machine that already trusts our client
 * id, which is why there is no PIN parameter: the auth code is fixed.
 * @param opts.user        { userid, nickname } for the pairing request
 * @param opts.onStep      progress callback (text)
 */
export async function connect(bridge, device, opts = {}) {
  const { user = {}, onStep = () => {}, trace } = opts;
  TRACE = trace || (() => {});
  const ip = device[DEVICE.IP];
  const sn = device[DEVICE.SN];
  if (!ip) throw new ConnectError('precheck', 'the saved device has no IP address');
  if (!sn) throw new ConnectError('precheck', 'the saved device has no serial number');

  let target = device;

  // A signed-in account can be issued keys by the cloud, which avoids the PIN
  // entirely. Try it before falling back to LAN pairing.
  if (!hasTlsMaterial(target) && user && user.token) {
    onStep('Fetching credentials from your account…');
    try {
      const cert = await fetchCloudCert(target, user);
      if (cert) target = Object.assign({}, target, cert);
    } catch (e) {
      // Not fatal: LAN pairing still works.
      onStep(`Cloud credentials unavailable (${e.message}); pairing over the LAN instead`);
    }
  }

  let device_ = target;
  const paired = hasTlsMaterial(device_);
  const clientId = clientIdFor(device_);


  // ---- phase 1: plain MQTT on :1884, to obtain credentials ---------------
  //
  // Skipped entirely when the device already carries keys.
  let material = null;
  if (!paired) {
    const pairAddr = `mqtt://${ip}:${PAIR_PORT}`;
    onStep(`Opening ${pairAddr}…`);
    // The shipped page uses a throwaway id for this leg and keeps the saved one
    // for the session proper.
    const tryId = `orca-try-${Date.now()}`;
    const p1 = await step('create pairing client', bridge.request(CMD.CREATE_MQTT_CLIENT,
      mqttParams(pairAddr, tryId, device_, sn, user)));
    if (!p1 || !p1.id) throw new ConnectError('create pairing client', 'no engine id');
    await step('connect pairing client', bridge.request(CMD.MQTT_CONNECT, { id: p1.id }));

    onStep('Exchanging keys…');
    try {
      material = await requestKeys(bridge, p1.id, clientId, TRACE);
    } catch (e) {
      throw new ConnectError('request key', e.message);
    } finally {
      bridge.request(CMD.MQTT_DISCONNECT, { id: p1.id }).catch(() => {});
    }
    device_ = Object.assign({}, device_, {
      [DEVICE.CA]: material.ca,
      [DEVICE.CERT]: material.cert,
      [DEVICE.KEY]: material.key,
      [DEVICE.PORT]: material.port || device_[DEVICE.PORT] || 8883,
    });
  }

  // ---- phase 2: mTLS on :8883, the session proper ------------------------
  const port = device_[DEVICE.PORT] || 8883;
  const address = `mqtts://${ip}:${port}`;
  onStep(`Opening ${address}…`);

  const params = mqttParams(address, clientId, device_, sn, user);
  params.ca = device_[DEVICE.CA];
  params.cert = device_[DEVICE.CERT];
  params.key = device_[DEVICE.KEY];
  params.username = device_[DEVICE.USER] || '';
  params.password = device_[DEVICE.PASSWORD] || '';

  TRACE(`create client params ${summarise(params)}`);
  const created = await step('create client', bridge.request(CMD.CREATE_MQTT_CLIENT, params));
  const id = created && created.id;
  if (!id) throw new ConnectError('create client', 'the host returned no engine id');

  onStep('Connecting…');
  await step('connect', bridge.request(CMD.MQTT_CONNECT, { id }));

  // The host routes inbound traffic by topic, so the session's topics have to be
  // subscribed before it is handed over.
  for (const suffix of ['status', 'response', 'notification']) {
    const topic = `${sn}/${suffix}`;
    await step(`subscribe ${suffix}`, bridge.subscribe(CMD.MQTT_SUBSCRIBE,
      { id, topic, qos: 1, event_id: topic }, () => {}));
  }

  // ---- hand the engine to Orca's Moonraker host ---------------------------
  onStep('Attaching…');
  const engineParams = {
    engine_id: id,
    ip,
    port,
    sn,
    clientId,
    ca: device_[DEVICE.CA],
    cert: device_[DEVICE.CERT],
    key: device_[DEVICE.KEY],
    user: device_[DEVICE.USER] || '',
    password: device_[DEVICE.PASSWORD] || '',
    link_mode: device_[DEVICE.LINK_MODE] || 'lan',
    // Leave our own page alone: with need_reload true the host reloads the
    // Device webview mid-sequence, which would tear this down halfway.
    need_reload: false,
  };
  TRACE(`set engine params ${summarise(engineParams)}`);
  await step('set engine', bridge.request(CMD.MQTT_SET_ENGINE, engineParams));

  onStep('Connected');
  return { engineId: id, paired: true };
}

/** Tear the session down. Best effort - a dead engine id is not an error worth raising. */
export async function disconnect(bridge, engineId) {
  if (!engineId) return;
  try {
    await bridge.request(CMD.MQTT_DISCONNECT, { id: engineId });
  } catch { /* already gone */ }
}
