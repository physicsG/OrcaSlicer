/* Walk .app and print every tag, id, class and data-*, plus the geometry that matters.
   Diff two runs of this to answer "what is on the page", not "is this one thing right". */
(function () {
  const L = [];
  const walk = (el, d) => {
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).filter(Boolean).join('.') : '';
    const id = el.id ? '#' + el.id : '';
    const data = Object.keys(el.dataset || {}).sort()
      .map(k => `[${k}=${el.dataset[k]}]`).join('');
    const r = el.getBoundingClientRect();
    const geo = (r.width || r.height)
      ? ` {${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}}` : '';
    L.push('  '.repeat(d) + el.tagName.toLowerCase() + id + cls + data + geo);
    [...el.children].forEach(c => walk(c, d + 1));
  };
  const app = document.querySelector('.app');
  if (app) walk(app, 0); else L.push('NO .app');
  L.push('--- summary ---');
  L.push('nodes: ' + document.querySelectorAll('*').length);
  const cs = getComputedStyle(document.querySelector('.content'));
  L.push('content display: ' + cs.display + ' cols: ' + cs.gridTemplateColumns);
  window.__report = L.join('\n');
})();
