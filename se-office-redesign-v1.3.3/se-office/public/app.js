/* SE Офіс: інтерфейс, підключення сервісів, чати, інструменти Notion та інтернет */
var CFG = window.CONFIG, agents = [CFG.lead].concat(CFG.team);
function $(id) { return document.getElementById(id); }
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
var STATUS = {}, cur = null, busy = {}, states = {}, saved = {};
try { saved = JSON.parse(lsGet("se_chats_v2", "{}")) || {}; } catch (e) { saved = {}; }
var webOn = lsGet("se_web", "1") !== "0", view = lsGet("se_view", "office") === "chat" ? "chat" : "office";
var log = $("log"), col = $("col"), inp = $("inp"), chatBox = { open: true };
function on(p) { return !!(STATUS[p] && STATUS[p].connected); }

async function post(url, data) {
  var r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || j.message || ("HTTP " + r.status));
  return j;
}
function notion(method, path, body) { return post("/api/notion", { method: method, path: path, body: body }); }

function nid(s) {
  var m = String(s || "").match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i);
  if (!m) throw new Error("Не знайдено id Notion у: " + s);
  return m[0].replace(/-/g, "");
}
function plain(arr) { return (arr || []).map(function (t) { return t.plain_text; }).join(""); }
function pageTitle(p) {
  for (var k in p.properties || {}) if (p.properties[k].type === "title") return plain(p.properties[k].title);
  return "";
}
function simpleVal(p) {
  switch (p.type) {
    case "title": return plain(p.title);
    case "rich_text": return plain(p.rich_text);
    case "select": case "status": return p[p.type] ? p[p.type].name : null;
    case "multi_select": return p.multi_select.map(function (o) { return o.name; });
    case "number": case "checkbox": case "url": case "email": case "phone_number": return p[p.type];
    case "date": return p.date ? (p.date.end ? p.date.start + " → " + p.date.end : p.date.start) : null;
    case "people": return p.people.map(function (u) { return u.name || u.id; });
    case "relation": return p.relation.map(function (r) { return r.id; });
    case "formula": var f = p.formula; return f[f.type];
    case "created_time": case "last_edited_time": return p[p.type];
    default: return undefined;
  }
}
function simplePage(p) {
  var o = { id: p.id, url: p.url };
  for (var k in p.properties) { var v = simpleVal(p.properties[k]); if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) o[k] = v; }
  return o;
}
function cut(o) { var s = typeof o === "string" ? o : JSON.stringify(o); return s.length > 14000 ? s.slice(0, 14000) + " …(скорочено)" : s; }

var schemaCache = {};
async function schema(dbId) {
  if (!schemaCache[dbId]) schemaCache[dbId] = await notion("GET", "/v1/databases/" + dbId);
  return schemaCache[dbId];
}
// Проста форма {назва: значення} → формат Notion API за схемою таблиці
function toNotion(db, props) {
  var out = {};
  for (var k in props) {
    var def = db.properties[k];
    if (!def) throw new Error("У таблиці немає властивості «" + k + "». Є: " + Object.keys(db.properties).join(", "));
    var v = props[k], t = def.type;
    if (t === "title" || t === "rich_text") out[k] = { [t]: [{ text: { content: String(v) } }] };
    else if (t === "number") out[k] = { number: v === null ? null : Number(v) };
    else if (t === "select" || t === "status") out[k] = { [t]: v === null ? null : { name: String(v) } };
    else if (t === "multi_select") out[k] = { multi_select: (Array.isArray(v) ? v : String(v).split(",")).map(function (x) { return { name: String(x).trim() }; }) };
    else if (t === "checkbox") out[k] = { checkbox: v === true || v === "true" };
    else if (t === "url" || t === "email" || t === "phone_number") out[k] = { [t]: v === null ? null : String(v) };
    else if (t === "date") { var pr = v === null ? null : String(v).split(/\s*(?:→|\/)\s*/); out[k] = { date: pr ? { start: pr[0], end: pr[1] || null } : null }; }
    else throw new Error("Властивість «" + k + "» має тип " + t + ", його поки не можна змінювати з чату");
  }
  return out;
}

