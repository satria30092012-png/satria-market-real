const fs = require('fs'), path = require('path');
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;
const DIR = isVercel ? '/tmp/data' : (process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const mem = {};
function readJson(n, d) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8')); } catch { return n in mem ? mem[n] : d; }
}
function writeJson(n, v) {
  mem[n] = v;
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, n), JSON.stringify(v, null, 2)); } catch (e) { console.error('[ban] write', e.message); }
}
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
function authOk(req) {
  const secret = process.env.GATEWAY_SECRET || '';
  if (!secret) return true;
  const k = req.headers['x-satria-key'] || (req.headers.authorization || '').replace(/^Bearer /, '');
  return k === secret;
}
function active(b) { return b && (b.bannedUntil === null || b.bannedUntil > Date.now()); }

module.exports = async (req, res) => {
  try {
    if (!authOk(req)) return send(res, 401, { ok: false, msg: 'Unauthorized' });
    const bans = readJson('bans.json', {});
    if (req.method === 'GET') {
      const q = String((req.query && req.query.check) || '').trim().toLowerCase();
      if (q) { const b = bans[q]; return send(res, 200, { ok: true, banned: !!active(b), data: active(b) ? { username: q, ...b } : null }); }
      const list = Object.keys(bans).filter((u) => active(bans[u])).map((u) => ({ username: u, ...bans[u] }));
      return send(res, 200, { ok: true, data: list });
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, msg: 'Method not allowed' });
    const b = await readBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{2,40}$/.test(username)) return send(res, 400, { ok: false, msg: 'Username tidak valid' });
    if (b.action === 'ban') {
      const reason = String(b.reason || '').trim().slice(0, 200);
      if (!reason) return send(res, 400, { ok: false, msg: 'Alasan wajib diisi' });
      const hrs = Number(b.duration);
      bans[username] = { reason, bannedAt: Date.now(), bannedUntil: hrs > 0 ? Date.now() + hrs * 3600000 : null, bannedBy: String(b.by || 'dev').slice(0, 40) };
      writeJson('bans.json', bans);
      return send(res, 200, { ok: true, msg: 'User diblokir' });
    }
    if (b.action === 'unban') {
      delete bans[username]; writeJson('bans.json', bans);
      return send(res, 200, { ok: true, msg: 'Blokir dibuka' });
    }
    return send(res, 400, { ok: false, msg: 'Action tidak dikenal' });
  } catch (e) {
    console.error('[ban]', e);
    return send(res, 500, { ok: false, msg: 'Server error' });
  }
};