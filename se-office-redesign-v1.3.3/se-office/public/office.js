/* Віртуальний офіс: тихий вечірній простір і зрозуміла анімація роботи агентів. */
window.Office = (function () {
  var W = 480, H = 270, LANE = { F: 235, M: 177, T: 119 }, EL = 20, ER = 460;
  var DESKS = [
    { x: 92, y: 77, l: "T" }, { x: 190, y: 77, l: "T" }, { x: 288, y: 77, l: "T" }, { x: 386, y: 77, l: "T" },
    { x: 138, y: 139, l: "M" }, { x: 240, y: 139, l: "M" }, { x: 342, y: 139, l: "M" }
  ];
  var SPOTS = [
    { x: 414, l: "F", e: "☕" }, { x: 242, l: "T", e: "" }, { x: 185, l: "F", e: "" },
    { x: 60, l: "M", e: "" }, { x: 330, l: "F", e: "" }, { x: 420, l: "M", e: "✦" },
    { x: 248, l: "M", e: "" }, { x: 350, l: "M", e: "" }, { x: 66, l: "T", e: "" }
  ];
  var SKIN = ["#f1c9a5", "#e0ac84", "#c68b63", "#f6d7bd", "#a86f4a", "#e8b995", "#f0c2a0"];
  var cv, ctx, ags = {}, list = [], opt = {}, raf = 0, running = false, last = 0, T = 0, dpr = 1, geo = { k: 1, ox: 0, oy: 0 };

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function R(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function E(x, y, rx, ry, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.2832); ctx.fill(); }
  function now() { return Date.now(); }
  function glow(x, y, rx, ry, strength) {
    ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, "rgba(243,185,125," + strength + ")");
    g.addColorStop(.55, "rgba(229,166,112," + (strength * .45) + ")");
    g.addColorStop(1, "rgba(229,166,112,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.2832); ctx.fill(); ctx.restore();
  }

  function nearLane(y) { var b = "F", d = 1e9; for (var k in LANE) { var q = Math.abs(LANE[k] - y); if (q < d) { d = q; b = k; } } return b; }
  function route(a, tg) {
    var p = [], cl = nearLane(a.y), onLane = Math.abs(a.y - LANE[cl]) < 1.5, onEdge = Math.abs(a.x - EL) < 2 || Math.abs(a.x - ER) < 2, ly = LANE[tg.l];
    if (!onLane && !onEdge) { a.y = LANE[cl]; onLane = true; }
    var e = a.x < W / 2 ? EL : ER;
    if (onEdge && !onLane) p.push({ x: a.x, y: ly });
    else if (cl !== tg.l) p.push({ x: e, y: LANE[cl] }, { x: e, y: ly });
    p.push({ x: tg.x, y: ly });
    if (tg.drop !== undefined) p.push({ x: tg.x, y: tg.drop });
    return p;
  }
  function seat(a) { return { x: a.d.x, l: a.d.l, drop: a.d.y + 20 }; }
  function beginListening(a) {
    a.mode = "listen"; a.path = []; a.emote = ""; a.phaseText = "Так, слухаю…";
    a.listenUntil = now() + 1250; a.finishUntil = 0; a.face = a.x < W / 2 ? 1 : -1;
  }
  function goToDesk(a) {
    a.mode = "toDesk"; a.phaseText = "До ноутбука…"; a.path = route(a, seat(a)); a.finishUntil = 0;
  }
  function leaveDesk(a) {
    a.mode = "leave"; a.phaseText = ""; a.path = [{ x: a.d.x, y: LANE[a.d.l] }]; a.wait = rnd(1.5, 3.5); a.finishUntil = 0;
  }

  function init(canvas, agents, o) {
    cv = canvas; ctx = cv.getContext("2d"); opt = o || {}; list = [];
    Object.keys(ags).forEach(function (n) { delete ags[n]; });
    agents.forEach(function (t, i) {
      var d = DESKS[i % DESKS.length], s = SPOTS[i % SPOTS.length];
      var a = { t: t, i: i, d: d, x: s.x, y: LANE[s.l], mode: "idle", path: [], wait: rnd(0.5, 4), step: rnd(0, 8), face: 1, skin: SKIN[i % SKIN.length], status: "", until: 0, emote: "", phaseText: "", spot: s, ok: true, finishUntil: 0, listenUntil: 0 };
      ags[t.n] = a; list.push(a);
    });
    cv.addEventListener("click", function (e) { var a = hit(e); if (a && opt.select) opt.select(a.t.n); });
    cv.addEventListener("dblclick", function (e) { var a = hit(e); if (a && opt.open) opt.open(a.t.n); });
    cv.addEventListener("mousemove", function (e) { cv.style.cursor = hit(e) ? "pointer" : "default"; });
    window.addEventListener("resize", fit);
    if (window.ResizeObserver) new ResizeObserver(fit).observe(cv);
  }
  function fit() {
    if (!cv) return; var r = cv.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    draw();
  }
  function hit(e) {
    var r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr, x = (px - geo.ox) / geo.k, y = (py - geo.oy) / geo.k, best = null, bd = 1e9;
    list.forEach(function (a) { var dx = Math.abs(x - a.x), dy = y - (a.y - 13); if (dx < 13 && Math.abs(dy) < 19 && dx + Math.abs(dy) < bd) { bd = dx + Math.abs(dy); best = a; } });
    return best;
  }

  function busyOf(a) { return !!(opt.busy && opt.busy(a.t.n)); }
  function tick(dt) {
    T += dt; var t = now(), reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.forEach(function (a) {
      var busy = busyOf(a);
      if (busy && (a.mode === "idle" || a.mode === "leave")) beginListening(a);
      if (a.mode === "listen" && t >= a.listenUntil) goToDesk(a);
      if (a.mode === "work" && busy) a.finishUntil = 0;
      if (a.mode === "work" && !busy) {
        if (!a.finishUntil) a.finishUntil = t + 900;
        if (t >= a.finishUntil) leaveDesk(a);
      }
      if (a.path.length) {
        var p = a.path[0], dx = p.x - a.x, dy = p.y - a.y, dist = Math.sqrt(dx * dx + dy * dy), sp = reduceMotion ? 190 : (a.mode === "toDesk" ? 54 : 32), mv = sp * dt;
        if (dist <= mv) { a.x = p.x; a.y = p.y; a.path.shift(); }
        else { a.x += dx / dist * mv; a.y += dy / dist * mv; a.step += dt * sp * 0.36; if (Math.abs(dx) > 0.5) a.face = dx > 0 ? 1 : -1; }
        if (!a.path.length) {
          if (a.mode === "toDesk") { a.mode = "work"; a.phaseText = busy ? "" : "Ще мить…"; a.finishUntil = busy ? 0 : t + 1000; a.face = 1; }
          else if (a.mode === "leave") a.mode = "idle";
          else if (a.mode === "idle") a.emote = a.spot.e;
        }
      } else if (a.mode === "idle" && !reduceMotion) {
        a.wait -= dt;
        if (a.wait <= 0) {
          var s; do { s = SPOTS[Math.floor(Math.random() * SPOTS.length)]; } while (s === a.spot && SPOTS.length > 1);
          a.spot = s; a.emote = ""; a.path = route(a, { x: s.x, l: s.l }); a.wait = rnd(4, 10);
        }
      }
      if (a.mode !== "work" && a.status && t > a.until) a.status = "";
    });
  }

  /* ---------- вечірній інтер’єр ---------- */
  function windowScene(x) {
    R(x - 3, 12, 84, 45, "#57483f"); R(x, 15, 78, 38, "#172335");
    R(x + 2, 17, 74, 34, "#223148"); R(x + 2, 31, 74, 20, "#30364a");
    [[5, 20, 8, 13], [15, 25, 10, 9], [27, 21, 8, 16], [39, 27, 12, 10], [54, 19, 8, 18], [64, 24, 8, 13]].forEach(function (b, i) {
      R(x + b[0], 51 - b[3], b[2], b[3], i % 2 ? "#1b263a" : "#202b40");
      if (i % 2 === 0) { R(x + b[0] + 2, 51 - b[3] + 4, 2, 2, "#e9b878"); R(x + b[0] + 5, 51 - b[3] + 9, 2, 2, "#e9b878"); }
    });
    [[10,20],[23,24],[46,19],[68,21]].forEach(function (p) { R(x + p[0], p[1], 2, 2, "#f4d9a3"); });
    E(x + 59, 24, 5.5, 5.5, "#f3d9a0"); E(x + 61, 22, 5.2, 5.2, "#223148");
    R(x + 37, 15, 3, 38, "#57483f"); R(x, 32, 78, 3, "#57483f");
    R(x - 4, 54, 86, 4, "#85634b"); R(x - 2, 58, 82, 2, "#463c3b");
  }
  function room() {
    R(0, 0, W, H, "#11131b");
    R(8, 7, 464, 252, "#20232d"); R(12, 8, 456, 49, "#2a2932");
    R(12, 53, 456, 5, "#715744"); R(12, 58, 456, 2, "#131720");
    [28, 133, 238].forEach(windowScene);
    /* Підвіконня, непомітний годинник та тонка полиця */
    E(429, 28, 9, 9, "#dfc69b"); E(429, 28, 7, 7, "#2a2932");
    ctx.strokeStyle = "#d8c29b"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(429, 28); ctx.lineTo(429, 23); ctx.moveTo(429, 28); ctx.lineTo(432, 30); ctx.stroke();
    R(369, 13, 52, 3, "#765b48"); R(374, 17, 3, 21, "#5c493e");
    ["#b77f59", "#66818a", "#ceaa6b", "#88729a"].forEach(function (c, i) { R(380 + i * 10, 18 + (i % 2) * 2, 7, 18 - (i % 2) * 2, c); });
    /* Тепла підлога з дуже делікатною сіткою */
    R(12, 60, 456, 197, "#2b2b34");
    for (var y = 60, r = 0; y < 257; y += 24, r++) {
      for (var x = 12, c = 0; x < 468; x += 24, c++) R(x, y, 24, 24, (r + c) % 2 ? "#302f38" : "#2d2c35");
    }
    /* Розсіяне тепле світло, без перевантаження дрібним декором */
    glow(238, 155, 280, 175, .085); glow(82, 194, 105, 76, .09); glow(410, 190, 82, 75, .11);
    /* Тонкий килим у зоні відпочинку */
    R(165, 205, 150, 45, "#37303a"); R(170, 210, 140, 35, "#40343b");
    R(175, 214, 130, 1, "#695044"); R(175, 239, 130, 1, "#695044");
    R(181, 219, 118, 17, "#493940");
    /* Плінтус і м’яка віньєтка */
    R(12, 254, 456, 3, "#171922");
    R(8, 7, 4, 250, "rgba(10,11,17,.28)"); R(468, 7, 4, 250, "rgba(10,11,17,.28)");
  }
  function plant(x, y) {
    E(x, y - 2, 12, 3, "rgba(8,10,15,.22)"); R(x - 7, y - 10, 14, 9, "#765743"); R(x - 6, y - 9, 12, 2, "#a17a58");
    E(x, y - 16, 7, 9, "#55765d"); E(x - 6, y - 14, 5, 6, "#698b68"); E(x + 6, y - 12, 5, 7, "#78936b"); E(x, y - 23, 4, 7, "#77966c");
  }
  function sofa() {
    R(31, 204, 94, 34, "#181921"); R(28, 194, 100, 32, "#70544d");
    R(34, 198, 88, 22, "#8a665a"); R(31, 220, 94, 8, "#624a46");
    R(28, 201, 8, 24, "#795950"); R(120, 201, 8, 24, "#795950");
    R(52, 198, 27, 20, "#aa7e6b"); R(82, 198, 29, 20, "#997465");
    R(40, 228, 5, 5, "#473b38"); R(108, 228, 5, 5, "#473b38");
  }
  function coffee() {
    R(390, 204, 58, 33, "#171921"); R(387, 194, 64, 10, "#795a46"); R(391, 197, 56, 5, "#a17a58");
    R(400, 177, 38, 18, "#37343a"); R(404, 180, 30, 8, "#20232d");
    R(408, 182, 4, 4, "#df9e67"); R(420, 182, 12, 4, "#6f8790");
    R(405, 196, 12, 6, "#e4d1b6"); R(418, 197, 7, 4, "#f0c789");
    R(396, 237, 4, 7, "#57473d"); R(438, 237, 4, 7, "#57473d");
  }
  function loungeTable() {
    R(130, 218, 28, 18, "#171920"); R(127, 214, 34, 6, "#8e6b50"); R(130, 215, 28, 2, "#b08a61");
    R(142, 220, 7, 2, "#d0ad7b");
  }
  function chair(a) {
    R(a.x - 9, a.y - 8, 18, 10, "#333541"); R(a.x - 7, a.y + 2, 14, 4, "#4b4a50");
    R(a.x - 5, a.y + 6, 2, 4, "#51463e"); R(a.x + 3, a.y + 6, 2, 4, "#51463e");
  }
  function desk(a) {
    var d = a.d, working = a.mode === "work" && Math.abs(a.x - d.x) < 1;
    E(d.x, d.y + 14, 31, 11, working ? "rgba(246,190,116,.14)" : "rgba(226,175,112,.055)");
    R(d.x - 30, d.y, 60, 7, "#775943"); R(d.x - 30, d.y + 7, 60, 7, "#5d483e");
    R(d.x - 27, d.y + 14, 4, 9, "#493d39"); R(d.x + 23, d.y + 14, 4, 9, "#493d39");
    R(d.x - 12, d.y - 14, 24, 15, "#a2a7ad"); R(d.x - 10, d.y - 12, 20, 11, working ? "#33464d" : "#303744");
    R(d.x - 8, d.y - 10, 16, 1, working ? "#d79d68" : "#58616c");
    R(d.x - 7, d.y - 1, 14, 2, "#b19a7f"); R(d.x - 4, d.y + 1, 8, 2, "#4f5058");
    if (working) {
      var blink = Math.sin(T * 15) > 0;
      R(d.x - 8, d.y + 4 + (blink ? 1 : 0), 3, 2, a.skin); R(d.x + 5, d.y + 4 + (blink ? 0 : 1), 3, 2, a.skin);
    }
  }
  function person(a) {
    var x = a.x, y = a.y, moving = a.path.length > 0, sit = a.mode === "work" && Math.abs(a.x - a.d.x) < 1 && !moving;
    var listening = a.mode === "listen", c = a.t.c || "#9c8977", hair = a.t.hair || "#382d2c";
    if (!sit) E(x, y + 1, 8, 2.5, "rgba(7,9,14,.28)");
    var walk = moving ? Math.sin(a.step * 3) * 2 : 0;
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var breathe = !reduceMotion && !moving && !sit ? Math.sin(T * 2.1 + a.i) * 0.6 : 0;
    var nod = listening && !reduceMotion ? Math.sin(T * 5.5) * 1.1 : 0;
    if (!sit) {
      R(x - 5, y - 8 + Math.max(0, walk), 4, 8 - Math.max(0, walk), "#29303a");
      R(x + 1, y - 8 + Math.max(0, -walk), 4, 8 - Math.max(0, -walk), "#29303a");
    }
    R(x - 6, y - 19 + breathe, 12, 12, c); R(x - 8, y - 18 + (moving ? walk * .4 : 0), 2, 8, c); R(x + 6, y - 18 - (moving ? walk * .4 : 0), 2, 8, c);
    if (listening) { R(x + (a.face > 0 ? 7 : -9), y - 22 + nod, 3, 7, c); R(x + (a.face > 0 ? 7 : -9), y - 24 + nod, 3, 3, a.skin); }
    R(x - 5, y - 29 + breathe + nod, 10, 10, a.skin); R(x - 5, y - 30 + breathe + nod, 10, 3, hair);
    R(x - 6, y - 29 + breathe + nod, 2, 6, hair); R(x + 4, y - 29 + breathe + nod, 2, 5, hair);
    var fx = sit ? 0 : a.face; R(x - 2 + fx, y - 25 + breathe + nod, 1.5, 2, "#292832"); R(x + 2 + fx, y - 25 + breathe + nod, 1.5, 2, "#292832");
    if (sit) { R(x - 3, y - 19, 6, 2, "rgba(239,204,155,.55)"); R(x - 5, y - 2, 10, 3, "#c49467"); }
  }
  function label(a, sel) {
    var font = Math.min(15, Math.max(8, 10.5 / Math.max(.55, geo.k)));
    ctx.font = "600 " + font + "px system-ui, Segoe UI, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var n = a.t.n, w = ctx.measureText(n).width + 10, x = Math.min(W - w / 2 - 8, Math.max(w / 2 + 4, a.x)), y = a.y - 38;
    R(x - w / 2, y - 7, w, 14, sel ? "#bd8d61" : "rgba(25,26,34,.94)");
    R(x - w / 2 + 2, y - 5, w - 4, 1, sel ? "#e6bb8b" : "rgba(244,228,208,.13)");
    ctx.fillStyle = sel ? "#211b19" : "#f1e8dc"; ctx.fillText(n, x, y + .5);
    var txt = a.phaseText || a.status || a.emote; if (!txt) return;
    ctx.font = "500 " + Math.max(7, font * .88) + "px system-ui, Segoe UI, sans-serif";
    var tx = txt.length > 26 ? txt.slice(0, 25) + "…" : txt, tw = Math.min(166, ctx.measureText(tx).width + 14), by = y - 19;
    var bx = Math.min(W - tw / 2 - 5, Math.max(tw / 2 + 5, x));
    R(bx - tw / 2, by - 7, tw, 14, "#f0e4d4"); R(x - 2, by + 7, 4, 3, "#f0e4d4");
    ctx.fillStyle = a.ok ? "#38302c" : "#8d4b46"; ctx.fillText(tx, bx, by + .5);
  }
  function draw() {
    if (!ctx) return; var w = cv.width, h = cv.height, k = Math.min(w / W, h / H);
    geo = { k: k, ox: (w - W * k) / 2, oy: (h - H * k) / 2 };
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#151720"; ctx.fillRect(0, 0, w, h);
    ctx.setTransform(k, 0, 0, k, geo.ox, geo.oy); room();
    var items = [
      { d: 228, f: sofa }, { d: 238, f: loungeTable }, { d: 202, f: coffee },
      { d: 224, f: function () { plant(24, 223); } }, { d: 225, f: function () { plant(458, 224); } },
      { d: 251, f: function () { plant(355, 251); } }
    ];
    list.forEach(function (a) {
      var seated = a.mode === "work" && Math.abs(a.x - a.d.x) < 1 && !a.path.length;
      items.push({ d: a.d.y + 20, f: function () { chair({ x: a.d.x, y: a.d.y + 15 }); } });
      items.push({ d: seated ? a.d.y + 14 : a.y, f: function () { person(a); } });
      items.push({ d: a.d.y + 23, f: function () { desk(a); } });
    });
    items.sort(function (p, q) { return p.d - q.d; }).forEach(function (i) { i.f(); });
    /* Світло від вікон і теплі робочі острови */
    R(12, 58, 456, 2, "rgba(226,175,112,.12)");
    list.forEach(function (a) { if (a.mode === "work") E(a.d.x, a.d.y + 13, 36, 15, "rgba(249,194,126,.055)"); });
    var sel = opt.selected ? opt.selected() : ""; list.forEach(function (a) { label(a, a.t.n === sel); });
  }
  function loop(ts) { if (!running) return; var dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts; tick(dt); draw(); raf = requestAnimationFrame(loop); }
  return {
    init: init,
    start: function () { if (running) return; running = true; last = performance.now(); fit(); raf = requestAnimationFrame(loop); },
    stop: function () { running = false; cancelAnimationFrame(raf); },
    status: function (n, text) { var a = ags[n]; if (a) { a.status = text; a.ok = true; a.until = now() + 1e9; } },
    done: function (n, ok, text) { var a = ags[n]; if (a) { a.status = ok ? (text || "✅ Готово!") : "❌ Помилка"; a.ok = ok; a.until = now() + 7000; } },
    tick: tick, draw: draw, _ags: ags
  };
})();
