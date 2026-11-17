'use strict';
// Token sesi bertanda tangan HMAC-SHA256 + utilitas kredensial. Tanpa dependency.
const crypto = require('crypto');

let KEY = process.env.JWT_SECRET || process.env.GATEWAY_SECRET || '';
const EPHEMERAL = !KEY;
if (EPHEMERAL) {
  // Jangan pernah pakai kunci default yang bisa ditebak. Token akan hangus saat restart.
  KEY = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] JWT_SECRET kosong: pakai kunci acak sementara. Isi JWT_SECRET agar sesi bertahan setelah restart / multi-instance.');
}

const sign = (data) => crypto.createHmac('sha256', KEY).update(data).digest('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
function safeEq(a, b) { return crypto.timingSafeEqual(sha(a), sha(b)); }

function issue(claims, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const p = Buffer.from(JSON.stringify({ ...claims, iat: now, exp: now + ttlSec })).toString('base64url');
  return p + '.' + sign(p);
}
function verify(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!safeEq(sign(parts[0]), parts[1])) return null;
  try {
    const d = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!d || typeof d.exp !== 'number' || d.exp < Math.floor(Date.now() / 1000)) return null;
    return d;
  } catch { return null; }
}
const bearer = (req) => String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '').trim();
const fromReq = (req) => verify(bearer(req));

// Middleware: wajib login (role user atau dev)
function requireUser(req, res, next) {
  const s = fromReq(req);
  if (!s || (s.role !== 'user' && s.role !== 'dev')) return res.status(401).json({ ok: false, code: 'auth', msg: 'Sesi tidak valid, silakan login ulang' });
  req.session = s; next();
}
// Middleware: wajib developer
function requireDev(req, res, next) {
  const s = fromReq(req);
  if (!s || s.role !== 'dev') return res.status(401).json({ ok: false, code: 'auth', msg: 'Khusus developer' });
  req.session = s; next();
}

// Hash password: scrypt + salt acak
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 32);
  return 's1$' + salt.toString('base64url') + '$' + h.toString('base64url');
}
function checkPassword(pw, stored) {
  try {
    const [v, s, h] = String(stored).split('$');
    if (v !== 's1') return false;
    const calc = crypto.scryptSync(String(pw), Buffer.from(s, 'base64url'), 32);
    const want = Buffer.from(h, 'base64url');
    return want.length === calc.length && crypto.timingSafeEqual(calc, want);
  } catch { return false; }
}

module.exports = { issue, verify, fromReq, bearer, requireUser, requireDev, hashPassword, checkPassword, safeEq, EPHEMERAL };
