(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var PAL = ["#a23a5a", "#2f7f79", "#c58a1d", "#5a4aa8", "#3d7ab5", "#8a5a3c", "#6b8e3d", "#b5546b"];
  function el(n, a, p) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
  function fmt(v, money) {
    if (money) return (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return Number(v).toLocaleString("pt-BR");
  }
  function short(v, money) {
    var x = money ? v / 100 : v;
    if (Math.abs(x) >= 1000) return (money ? "R$ " : "") + (x / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
    return (money ? "R$ " : "") + Math.round(x).toLocaleString("pt-BR");
  }
  var tip;
  function showTip(e, t) {
    if (!tip) { tip = document.createElement("div"); tip.className = "chart-tip"; document.body.appendChild(tip); }
    tip.textContent = t; tip.style.display = "block";
    tip.style.left = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8) + "px"; tip.style.top = (e.clientY - 34) + "px";
  }
  function hideTip() { if (tip) tip.style.display = "none"; }
  function bindTip(node, text) {
    node.addEventListener("mousemove", function (e) { showTip(e, text); });
    node.addEventListener("mouseleave", hideTip);
    node.setAttribute("tabindex", "0");
    node.addEventListener("focus", function () { var r = node.getBoundingClientRect(); showTip({ clientX: r.left + r.width / 2, clientY: r.top }, text); });
    node.addEventListener("blur", hideTip);
  }
  function skeleton(host) {
    var w = host.clientWidth || 320, h = host.clientHeight || 220;
    var svg = el("svg", { viewBox: "0 0 " + w + " " + h, preserveAspectRatio: "xMidYMid meet", "aria-hidden": "true" });
    host.innerHTML = ""; host.appendChild(svg); return { svg: svg, w: w, h: h };
  }
  function niceMax(m) { if (m <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(m))); var f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

  function axisY(svg, left, top, bw, bh, max, money) {
    for (var i = 0; i <= 4; i++) {
      var y = top + bh - (bh * i / 4);
      el("line", { x1: left, x2: left + bw, y1: y, y2: y, "class": "grid" }, svg);
      var t = el("text", { x: left - 6, y: y + 4, "text-anchor": "end" }, svg); t.textContent = short(max * i / 4, money);
    }
  }
  function thin(n, w) { return Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 46)))); }

  function bar(host, d) {
    var s = skeleton(host), L = 52, T = 10, B = 28, R = 8, bw = s.w - L - R, bh = s.h - T - B;
    var max = niceMax(Math.max.apply(null, d.values)); axisY(s.svg, L, T, bw, bh, max, d.money);
    var n = d.values.length, slot = bw / n, w = Math.min(46, slot * 0.7), step = thin(n, bw);
    d.values.forEach(function (v, i) {
      var h = bh * v / max, x = L + slot * i + (slot - w) / 2;
      var r = el("rect", { x: x, y: T + bh - h, width: w, height: Math.max(h, v > 0 ? 2 : 0), rx: 4, "class": "bar", "aria-label": d.labels[i] + ": " + fmt(v, d.money) }, s.svg);
      bindTip(r, d.labels[i] + ": " + fmt(v, d.money));
      if (i % step === 0) { var t = el("text", { x: x + w / 2, y: s.h - 8, "text-anchor": "middle" }, s.svg); t.textContent = d.labels[i]; }
    });
  }
  function hbar(host, d) {
    var n = d.values.length, rowH = 34, h = Math.max(n * rowH + 8, 80); host.style.height = h + "px";
    var s = skeleton(host), L = Math.min(130, s.w * 0.36), R = 74, bw = s.w - L - R, max = Math.max.apply(null, d.values) || 1;
    d.values.forEach(function (v, i) {
      var y = 4 + i * rowH, w = bw * v / max;
      var lab = d.labels[i].length > 20 ? d.labels[i].slice(0, 19) + "…" : d.labels[i];
      var t = el("text", { x: L - 8, y: y + 18, "text-anchor": "end" }, s.svg); t.textContent = lab;
      var r = el("rect", { x: L, y: y + 4, width: Math.max(w, v > 0 ? 3 : 0), height: 20, rx: 5, "class": "bar", "aria-label": d.labels[i] + ": " + fmt(v, d.money) }, s.svg);
      bindTip(r, d.labels[i] + ": " + fmt(v, d.money));
      var vt = el("text", { x: L + w + 6, y: y + 18 }, s.svg); vt.textContent = short(v, d.money);
    });
  }
  function donut(host, d) {
    var total = d.values.reduce(function (a, b) { return a + b; }, 0) || 1;
    var s = skeleton(host), size = Math.min(s.h - 10, s.w * 0.5), cx = size / 2 + 8, cy = s.h / 2, R = size / 2, r = R * 0.6, a0 = -Math.PI / 2;
    d.values.forEach(function (v, i) {
      if (v <= 0) return;
      var a1 = a0 + (v / total) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
      if (v === total) a1 = a0 + Math.PI * 2 - 0.0001;
      var p = "M" + (cx + R * Math.cos(a0)) + " " + (cy + R * Math.sin(a0)) + " A" + R + " " + R + " 0 " + big + " 1 " + (cx + R * Math.cos(a1)) + " " + (cy + R * Math.sin(a1)) +
        " L" + (cx + r * Math.cos(a1)) + " " + (cy + r * Math.sin(a1)) + " A" + r + " " + r + " 0 " + big + " 0 " + (cx + r * Math.cos(a0)) + " " + (cy + r * Math.sin(a0)) + " Z";
      var path = el("path", { d: p, fill: PAL[i % PAL.length], stroke: "#fff", "stroke-width": 1.5, "aria-label": d.labels[i] + ": " + fmt(v, d.money) }, s.svg);
      bindTip(path, d.labels[i] + ": " + fmt(v, d.money) + " (" + Math.round(v / total * 100) + "%)");
      a0 = a1;
    });
    var c = el("text", { x: cx, y: cy + 5, "text-anchor": "middle", style: "font-weight:800;font-size:13px" }, s.svg); c.textContent = short(total, d.money);
    var lx = size + 28, ly = Math.max(14, cy - d.labels.length * 11);
    d.labels.forEach(function (lb, i) {
      el("rect", { x: lx, y: ly + i * 22 - 9, width: 11, height: 11, rx: 3, fill: PAL[i % PAL.length] }, s.svg);
      var t = el("text", { x: lx + 17, y: ly + i * 22 }, s.svg); t.textContent = (lb.length > 18 ? lb.slice(0, 17) + "…" : lb) + " · " + Math.round(d.values[i] / total * 100) + "%";
    });
  }
  function line(host, d) {
    var s = skeleton(host), L = 52, T = 12, B = 28, R = 12, bw = s.w - L - R, bh = s.h - T - B;
    var max = niceMax(Math.max.apply(null, d.values)); axisY(s.svg, L, T, bw, bh, max, d.money);
    var n = d.values.length, pts = d.values.map(function (v, i) { return [L + (n === 1 ? bw / 2 : bw * i / (n - 1)), T + bh - bh * v / max]; });
    el("polyline", { points: pts.map(function (p) { return p.join(","); }).join(" "), "class": "line" }, s.svg);
    var step = thin(n, bw);
    pts.forEach(function (p, i) {
      var c = el("circle", { cx: p[0], cy: p[1], r: 4, "class": "dot", "aria-label": d.labels[i] + ": " + fmt(d.values[i], d.money) }, s.svg);
      bindTip(c, d.labels[i] + ": " + fmt(d.values[i], d.money));
      if (i % step === 0) { var t = el("text", { x: p[0], y: s.h - 8, "text-anchor": "middle" }, s.svg); t.textContent = d.labels[i]; }
    });
  }
  var KINDS = { bar: bar, hbar: hbar, donut: donut, line: line };
  function draw() {
    Array.prototype.forEach.call(document.querySelectorAll(".chart[data-chart]"), function (host) {
      var d; try { d = JSON.parse(host.getAttribute("data-chart")); } catch (e) { return; }
      if (!d || !d.values || !d.values.length) return;
      (KINDS[d.kind] || bar)(host, d);
    });
  }
  window.desenharGraficos = draw; draw();
  var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(draw, 180); });
})();
