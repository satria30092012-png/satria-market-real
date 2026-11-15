try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) {}

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { otpEmailHTML } = require('./email-templates');

const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.GATEWAY_SECRET || '';
const NO_AUTH = !SECRET;
const SIGN_KEY = SECRET || process.env.JWT_SECRET || 'satria-no-secret';
const NODE_ID = process.env.NODE_ID || `pid${process.pid}`;
const ROOT = __dirname;

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
let fsWritable = true;
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch {
  console.warn('[storage] Read-only filesystem, pakai in-memory');
  fsWritable = false;
}
const memStore = {};

function readJson(name, def = []) {
  if (!fsWritable) return memStore[name] ?? def;
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); }
  catch { return def; }
}
function writeJson(name, d) {
  if (!fsWritable) { memStore[name] = d; return; }
  try {
    const tmp = path.join(DATA_DIR, `${name}.tmp.${process.pid}.${Date.now()}`);
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, path.join(DATA_DIR, name));
  } catch (e) { memStore[name] = d; }
}

const app = express();
const server = http.createServer(app);

// ===== CORS untuk GitHub Pages =====
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Satria-Key');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '15mb' }));

// ===== Socket.IO =====
let io = null;
try {
  const { Server } = require('socket.io');
  io = new Server(server, {
    path: '/socket.io',
    cors: {
      origin: allowedOrigins.includes('*') ? true : allowedOrigins,
      credentials: true
    },
    maxHttpBufferSize: 15 * 1024 * 1024
  });
} catch (e) {
  console.error('[socket.io] gagal init:', e.message);
}

function authMw(req, res, next) {
  if (NO_AUTH) return next();
  const k = req.headers['x-satria-key'] || req.query.key ||
            (req.headers['authorization'] || '').replace(/^Bearer /, '');
  if (k === SECRET) return next();
  res.status(401).json({ ok: false, msg: 'Unauthorized' });
}

app.get('/api/health', (req, res) =>
  res.json({ ok: true, id: NODE_ID, uptime: process.uptime(), ts: Date.now() }));

app.get('/api/config', (req, res) => res.json({
  NAMA_TOKO: process.env.NAMA_TOKO || 'SATRIA REAL MARKET',
  WA_ORDER: process.env.WA_ORDER || '',
  TG_ADMIN: process.env.TG_ADMIN || '',
  QRIS_IMAGE: process.env.QRIS_IMAGE || '',
  MUSIC_URL: process.env.MUSIC_URL || '',
  FOTO_PRODUK: (() => { try { return JSON.parse(process.env.FOTO_PRODUK || '{}'); } catch { return {}; } })(),
  DEVELOPER: {
    username: process.env.DEV_USERNAME || '',
    email: process.env.DEV_EMAIL || '',
    password: process.env.DEV_PASSWORD || ''
  }
}));

const transporter = (() => {
  if (!process.env.SMTP_HOST) return null;
  try {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  } catch (e) { return null; }
})();

const OTP_EXPIRY = (Number(process.env.OTP_EXPIRY_MIN) || 5) * 60000;
const OTP_LEN = Math.min(10, Math.max(4, Number(process.env.OTP_LENGTH) || 6));
const OTP_COOLDOWN = Number(process.env.OTP_COOLDOWN_SEC) || 60;
const OTP_WINDOW = 10 * 60000;
const OTP_MAX_SEND = 3;
const otpStore = new Map();
const ipHits = new Map();

function ipLimit(req, res, next) {
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  const now = Date.now();
  let h = ipHits.get(ip);
  if (!h || now - h.start > OTP_WINDOW) h = { start: now, n: 0 };
  h.n++; ipHits.set(ip, h);
  if (h.n > 60) return res.status(429).json({ ok: false, code: 'rate', msg: 'Terlalu banyak permintaan' });
  next();
}

function smtpMsg(e) {
  const c = e && e.code;
  if (c === 'EAUTH') return 'Login SMTP ditolak. Cek SMTP_USER / SMTP_PASS.';
  if (c === 'ECONNECTION' || c === 'ETIMEDOUT' || c === 'ESOCKET' || c === 'EDNS') return 'Tidak bisa konek SMTP.';
  return 'Email gagal terkirim: ' + (e && e.message ? e.message : 'unknown');
}

app.post('/api/otp/send', ipLimit, async (req, res) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, msg: 'Email tidak valid' });
    if (!transporter) return res.status(500).json({ ok: false, msg: 'SMTP belum diset di server' });

    const now = Date.now();
    let ex = otpStore.get(email);
    if (ex && now - ex.firstAt > OTP_WINDOW) ex = null;
    if (ex) {
      const wait = Math.ceil((ex.lastAt + OTP_COOLDOWN * 1000 - now) / 1000);
      if (wait > 0) return res.status(429).json({ ok: false, msg: `Tunggu ${wait} detik`, retryAfter: wait });
      if (ex.sentCount >= OTP_MAX_SEND) return res.status(429).json({ ok: false, msg: 'Terlalu sering, coba lagi nanti' });
    }

    let code = '';
    for (let i = 0; i < OTP_LEN; i++) code += crypto.randomInt(0, 10);

    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'SatriaReal',
        to: email,
        subject: '🔐 Kode Verifikasi SatriaReal',
        html: otpEmailHTML({ code, email, expiryMin: OTP_EXPIRY / 60000 })
      });
    } catch (e) {
      console.error('[otp] sendMail gagal:', e.code, e.message);
      return res.status(502).json({ ok: false, msg: smtpMsg(e) });
    }

    otpStore.set(email, {
      code, expires: now + OTP_EXPIRY, tries: 0,
      sentCount: (ex?.sentCount || 0) + 1, firstAt: ex?.firstAt || now, lastAt: now
    });
    res.json({ ok: true, msg: 'Terkirim', expiresIn: OTP_EXPIRY / 1000, cooldown: OTP_COOLDOWN, length: OTP_LEN });
  } catch (e) {
    console.error('[otp]', e);
    res.status(500).json({ ok: false, msg: e.message });
  }
});

