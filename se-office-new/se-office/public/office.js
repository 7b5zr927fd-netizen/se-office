/* Віртуальний офіс — затишний вечірній піксельний офіс.
   Працівники ходять між кавоматом, вікнами, диваном і столами. Коли ви даєте завдання, працівник
   помічає вас, вислуховує (киває), іде до свого стола й працює. Закінчивши — радіє і повертається до прогулянок.
   Картинка малюється у малому буфері 384×216 і збільшується без згладжування — звідси «піксельний» вигляд. */
window.Office = (function () {
  "use strict";
  var W = 384, H = 216, CELL = 4, GW = W / CELL, GH = H / CELL;
  var cv, ctx, buf, bx, bgc, grid, opt = {}, ags = {}, list = [], raf = 0, running = false, last = 0, T = 0, dpr = 1, geo = { k: 1, ox: 0, oy: 0 };
  var portraits = {};

  /* ---------- розташування (змінюйте тут, якщо хочете інакше розставити меблі) ---------- */
  var DESKS = [{ x: 44, y: 96 }, { x: 118, y: 96 }, { x: 192, y: 96 }, { x: 266, y: 96 }, { x: 80, y: 150 }, { x: 154, y: 150 }, { x: 228, y: 150 }];
  var WIN = [{ x: 12, y: 9 }, { x: 82, y: 9 }, { x: 202, y: 9 }], WW = 56, WH = 34;
  var SPOTS = [
    { id: "coffee", x: 350, y: 95, f: "up", act: "coffee", e: "☕", t: [6, 10] },
    { id: "winA", x: 81, y: 77, f: "up", act: "look", e: "🌙", t: [6, 11] },
    { id: "winB", x: 229, y: 77, f: "up", act: "look", e: "✨", t: [6, 11] },
    { id: "book", x: 318, y: 73, f: "up", act: "book", e: "📚", t: [7, 12] },
    { id: "sofa", x: 46, y: 192, nx: 86, ny: 192, f: "down", act: "sit", e: "😌", t: [10, 18] },
    { id: "chair", x: 318, y: 168, nx: 290, ny: 170, f: "down", act: "sit", e: "📖", t: [9, 15] },
    { id: "chatA", x: 148, y: 126, f: "right", act: "chat", e: "💬", pair: "chatB", t: [6, 11] },
    { id: "chatB", x: 170, y: 126, f: "left", act: "chat", e: "💬", pair: "chatA", t: [6, 11] },
    { id: "stretch", x: 268, y: 126, f: "down", act: "stretch", e: "", t: [3, 5] },
    { id: "plant", x: 36, y: 146, f: "left", act: "look", e: "🌱", t: [4, 7] }
  ];
  var OBS = [];
  DESKS.forEach(function (d, i) { OBS.push([d.x - 24, i < 4 ? 60 : d.y - 10, d.x + 24, d.y + 18]); });
  OBS.push([338, 56, 384, 88], [298, 56, 338, 66], [10, 164, 78, 200], [296, 146, 340, 176], [166, 184, 210, 198], [118, 186, 146, 200],
    [8, 130, 26, 146], [88, 192, 104, 206], [344, 176, 358, 190], [358, 190, 376, 208]);
  DESKS.forEach(function (d, i) { d.nav = { x: d.x + 36, y: d.y + 4 }; d.seat = { x: d.x, y: d.y + 4 }; });

  /* ---------- вигляд персонажів ---------- */
  var SKIN = ["#f3cfae", "#e2ac86", "#c88b62", "#f7dcc3", "#a8704a", "#eab995", "#f0c4a2"];
  var LOOKS = [
    { hs: "messy", fit: 0, pants: "#2e3347" }, { hs: "long", fit: 1, pants: "#3a3d55" }, { hs: "bob", fit: 2, pants: "#2c3a4a", glasses: 1 },
    { hs: "bun", fit: 3, pants: "#3f3550" }, { hs: "phones", fit: 0, pants: "#2a3a3a" }, { hs: "cap", fit: 2, pants: "#3a3347" }, { hs: "curly", fit: 1, pants: "#33384c" }
  ];
  var INK = "#2b2233", SHOE = "#1e1a28";

  /* ---------- допоміжне малювання ---------- */
  var _sh = {};
  function hex(c) { if (!/^#/.test(c || "")) c = "#888888"; if (c.length === 4) c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]; return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function sh(c, a) { var k = c + "|" + a; if (_sh[k]) return _sh[k]; var v = hex(c).map(function (n) { n = Math.max(0, Math.min(255, Math.round(n + a * 2.55))); return (n < 16 ? "0" : "") + n.toString(16); }); return (_sh[k] = "#" + v.join("")); }
  function rgba(c, a) { var v = hex(c); return "rgba(" + v[0] + "," + v[1] + "," + v[2] + "," + a + ")"; }
  function rng(s) { return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function R(x, y, w, h, c) { bx.fillStyle = c; bx.fillRect(Math.round(x), Math.round(y), w, h); }
  function P(x, y, c) { R(x, y, 1, 1, c); }
  function E(cx, cy, rx, ry, c) { bx.fillStyle = c; cx = Math.round(cx); cy = Math.round(cy); for (var j = -ry; j <= ry; j++) { var hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (j * j) / (ry * ry + 0.6)))); bx.fillRect(cx - hw, cy + j, hw * 2 + 1, 1); } }
  function L(x0, y0, x1, y1, c) { var n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1; for (var i = 0; i <= n; i++) P(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c); }
  function glow(cx, cy, rx, ry, rgb, a) { bx.globalCompositeOperation = "lighter"; for (var s = 0; s < 3; s++) E(cx, cy, rx * (1 - s * 0.3), ry * (1 - s * 0.3), "rgba(" + rgb + "," + a + ")"); bx.globalCompositeOperation = "source-over"; }
  function now() { return Date.now(); }

  /* ---------- пошук шляху (A*) по сітці, щоб ходити довкола меблів ---------- */
  function buildGrid() {
    grid = new Uint8Array(GW * GH);
    for (var gy = 0; gy < GH; gy++) for (var gx = 0; gx < GW; gx++) {
      var cx = gx * CELL + CELL / 2, cy = gy * CELL + CELL / 2, b = cx < 10 || cx > W - 10 || cy < 64 || cy > H - 6;
      for (var i = 0; i < OBS.length && !b; i++) { var o = OBS[i]; if (cx > o[0] - 2 && cx < o[2] + 2 && cy > o[1] - 2 && cy < o[3] + 2) b = true; }
      grid[gy * GW + gx] = b ? 1 : 0;
    }
  }
  function cellFree(x, y) { var gx = Math.floor(x / CELL), gy = Math.floor(y / CELL); return gx >= 0 && gy >= 0 && gx < GW && gy < GH && !grid[gy * GW + gx]; }
  function snap(x, y) {
    if (cellFree(x, y)) return { x: x, y: y };
    for (var r = 1; r < 30; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (cellFree(x + dx * CELL, y + dy * CELL)) return { x: x + dx * CELL, y: y + dy * CELL };
    }
    return { x: x, y: y };
  }
  function los(a, b) { var n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2); for (var i = 1; i < n; i++) if (!cellFree(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n)) return false; return true; }
  function findPath(sx, sy, tx, ty) {
    var s = snap(sx, sy), t = snap(tx, ty), S = (Math.floor(s.y / CELL)) * GW + Math.floor(s.x / CELL), Tt = (Math.floor(t.y / CELL)) * GW + Math.floor(t.x / CELL);
    var g = new Float32Array(GW * GH).fill(1e9), par = new Int32Array(GW * GH).fill(-1), done = new Uint8Array(GW * GH), heap = [[0, S]];
    g[S] = 0;
    function push(it) { heap.push(it); var i = heap.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; var tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p; } }
    function pop() { var top = heap[0], lastIt = heap.pop(); if (heap.length) { heap[0] = lastIt; var i = 0; for (;;) { var l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; var tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m; } } return top; }
    var tx2 = Tt % GW, ty2 = Math.floor(Tt / GW);
    while (heap.length) {
      var cur = pop()[1]; if (done[cur]) continue; done[cur] = 1; if (cur === Tt) break;
      var cx = cur % GW, cy = Math.floor(cur / GW);
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; var nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        var ni = ny * GW + nx; if (grid[ni]) continue; if (dx && dy && (grid[cy * GW + nx] || grid[ny * GW + cx])) continue;
        var ng = g[cur] + (dx && dy ? 1.414 : 1); if (ng < g[ni]) { g[ni] = ng; par[ni] = cur; var h = Math.max(Math.abs(nx - tx2), Math.abs(ny - ty2)) + 0.414 * Math.min(Math.abs(nx - tx2), Math.abs(ny - ty2)); push([ng + h, ni]); }
      }
    }
    var pts = [], c = Tt; if (par[c] === -1 && c !== S) return [{ x: t.x, y: t.y }];
    while (c !== -1) { pts.push({ x: (c % GW) * CELL + CELL / 2, y: Math.floor(c / GW) * CELL + CELL / 2 }); c = par[c]; }
    pts.reverse(); pts[0] = { x: s.x, y: s.y }; pts[pts.length - 1] = { x: t.x, y: t.y };
    var out = [pts[0]], i = 0; while (i < pts.length - 1) { var j = pts.length - 1; while (j > i + 1 && !los(pts[i], pts[j])) j--; out.push(pts[j]); i = j; }
    out.shift(); return out;
  }

  /* ---------- персонаж ---------- */
  function person(o) {
    var x = Math.round(o.x), y = Math.round(o.y), d = o.dir || "down", side = d === "left" || d === "right", fx = d === "left" ? -1 : 1;
    var sit = o.sit || 0, ys = y + Math.round(3 * sit) + (o.by || 0), yh = ys + (o.hy || 0), sw = o.sw || 0;
    var top = o.top, tdk = sh(top, -22), skin = o.skin, sk2 = sh(skin, -14), hc = o.hair, hl = sh(hc, 24), pants = o.pants, look = o.look;
    var hs = look.hs, blush = "#ee9a94", acc = o.acc;
    function Rr(ox, oy, w, h, c) { R(x + ox, ys + oy, w, h, c); }
    function Hh(ox, oy, w, h, c) { R(x + ox, yh + oy, w, h, c); }
    function Sr(ox, oy, w, h, c) { R(fx > 0 ? x + ox : x - ox - w + 1, ys + oy, w, h, c); }
    function Sh(ox, oy, w, h, c) { R(fx > 0 ? x + ox : x - ox - w + 1, yh + oy, w, h, c); }
    if (!sit) E(x, y, 6, 2, "rgba(20,10,30,.3)");
    var lA = Math.max(0, sw), lB = Math.max(0, -sw);
    /* ---- ноги ---- */
    if (sit > 0.5) { Rr(-3, -6, 7, 3, pants); Rr(-3, -3, 3, 3, pants); Rr(1, -3, 3, 3, pants); Rr(-3, -1, 3, 1, SHOE); Rr(1, -1, 3, 1, SHOE); }
    else if (!side) { Rr(-3, -6, 3, 6 - lA, pants); Rr(1, -6, 3, 6 - lB, pants); Rr(-3, -2 - lA, 3, 2, SHOE); Rr(1, -2 - lB, 3, 2, SHOE); }
    else { var ax = Math.round(sw * 0.8); Sr(-2 + ax, -6, 3, 6 - Math.max(0, -sw), sh(pants, -10)); Sr(-2 + ax, -2 - Math.max(0, -sw), 3, 2, SHOE); Sr(-1 - ax, -6, 3, 6 - Math.max(0, sw), pants); Sr(-1 - ax, -2 - Math.max(0, sw), 3, 2, SHOE); Sr(1 - ax, -2 - Math.max(0, sw), 1, 2, SHOE); }
    /* ---- тулуб ---- */
    var arms = o.arms || "down", aL = 0, aR = 0, i;
    if (!side) {
      Rr(-3, -14, 7, 8, top); Rr(-3, -7, 7, 1, tdk);
      if (d === "down") {
        if (look.fit === 0) { Rr(-1, -12, 1, 3, "#efe4d4"); Rr(1, -12, 1, 3, "#efe4d4"); Rr(-2, -9, 5, 1, tdk); }
        else if (look.fit === 1) { Rr(-2, -14, 2, 2, "#f4efe6"); Rr(1, -14, 2, 2, "#f4efe6"); Rr(0, -12, 1, 5, sh(top, -30)); }
        else if (look.fit === 2) { Rr(-3, -11, 7, 1, sh(top, 30)); Rr(-3, -9, 7, 1, sh(top, 30)); }
        else { Rr(-3, -14, 7, 2, sh(top, 24)); Rr(-2, -9, 5, 1, tdk); }
        Rr(-1, -14, 3, 1, skin);
      } else { Rr(-3, -14, 7, 2, sh(top, -14)); }
      if (o.moving) { aL = Math.round(sw * 0.5); aR = -aL; }
      if (arms === "type") { Rr(-6, -13, 2, 6, top); Rr(5, -13, 2, 6, top); }
      else if (arms === "up") { Rr(-6, -22, 2, 8, top); Rr(5, -22, 2, 8, top); Rr(-6, -24, 2, 2, skin); Rr(5, -24, 2, 2, skin); Rr(-4, -14, 1, 2, top); Rr(4, -14, 1, 2, top); }
      else if (arms === "wave") { var wv = Math.round(Math.sin(T * 14)); Rr(-5, -14, 2, 6, top); Rr(-5, -8, 2, 2, skin); Rr(5 + wv, -21, 2, 8, top); Rr(5 + wv, -23, 2, 2, skin); Rr(4, -14, 1, 2, top); }
      else if (arms === "book") { Rr(-5, -14, 2, 5, top); Rr(4, -14, 2, 5, top); Rr(-4, -10, 9, 6, "#8e3b46"); Rr(-3, -9, 7, 4, "#f1e6d0"); Rr(0, -9, 1, 4, "#c9b99d"); Rr(-4, -5, 2, 2, skin); Rr(3, -5, 2, 2, skin); }
      else if (arms === "hold") { Rr(-5, -14, 2, 6, top); Rr(-5, -8, 2, 2, skin); Rr(4, -14, 2, 4, top); Rr(5, -11, 2, 3, top); Rr(4, -17, 2, 2, skin); }
      else { Rr(-5, -14 + aL, 2, 6, top); Rr(-5, -9 + aL, 2, 1, tdk); Rr(-5, -8 + aL, 2, 2, skin); Rr(4, -14 + aR, 2, 6, top); Rr(4, -9 + aR, 2, 1, tdk); Rr(4, -8 + aR, 2, 2, skin); }
    } else {
      Sr(-3, -14, 6, 8, top); Sr(-3, -7, 6, 1, tdk);
      if (look.fit === 0) Sr(-4, -13, 2, 5, sh(top, -16)); else if (look.fit === 3) Sr(-3, -14, 6, 2, sh(top, 24));
      if (o.moving) aL = Math.round(-sw * 0.8);
      Sr(-1 + aL, -13, 2, 6, sh(top, -8)); Sr(-1 + aL, -7, 2, 2, skin);
    }
    /* ---- голова ---- */
    if (d === "down") {
      Hh(-4, -23, 9, 9, skin); Hh(-1, -15, 3, 1, skin);
      var cap = sh(top, -8);
      Hh(-5, -25, 11, 4, hc); Hh(-4, -26, 9, 1, hc); Hh(-2, -25, 3, 1, hl);
      if (hs === "messy") { Hh(-5, -21, 1, 3, hc); Hh(5, -21, 1, 3, hc); Hh(-4, -21, 6, 1, hc); Hh(3, -21, 2, 1, hc); Hh(-4, -28, 2, 2, hc); Hh(0, -28, 3, 2, hc); Hh(3, -27, 2, 1, hc); }
      else if (hs === "long") { Hh(-5, -22, 2, 11, hc); Hh(4, -22, 2, 11, hc); Hh(-4, -21, 4, 2, hc); Hh(1, -21, 4, 1, hc); }
      else if (hs === "bob") { Hh(-5, -22, 2, 7, hc); Hh(4, -22, 2, 7, hc); Hh(-4, -21, 9, 2, hc); Hh(0, -21, 1, 2, skin); }
      else if (hs === "bun") { Hh(-5, -21, 1, 3, hc); Hh(5, -21, 1, 3, hc); Hh(-4, -21, 5, 1, hc); Hh(2, -21, 2, 1, hc); Hh(-2, -30, 5, 4, hc); Hh(-1, -30, 2, 1, hl); Hh(-2, -26, 5, 1, acc); }
      else if (hs === "phones") { Hh(-5, -21, 1, 3, hc); Hh(5, -21, 1, 3, hc); Hh(-4, -21, 6, 1, hc); Hh(-5, -27, 11, 1, "#2a2a36"); Hh(-6, -23, 2, 6, "#2a2a36"); Hh(5, -23, 2, 6, "#2a2a36"); Hh(-6, -21, 1, 2, acc); Hh(6, -21, 1, 2, acc); }
      else if (hs === "cap") { Hh(-5, -26, 11, 5, cap); Hh(-4, -27, 9, 1, cap); Hh(-5, -21, 11, 1, sh(cap, -22)); Hh(-5, -20, 1, 2, hc); Hh(5, -20, 1, 2, hc); Hh(-1, -24, 3, 2, sh(cap, 30)); }
      else if (hs === "curly") { Hh(-6, -24, 2, 5, hc); Hh(5, -24, 2, 5, hc); Hh(-5, -27, 3, 2, hc); Hh(-1, -27, 3, 2, hc); Hh(2, -27, 3, 2, hc); Hh(-4, -21, 9, 1, hc); }
      var ex = o.look2 || 0, ey = o.eyeDy || 0;
      if (o.mood === "sad" || o.blink) { Hh(-3 + ex, -18, 2, 1, INK); Hh(2 + ex, -18, 2, 1, INK); }
      else if (look.glasses) { Hh(-3 + ex, -19 + ey, 2, 2, INK); Hh(2 + ex, -19 + ey, 2, 2, INK); }
      else { Hh(-3 + ex, -19 + ey, 2, 3 - (ey ? 1 : 0), INK); Hh(2 + ex, -19 + ey, 2, 3 - (ey ? 1 : 0), INK); P(x - 3 + ex, yh - 19 + ey, "#fff"); P(x + 2 + ex, yh - 19 + ey, "#fff"); }
      if (look.glasses) { var gl = "#3b3350"; Hh(-4, -20, 4, 1, gl); Hh(-4, -17, 4, 1, gl); Hh(-4, -19, 1, 2, gl); Hh(-1, -19, 1, 2, gl); Hh(1, -20, 4, 1, gl); Hh(1, -17, 4, 1, gl); Hh(1, -19, 1, 2, gl); Hh(4, -19, 1, 2, gl); Hh(0, -19, 1, 1, gl); }
      Hh(-4, -16, 2, 1, blush); Hh(3, -16, 2, 1, blush);
      if (o.mood === "happy") { Hh(-1, -15, 3, 1, "#9c4f4f"); }
      else if (o.mood === "sad") { Hh(-1, -15, 3, 1, "#9c4f4f"); P(x - 1, yh - 14, "#9c4f4f"); P(x + 1, yh - 14, "#9c4f4f"); }
      else if (o.mood === "o") { Hh(0, -16, 1, 2, "#9c4f4f"); }
      else Hh(0, -15, 1, 1, "#9c4f4f");
      if (o.glow) { bx.fillStyle = o.glow; bx.fillRect(x - 4, yh - 21, 9, 7); }
    } else if (d === "up") {
      Hh(-4, -23, 9, 9, hc); Hh(-5, -25, 11, 4, hc); Hh(-4, -26, 9, 1, hc); Hh(-2, -25, 3, 1, hl); Hh(-1, -15, 3, 1, skin);
      if (hs === "long") { Hh(-5, -22, 11, 11, hc); Hh(-2, -20, 1, 7, hl); }
      else if (hs === "bob") { Hh(-5, -22, 11, 7, hc); }
      else if (hs === "bun") { Hh(-2, -30, 5, 4, hc); Hh(-1, -30, 2, 1, hl); Hh(-2, -26, 5, 1, acc); Hh(-5, -21, 1, 3, hc); Hh(5, -21, 1, 3, hc); }
      else if (hs === "phones") { Hh(-5, -27, 11, 1, "#2a2a36"); Hh(-6, -23, 2, 6, "#2a2a36"); Hh(5, -23, 2, 6, "#2a2a36"); }
      else if (hs === "cap") { Hh(-5, -26, 11, 5, sh(top, -8)); Hh(-4, -27, 9, 1, sh(top, -8)); Hh(-5, -21, 11, 1, sh(top, -30)); }
      else if (hs === "curly") { Hh(-6, -24, 2, 5, hc); Hh(5, -24, 2, 5, hc); Hh(-5, -27, 3, 2, hc); Hh(-1, -27, 3, 2, hc); Hh(2, -27, 3, 2, hc); }
      else if (hs === "messy") { Hh(-4, -28, 2, 2, hc); Hh(0, -28, 3, 2, hc); Hh(3, -27, 2, 1, hc); Hh(-5, -21, 1, 3, hc); Hh(5, -21, 1, 3, hc); }
      else { Hh(-5, -21, 1, 3, hc); Hh(5, -21, 1, 3, hc); }
    } else {
      Sh(-3, -23, 8, 9, skin); Sh(5, -18, 1, 1, sk2); Sh(-1, -19, 2, 2, sk2); Sh(-1, -15, 3, 1, skin);
      Sh(-4, -25, 9, 4, hc); Sh(-3, -26, 7, 1, hc); Sh(-1, -25, 3, 1, hl); Sh(-4, -22, 4, 6, hc); Sh(1, -22, 4, 2, hc);
      if (hs === "messy") { Sh(-3, -28, 2, 2, hc); Sh(0, -28, 3, 2, hc); Sh(3, -27, 2, 1, hc); }
      else if (hs === "long") { Sh(-4, -22, 4, 12, hc); }
      else if (hs === "bob") { Sh(-4, -22, 4, 8, hc); }
      else if (hs === "bun") { Sh(-4, -30, 5, 4, hc); Sh(-3, -30, 2, 1, hl); }
      else if (hs === "phones") { Sh(-4, -27, 9, 1, "#2a2a36"); Sh(-2, -23, 3, 6, "#2a2a36"); Sh(-1, -21, 1, 2, acc); }
      else if (hs === "cap") { var c2 = sh(top, -8); Sh(-4, -26, 9, 5, c2); Sh(-3, -27, 7, 1, c2); Sh(4, -21, 4, 1, sh(c2, -22)); }
      else if (hs === "curly") { Sh(-5, -24, 2, 5, hc); Sh(-3, -27, 3, 2, hc); Sh(1, -27, 3, 2, hc); }
      if (o.mood === "sad" || o.blink) Sh(2, -18, 2, 1, INK); else { Sh(2, -19, 1, 3 - (o.eyeDy ? 1 : 0), INK); P(fx > 0 ? x + 2 : x - 2, yh - 19, "#fff"); }
      Sh(2, -16, 2, 1, blush); Sh(4, -15, 1, 1, "#9c4f4f");
      if (look.glasses) { var g2 = "#3b3350"; Sh(1, -20, 4, 1, g2); Sh(1, -17, 4, 1, g2); Sh(1, -19, 1, 2, g2); Sh(4, -19, 1, 2, g2); Sh(-2, -20, 3, 1, g2); }
    }
  }

  /* ---------- меблі та кімната ---------- */
  function wallBG() {
    R(0, 0, W, 58, "#46354f"); for (var x = 0; x < W; x += 8) R(x, 0, 4, 58, "#4b3a55");
    R(0, 0, W, 6, "#352840"); R(0, 6, W, 1, "#5a4564");
    R(0, 45, W, 2, "#7a6280"); R(0, 47, W, 11, "#3a2c45"); for (x = 6; x < W; x += 24) R(x, 49, 1, 7, "#31243b");
    R(0, 58, W, 4, "#2b2033"); R(0, 58, W, 1, "#6b5470");
    var rr = rng(7), sky = ["#1a1740", "#2b2257", "#472e6a", "#7a3f78", "#bd5a76", "#e8806e"];
    WIN.forEach(function (w, wi) {
      R(w.x - 2, w.y - 2, WW + 4, WH + 4, "#d9c9ae"); R(w.x - 2, w.y - 2, WW + 4, 1, "#efe3cc");
      for (var k = 0; k < 6; k++) R(w.x, w.y + Math.floor(k * WH / 6), WW, Math.ceil(WH / 6), sky[k]);
      var bxp = 0; while (bxp < WW) { var bw = 5 + Math.floor(rr() * 6), bh = 8 + Math.floor(rr() * 14); if (bxp + bw > WW) bw = WW - bxp; R(w.x + bxp, w.y + WH - bh, bw, bh, rr() > 0.5 ? "#1d1733" : "#17112b"); w["b" + bxp] = [bxp, bw, bh]; bxp += bw; }
      w.bl = []; for (var kk in w) if (kk.charAt(0) === "b" && kk.length > 1 && w[kk] instanceof Array) w.bl.push(w[kk]);
      w.win = []; w.bl.forEach(function (b) { for (var yy = 3; yy < b[2] - 2; yy += 4) for (var xx = 1; xx < b[1] - 1; xx += 3) if (rr() > 0.35) w.win.push([w.x + b[0] + xx, w.y + WH - b[2] + yy, rr()]); });
      w.stars = []; for (var s = 0; s < 9; s++) w.stars.push([w.x + 2 + Math.floor(rr() * (WW - 4)), w.y + 1 + Math.floor(rr() * 14), rr() * 6]);
      R(w.x + WW / 2 - 1, w.y, 2, WH, "#d9c9ae"); R(w.x, w.y + 22, WW, 2, "#d9c9ae");
      R(w.x - 3, w.y + WH + 2, WW + 6, 3, "#cbb99d"); R(w.x - 3, w.y + WH + 5, WW + 6, 1, "#8d7a67");
      if (wi === 2) { E(w.x + 41, w.y + 9, 5, 5, "#f6e7b8"); E(w.x + 44, w.y + 8, 5, 5, "#472e6a"); }
      if (wi === 1) { R(w.x + 9, w.y + WH - 3, 7, 5, "#b5683f"); R(w.x + 9, w.y + WH - 3, 7, 1, "#d3865a"); E(w.x + 12, w.y + WH - 6, 4, 3, "#3f9a56"); E(w.x + 10, w.y + WH - 8, 2, 3, "#58b36f"); E(w.x + 14, w.y + WH - 8, 2, 3, "#46a45e"); }
    });
    /* годинник */
    E(171, 17, 9, 9, "#c9a96b"); E(171, 17, 8, 8, "#f3ead9");
    for (var h = 0; h < 12; h++) { var an = h / 12 * 6.2832; P(171 + Math.cos(an) * 6.6, 17 + Math.sin(an) * 6.6, "#6b5a47"); }
    /* рамки */
    R(268, 11, 13, 16, "#2a2036"); R(270, 13, 9, 12, "#e8c9a0"); R(270, 19, 9, 6, "#c9694e"); E(274, 17, 2, 2, "#f6e7b8"); R(270, 22, 9, 3, "#2f5d62");
    R(284, 17, 11, 14, "#2a2036"); R(286, 19, 7, 10, "#2f5d62"); E(289, 24, 2, 3, "#e3cfa6");
    /* полиця з горнятками над кавовим кутком */
    R(346, 30, 34, 2, "#6b4a33"); R(346, 32, 34, 1, "#4a3224");
    R(350, 24, 5, 6, "#e7d9c4"); R(358, 25, 5, 5, "#c7694f"); R(366, 23, 5, 7, "#5aa0a8"); R(354, 26, 1, 2, "#e7d9c4"); E(375, 26, 3, 3, "#3f9a56"); R(373, 28, 5, 2, "#b5683f");
    /* книжкова шафа */
    R(300, 10, 36, 52, "#5a3d2b"); R(302, 12, 32, 48, "#2d2029");
    var cols = ["#e45b5b", "#4f8ef7", "#f3c04a", "#58b36f", "#a56bd9", "#e8d8c0", "#c7694f", "#5aa0a8"], r2 = rng(3);
    for (var row = 0; row < 4; row++) { R(302, 24 + row * 12, 32, 2, "#6b4a33"); var bxx = 303; while (bxx < 332) { var bw2 = 2 + Math.floor(r2() * 3), bh2 = 6 + Math.floor(r2() * 4); R(bxx, 24 + row * 12 - bh2, bw2, bh2, cols[Math.floor(r2() * cols.length)]); bxx += bw2 + (r2() > 0.8 ? 1 : 0); } }
    R(300, 58, 36, 4, "#46301f");
    /* кавовий куточок */
    R(340, 58, 44, 10, "#7a5638"); R(340, 58, 44, 2, "#a07650"); R(340, 68, 44, 18, "#5d4129"); R(342, 70, 18, 14, "#4b3320"); R(362, 70, 18, 14, "#4b3320");
    R(344, 42, 16, 16, "#33384a"); R(346, 44, 12, 7, "#1c1f2b"); R(349, 53, 6, 5, "#1c1f2b"); R(344, 42, 16, 2, "#4a5068"); R(362, 50, 9, 8, "#e8e0d2"); R(363, 51, 7, 2, "#c9b99d");
    R(340, 86, 44, 2, "rgba(20,10,30,.3)");
  }
  function floorBG() {
    var r = rng(11), cl = ["#a2714a", "#a87850", "#9a6a44"];
    for (var y = 62, row = 0; y < H; y += 9, row++) {
      var off = (row * 29) % 56, x = -off; while (x < W) { var len = 56; R(Math.max(0, x), y, Math.min(len, W - Math.max(0, x)) - (x < 0 ? -x : 0) + (x < 0 ? 0 : 0), 8, cl[Math.floor(r() * 3)]); R(Math.max(0, x), y + 8, len, 1, "#8e5f3c"); if (x > 0) R(x, y, 1, 9, "#8e5f3c"); x += len; }
    }
    R(0, 62, W, 3, "rgba(30,15,40,.28)"); R(0, 65, W, 2, "rgba(30,15,40,.12)");
    /* килим */
    R(108, 170, 154, 46, "#e3cfa6"); R(111, 173, 148, 40, "#2f5d62"); R(114, 176, 142, 34, "#e3cfa6"); R(115, 177, 140, 32, "#2a5256");
    for (var i = 0; i < 8; i++) { var dx = 128 + i * 17; E(dx, 193, 4, 3, "#c9694e"); P(dx, 193, "#e3cfa6"); }
    for (i = 0; i < 38; i += 3) { R(106, 172 + i, 2, 1, "#e3cfa6"); R(262, 172 + i, 2, 1, "#e3cfa6"); }
  }
  function plant(x, y, big) {
    R(x - 5, y - 8, 10, 8, "#a0634a"); R(x - 5, y - 8, 10, 2, "#c27d5d"); R(x - 4, y, 8, 1, "rgba(20,10,30,.3)");
    E(x, y - 14, 8, 6, "#3f9a56"); E(x - 5, y - 19, 4, 6, "#4fb066"); E(x + 5, y - 18, 4, 6, "#46a45e"); E(x, y - 22, 3, 5, "#58b36f");
    if (big) { E(x - 8, y - 12, 4, 4, "#46a45e"); E(x + 8, y - 12, 4, 4, "#3f9a56"); }
  }
  function chairBack(d) { var x = d.x; R(x - 7, d.y - 14, 14, 15, "#3a3550"); R(x - 6, d.y - 15, 12, 1, "#3a3550"); R(x - 7, d.y - 14, 1, 14, "#4b4666"); R(x - 5, d.y - 12, 10, 1, "#4b4666"); R(x - 8, d.y - 4, 2, 7, "#2d2940"); R(x + 6, d.y - 4, 2, 7, "#2d2940"); }
  function desk(a, i) {
    var d = DESKS[i], x = d.x, y = d.y, work = a && a.mode === "work" && a.sit > 0.7, rgb = a ? hex(a.t.c).join(",") : "200,200,255";
    R(x - 22, y + 16, 44, 2, "rgba(20,10,30,.3)");
    R(x - 22, y, 44, 9, "#d6a46c"); R(x - 22, y, 44, 1, "#ebc08a"); R(x - 22, y + 9, 44, 7, "#a8703f"); R(x - 22, y + 9, 44, 1, "#8d5c34"); R(x + 6, y + 10, 14, 5, "#94622f"); R(x + 11, y + 12, 4, 1, "#d6a46c");
    R(x - 21, y + 16, 3, 2, "#6b4426"); R(x + 18, y + 16, 3, 2, "#6b4426");
    /* ноутбук (спиною до нас) */
    R(x - 5, y + 2, 10, 2, "#9aa1b0"); R(x - 4, y - 5, 8, 7, "#cfd4de"); R(x - 4, y - 5, 8, 1, "#e6eaf1"); R(x - 1, y - 2, 2, 2, work ? a.t.c : "#9aa1b0");
    if (work) { bx.globalCompositeOperation = "lighter"; E(x, y + 5, 11, 3, "rgba(" + rgb + ",.10)"); bx.globalCompositeOperation = "source-over"; }
    /* лампа */
    R(x - 18, y + 4, 5, 1, "#3a3040"); L(x - 16, y + 3, x - 18, y - 4, "#3a3040"); R(x - 21, y - 7, 7, 3, "#e8b86b"); R(x - 20, y - 4, 5, 1, "#fff0c4");
    /* дрібниці справа */
    var k = i % 3;
    if (k === 0) { R(x + 13, y + 1, 5, 5, "#f2e8dc"); R(x + 18, y + 2, 1, 3, "#f2e8dc"); R(x + 14, y + 1, 3, 1, "#6b4426"); }
    else if (k === 1) { R(x + 13, y + 1, 5, 4, "#b5683f"); E(x + 15, y - 1, 3, 3, "#3f9a56"); P(x + 14, y - 4, "#58b36f"); }
    else { R(x + 12, y + 3, 8, 2, "#c9694e"); R(x + 13, y + 1, 7, 2, "#5aa0a8"); R(x + 12, y - 1, 6, 2, "#e8d8c0"); }
    /* руки за ноутбуком */
    if (work) { var sp = a.wk === "think" ? 6 : a.wk === "read" ? 0 : 16, s = sp ? Math.sin(T * sp) > 0 : 0; R(x - 7, y + 1 + (s ? 1 : 0), 2, 2, a.skin); R(x + 5, y + 1 + (s ? 0 : 1), 2, 2, a.skin); }
    else if (a && a.sit > 0.7) { R(x - 7, y + 1, 2, 2, a.skin); R(x + 5, y + 1, 2, 2, a.skin); }
    if (work) { for (var q = 0; q < 3; q++) { var ph = (T * 0.8 + q / 3) % 1; bx.globalAlpha = 1 - ph; P(x - 4 + Math.sin(q * 2.3 + T * 2) * 6 + 4, y - 8 - ph * 14, a.t.c); bx.globalAlpha = 1; } }
    /* пара над горням */
    if (k === 0) { var sp2 = (T * 0.7 + i) % 1; bx.globalAlpha = (1 - sp2) * 0.6; P(x + 15 + Math.sin(T * 3 + i), y - 2 - sp2 * 8, "#fff"); bx.globalAlpha = 1; }
  }
  function sofa(front) {
    if (!front) { R(12, 164, 64, 16, "#7a4a5a"); R(14, 166, 60, 6, "#8d5a6c"); R(10, 170, 6, 24, "#6b3f4f"); R(72, 170, 6, 24, "#6b3f4f"); R(16, 178, 56, 13, "#93606f"); R(44, 178, 1, 13, "#7a4a5a"); R(18, 168, 8, 8, "#e3cfa6"); R(18, 168, 8, 1, "#f3e4c4"); R(18, 172, 8, 2, "#c9694e"); }
    else { R(10, 189, 68, 10, "#6b3f4f"); R(12, 189, 64, 2, "#8d5a6c"); R(10, 194, 68, 1, "#573140"); R(12, 199, 4, 2, "#3a2530"); R(72, 199, 4, 2, "#3a2530"); R(10, 197, 68, 2, "rgba(20,10,30,.3)"); }
  }
  function armchair(front) {
    if (!front) { R(300, 142, 36, 16, "#4d6b73"); R(302, 144, 32, 5, "#5f808a"); R(296, 150, 6, 22, "#3f5a62"); R(334, 150, 6, 22, "#3f5a62"); R(302, 156, 32, 10, "#5f808a"); }
    else { R(296, 166, 44, 9, "#3f5a62"); R(298, 166, 40, 2, "#5f808a"); R(298, 175, 4, 2, "#2c4046"); R(334, 175, 4, 2, "#2c4046"); }
  }
  function table() { var x = 188, y = 190; R(x - 20, y + 6, 40, 2, "rgba(20,10,30,.3)"); R(x - 20, y - 4, 40, 8, "#c99a6b"); R(x - 20, y - 4, 40, 1, "#e0b78a"); R(x - 18, y + 4, 36, 3, "#8d5c34"); R(x - 14, y - 7, 8, 3, "#5aa0a8"); R(x - 14, y - 6, 8, 1, "#e8d8c0"); R(x + 8, y - 6, 4, 4, "#f2e8dc"); R(x + 12, y - 5, 1, 2, "#f2e8dc"); R(x - 2, y - 8, 4, 4, "#e8d8c0"); R(x - 1, y - 11, 2, 3, "#fff3c4"); var fl = Math.sin(T * 9) > 0.4 ? 0 : 1; P(x, y - 12 + fl, "#ffb347"); P(x, y - 11 + fl, "#ffe08a"); }
  function cat() {
    var x = 132, y = 194, br = Math.round(Math.sin(T * 1.6));
    E(x, y + 3, 11, 2, "rgba(20,10,30,.25)"); E(x, y, 9, 4 + br * 0, "#d99a62"); E(x, y - 1, 8, 2, "#e8b07a"); E(x - 8, y + 1, 4, 3, "#d99a62"); P(x - 11, y - 2, "#d99a62"); P(x - 10, y - 3, "#d99a62"); P(x - 8, y - 3, "#d99a62"); P(x - 7, y - 2, "#d99a62");
    R(x - 10, y + 1, 2, 1, "#2b2233"); R(x + 7, y + 2, 5, 2, "#d99a62"); R(x + 10, y + 1, 2, 2, "#c28350"); R(x - 2, y - 3, 1, 3, "#b9794a"); R(x + 2, y - 3, 1, 3, "#b9794a");
    var ph = (T * 0.35) % 1; bx.globalAlpha = Math.sin(ph * 3.14); var zx = x - 8 + ph * 6, zy = y - 8 - ph * 12; L(zx, zy, zx + 2, zy, "#f3ead9"); L(zx + 2, zy, zx, zy + 2, "#f3ead9"); L(zx, zy + 2, zx + 2, zy + 2, "#f3ead9"); bx.globalAlpha = 1;
  }
  function lampFloor() { var x = 351, y = 190; E(x, y, 5, 2, "#3a3040"); R(x, y - 40, 1, 40, "#3a3040"); R(x - 6, y - 50, 13, 10, "#f3c98a"); R(x - 5, y - 49, 11, 3, "#fbe2b5"); R(x - 6, y - 41, 13, 1, "#d89f5a"); }
  function counterItems() {
    /* кавомашина: лампочка та пара */
    var busy = list.some(function (a) { return a.mode === "stand" && a.spot && a.spot.id === "coffee"; });
    R(350, 47, 3, 2, busy ? "#ff6a4d" : "#6bd07a"); if (busy) { for (var q = 0; q < 3; q++) { var ph = (T * 0.9 + q / 3) % 1; bx.globalAlpha = (1 - ph) * 0.7; P(351 + Math.sin(q * 3 + T * 2) * 2, 56 - ph * 12, "#fff"); bx.globalAlpha = 1; } R(351, 53, 1, 3, "#5a3a24"); }
  }

  /* ---------- освітлення та атмосфера ---------- */
  var MOTES = []; (function () { var r = rng(5); for (var i = 0; i < 16; i++) MOTES.push({ x: r() * W, y: 70 + r() * 140, vx: (r() - 0.5) * 3, vy: -0.8 - r() * 2, ph: r() * 6 }); })();
  function windowsDyn() {
    WIN.forEach(function (w) {
      w.stars.forEach(function (s) { var v = Math.sin(T * 1.4 + s[2]); if (v > -0.2) { bx.globalAlpha = 0.4 + 0.6 * v; P(s[0], s[1], "#fff5d6"); bx.globalAlpha = 1; } });
      w.win.forEach(function (c) { if ((T * 0.05 + c[2]) % 1 < 0.78) P(c[0], c[1], c[2] > 0.6 ? "#ffd98a" : "#f6b867"); });
    });
  }
  function stringLights() {
    for (var x = 0; x <= W; x += 6) {
      var y = 3 + Math.round(Math.sin(x / 38 * 3.14) * 2 + 2), lit = 0.55 + 0.45 * Math.sin(T * 1.7 + x * 0.35);
      P(x, y - 1, "#2a2036"); var cl = ["255,200,120", "255,170,150", "255,225,160"][(x / 6) % 3];
      bx.fillStyle = "rgba(" + cl + "," + (0.55 + 0.4 * lit) + ")"; bx.fillRect(x, y, 2, 3);
      bx.globalCompositeOperation = "lighter"; bx.fillStyle = "rgba(" + cl + "," + (0.05 + 0.08 * lit) + ")"; bx.fillRect(x - 2, y - 1, 6, 6); bx.globalCompositeOperation = "source-over";
    }
  }
  function clockHands() {
    var d = new Date(), ma = d.getMinutes() / 60 * 6.2832 - 1.5708, ha = (d.getHours() % 12 + d.getMinutes() / 60) / 12 * 6.2832 - 1.5708;
    L(171, 17, 171 + Math.cos(ma) * 6, 17 + Math.sin(ma) * 6, "#4a3a55"); L(171, 17, 171 + Math.cos(ha) * 4, 17 + Math.sin(ha) * 4, "#2a2036"); P(171, 17, "#c7694f");
  }
  var NEON = { S: ["01110", "10001", "10000", "01110", "00001", "10001", "01110"], E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"] };
  function neon() {
    var fl = Math.sin(T * 23) > 0.96 && Math.sin(T * 0.7) > 0.5 ? 0.45 : 1, bxp = 160, byp = 30;
    bx.globalCompositeOperation = "lighter"; E(171, 34, 17, 8, "rgba(255,110,170," + 0.05 * fl + ")"); E(171, 34, 11, 5, "rgba(255,110,170," + 0.06 * fl + ")"); bx.globalCompositeOperation = "source-over";
    "SE".split("").forEach(function (ch, ci) { NEON[ch].forEach(function (row, ry) { for (var rx = 0; rx < 5; rx++) if (row.charAt(rx) === "1") P(bxp + ci * 13 + rx * 2, byp + ry, "rgba(255,140,190," + fl + ")"), P(bxp + ci * 13 + rx * 2 + 1, byp + ry, "rgba(255,200,225," + fl + ")"); }); });
  }
  function lights() {
    bx.fillStyle = "rgba(60,32,100,.20)"; bx.fillRect(0, 0, W, H);
    DESKS.forEach(function (d, i) { var a = list[i], w = a && a.mode === "work" && a.sit > 0.5; glow(d.x - 17, d.y + 3, w ? 30 : 22, w ? 13 : 9, "255,190,110", w ? 0.07 : 0.05); });
    glow(351, 152, 16, 12, "255,190,110", 0.05); glow(351, 188, 26, 9, "255,190,110", 0.045);
    glow(188, 186, 22, 9, "255,170,90", 0.05 + 0.015 * Math.sin(T * 7));
    glow(171, 40, 40, 14, "255,120,170", 0.02);
    var s = list.filter(function (a) { return a.mode === "stand" && a.spot && a.spot.id === "coffee"; }).length; if (s) glow(350, 70, 14, 8, "255,170,100", 0.06);
    bx.globalCompositeOperation = "lighter";
    MOTES.forEach(function (m) { var v = 0.25 + 0.3 * Math.sin(T * 1.3 + m.ph); bx.fillStyle = "rgba(255,214,150," + v + ")"; bx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1); });
    bx.globalCompositeOperation = "source-over";
    R(0, 0, W, 3, "rgba(15,8,35,.25)"); R(0, H - 5, W, 5, "rgba(15,8,35,.25)"); R(0, 0, 3, H, "rgba(15,8,35,.2)"); R(W - 3, 0, 3, H, "rgba(15,8,35,.2)");
  }

  /* ---------- логіка ---------- */
  function busyOf(a) { return !!(opt.busy && opt.busy(a.t.n)); }
  function occupied(id) { return list.some(function (b) { return b.spot && b.spot.id === id && (b.mode === "stand" || (b.mode === "walk" && b.goal === "spot")); }); }
  function pickSpot(a) {
    var cand = SPOTS.filter(function (s) { return s !== a.spot && !occupied(s.id); }), tot = 0, w = cand.map(function (s) { var k = 1; if (s.pair && occupied(s.pair)) k = 4; tot += k; return k; }), r = Math.random() * tot, i = 0;
    for (; i < cand.length; i++) { r -= w[i]; if (r <= 0) break; }
    return cand[Math.min(i, cand.length - 1)];
  }
  function go(a, spot, fast) {
    var pts = [], sx = a.x, sy = a.y;
    if (a.inside) { pts.push({ x: a.inside.x, y: a.inside.y, s: 1 }); sx = a.inside.x; sy = a.inside.y; a.inside = null; }
    var nav = spot.nav ? { x: spot.nav.x, y: spot.nav.y } : (spot.nx ? { x: spot.nx, y: spot.ny } : { x: spot.x, y: spot.y });
    pts = pts.concat(findPath(sx, sy, nav.x, nav.y));
    if (spot.nav || spot.nx) pts.push({ x: spot.seat ? spot.seat.x : spot.x, y: spot.seat ? spot.seat.y : spot.y, s: 1, inn: nav });
    a.path = pts; a.mode = "walk"; a.fast = !!fast; a.goal = fast ? "desk" : "spot";
  }
  function arrive(a) {
    if (a.goal === "desk") { a.mode = "work"; a.tm = 1.6; a.face = "down"; a.sitTo = 1; return; }
    var s = a.spot; a.mode = "stand"; a.face = s.f; a.tm = rnd(s.t[0], s.t[1]); a.age = 0; a.sitTo = s.act === "sit" ? 1 : 0;
  }
  function startTask(a) { a.tasked = true; a.path = []; a.inside = a.inside; a.mode = "notice"; a.tm = 0.55; a.face = "down"; a.sitTo = 0; a.emote = ""; a.hold = 0; }
  function tick(dt) {
    T += dt; var t = now();
    MOTES.forEach(function (m) { m.x += m.vx * dt; m.y += m.vy * dt; if (m.y < 64) { m.y = 214; m.x = Math.random() * W; } if (m.x < 0) m.x = W; if (m.x > W) m.x = 0; });
    list.forEach(function (a) {
      var busy = busyOf(a);
      if (busy && !a.tasked) startTask(a);
      a.sit += (a.sitTo - a.sit) * Math.min(1, dt * 9); if (Math.abs(a.sitTo - a.sit) < 0.02) a.sit = a.sitTo;
      a.age += dt; a.blinkT -= dt; if (a.blinkT < -0.12) a.blinkT = rnd(2, 5);
      if (a.mode !== "work" && a.status && t > a.until) a.status = "";
      if (a.hold > 0) { a.hold -= dt; a.face = "down"; return; }
      switch (a.mode) {
        case "notice": a.tm -= dt; if (a.tm <= 0) { a.mode = "listen"; a.tm = 1.9; } break;
        case "listen": a.tm -= dt; if (a.tm <= 0) { a.mode = "ack"; a.tm = 0.8; } break;
        case "ack": a.tm -= dt; if (a.tm <= 0) { go(a, DESKS[a.i % DESKS.length], true); } break;
        case "work":
          a.wk = workKind(a); a.tm -= dt;
          if (!busy && a.tm <= 0) { a.mode = "cheer"; a.tm = 1.7; a.sitTo = 0; a.face = "down"; }
          break;
        case "cheer": a.tm -= dt; if (a.tm <= 0) { a.tasked = false; a.mode = "leave"; var d = DESKS[a.i % DESKS.length]; a.inside = { x: d.nav.x, y: d.nav.y }; a.path = [{ x: d.nav.x, y: d.nav.y, s: 1 }]; a.inside = null; a.leaving = true; a.face = "right"; } break;
        case "stand":
          a.tm -= dt; if (a.tm <= 0) { var s = pickSpot(a); a.spot = s; a.emote = ""; a.sitTo = 0; go(a, s, false); }
          break;
      }
      if ((a.mode === "walk" || a.mode === "leave") && a.path.length) {
        var p = a.path[0], sp = (a.fast ? 52 : 28) * (p.s ? 0.75 : 1), dx = p.x - a.x, dy = p.y - a.y, dist = Math.hypot(dx, dy), mv = sp * dt;
        if (dist <= mv) {
          a.x = p.x; a.y = p.y; a.path.shift();
          if (p.inn) { a.inside = p.inn; }
        } else {
          a.x += dx / dist * mv; a.y += dy / dist * mv; a.step += dt * sp * 0.4;
          if (Math.abs(dx) > Math.abs(dy) * 1.2) a.face = dx > 0 ? "right" : "left"; else a.face = dy > 0 ? "down" : "up";
        }
        if (!a.path.length) { if (a.mode === "leave") { a.mode = "stand"; a.tm = 0.5; a.spot = a.spot || SPOTS[0]; a.leaving = false; a.sitTo = 0; a.face = "down"; a.inside = null; var s2 = pickSpot(a); a.spot = s2; a.tm = 0.4; } else arrive(a); }
      }
      if (a.mode === "stand" && a.tm < 0.4 && a.spot && a.age > 0.3 && a.path.length === 0 && a.leaving === false) { }
    });
    list.forEach(function (a) { if (a.mode === "stand" && !a.emote && a.spot && a.age > 1.2 && a.spot.e) a.emote = a.spot.e; });
  }
  function workKind(a) { var s = a.status || ""; if (/Думаю|Беруся/.test(s)) return "think"; if (/🌐|Шукаю|Читаю|📋|📄|🔎/.test(s)) return "read"; return "type"; }

  /* ---------- малювання ---------- */
  function pose(a) {
    var o = { x: a.x, y: a.y, dir: a.face, skin: a.skin, hair: a.hair, top: a.t.c || "#888", pants: a.look.pants, look: a.look, acc: a.t.c || "#888", sit: a.sit, arms: "down", moving: false, sw: 0, by: 0, hy: 0, mood: "normal", blink: a.blinkT < 0 };
    var m = a.mode, moving = (m === "walk" || m === "leave") && a.path.length > 0 && a.hold <= 0;
    if (moving) { var ph = Math.sin(a.step); o.moving = true; o.sw = Math.round(ph * 2); o.by = Math.abs(ph) < 0.45 ? -1 : 0; }
    if (a.hold > 0) o.arms = "wave", o.mood = "happy";
    switch (m) {
      case "notice": var u = 1 - a.tm / 0.55; o.by = -Math.round(Math.abs(Math.sin(u * 3.14)) * 4); o.mood = "o"; break;
      case "listen": o.hy = Math.sin(T * 7) > 0.2 ? 1 : 0; o.mood = Math.sin(T * 2) > 0.8 ? "o" : "normal"; break;
      case "ack": o.arms = "up"; o.arms = "wave"; o.mood = "happy"; o.by = -(Math.sin(T * 12) > 0 ? 1 : 0); break;
      case "work": o.arms = "type"; o.glow = rgba(o.top, 0.13); if (a.wk === "think") { o.eyeDy = 0; o.look2 = Math.sin(T * 0.9) > 0 ? 1 : 0; o.hy = 0; } else if (a.wk === "read") { o.look2 = Math.sin(T * 3) > 0 ? 1 : -1; } else { o.eyeDy = 1; o.hy = Math.sin(T * 8) > 0.5 ? 1 : 0; } break;
      case "cheer": if (a.ok) { o.arms = "up"; o.mood = "happy"; o.by = -Math.round(Math.abs(Math.sin(T * 9)) * 4); } else { o.mood = "sad"; o.hy = 1; o.x += Math.sin(T * 22) > 0 ? 1 : 0; } break;
      case "stand":
        var s = a.spot;
        if (s.act === "coffee") { o.arms = (a.age % 4) > 1.6 ? "hold" : "down"; }
        else if (s.act === "stretch") { o.arms = (a.age % 2) < 1.1 ? "up" : "down"; o.by = (a.age % 2) < 1.1 ? -1 : 0; o.mood = "happy"; }
        else if (s.act === "book") { if (a.age > 1.6) { o.dir = "down"; o.arms = "book"; o.look2 = Math.sin(T * 1.7) > 0 ? 1 : -1; o.eyeDy = 1; } }
        else if (s.act === "sit") { o.arms = s.id === "chair" ? "book" : "down"; o.mood = s.id === "sofa" ? "happy" : "normal"; if (s.id === "chair") o.eyeDy = 1; }
        else if (s.act === "chat") { o.mood = Math.sin(T * 5 + a.i) > 0.4 ? "o" : "happy"; o.hy = Math.sin(T * 6 + a.i) > 0.6 ? 1 : 0; }
        else if (s.act === "look") { o.arms = "down"; }
        break;
    }
    return o;
  }
  function drawAgent(a) {
    var o = pose(a); person(o);
    var s = a.spot, x = Math.round(a.x), ys = Math.round(a.y) + Math.round(3 * a.sit) + (o.by || 0);
    if (a.mode === "stand" && s && s.act === "coffee" && o.arms === "hold") { R(x + 4, ys - 20, 4, 4, "#f4ead9"); R(x + 8, ys - 19, 1, 2, "#f4ead9"); R(x + 5, ys - 20, 2, 1, "#6b4426"); var ph = (T * 1.2) % 1; bx.globalAlpha = 1 - ph; P(x + 5 + Math.sin(T * 4), ys - 22 - ph * 6, "#fff"); bx.globalAlpha = 1; }
    if (a.mode === "cheer" && a.ok) { for (var q = 0; q < 5; q++) { var pp = (T * 1.5 + q / 5) % 1; bx.globalAlpha = 1 - pp; P(x - 12 + q * 6 + Math.sin(q * 5 + T * 3) * 2, ys - 26 - pp * 12, ["#ffd36b", "#ff8ab5", "#7ec8ff", "#9ff0b0", "#fff"][q]); bx.globalAlpha = 1; } }
  }
  function ring(a) {
    var sel = opt.selected ? opt.selected() : ""; if (a.t.n !== sel) return;
    var x = Math.round(a.x), y = Math.round(a.y) + 1, pul = 0.5 + 0.2 * Math.sin(T * 4);
    if (a.sit > 0.5) return; bx.globalCompositeOperation = "lighter"; E(x, y, 10, 4, rgba(a.t.c || "#888", pul * 0.55)); bx.globalCompositeOperation = "source-over"; E(x, y, 8, 3, "rgba(20,10,30,.35)");
  }
  function scene() {
    bx.setTransform(1, 0, 0, 1, 0, 0); bx.globalAlpha = 1; bx.globalCompositeOperation = "source-over";
    bx.drawImage(bgc, 0, 0);
    windowsDyn(); clockHands(); neon(); counterItems(); stringLights();
    var items = [{ d: 66, f: function () { } }, { d: 190, f: sofa.bind(null, 0) }, { d: 194, f: sofa.bind(null, 1) }, { d: 160, f: armchair.bind(null, 0) }, { d: 174, f: armchair.bind(null, 1) },
      { d: 196, f: table }, { d: 197, f: cat }, { d: 190, f: lampFloor }, { d: 146, f: function () { plant(17, 146, 1); } }, { d: 206, f: function () { plant(96, 206); } }, { d: 208, f: function () { plant(367, 208, 1); } }];
    list.forEach(function (a, i) {
      var d = DESKS[i % DESKS.length], di = i % DESKS.length, seated = (a.mode === "work" || a.mode === "cheer") && a.path.length === 0 && Math.abs(a.x - d.seat.x) < 1 && Math.abs(a.y - d.seat.y) < 1;
      items.push({ d: d.y - 2, f: function () { chairBack(d); } }); items.push({ d: d.y + 16, f: function () { desk(seated ? a : (a.mode === "work" ? a : null), di); } });
      var depth = a.y; if (seated || a.inside && a.inside.x === d.nav.x) depth = a.y; items.push({ d: depth + 0.1, f: function () { ring(a); drawAgent(a); } });
    });
    items.sort(function (p, q) { return p.d - q.d; }).forEach(function (it) { it.f(); });
    lights();
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function wrap(text, maxW) {
    var words = text.split(" "), lines = [""], i;
    for (i = 0; i < words.length; i++) { var t = lines[lines.length - 1] ? lines[lines.length - 1] + " " + words[i] : words[i]; if (ctx.measureText(t).width > maxW && lines[lines.length - 1]) { if (lines.length === 2) { lines[1] = lines[1].replace(/\s*\S*$/, "") + "…"; break; } lines.push(words[i]); } else lines[lines.length - 1] = t; }
    return lines.slice(0, 2);
  }
  function bubbleFor(a) {
    var m = a.mode;
    if (m === "notice") return { t: "❗", big: 1 };
    if (m === "listen") return { t: "Слухаю" + ".".repeat(1 + Math.floor(T * 2.5) % 3), ear: 1 };
    if (m === "ack") return { t: "Зрозуміло! 👍" };
    if (a.hold > 0) return { t: "👋", big: 1 };
    var st = a.status; if (st) { if (m === "work" && /…$/.test(st)) st = st.replace(/…$/, "") + ".".repeat(1 + Math.floor(T * 2.5) % 3); return { t: st, err: !a.ok }; }
    if (a.emote) return { t: a.emote, big: 1, soft: 1 };
    return null;
  }
  function labels() {
    ctx.setTransform(geo.k, 0, 0, geo.k, geo.ox, geo.oy); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var sel = opt.selected ? opt.selected() : "";
    list.forEach(function (a) {
      var d = DESKS[a.i % DESKS.length], seatedNow = a.sit > 0.5 && a.mode === "work" || a.mode === "cheer", ly = (a.mode === "work" || (a.mode === "cheer" && Math.abs(a.y - d.seat.y) < 2)) ? d.y + 22 : a.y + 8;
      if (a.sit > 0.5 && a.spot && a.mode === "stand") ly = a.y + 9;
      ctx.font = "600 5.6px system-ui, 'Segoe UI', sans-serif";
      var n = a.t.n, w = ctx.measureText(n).width + 11 + (a.mode === "work" ? 5 : 0), x = Math.min(W - w / 2 - 2, Math.max(w / 2 + 2, a.x)), on = a.t.n === sel;
      rr(x - w / 2, ly - 4.5, w, 9, 4.5); ctx.fillStyle = on ? a.t.c : "rgba(28,20,40,.78)"; ctx.fill(); if (!on) { ctx.strokeStyle = "rgba(255,235,200,.14)"; ctx.lineWidth = 0.4; ctx.stroke(); }
      ctx.fillStyle = on ? "#fff" : (a.t.c || "#bbb"); ctx.beginPath(); ctx.arc(x - w / 2 + 4.5, ly, 1.6, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "#fff6e6"; ctx.fillText(n, x + 2.4 - (a.mode === "work" ? 2.5 : 0), ly + 0.3);
      if (a.mode === "work") { ctx.fillStyle = "#4fd37e"; ctx.beginPath(); ctx.arc(x + w / 2 - 4, ly, 1.2, 0, 6.2832); ctx.fill(); }
      var b = bubbleFor(a); if (!b) return;
      /* tip — точка над головою, куди вказує хвостик бульбашки */
      var tip = a.y - 29 + (a.sit > 0.5 ? 3 : 0) - (a.mode === "notice" ? Math.abs(Math.sin((1 - a.tm / 0.55) * 3.14)) * 4 : 0) - (hs(a) ? 3 : 0) - (a.mode === "cheer" && a.ok ? Math.abs(Math.sin(T * 9)) * 4 : 0), pulse = b.soft ? 0.88 + 0.12 * Math.sin(T * 3 + a.i) : 1;
      if (b.big) {
        ctx.font = (b.soft ? "7px" : "9px") + " 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',system-ui,sans-serif"; var ew = 15, eh = 12.5, ey = tip - 3 - eh;
        ctx.globalAlpha = pulse; rr(x - ew / 2, ey, ew, eh, 5); ctx.fillStyle = "#fff7e8"; ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 2, ey + eh - 0.3); ctx.lineTo(x + 2, ey + eh - 0.3); ctx.lineTo(x, tip); ctx.fill();
        ctx.fillStyle = "#3a2c44"; ctx.fillText(b.t, x, ey + eh / 2 + 0.5); ctx.globalAlpha = 1; return;
      }
      ctx.font = "500 5.4px system-ui, 'Segoe UI', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif"; var lines = wrap(b.t, 78), tw = 0; lines.forEach(function (l) { tw = Math.max(tw, ctx.measureText(l).width); });
      var bw = tw + 10, bh = lines.length * 7 + 5, bxp = Math.min(W - bw / 2 - 2, Math.max(bw / 2 + 2, x)), by = tip - 3 - bh;
      rr(bxp - bw / 2 + 0.4, by + 0.9, bw, bh, 4); ctx.fillStyle = "rgba(20,8,35,.22)"; ctx.fill();
      rr(bxp - bw / 2, by, bw, bh, 4); ctx.fillStyle = "#fff7e8"; ctx.fill(); ctx.strokeStyle = b.err ? "rgba(192,57,43,.6)" : "rgba(80,50,90,.25)"; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 2.5, by + bh - 0.3); ctx.lineTo(x + 2.5, by + bh - 0.3); ctx.lineTo(x, tip); ctx.fillStyle = "#fff7e8"; ctx.fill();
      ctx.fillStyle = b.err ? "#b0302a" : "#3a2c44"; lines.forEach(function (l, li) { ctx.fillText(l, bxp, by + 5.5 + li * 7); });
    });
  }
  function hs(a) { return a.look.hs === "bun" || a.look.hs === "messy" || a.look.hs === "curly"; }
  function draw() {
    if (!ctx) return; var w = cv.width, h = cv.height, k = Math.min(w / W, h / H);
    geo = { k: k, ox: Math.round((w - W * k) / 2), oy: Math.round((h - H * k) / 2) };
    scene();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#1b1524"; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(buf, 0, 0, W, H, geo.ox, geo.oy, Math.round(W * k), Math.round(H * k));
    ctx.setTransform(k, 0, 0, k, geo.ox, geo.oy);
    var g = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, W * 0.62); g.addColorStop(0, "rgba(20,8,35,0)"); g.addColorStop(1, "rgba(20,8,35,.5)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    labels();
  }

  /* ---------- ініціалізація та події ---------- */
  function buildBG() {
    bgc = document.createElement("canvas"); bgc.width = W; bgc.height = H; var keep = bx; bx = bgc.getContext("2d"); wallBG(); floorBG(); bx = keep;
  }
  function init(canvas, agents, o) {
    cv = canvas; ctx = cv.getContext("2d"); opt = o || {}; list = [];
    buf = document.createElement("canvas"); buf.width = W; buf.height = H; bx = buf.getContext("2d");
    buildGrid(); buildBG();
    agents.forEach(function (t, i) {
      var s = SPOTS[(i * 3 + 1) % SPOTS.length], st = pickStart(i);
      var a = { t: t, i: i, look: LOOKS[i % LOOKS.length], skin: SKIN[i % SKIN.length], hair: t.hair || "#3a2a20", x: st.x, y: st.y, mode: "stand", path: [], face: "down", step: 0, spot: st.spot, tm: rnd(0.5, 4), age: 0, sit: 0, sitTo: 0, status: "", until: 0, emote: "", ok: true, tasked: false, hold: 0, blinkT: rnd(1, 4), inside: null, wk: "type", leaving: false };
      a.spot = st.spot; ags[t.n] = a; list.push(a);
    });
    cv.addEventListener("click", function (e) { var a = hit(e); if (a) { if (!a.tasked && a.mode !== "work") a.hold = 1.4; if (opt.select) opt.select(a.t.n); } });
    cv.addEventListener("dblclick", function (e) { var a = hit(e); if (a && opt.open) opt.open(a.t.n); });
    cv.addEventListener("mousemove", function (e) { cv.style.cursor = hit(e) ? "pointer" : "default"; });
    window.addEventListener("resize", fit);
    if (window.ResizeObserver) new ResizeObserver(fit).observe(cv);
  }
  function pickStart(i) {
    var free = SPOTS.filter(function (s) { return !s.nx && !s.nav; }), s = free[(i * 3) % free.length]; return { x: s.x, y: s.y, spot: s };
  }
  function fit() {
    if (!cv) return; var r = cv.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    draw();
  }
  function hit(e) {
    var r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr, x = (px - geo.ox) / geo.k, y = (py - geo.oy) / geo.k, best = null, bd = 1e9;
    list.forEach(function (a) { var cy = a.y - 12 + (a.sit > 0.5 ? 3 : 0), dx = Math.abs(x - a.x), dy = y - cy; if (dx < 9 && Math.abs(dy) < 16 && dx + Math.abs(dy) < bd) { bd = dx + Math.abs(dy); best = a; } });
    return best;
  }
  function loop(ts) {
    if (!running) return; var dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts; tick(dt); draw(); raf = requestAnimationFrame(loop);
  }
  /* маленький піксельний портрет для списку ліворуч */
  function portrait(t, idx) {
    var key = t.n + "|" + t.c + "|" + idx; if (portraits[key]) return portraits[key];
    var c = document.createElement("canvas"); c.width = c.height = 22; var keep = bx; bx = c.getContext("2d");
    R(0, 0, 22, 22, sh(t.c || "#888", -32)); R(0, 14, 22, 8, sh(t.c || "#888", -42));
    person({ x: 11, y: 30, dir: "down", skin: SKIN[idx % SKIN.length], hair: t.hair || "#3a2a20", top: t.c || "#888", pants: "#333", look: LOOKS[idx % LOOKS.length], acc: t.c || "#888", sit: 0, mood: "happy" });
    bx = keep; return (portraits[key] = c.toDataURL());
  }
  return {
    init: init, portrait: portrait,
    start: function () { if (running) return; running = true; last = performance.now(); fit(); raf = requestAnimationFrame(loop); },
    stop: function () { running = false; cancelAnimationFrame(raf); },
    status: function (n, text) { var a = ags[n]; if (a) { a.status = text; a.ok = true; a.until = now() + 1e9; } },
    done: function (n, ok, text) { var a = ags[n]; if (a) { a.status = ok ? (text || "✅ Готово!") : "❌ Помилка"; a.ok = ok; a.until = now() + 7000; } },
    tick: tick, draw: draw, _ags: ags
  };
})();
