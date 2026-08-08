/* Review overlay for the ace-mmu mockups.
 *
 * Adds a "Review" toggle to any mockup. In review mode, clicking any element pins a
 * numbered note to it and captures a description precise enough to act on. "Copy for
 * Claude" puts the whole list on the clipboard, so feedback travels as text instead of
 * a screenshot plus prose.
 *
 * Self-contained, no network, no dependencies. Injected into the mockups by
 * tools/inject_review.py so every mockup shares one implementation.
 */
(function () {
  "use strict";
  if (window.__reviewOverlay) return;
  window.__reviewOverlay = true;

  var notes = [];      // {n, desc, text}
  var on = false;
  var seq = 0;

  var css = document.createElement("style");
  css.textContent = [
    ".rv-bar{position:fixed;right:14px;bottom:14px;z-index:99999;display:flex;gap:8px;align-items:center;",
    "  font:13px/1.3 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;}",
    ".rv-btn{padding:8px 13px;border-radius:9px;border:1px solid rgba(0,0,0,.18);background:#fff;color:#24292f;",
    "  cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.16);font-weight:600;}",
    ".rv-btn.on{background:#e2953a;border-color:transparent;color:#fff;}",
    ".rv-btn.ghost{font-weight:500;}",
    ".rv-btn[hidden]{display:none;}",
    "html.rv-on *{cursor:crosshair !important;}",
    "html.rv-on .rv-bar,html.rv-on .rv-bar *{cursor:pointer !important;}",
    ".rv-hover{outline:2px dashed #e2953a !important;outline-offset:1px;}",
    ".rv-marked{outline:2px solid #e2953a !important;outline-offset:1px;}",
    ".rv-pin{position:absolute;z-index:99998;min-width:18px;height:18px;padding:0 5px;border-radius:9px;",
    "  background:#e2953a;color:#fff;font:700 11px/18px ui-sans-serif,system-ui,sans-serif;text-align:center;",
    "  box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:none;}",
    ".rv-panel{position:fixed;right:14px;bottom:60px;z-index:99999;width:340px;max-height:60vh;overflow:auto;",
    "  background:#fff;color:#24292f;border:1px solid rgba(0,0,0,.16);border-radius:12px;",
    "  box-shadow:0 10px 34px rgba(0,0,0,.28);padding:12px 13px;",
    "  font:13px/1.45 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;}",
    ".rv-panel[hidden]{display:none;}",
    ".rv-panel h4{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#6b7280;}",
    ".rv-item{display:flex;gap:8px;padding:6px 0;border-top:1px solid #eef0f2;}",
    ".rv-item:first-of-type{border-top:0;}",
    ".rv-num{flex:none;width:18px;height:18px;border-radius:9px;background:#e2953a;color:#fff;",
    "  font:700 11px/18px ui-sans-serif,sans-serif;text-align:center;}",
    ".rv-what{font-size:11.5px;color:#6b7280;}",
    ".rv-say{font-size:13px;}",
    ".rv-x{margin-left:auto;color:#9aa1a6;cursor:pointer;}",
    ".rv-empty{color:#6b7280;font-size:12.5px;}",
    "@media (prefers-color-scheme:dark){",
    "  .rv-btn,.rv-panel{background:#1f242a;color:#e8ecef;border-color:#333b43;}",
    "  .rv-item{border-color:#2b3138;} .rv-panel h4,.rv-what,.rv-empty{color:#9aa4ac;}}"
  ].join("");
  document.head.appendChild(css);

  var bar = document.createElement("div");
  bar.className = "rv-bar";
  bar.innerHTML =
    '<button class="rv-btn ghost" id="rvCopy" hidden>Copy for Claude</button>' +
    '<button class="rv-btn ghost" id="rvClear" hidden>Clear</button>' +
    '<button class="rv-btn" id="rvToggle">Review</button>';
  var panel = document.createElement("div");
  panel.className = "rv-panel";
  panel.hidden = true;
  panel.innerHTML = '<h4>Feedback</h4><div id="rvList" class="rv-empty">Click anything to comment on it.</div>';
  document.body.appendChild(panel);
  document.body.appendChild(bar);

  function describe(el) {
    // A human-readable handle: nearest label-ish text, plus a structural hint.
    var txt = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    if (txt.length > 48) txt = txt.slice(0, 45) + "…";
    var tag = el.tagName.toLowerCase();
    var cls = (el.className && typeof el.className === "string")
      ? "." + el.className.trim().split(/\s+/).filter(function (c) { return c.indexOf("rv-") !== 0; }).slice(0, 2).join(".")
      : "";
    var id = el.id ? "#" + el.id : "";
    var hint = tag + id + (id ? "" : cls);
    // Walk up for a section title, so "4 slots" becomes "… in ‘multiACE — how each toolhead is fed’".
    var sec = el.closest(".sect, .acebox, .panel, .dialog, .win");
    var secName = "";
    if (sec) {
      var h = sec.querySelector(".nm, .title, h1, h2, h3, .aceband .nm");
      if (h) secName = (h.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40);
    }
    return (txt ? '"' + txt + '"' : hint) + (secName && txt !== secName ? " (in " + secName + ")" : "") +
           "  [" + hint + "]";
  }

  function render() {
    var list = document.getElementById("rvList");
    if (!notes.length) {
      list.className = "rv-empty";
      list.textContent = "Click anything to comment on it.";
    } else {
      list.className = "";
      list.innerHTML = notes.map(function (n) {
        return '<div class="rv-item"><span class="rv-num">' + n.n + "</span>" +
               '<span><span class="rv-say">' + n.text.replace(/</g, "&lt;") + "</span><br>" +
               '<span class="rv-what">' + n.desc.replace(/</g, "&lt;") + "</span></span>" +
               '<span class="rv-x" data-del="' + n.n + '">&times;</span></div>';
      }).join("");
    }
    document.getElementById("rvCopy").hidden = !notes.length;
    document.getElementById("rvClear").hidden = !notes.length;
    panel.hidden = !on && !notes.length;
  }

  function pin(el, n) {
    var r = el.getBoundingClientRect();
    var p = document.createElement("div");
    p.className = "rv-pin";
    p.dataset.pin = n;
    p.textContent = n;
    p.style.left = (window.scrollX + r.left - 6) + "px";
    p.style.top = (window.scrollY + r.top - 6) + "px";
    document.body.appendChild(p);
  }

  var hovered = null;
  document.addEventListener("mouseover", function (e) {
    if (!on || bar.contains(e.target) || panel.contains(e.target)) return;
    if (hovered) hovered.classList.remove("rv-hover");
    hovered = e.target;
    hovered.classList.add("rv-hover");
  }, true);

  document.addEventListener("click", function (e) {
    if (!on || bar.contains(e.target) || panel.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();                       // never trigger the mockup's own handlers
    var el = e.target;
    var what = describe(el);
    var say = window.prompt("What should change here?\n\n" + what, "");
    if (!say) return;
    notes.push({ n: ++seq, desc: what, text: say });
    el.classList.add("rv-marked");
    pin(el, seq);
    render();
  }, true);

  panel.addEventListener("click", function (e) {
    var d = e.target.getAttribute && e.target.getAttribute("data-del");
    if (!d) return;
    notes = notes.filter(function (n) { return String(n.n) !== d; });
    var p = document.querySelector('.rv-pin[data-pin="' + d + '"]');
    if (p) p.remove();
    render();
  });

  document.getElementById("rvToggle").addEventListener("click", function () {
    on = !on;
    this.classList.toggle("on", on);
    this.textContent = on ? "Reviewing — click an element" : "Review";
    document.documentElement.classList.toggle("rv-on", on);
    if (!on && hovered) { hovered.classList.remove("rv-hover"); hovered = null; }
    render();
  });

  document.getElementById("rvClear").addEventListener("click", function () {
    notes = [];
    [].forEach.call(document.querySelectorAll(".rv-pin"), function (p) { p.remove(); });
    [].forEach.call(document.querySelectorAll(".rv-marked"), function (m) { m.classList.remove("rv-marked"); });
    render();
  });

  document.getElementById("rvCopy").addEventListener("click", function () {
    var title = (document.title || "mockup").replace(/\s*—\s*mockup\s*$/i, "");
    var out = "FEEDBACK — " + title + "\n" +
      notes.map(function (n) { return n.n + ". " + n.text + "\n   ↳ " + n.desc; }).join("\n") + "\n";
    var done = function () { var b = document.getElementById("rvCopy"); b.textContent = "Copied — paste to Claude"; setTimeout(function () { b.textContent = "Copy for Claude"; }, 2500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(out).then(done, function () { window.prompt("Copy this:", out); });
    else window.prompt("Copy this:", out);
  });

  window.addEventListener("resize", function () {
    [].forEach.call(document.querySelectorAll(".rv-pin"), function (p) { p.remove(); });
    notes.forEach(function (n) { /* pins are re-pinned only on demand */ });
  });
})();