function ask(title, obj) {
  return new Promise(function (res) {
    var d = document.getElementById("cfm"), y = document.getElementById("cfy"), n = document.getElementById("cfn");
    document.getElementById("cft").textContent = title;
    document.getElementById("cfp").textContent = JSON.stringify(obj, null, 2);
    function done(v) { y.onclick = n.onclick = d.oncancel = null; d.close(); res(v); }
    y.onclick = function () { done(true); }; n.onclick = function () { done(false); };
    d.oncancel = function () { done(false); };
    d.showModal();
  });
}

var TOOLS = [
  { name: "notion_search", description: "Шукає сторінки та таблиці в Notion за ключовими словами. Повертає id, тип, назву, url.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async function (a) {
      var r = await notion("POST", "/v1/search", { query: String(a.query || ""), page_size: 15 });
      return r.results.map(function (x) { return { id: x.id, type: x.object, title: x.object === "database" ? plain(x.title) : pageTitle(x), url: x.url }; });
    } },
  { name: "notion_read_database", description: "Читає таблицю Notion: структуру властивостей (з допустимими значеннями select/status) і рядки (до 50 за раз). Необов'язково: filter у форматі Notion API та start_cursor для наступної порції.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "id або URL таблиці" }, filter: { type: "object" }, start_cursor: { type: "string" } }, required: ["id"] },
    run: async function (a) {
      var id = nid(a.id), db = await schema(id);
      var q = { page_size: 50 }; if (a.filter) q.filter = a.filter; if (a.start_cursor) q.start_cursor = a.start_cursor;
      var r = await notion("POST", "/v1/databases/" + id + "/query", q);
      var cols = {};
      for (var k in db.properties) { var p = db.properties[k]; cols[k] = p.type + ((p[p.type] && p[p.type].options) ? ": " + p[p.type].options.map(function (o) { return o.name; }).join(" | ") : ""); }
      return { title: plain(db.title), columns: cols, rows: r.results.map(simplePage), has_more: r.has_more, next_cursor: r.next_cursor };
    } },
  { name: "notion_read_page", description: "Читає сторінку Notion: властивості та текст блоків.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "id або URL сторінки" } }, required: ["id"] },
    run: async function (a) {
      var id = nid(a.id);
      var res = await Promise.all([notion("GET", "/v1/pages/" + id), notion("GET", "/v1/blocks/" + id + "/children?page_size=100")]);
      var text = res[1].results.map(function (b) { var c = b[b.type]; return c && c.rich_text ? plain(c.rich_text) : (b.type === "child_database" ? "[таблиця: " + b.child_database.title + " | id " + b.id + "]" : (b.type === "child_page" ? "[сторінка: " + b.child_page.title + " | id " + b.id + "]" : "")); }).filter(Boolean);
      return { properties: simplePage(res[0]), text: text };
    } },
  { name: "notion_update_page", description: "Оновлює властивості рядка таблиці. properties — прості значення: {\"Статус\":\"Готово\",\"Сума\":120,\"Дата\":\"2026-11-07\",\"Теги\":[\"a\",\"b\"]}. Спершу прочитай таблицю, щоб знати назви та допустимі значення. Користувач підтверджує кожну зміну.",
    input_schema: { type: "object", properties: { page_id: { type: "string" }, properties: { type: "object" } }, required: ["page_id", "properties"] },
    run: async function (a) {
      var id = nid(a.page_id), pg = await notion("GET", "/v1/pages/" + id);
      if (!pg.parent || !pg.parent.database_id) throw new Error("Це не рядок таблиці — змінювати властивості можна лише в таблицях");
      var db = await schema(pg.parent.database_id), props = toNotion(db, a.properties || {});
      if (!(await ask("Оновити рядок «" + pageTitle(pg) + "»", a.properties))) return "Користувач скасував зміну.";
      var r = await notion("PATCH", "/v1/pages/" + id, { properties: props });
      return { ok: true, row: simplePage(r) };
    } },
  { name: "notion_create_row", description: "Додає новий рядок у таблицю Notion. database_id — id або URL таблиці. properties — прості значення (як в notion_update_page). Користувач підтверджує.",
    input_schema: { type: "object", properties: { database_id: { type: "string" }, properties: { type: "object" } }, required: ["database_id", "properties"] },
    run: async function (a) {
      var id = nid(a.database_id), db = await schema(id), props = toNotion(db, a.properties || {});
      if (!(await ask("Додати рядок у «" + plain(db.title) + "»", a.properties))) return "Користувач скасував створення.";
      var r = await notion("POST", "/v1/pages", { parent: { database_id: id }, properties: props });
      return { ok: true, row: simplePage(r) };
    } }
];

