// SE Офіс — локальний сервер без залежностей (Node.js 18+).
// Ключі зберігаються у файлі data/settings.json на вашому комп'ютері і ніколи не потрапляють у браузер.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), dns = require('dns').promises, net = require('net'), { exec } = require('child_process');
const { toOpenAI, fromOpenAI } = require('./convert');

try { // необов'язковий .env (запасний варіант)
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const SET_FILE = path.join(DATA, 'settings.json');
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const PROVIDERS = {
  anthropic: { label: 'Claude', type: 'anthropic', model: 'claude-sonnet-5-5', env: 'ANTHROPIC_API_KEY' },
  openai: { label: 'ChatGPT', type: 'openai', model: 'gpt-4.1', base: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
  kimi: { label: 'Kimi', type: 'openai', model: 'kimi-k2-0905-preview', base: 'https://api.moonshot.ai/v1', env: 'KIMI_API_KEY' },
  gemini: { label: 'Gemini', type: 'openai', model: 'gemini-2.5-flash', base: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY' },
  groq: { label: 'Llama (Groq)', type: 'openai', model: 'llama-3.3-70b-versatile', base: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY' },
  openrouter: { label: 'OpenRouter', type: 'openai', model: 'meta-llama/llama-3.3-70b-instruct:free', base: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY' },
  deepseek: { label: 'DeepSeek', type: 'openai', model: 'deepseek-flash', base: 'https://api.deepseek.com', env: 'DEEPSEEK_API_KEY', extra: { thinking: { type: 'disabled' } } },
  notion: { label: 'Notion', type: 'notion', env: 'NOTION_TOKEN' },
  telegram: { label: 'Telegram', type: 'telegram', env: 'TELEGRAM_BOT_TOKEN' }
};

let S = {};
try { S = JSON.parse(fs.readFileSync(SET_FILE, 'utf8')); } catch {}
function saveSettings() { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(SET_FILE, JSON.stringify(S, null, 2), { mode: 0o600 }); }
function cfg(id) { const s = S[id] || {}, p = PROVIDERS[id]; return { key: s.key || process.env[p.env] || '', model: s.model || p.model, chat: s.chat || (id === 'telegram' ? process.env.TELEGRAM_CHAT_ID : '') || '' }; }
const isOn = id => { const c = cfg(id); return PROVIDERS[id].type === 'telegram' ? !!(c.key && c.chat) : !!c.key; };
async function telegramSend(text) {
  const c = cfg('telegram');
  const r = await fetch('https://api.telegram.org/bot' + c.key + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: c.chat, text: String(text).slice(0, 3500) }) });
  const d = await r.json().catch(() => ({}));
  return r.ok && d.ok ? { ok: true } : { ok: false, error: d.description || ('HTTP ' + r.status) };
}

const ID = '[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}';
const NOTION_OK = new RegExp(`^/v1/(search|pages|pages/${ID}|databases/${ID}|databases/${ID}/query|blocks/${ID}/children)(\\?[\\w=&%.\\-]*)?$`);

function localOk(req) { // захист: тільки з цього комп'ютера і тільки з цієї сторінки
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1'].includes(host)) return false;
  if (req.headers.origin) {
    try { const u = new URL(req.headers.origin); if (!['localhost', '127.0.0.1'].includes(u.hostname) || String(u.port || 80) !== String(PORT)) return false; } catch { return false; }
  }
  return true;
}
function body(req) {
  return new Promise((ok, no) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 4e6) { no(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } });
  });
}
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
function errMsg(data, status) {
  return (data && data.error && (data.error.message || (typeof data.error === 'string' && data.error))) ||
    (Array.isArray(data) && data[0] && data[0].error && data[0].error.message) || (data && data.message) || ('HTTP ' + status);
}
const notionCall = (key, method, p, b) => fetch('https://api.notion.com' + p, {
  method, headers: { Authorization: 'Bearer ' + key, 'Notion-Version': '2022-06-28', 'content-type': 'application/json' },
  body: method === 'GET' ? undefined : JSON.stringify(b || {})
});

async function chatCall(id, system, messages, tools) {
  const p = PROVIDERS[id], c = cfg(id);
  if (p.type === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: c.model, max_tokens: 4096, system, messages, tools })
    });
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, data: d } : { ok: false, status: r.status, error: errMsg(d, r.status) };
  }
  const o = toOpenAI(system, messages, tools);
  const payload = Object.assign({ model: c.model, messages: o.messages }, p.extra || {}); if (o.tools.length) payload.tools = o.tools;
  const r = await fetch(p.base + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + c.key, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, data: fromOpenAI(d) } : { ok: false, status: r.status, error: errMsg(d, r.status) };
}

