'use strict';
const path = require('path');
const crypto = require('crypto');
const auth = require('../lib/auth');
const { createStore, resolveDir } = require('../lib/store');
const store = createStore(resolveDir(path.join(__dirname, '..')));
const BOT_TTL = 365 * 24 * 3600;

function send(res, code, obj) {
  if (typeof res.status === 'function') return res.status(code).json(obj);
  res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((resolve) => {
    let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const isDev = (req) => { const s = auth.fromReq(req); return !!s && s.role === 'dev'; };
const botSession = (req) => {
  const s = auth.fromReq(req);
  if (!s || s.role !== 'bot') return null;
  const b = store.read('bots.json', {})[s.sub];
  return b && b.botId === s.botId ? s : null; // dicabut = botId tidak cocok lagi
};
function newCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let a = '', n = '';
  for (let i = 0; i < 4; i++) { a += L[crypto.randomInt(0, L.length)]; n += crypto.randomInt(0, 10); }
  return a + '-' + n;
}
const cleanName = (u) => String(u || '').trim().replace(/^@/, '').toLowerCase();
const DEV_ONLY = { ok: false, msg: 'Khusus developer' };

async function handler(req, res) {
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const action = body.action || ((req.query && req.query.me) ? 'me' : 'list');

    if (action === 'list') {
      if (!isDev(req)) return send(res, 401, DEV_ONLY);
      const bots = store.read('bots.json', {});
      return send(res, 200, { ok: true, data: Object.keys(bots).map((u) => ({ username: u, botId: bots[u].botId, pairedAt: bots[u].pairedAt })) });
    }
    if (action === 'generate-code') {
      if (!isDev(req)) return send(res, 401, DEV_ONLY);
      const username = cleanName(body.username);
      if (!/^[a-z0-9_.-]{2,40}$/.test(username)) return send(res, 400, { ok: false, msg: 'Username bot tidak valid' });
      const codes = store.read('pairing_codes.json', {});
      for (const c of Object.keys(codes)) if (codes[c].expires < Date.now()) delete codes[c];
      const code = newCode();
      codes[code] = { username, expires: Date.now() + 60000, tries: 0 };
      store.write('pairing_codes.json', codes);
      return send(res, 200, { ok: true, code, expiresIn: 60 });
    }
    if (action === 'pair') {
      const username = cleanName(body.username), code = String(body.code || '').trim().toUpperCase();
      const codes = store.read('pairing_codes.json', {});
      const c = codes[code];
      if (!c || c.username !== username || c.expires < Date.now()) return send(res, 400, { ok: false, msg: 'Kode salah atau kedaluwarsa' });
      delete codes[code]; store.write('pairing_codes.json', codes); // sekali pakai
      const bots = store.read('bots.json', {});
      const botId = crypto.randomBytes(8).toString('hex');
      bots[username] = { botId, pairedAt: Date.now() };
      store.write('bots.json', bots);
      return send(res, 200, { ok: true, token: auth.issue({ role: 'bot', sub: username, botId }, BOT_TTL), botId });
    }
    if (action === 'me') {
      const t = botSession(req);
      if (!t) return send(res, 401, { ok: false, msg: 'Token tidak valid' });
      return send(res, 200, { ok: true, bot: { username: t.sub, botId: t.botId } });
    }
    if (action === 'send') {
      const t = botSession(req);
      if (!t) return send(res, 401, { ok: false, msg: 'Token tidak valid' });
      const to = String(body.to || '').trim().slice(0, 40), message = String(body.message || '').trim().slice(0, 1000);
      if (!to || !message) return send(res, 400, { ok: false, msg: 'to & message wajib' });
      const box = store.read('bot_messages.json', []);
      box.push({ from: t.sub, to, message, ts: Date.now() });
      store.write('bot_messages.json', box.slice(-200));
      return send(res, 200, { ok: true });
    }
    if (action === 'revoke') {
      if (!isDev(req)) return send(res, 401, DEV_ONLY);
      const username = cleanName(body.username);
      const bots = store.read('bots.json', {});
      delete bots[username]; store.write('bots.json', bots);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { ok: false, msg: 'Action tidak dikenal' });
  } catch (e) {
    console.error('[bot]', e);
    return send(res, 500, { ok: false, msg: 'Server error' });
  }
}
module.exports = handler;