/* ---- Markdown (безпечний: усе екранується) ---- */
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function inl(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
  return s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>').replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}
function block(p) {
  var lines = p.split("\n"), h = "", para = [], list = null, i = 0;
  function fp() { if (para.length) { h += "<p>" + para.map(inl).join("<br>") + "</p>"; para = []; } }
  function fl() { if (list) { h += "<" + list.t + ">" + list.i.map(function (x) { return "<li>" + inl(x) + "</li>"; }).join("") + "</" + list.t + ">"; list = null; } }
  for (; i < lines.length; i++) {
    var l = lines[i], m;
    if (/^\s*\|.*\|\s*$/.test(l) && lines[i + 1] && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      fp(); fl(); var cells = function (x) { return x.trim().replace(/^\||\|$/g, "").split("|"); };
      var t = "<div class=\"tbl\"><table><tr>" + cells(l).map(function (c) { return "<th>" + inl(c.trim()) + "</th>"; }).join("") + "</tr>"; i += 2;
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) t += "<tr>" + cells(lines[i]).map(function (c) { return "<td>" + inl(c.trim()) + "</td>"; }).join("") + "</tr>";
      i--; h += t + "</table></div>"; continue;
    }
    if ((m = l.match(/^(#{1,3})\s+(.*)/))) { fp(); fl(); h += "<h" + m[1].length + ">" + inl(m[2]) + "</h" + m[1].length + ">"; }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { fp(); if (!list || list.t !== "ul") { fl(); list = { t: "ul", i: [] }; } list.i.push(m[1]); }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { fp(); if (!list || list.t !== "ol") { fl(); list = { t: "ol", i: [] }; } list.i.push(m[1]); }
    else if (!l.trim()) { fp(); fl(); }
    else { fl(); para.push(l); }
  }
  fp(); fl(); return h;
}
function md(t) {
  var parts = String(t).split("```"), out = "";
  for (var i = 0; i < parts.length; i++) {
    if (i % 2 && i < parts.length - 1) {
      var nl = parts[i].indexOf("\n"), code = nl >= 0 ? parts[i].slice(nl + 1) : parts[i];
      out += '<div class="code"><button class="cp">Копіювати</button><pre><code>' + esc(code.replace(/\n$/, "")) + "</code></pre></div>";
    } else out += block(i % 2 ? "```" + parts[i] : parts[i]);
  }
  return out;
}
col.addEventListener("click", function (e) {
  if (e.target.classList.contains("cp")) { var c = e.target.parentNode.querySelector("code").textContent; try { navigator.clipboard.writeText(c); e.target.textContent = "Скопійовано ✓"; setTimeout(function () { e.target.textContent = "Копіювати"; }, 1500); } catch (x) {} }
});

/* ---- Чати ---- */
function stateOf(t) {
  if (!states[t.n]) {
    var sv = saved[t.n] || {}, turns = sv.turns || [];
    states[t.n] = { turns: turns, hist: turns.map(function (x) { return { role: x.role, content: x.content }; }), msgs: (sv.msgs || []).map(function (x) { return { cls: x.cls, text: x.text }; }) };
  }
  return states[t.n];
}
function persist() {
  var o = {};
  for (var k in states) { var s = states[k]; o[k] = { turns: s.turns.slice(-30), msgs: s.msgs.filter(function (m) { return !m.temp; }).slice(-100).map(function (m) { return { cls: m.cls, text: m.text }; }) }; }
  lsSet("se_chats_v2", JSON.stringify(o));
}
function avatar(t, big) { return '<div class="av" style="background:' + t.c + '">' + esc(t.n.charAt(0)) + (t === CFG.lead ? '<span class="crown">👑</span>' : "") + "</div>"; }
function paint(d, m) { if (m.cls === "a") d.innerHTML = m.typing ? '<span class="typing"><i></i><i></i><i></i></span>' : md(m.text); else d.textContent = m.text; }
function elFor(m) { var d = document.createElement("div"); d.className = "msg " + m.cls; paint(d, m); return d; }
function scrollDown() { log.scrollTop = log.scrollHeight; }
function addMsg(st, cls, text, o) {
  var m = { cls: cls, text: text, typing: !!(o && o.typing), temp: !!(o && o.temp) }; st.msgs.push(m);
  if (cur && cur.st === st) { clearEmpty(); m.el = elFor(m); col.appendChild(m.el); scrollDown(); }
  return m;
}
function setMsg(m, text) { m.typing = false; m.text = text; if (m.el) { paint(m.el, m); scrollDown(); } }
function dropMsg(st, m) { var i = st.msgs.indexOf(m); if (i >= 0) st.msgs.splice(i, 1); if (m.el) m.el.remove(); }
function clearEmpty() { var e = col.querySelector(".empty"); if (e) e.remove(); }
function chatHeader() {
  var t = cur.t, c = STATUS[t.provider] || {};
  var compact = window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
  $("ch").textContent = (t === CFG.lead ? "👑 " : "") + t.n + (compact ? "" : " — " + t.r);
  $("cst").textContent = compact
    ? (on(t.provider) ? "Підключено" : "Не підключено") + (on("notion") ? " · Notion ✓" : "")
    : (on(t.provider)
      ? "Підключено" + (c.model ? " · " + c.model : "") + (on("notion") ? " · Notion ✓" : " · Notion не підключено") + (webOn ? " · інтернет ✓" : "")
      : t.n + " ще не підключено — відкрийте «Підключення» ліворуч внизу");
  var s = $("site"); s.style.display = t.url ? "" : "none"; if (t.url) s.href = t.url;
  var nu = lsGet("se_notion_url", CFG.NOTION_URL || ""), nl = $("nl"); nl.style.display = nu ? "" : "none"; if (nu) nl.href = nu;
  var chips = $("chips"); chips.innerHTML = "";
  var qs = t === CFG.lead ? ["Які таблиці є в моєму Notion?", "Підсумуй, що останнім часом змінилось у таблицях", "Знайди в інтернеті новини за сьогодні"] : (t.e ? [t.e.replace(/[«»]/g, "")] : []);
  qs.forEach(function (q) { var b = document.createElement("button"); b.className = "chip"; b.textContent = q; b.onclick = function () { send(q); }; chips.appendChild(b); });
  $("snd").disabled = !!busy[t.n];
}
window.addEventListener("resize", function () { if (cur) chatHeader(); }, { passive: true });
function renderAgents() {
  var box = $("agents"); box.innerHTML = "";
  agents.forEach(function (t) {
    var b = document.createElement("button"); b.className = "ag" + (cur && cur.t === t ? " on" : "");
    b.innerHTML = avatar(t) + '<div class="txt"><b></b><span class="r"></span></div><i class="dot ' + (busy[t.n] ? "work" : on(t.provider) ? "ok" : "") + '"></i>';
    b.querySelector("b").textContent = t.n; b.querySelector(".r").textContent = t.r;
    b.onclick = function () { openChat(t); $("side").classList.remove("open"); };
    box.appendChild(b);
  });
}
function openChat(t) {
  cur = { t: t, st: stateOf(t) }; col.innerHTML = "";
  if (!cur.st.msgs.length) col.innerHTML = '<div class="empty">' + avatar(t) + "<h2></h2><div></div></div>", col.querySelector("h2").textContent = t.n, col.querySelector(".empty div:last-child").textContent = t.d || t.r;
  cur.st.msgs.forEach(function (m) { m.el = elFor(m); col.appendChild(m.el); });
  chatHeader(); renderAgents(); scrollDown(); if (view === "chat") inp.focus(); refreshResult();
}

var TOOLS_WEB = [
  { name: "web_search", description: "Шукає в інтернеті. Повертає заголовки, посилання й короткі описи.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    label: function (a) { return "🌐 Шукаю в інтернеті: " + a.query; },
    run: async function (a) { var r = await post("/api/web", { op: "search", q: String(a.query || "") }); if (r.error) throw new Error(r.error); return r.results; } },
  { name: "fetch_url", description: "Відкриває сторінку за посиланням і повертає її текст.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    label: function (a) { return "🌐 Читаю: " + a.url; },
    run: async function (a) { var r = await post("/api/web", { op: "fetch", url: String(a.url || "") }); if (r.error) throw new Error(r.error); return r; } }
];
TOOLS = TOOLS.concat(TOOLS_WEB);
var LABEL = { notion_search: "🔎 Шукаю в Notion", notion_read_database: "📋 Читаю таблицю", notion_read_page: "📄 Читаю сторінку", notion_update_page: "✏️ Готую зміну рядка", notion_create_row: "➕ Готую новий рядок" };
function activeTools() {
  return TOOLS.filter(function (x) { return x.name.indexOf("notion_") === 0 ? on("notion") : webOn; }).map(function (t) { return { name: t.name, description: t.description, input_schema: t.input_schema }; });
}
/* ---- Сповіщення ---- */
var notifyOn = lsGet("se_notify", "1") !== "0";
function toast(text) {
  var t = document.getElementById("toast"); if (!t) return;
  t.textContent = text; t.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(function () { t.classList.remove("show"); }, 6000);
}
function beep() {
  try { var C = window.AudioContext || window.webkitAudioContext, a = new C(), o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = 0.06; o.start(); o.stop(a.currentTime + 0.18); } catch (e) {}
}
function askNotifyPermission() { try { if (window.Notification && Notification.permission === "default") Notification.requestPermission(); } catch (e) {} }
function notifyDone(who, text, secs) {
  if (!notifyOn) return;
  var short = String(text || "Готово").replace(/\s+/g, " ").slice(0, 160);
  toast("✅ " + who + ": " + short); beep();
  try { if (window.Notification && Notification.permission === "granted" && document.hidden) new Notification("SE Офіс — " + who + " завершив(ла) роботу", { body: short }); } catch (e) {}
  if (on("telegram") && (document.hidden || secs > 15)) post("/api/notify", { text: "✅ " + who + " завершив(ла) роботу\n" + short }).catch(function () {});
}
function notifyFail(who, msg) { if (!notifyOn) return; toast("❌ " + who + ": " + msg); if (on("telegram") && document.hidden) post("/api/notify", { text: "❌ " + who + ": помилка\n" + msg }).catch(function () {}); }


async function send(text) {
  var t = cur && cur.t, st = cur && cur.st; text = String(text || "").trim();
  if (!t || !text || busy[t.n]) return;
  if (!on(t.provider)) { addMsg(st, "s", t.n + " не підключено."); openSettings(); return; }
  busy[t.n] = true; Office.status(t.n, "Беруся до роботи…"); chatHeader(); renderAgents(); addMsg(st, "u", text); inp.value = ""; grow(); askNotifyPermission();
  var snap = st.hist.length, out = null, t0 = Date.now(), lastText = "", failed = false;
  st.hist.push({ role: "user", content: text });
  try {
    for (var i = 0; i < 12; i++) {
      Office.status(t.n, "Думаю…"); out = addMsg(st, "a", "", { typing: true, temp: true });
      var r = await post("/api/chat", { provider: t.provider, system: CFG.SYSTEM(t, t === CFG.lead), messages: st.hist, tools: activeTools() });
      st.hist.push({ role: "assistant", content: r.content });
      var txt = r.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n");
      if (txt) { setMsg(out, txt); out.temp = false; lastText = txt; refreshResult(); } else { dropMsg(st, out); out = null; }
      var uses = r.content.filter(function (b) { return b.type === "tool_use"; });
      if (r.stop_reason !== "tool_use" || !uses.length) break;
      var results = [];
      for (var j = 0; j < uses.length; j++) {
        var u = uses[j], tool = TOOLS.filter(function (x) { return x.name === u.name; })[0], a = u.input || {};
        var lbl = tool && tool.label ? tool.label(a) : (LABEL[u.name] || "🔧 " + u.name); addMsg(st, "s", lbl); Office.status(t.n, lbl);
        try { if (!tool) throw new Error("Невідомий інструмент"); results.push({ type: "tool_result", tool_use_id: u.id, content: cut(await tool.run(a)) }); }
        catch (e) { results.push({ type: "tool_result", tool_use_id: u.id, content: "Помилка: " + (e.message || e), is_error: true }); }
      }
      st.hist.push({ role: "user", content: results });
    }
    st.turns.push({ role: "user", content: text }, { role: "assistant", content: lastText || "(виконано)" });
  } catch (e) {
    st.hist.length = snap; if (out && out.typing) dropMsg(st, out);
    addMsg(st, "s", "Помилка: " + (e.message || e)); failed = true; notifyFail(t.n, e.message || e);
  }
  busy[t.n] = false; Office.done(t.n, !failed); persist(); if (cur) { chatHeader(); refreshResult(); } renderAgents();
  if (!failed) notifyDone(t.n, lastText, (Date.now() - t0) / 1000);
}
function grow() { inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 180) + "px"; }
inp.addEventListener("input", grow);
inp.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(inp.value); } });
$("snd").addEventListener("click", function () { send(inp.value); });
$("clr").addEventListener("click", function () { if (!cur || !confirm("Очистити чат з " + cur.t.n + "?")) return; cur.st.msgs = []; cur.st.turns = []; cur.st.hist = []; persist(); openChat(cur.t); });
$("menu").addEventListener("click", function () { $("side").classList.toggle("open"); });