// ---------- Інтернет для ШІ: пошук і читання сторінок (з захистом від доступу до локальної мережі) ----------
function privateIp(ip) {
  if (net.isIPv6(ip)) { const l = ip.toLowerCase(); const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return privateIp(m[1]); return l === '::1' || l === '::' || /^f[cd]/.test(l) || l.startsWith('fe80'); }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
async function safeUrl(u) {
  const x = new URL(u);
  if (!['http:', 'https:'].includes(x.protocol)) throw new Error('Дозволено лише http/https');
  if (x.port && !['80', '443', '8080', '8443'].includes(x.port)) throw new Error('Цей порт заблоковано');
  const addrs = await dns.lookup(x.hostname, { all: true });
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Error('Адреси локальної мережі заблоковано');
  return x;
}
const UA = 'Mozilla/5.0 (compatible; SE-Office/1.1)';
async function fetchPage(url) {
  let cur = url;
  for (let hop = 0; hop < 5; hop++) {
    const x = await safeUrl(cur);
    const r = await fetch(x, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(15000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { cur = new URL(r.headers.get('location'), x).href; continue; }
    if (!r.ok) throw new Error('Сайт відповів: HTTP ' + r.status);
    const type = r.headers.get('content-type') || '';
    if (!/text|json|xml/.test(type)) throw new Error('Це не текстова сторінка (' + type + ')');
    const chunks = []; let n = 0; const rd = r.body.getReader();
    while (n < 1.5e6) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); n += value.length; }
    try { rd.cancel(); } catch {}
    let t = Buffer.concat(chunks).toString('utf8');
    if (/html/.test(type)) t = t.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|h\d|tr|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    t = t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    return { url: cur, text: t.length > 12000 ? t.slice(0, 12000) + ' …(скорочено)' : t };
  }
  throw new Error('Забагато переадресацій');
}
async function webSearch(q) {
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Пошук недоступний: HTTP ' + r.status);
  const h = await r.text(), out = [], re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  const clean = v => String(v || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').trim();
  let m; while ((m = re.exec(h)) && out.length < 8) {
    let u = m[1]; const q2 = u.match(/uddg=([^&]+)/); if (q2) u = decodeURIComponent(q2[1]); if (u.startsWith('//')) u = 'https:' + u;
    out.push({ title: clean(m[2]), url: u, snippet: clean(m[3]) });
  }
  if (!out.length) throw new Error('Нічого не знайдено або пошук тимчасово заблокував запит');
  return out;
}

// ---------- Вхід через OpenRouter (OAuth PKCE): один вхід — доступ до багатьох моделей ----------
let pkce = null;
function orStart() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  pkce = { verifier, at: Date.now() };
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return 'https://openrouter.ai/auth?callback_url=' + encodeURIComponent(`http://localhost:${PORT}/oauth/openrouter`) + '&code_challenge=' + challenge + '&code_challenge_method=S256';
}
async function orFinish(code) {
  if (!pkce || Date.now() - pkce.at > 10 * 60 * 1000) throw new Error('Сесію входу не знайдено. Почніть ще раз.');
  const r = await fetch('https://openrouter.ai/api/v1/auth/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, code_verifier: pkce.verifier, code_challenge_method: 'S256' }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.key) throw new Error(errMsg(d, r.status));
  pkce = null; S.openrouter = S.openrouter || {}; S.openrouter.key = d.key; saveSettings();
}

async function handleApi(req, res, url) {
  if (url === '/api/status') {
    const o = {}; for (const id in PROVIDERS) { const c = cfg(id); o[id] = { connected: isOn(id), chat: id === 'telegram' ? c.chat : undefined, model: PROVIDERS[id].model ? c.model : undefined, defaultModel: PROVIDERS[id].model }; }
    return send(res, 200, o);
  }
  if (url === '/api/openrouter/start') return send(res, 200, { url: orStart() });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const b = await body(req);

  if (url === '/api/settings') {
    const id = b.provider; if (!PROVIDERS[id]) return send(res, 400, { error: 'Невідомий сервіс' });
    if (b.clear) delete S[id];
    else {
      S[id] = S[id] || {};
      if (typeof b.key === 'string' && b.key.trim()) S[id].key = b.key.trim();
      if (PROVIDERS[id].type === 'telegram' && typeof b.chat === 'string' && b.chat.trim()) S[id].chat = b.chat.trim();
      if (PROVIDERS[id].model) { if (typeof b.model === 'string') S[id].model = b.model.trim() || undefined; }
    }
    saveSettings(); return send(res, 200, { ok: true });
  }
  if (url === '/api/test') {
    const id = b.provider, p = PROVIDERS[id]; if (!p) return send(res, 400, { error: 'Невідомий сервіс' });
    const c = cfg(id); if (!c.key) return send(res, 200, { ok: false, error: 'Ключ не задано' });
    try {
      if (p.type === 'telegram') { if (!c.chat) return send(res, 200, { ok: false, error: 'Вкажіть Chat ID' }); return send(res, 200, await telegramSend('✅ SE Офіс: сповіщення працюють')); }
      if (p.type === 'notion') { const r = await notionCall(c.key, 'POST', '/v1/search', { page_size: 1 }); const d = await r.json().catch(() => ({})); return send(res, 200, r.ok ? { ok: true } : { ok: false, error: errMsg(d, r.status) }); }
      const t = await chatCall(id, 'Відповідай одним словом.', [{ role: 'user', content: 'Скажи: ок' }], []);
      return send(res, 200, t.ok ? { ok: true } : { ok: false, error: t.error });
    } catch (e) { return send(res, 200, { ok: false, error: 'Немає зв\'язку: ' + (e.cause && e.cause.code || e.message) }); }
  }
  if (url === '/api/chat') {
    const id = b.provider || 'anthropic', p = PROVIDERS[id];
    if (!p || p.type === 'notion' || p.type === 'telegram') return send(res, 400, { error: 'Невідомий сервіс' });
    if (!cfg(id).key) return send(res, 400, { error: p.label + ' не підключено. Натисніть «Підключення».' });
    try {
      const r = await chatCall(id, b.system, b.messages, b.tools);
      return r.ok ? send(res, 200, r.data) : send(res, r.status || 502, { error: r.error });
    } catch (e) { return send(res, 502, { error: 'Немає зв\'язку з ' + p.label + ': ' + (e.cause && e.cause.code || e.message) }); }
  }
  if (url === '/api/web') {
    try { return send(res, 200, b.op === 'fetch' ? await fetchPage(String(b.url || '')) : { results: await webSearch(String(b.q || '').slice(0, 300)) }); }
    catch (e) { return send(res, 200, { error: String(e.message || e) }); }
  }
  if (url === '/api/notify') {
    if (!isOn('telegram')) return send(res, 200, { ok: false, error: 'Telegram не підключено' });
    try { return send(res, 200, await telegramSend(b.text || '')); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
  }
  if (url === '/api/notion') {
    const key = cfg('notion').key; if (!key) return send(res, 400, { error: 'Notion не підключено. Натисніть «Підключення».' });
    const method = String(b.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PATCH'].includes(method) || !NOTION_OK.test(String(b.path || ''))) return send(res, 403, { error: 'Цей виклик Notion заблоковано' });
    if (b.body && (b.body.archived || b.body.in_trash)) return send(res, 403, { error: 'Видалення заборонено' });
    const r = await notionCall(key, method, b.path, b.body);
    const d = await r.json().catch(() => ({}));
    return send(res, r.status, r.ok ? d : { error: errMsg(d, r.status) });
  }
  send(res, 404, { error: 'not found' });
}

http.createServer(async (req, res) => {
  try {
    if (!localOk(req)) { res.writeHead(403); return res.end('Forbidden'); }
    const url = req.url.split('?')[0];
    if (url === '/oauth/openrouter') {
      const code = new URL(req.url, 'http://localhost').searchParams.get('code'); let msg = '✅ Готово. Це вікно можна закрити.';
      try { if (!code) throw new Error('Немає коду'); await orFinish(code); } catch (e) { msg = '❌ ' + (e.message || e); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta charset="utf-8"><body style="font-family:system-ui;text-align:center;padding:60px"><h2>' + msg.replace(/</g, '&lt;') + '</h2><script>setTimeout(function(){try{window.opener&&window.opener.postMessage("se-oauth","*")}catch(e){};window.close()},1200)</script>');
    }
    if (url.startsWith('/api/')) return await handleApi(req, res, url);
    const rel = url === '/' ? '/index.html' : decodeURIComponent(url);
    const file = path.normalize(path.join(PUB, rel));
    if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, data) => {
      if (e) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, '127.0.0.1', () => {
  const u = `http://localhost:${PORT}`;
  console.log(`\n  SE Офіс запущено: ${u}\n  Не закривайте це вікно, поки користуєтесь офісом.\n`);
  if (!process.env.NO_OPEN) exec(process.platform === 'win32' ? `start "" ${u}` : process.platform === 'darwin' ? `open ${u}` : `xdg-open ${u}`, () => {});
}).on('error', e => { console.log(e.code === 'EADDRINUSE' ? `\n  Порт ${PORT} зайнятий. Можливо, офіс уже запущено: відкрийте http://localhost:${PORT}\n` : e); });
