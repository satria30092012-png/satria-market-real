'use strict';
const path = require('path');
const auth = require('../lib/auth');
const { createStore, resolveDir } = require('../lib/store');
const store = createStore(resolveDir(path.join(__dirname, '..')));

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
const active = (b) => !!b && (b.bannedUntil === null || b.bannedUntil > Date.now());
const key = (u) => String(u || '').trim().toLowerCase();

// Dipakai juga oleh login: cek ban tanpa HTTP
function getBan(username) {
  const b = store.read('bans.json', {})[key(username)];
  return active(b) ? { username: key(username), ...b } : null;
}

async function handler(req, res) {
  try {
    const bans = store.read('bans.json', {});
    if (req.method === 'GET') {
      const q = key(req.query && req.query.check);
      // Cek status ban satu user boleh publik (dipakai layar login) dan hanya mengembalikan info minimum.
      if (q) { const b = getBan(q); return send(res, 200, { ok: true, banned: !!b, data: b ? { username: q, reason: b.reason, bannedUntil: b.bannedUntil } : null }); }
      if (!isDev(req)) return send(res, 401, { ok: false, msg: 'Khusus developer' });
      const list = Object.keys(bans).filter((u) => active(bans[u])).map((u) => ({ username: u, ...bans[u] }));
      return send(res, 200, { ok: true, data: list });
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, msg: 'Method not allowed' });
    if (!isDev(req)) return send(res, 401, { ok: false, msg: 'Khusus developer' });
    const b = await readBody(req);
    const username = key(b.username);
    if (!/^[a-z0-9_.-]{3,20}$/.test(username)) return send(res, 400, { ok: false, msg: 'Username tidak valid' });
    if (b.action === 'ban') {
      const reason = String(b.reason || '').trim().slice(0, 200);
      if (!reason) return send(res, 400, { ok: false, msg: 'Alasan wajib diisi' });
      const hrs = Number(b.duration);
      bans[username] = { reason, bannedAt: Date.now(), bannedUntil: hrs > 0 ? Date.now() + hrs * 3600000 : null, bannedBy: 'dev' };
      store.write('bans.json', bans);
      return send(res, 200, { ok: true, msg: 'User diblokir' });
    }
    if (b.action === 'unban') { delete bans[username]; store.write('bans.json', bans); return send(res, 200, { ok: true, msg: 'Blokir dibuka' }); }
    return send(res, 400, { ok: false, msg: 'Action tidak dikenal' });
  } catch (e) {
    console.error('[ban]', e);
    return send(res, 500, { ok: false, msg: 'Server error' });
  }
}
module.exports = handler;
module.exports.getBan = getBan;
