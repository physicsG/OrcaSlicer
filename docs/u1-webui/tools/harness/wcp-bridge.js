// Recording + replaying stand-in for the Orca C++ host.
//
// The page reaches its host through exactly one channel:
//     window.wx.postMessage(JSON.stringify({header, payload:{cmd, params, event_id}}))
// and the host answers on exactly one channel:
//     window.postMessage(JSON.stringify({header, payload:{code, message, data}}), '*')
// Both shapes are read straight out of SSWCP.cpp (handle_web_message / send_to_js).
(function () {
  const RECORD = [];
  window.__wcp = { record: RECORD, replies: 0, unhandled: [] };

  // Canned data, keyed by command. Populated by inject-state.js when present.
  window.__wcpFixtures = window.__wcpFixtures || {};

  function reply(header, data, code, message) {
    const msg = JSON.stringify({
      header: header || {},
      payload: { code: code === undefined ? 200 : code, message: message || 'success', data: data || {} }
    });
    // Same delivery the host uses: a window message the page is already listening for.
    window.postMessage(msg, '*');
    window.__wcp.replies++;
  }

  window.wx = {
    postMessage: function (raw) {
      let m;
      try { m = JSON.parse(raw); } catch (e) { RECORD.push({ parse_error: String(e), raw: String(raw).slice(0, 400) }); return; }
      const p = m.payload || {};
      RECORD.push({ t: Date.now(), header: m.header, cmd: p.cmd, params: p.params, event_id: p.event_id || null });

      const fx = window.__wcpFixtures[p.cmd];
      if (fx === undefined) { window.__wcp.unhandled.push(p.cmd); return; }

      // A fixture may be a value, or a function of (params, header, event_id).
      const data = (typeof fx === 'function') ? fx(p.params || {}, m.header || {}, p.event_id) : fx;
      if (data === null) return;               // explicit "stay silent"

      // Subscriptions echo event_id in the header and may push repeatedly.
      const header = Object.assign({}, m.header || {});
      if (p.event_id) header.event_id = p.event_id;
      reply(header, data);

      if (p.event_id && window.__wcpPush && window.__wcpPush[p.cmd]) {
        const frames = window.__wcpPush[p.cmd];
        frames.forEach(function (f, i) {
          setTimeout(function () { reply(header, f); }, 300 * (i + 1));
        });
      }
    }
  };

  // index.html's own helper expects this to exist.
  window.sendMessage = function (message) { window.wx.postMessage(message); };
})();

// Ship the recording back to the harness server so a headless run can inspect it.
(function () {
  const name = new URLSearchParams(location.search).get('dump') || 'dump';
  function ship() {
    try {
      navigator.sendBeacon('/wcp-dump?name=' + encodeURIComponent(name),
        new Blob([JSON.stringify({
          url: location.href,
          record: window.__wcp.record,
          replies: window.__wcp.replies,
          unhandled: Array.from(new Set(window.__wcp.unhandled))
        }, null, 1)], { type: 'application/json' }));
    } catch (e) { }
  }
  setTimeout(ship, 6000);
  setTimeout(ship, 14000);
})();
