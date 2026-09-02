// Stub the Snapmaker cloud REST API.
//
// The page treats a failed cloud call as "user is offline" and tears the session
// down, so without this the UI can never reach a connected state offline. Only
// snapmaker hosts are intercepted; everything else passes through untouched.
(function () {
  const SN = 'U1SIM0000000001';
  const DEV = {
    sn: SN, deviceName: 'Snapmaker U1', model: 'Snapmaker U1', modelName: 'Snapmaker U1',
    status: 1, online: true, bind: true, isOnline: true, ownerId: '10001'
  };
  function body(url) {
    if (url.includes('/user/device/list')) return { code: 200, message: 'ok', data: { list: [DEV], total: 1 } };
    if (url.includes('/user/device/info')) return { code: 200, message: 'ok', data: DEV };
    if (url.includes('getMqttCert')) return { code: 200, message: 'ok', data: {
      endpoint: '127.0.0.1', port: 8883, clientId: 'orca-sim',
      certificatePem: '', privateKey: '', rootCa: '' } };
    if (url.includes('checkAuth')) return { code: 200, message: 'ok', data: { auth: true, status: 4 } };
    if (url.includes('/oauth2/token')) return { code: 200, message: 'ok', data: { access_token: 'sim-token', token_type: 'Bearer', expires_in: 86400 } };
    return { code: 200, message: 'ok', data: {} };
  }
  const isCloud = u => /snapmaker\.(com|cn)|172\.17\.100\.32/.test(String(u));

  const of = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!isCloud(url)) return of.apply(this, arguments);
    return Promise.resolve(new Response(JSON.stringify(body(url)), {
      status: 200, headers: { 'Content-Type': 'application/json' } }));
  };

  const OX = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const x = new OX(), open = x.open;
    let url = '';
    x.open = function (m, u) { url = u; return open.apply(x, arguments); };
    const send = x.send;
    x.send = function () {
      if (!isCloud(url)) return send.apply(x, arguments);
      const text = JSON.stringify(body(url));
      Object.defineProperty(x, 'readyState', { get: () => 4 });
      Object.defineProperty(x, 'status', { get: () => 200 });
      Object.defineProperty(x, 'responseText', { get: () => text });
      Object.defineProperty(x, 'response', { get: () => text });
      setTimeout(function () {
        x.onreadystatechange && x.onreadystatechange();
        x.onload && x.onload();
      }, 1);
    };
    return x;
  };
  window.XMLHttpRequest.prototype = OX.prototype;
})();