/* ---- Підключення ---- */
var PV = [
 { id: "anthropic", g: "ШІ-співробітники", n: "Claude (Anthropic)", link: "https://console.anthropic.com/settings/keys", ph: "sk-ant-…", model: true },
 { id: "openai", n: "ChatGPT (OpenAI)", link: "https://platform.openai.com/api-keys", ph: "sk-…", model: true },
 { id: "deepseek", n: "DeepSeek", link: "https://platform.deepseek.com/api_keys", ph: "sk-…", model: true },
 { id: "kimi", n: "Kimi (Moonshot)", link: "https://platform.moonshot.ai/console/api-keys", ph: "sk-…", model: true },
 { id: "gemini", n: "Gemini (Google) — безкоштовно", link: "https://aistudio.google.com/apikey", ph: "AIza…", model: true },
 { id: "groq", n: "Llama (Groq) — безкоштовно", link: "https://console.groq.com/keys", ph: "gsk_…", model: true },
 { id: "openrouter", n: "OpenRouter — вхід одним кліком, багато моделей", link: "https://openrouter.ai/keys", ph: "sk-or-… (або натисніть «Увійти»)", model: true, oauth: true },
 { id: "notion", g: "Notion", n: "Notion (токен інтеграції)", link: "https://www.notion.so/profile/integrations", ph: "ntn_… або secret_…", model: false,
   help: "Створіть інтеграцію → скопіюйте токен сюди → на своїй сторінці Notion натисніть ··· → Connections → додайте цю інтеграцію." },
 { id: "telegram", g: "Сповіщення на телефон", n: "Telegram (необов'язково)", link: "https://t.me/BotFather", ph: "токен бота від @BotFather", model: false, chat: true,
   help: "У @BotFather створіть бота (/newbot), Chat ID дізнайтесь у @userinfobot, потім напишіть своєму боту /start." }
];
var setDlg = $("set");
function refresh() {
  return fetch("/api/status").then(function (r) { return r.json(); }).then(function (s) { STATUS = s; if (cur) chatHeader(); renderAgents(); return s; }).catch(function () { STATUS = {}; });
}
function renderSettings() {
  var box = $("prov"); box.innerHTML = ""; var lastG = "";
  PV.forEach(function (p) {
    if (p.g && p.g !== lastG) { lastG = p.g; var h = document.createElement("h4"); h.textContent = p.g; box.appendChild(h); }
    var s = STATUS[p.id] || {}, d = document.createElement("div"); d.className = "pv";
    d.innerHTML = '<h3><i class="dot' + (s.connected ? " ok" : "") + '"></i><span class="tt"></span><a target="_blank" rel="noopener">Де взяти ключ</a></h3>' + (p.help ? '<div class="hlp" style="font-size:12px;color:var(--mut);margin-bottom:4px"></div>' : "") +
      '<input type="password" class="k" autocomplete="off"><input class="mo" placeholder="модель"><input class="ci" placeholder="Chat ID (число)"><div class="btns"><button class="btn pri sv">Зберегти</button><button class="btn ts">Перевірити</button>' + (p.oauth ? '<button class="btn lg">🔐 Увійти через OpenRouter</button>' : "") + '<button class="btn dc">Відключити</button></div><div class="msg2"></div>';
    d.querySelector(".tt").textContent = p.n + (s.connected ? " — підключено" : "");
    if (p.help) d.querySelector(".hlp").textContent = p.help;
    d.querySelector("a").href = p.link;
    var k = d.querySelector(".k"); k.placeholder = s.connected ? "•••••••• (збережено; введіть новий, щоб замінити)" : p.ph;
    var mo = d.querySelector(".mo"); if (p.model) mo.value = s.model || ""; else mo.style.display = "none";
    var ci = d.querySelector(".ci"); if (p.chat) ci.value = s.chat || ""; else ci.style.display = "none";
    var msg = d.querySelector(".msg2");
    function saveNow() { return post("/api/settings", { provider: p.id, key: k.value, model: mo.value, chat: ci.value }); }
    d.querySelector(".sv").onclick = async function () { try { await saveNow(); await refresh(); renderSettings(); } catch (e) { msg.textContent = "❌ " + e.message; } };
    d.querySelector(".ts").onclick = async function () {
      msg.textContent = "Перевіряю…";
      try { if (k.value.trim() || p.model || p.chat) await saveNow(); k.value = ""; await refresh();
        var r = await post("/api/test", { provider: p.id }); msg.textContent = r.ok ? "✅ Працює" : "❌ " + r.error; if (r.ok) d.querySelector(".dot").className = "dot ok";
      } catch (e) { msg.textContent = "❌ " + e.message; }
    };
    d.querySelector(".dc").onclick = async function () { await post("/api/settings", { provider: p.id, clear: true }); await refresh(); renderSettings(); };
    var lg = d.querySelector(".lg");
    if (lg) lg.onclick = async function () {
      try { var r = await (await fetch("/api/openrouter/start")).json(); window.open(r.url, "_blank"); msg.textContent = "Завершіть вхід у новій вкладці…";
        var was = on("openrouter"), n = 0, h = setInterval(async function () { n++; await refresh(); if ((on("openrouter") && !was) || n > 90) { clearInterval(h); renderSettings(); if (on("openrouter")) toast("✅ OpenRouter підключено"); } }, 2000);
      } catch (e) { msg.textContent = "❌ " + e.message; }
    };
    box.appendChild(d);
  });
}
function openSettings() {
  refresh().then(function (s) {
    var any = Object.keys(s || {}).some(function (k) { return s[k].connected && k !== "notion" && k !== "telegram"; });
    $("wel").style.display = any ? "none" : ""; renderSettings(); $("nurl").value = lsGet("se_notion_url", CFG.NOTION_URL || ""); if (!setDlg.open) setDlg.showModal();
  });
}
$("gb").addEventListener("click", function () { $("side").classList.remove("open"); openSettings(); });
$("sx").addEventListener("click", function () { lsSet("se_notion_url", $("nurl").value.trim()); setDlg.close(); if (cur) chatHeader(); });
var wb = $("web"); wb.checked = webOn; wb.addEventListener("change", function () { webOn = wb.checked; lsSet("se_web", webOn ? "1" : "0"); if (cur) chatHeader(); });
var nt = $("ntf"); nt.checked = notifyOn; nt.addEventListener("change", function () { notifyOn = nt.checked; lsSet("se_notify", notifyOn ? "1" : "0"); if (notifyOn) { askNotifyPermission(); beep(); toast("🔔 Сповіщення увімкнено"); } });


