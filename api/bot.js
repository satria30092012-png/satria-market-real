const fs = require('fs'), path = require('path'), crypto = require('crypto');
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;
const DIR = isVercel ? '/tmp/data' : (process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const mem = {};
const TOKEN_SECRET = process.env.JWT_SECRET || process.env.GATEWAY_SECRET || 'satria-bot-fallback';
function readJson(n, d) { try { return JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8')); } catch { return n in mem ? mem[n] : d; } }
function writeJson(n, v) {
  mem[n] = v;
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, n), JSON.stringify(v, null, 2)); } catch (e) { console.error('[bot] write', e.message); }
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
function devOk(req) {
  const secret = process.env.GATEWAY_SECRET || '';
  if (!secret) return true;
  const k = req.headers['x-satria-key'] || '';
  return k === secret;
}
function sign(payload) { return crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url'); }
function makeToken(botId, username) {
  const p = Buffer.from(JSON.stringify({ botId, username, iat: Date.now() })).toString('base64url');
  return p + '.' + sign(p);
}
function readToken(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const [p, s] = t.split('.');
  if (!p || !s || sign(p) !== s) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    const bots = readJson('bots.json', {});
    return bots[d.username] && bots[d.username].botId === d.botId ? d : null;
  } catch { return null; }
}
function newCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let a = '', n = '';
  for (let i = 0; i < 4; i++) { a += L[crypto.randomInt(0, L.length)]; n += crypto.randomInt(0, 10); }
  return a + '-' + n;
}
const cleanName = (u) => String(u || '').trim().replace(/^@/, '').toLowerCase();

module.exports = async (req, res) => {
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const action = body.action || ((req.query && req.query.me) ? 'me' : 'list');

    if (action === 'list') {
      if (!devOk(req)) return send(res, 401, { ok: false, msg: 'Unauthorized' });
      const bots = readJson('bots.json', {});
      return send(res, 200, { ok: true, data: Object.keys(bots).map((u) => ({ username: u, botId: bots[u].botId, pairedAt: bots[u].pairedAt })) });
    }
    if (action === 'generate-code') {
      if (!devOk(req)) return send(res, 401, { ok: false, msg: 'Unauthorized' });
      const username = cleanName(body.username);
      if (!/^[a-z0-9_.-]{2,40}$/.test(username)) return send(res, 400, { ok: false, msg: 'Username bot tidak valid' });
      const codes = readJson('pairing_codes.json', {});
      for (const c of Object.keys(codes)) if (codes[c].expires < Date.now()) delete codes[c];
      const code = newCode();
      codes[code] = { username, expires: Date.now() + 60000 };
      writeJson('pairing_codes.json', codes);
      return send(res, 200, { ok: true, code, expiresIn: 60 });
    }
    if (action === 'pair') {
      const username = cleanName(body.username), code = String(body.code || '').trim().toUpperCase();
      const codes = readJson('pairing_codes.json', {});
      const c = codes[code];
      if (!c || c.username !== username || c.expires < Date.now()) return send(res, 400, { ok: false, msg: 'Kode salah atau kadaluarsa' });
      delete codes[code]; writeJson('pairing_codes.json', codes);
      const bots = readJson('bots.json', {});
      const botId = crypto.randomBytes(8).toString('hex');
      bots[username] = { botId, pairedAt: Date.now() };
      writeJson('bots.json', bots);
      return send(res, 200, { ok: true, token: makeToken(botId, username), botId });
    }
    if (action === 'me') {
      const t = readToken(req);
      if (!t) return send(res, 401, { ok: false, msg: 'Token tidak valid' });
      return send(res, 200, { ok: true, bot: { username: t.username, botId: t.botId } });
    }
    if (action === 'send') {
      const t = readToken(req);
      if (!t) return send(res, 401, { ok: false, msg: 'Token tidak valid' });
      const to = String(body.to || '').trim().slice(0, 40), message = String(body.message || '').trim().slice(0, 1000);
      if (!to || !message) return send(res, 400, { ok: false, msg: 'to & message wajib' });
      const box = readJson('bot_messages.json', []);
      box.push({ from: t.username, to, message, ts: Date.now() });
      writeJson('bot_messages.json', box.slice(-200));
      return send(res, 200, { ok: true });
    }
    if (action === 'revoke') {
      if (!devOk(req)) return send(res, 401, { ok: false, msg: 'Unauthorized' });
      const username = cleanName(body.username);
      const bots = readJson('bots.json', {});
      delete bots[username]; writeJson('bots.json', bots);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { ok: false, msg: 'Action tidak dikenal' });
  } catch (e) {
    console.error('[bot]', e);
    return send(res, 500, { ok: false, msg: 'Server error' });
  }
};