app.post('/api/otp/verify', ipLimit, (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const code = String((req.body || {}).code || '').trim();
  if (!email || !code) return res.status(400).json({ ok: false, msg: 'Wajib diisi' });
  const rec = otpStore.get(email);
  if (!rec || !rec.code) return res.status(404).json({ ok: false, msg: 'Kode tidak ditemukan' });
  if (rec.expires < Date.now()) { rec.code = null; return res.status(410).json({ ok: false, msg: 'Kode kadaluarsa' }); }
  if (rec.tries >= 5) { rec.code = null; return res.status(429).json({ ok: false, msg: 'Terlalu banyak salah' }); }
  rec.tries++;
  if (rec.code !== code) return res.status(401).json({ ok: false, msg: `Kode salah (${5 - rec.tries}x lagi)` });
  rec.code = null;
  const payload = Buffer.from(`${email}:${Date.now()}`).toString('base64url');
  const sig = crypto.createHmac('sha256', SIGN_KEY).update(payload).digest('base64url');
  res.json({ ok: true, token: `${payload}.${sig}`, email });
});

// ===== API modules =====
['yuki', 'ban', 'bot'].forEach((n) => {
  try {
    const h = require('./api/' + n + '.js');
    app.all('/api/' + n, ipLimit, h);
    console.log('[api] loaded:', n);
  } catch (e) {
    console.error('[api/' + n + '] gagal load:', e.message);
  }
});

// ===== Orders =====
app.get('/api/orders', authMw, (req, res) => res.json(readJson('orders.json', [])));

app.post('/api/orders', authMw, (req, res) => {
  const order = { ...(req.body || {}), _id: Date.now(), _ts: new Date().toISOString() };
  const list = readJson('orders.json', []);
  list.unshift(order);
  writeJson('orders.json', list.slice(0, 1000));

  let spending = { total: 0, count: 0, history: [] };
  if (order.email) {
    const sp = readJson('spending.json', {});
    const rec = sp[order.email] || { total: 0, count: 0, history: [] };
    rec.total += Number(order.bayar || 0);
    rec.count += 1;
    rec.history.unshift({ ts: Date.now(), amount: Number(order.bayar || 0), produk: order.produk });
    sp[order.email] = rec;
    writeJson('spending.json', sp);
    spending = rec;
  }
  res.json({ ok: true, id: order._id, spending });
});

app.get('/api/spending/:email', authMw, (req, res) => {
  const sp = readJson('spending.json', {});
  res.json(sp[req.params.email] || { total: 0, count: 0, history: [] });
});

// ===== Serve index.html =====
function findIndexHtml() {
  const candidates = [path.join(ROOT, 'index.html'), path.join(process.cwd(), 'index.html')];
  for (const p of candidates) {
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (_) {}
  }
  return null;
}

function serveIndex(req, res) {
  try {
    const idxPath = findIndexHtml();
    if (!idxPath) return res.status(404).type('text/plain').send('index.html not found');
    let html = fs.readFileSync(idxPath, 'utf8');
    const esc = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3c');
    html = html.replace(/window\.__SATRIA_KEY__\s*=\s*'[^']*'/, () => `window.__SATRIA_KEY__ = '${esc(SECRET)}'`);
    html = html.replace(/window\.__WEATHER_KEY__\s*=\s*'[^']*'/, () => `window.__WEATHER_KEY__ = '${esc(process.env.WEATHER_API_KEY)}'`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);
  } catch (e) {
    console.error('[serveIndex]', e);
    res.status(500).json({ ok: false, msg: e.message });
  }
}

app.get('/', serveIndex);
app.get('/index.html', serveIndex);

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return res.status(404).json({ ok: false, msg: 'not found' });
  }
  return serveIndex(req, res);
});

// ===== Socket.IO =====
if (io) {
  io.use((socket, next) => {
    const k = socket.handshake.auth?.key || socket.handshake.headers['x-satria-key'] || socket.handshake.query?.key;
    if (!NO_AUTH && k !== SECRET) return next(new Error('Unauthorized'));
    next();
  });

  const users = new Map(), socketUser = new Map();
  io.on('connection', (socket) => {
    socket.on('join', ({ username } = {}) => {
      if (!username) return;
      users.set(username, socket.id); socketUser.set(socket.id, username);
      socket.emit('joined', { ok: true, username });
    });
    socket.on('chat-message', (d) => {
      if (!d?.roomId) return;
      if (d.roomId === 'global') socket.broadcast.emit('chat-message', d);
      else { const t = users.get(d.roomId); if (t) io.to(t).emit('chat-message', d); }
    });
    socket.on('disconnect', () => {
      const u = socketUser.get(socket.id);
      if (u) users.delete(u);
      socketUser.delete(socket.id);
    });
  });
}

// ===== Start server =====
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SatriaReal jalan di port :${PORT}`);
  console.log(`   Auth mode: ${NO_AUTH ? 'DEMO (no secret)' : 'AKTIF'}`);
  console.log(`   CORS allow: ${allowedOrigins.join(', ') || '*'}`);
});

module.exports = { app, server, io };