/* ---- Віртуальний офіс ---- */
function agentByName(n) { return agents.filter(function (t) { return t.n === n; })[0]; }
function refreshResult() {
  var box = $("ofres"); if (!box || view !== "office" || !cur) return;
  var m = cur.st.msgs.filter(function (x) { return !x.typing && (x.cls === "a" || (x.cls === "s" && /^Помилка/.test(x.text))); }).pop();
  box.innerHTML = '<div class="who"><span></span><a id="ofopen">Відкрити чат ↗</a></div><div class="body"></div>';
  box.querySelector(".who span").textContent = cur.t.n + " — " + cur.t.r + (busy[cur.t.n] ? " · працює…" : "");
  box.querySelector(".body").innerHTML = m ? (m.cls === "a" ? md(m.text) : esc(m.text)) : '<span class="hint">Оберіть працівника кліком, напишіть завдання внизу — він сяде за ноутбук і візьметься до роботи. Двічі клікніть по працівнику, щоб відкрити чат.</span>';
  $("ofopen").onclick = function () { setView("chat"); };
  box.scrollTop = box.scrollHeight;
}
function setView(v) {
  view = v; lsSet("se_view", v);
  log.style.display = v === "chat" ? "" : "none"; $("chips").style.display = v === "chat" ? "" : "none";
  $("office").style.display = v === "office" ? "flex" : "none";
  $("vchat").classList.toggle("on", v === "chat"); $("voff").classList.toggle("on", v === "office");
  if (v === "office") { Office.start(); refreshResult(); } else { Office.stop(); scrollDown(); }
}
Office.init($("ofc"), agents, {
  busy: function (n) { return !!busy[n]; },
  selected: function () { return cur ? cur.t.n : ""; },
  select: function (n) { var t = agentByName(n); if (t) openChat(t); },
  open: function (n) { var t = agentByName(n); if (t) { openChat(t); setView("chat"); } }
});
$("vchat").addEventListener("click", function () { setView("chat"); });
$("voff").addEventListener("click", function () { setView("office"); });

/* ---- Старт ---- */
openChat(agents[0]); setView(view);
refresh().then(function (s) { if (cur) chatHeader(); var any = Object.keys(s || {}).some(function (k) { return s[k].connected && k !== "notion" && k !== "telegram"; }); if (!any) openSettings(); });
