// Vercel injects Environment Variables; local development may use .env in project root.
try {
  require('dotenv').config({ path: require('path').join(__dirname, '.env') });
} catch (e) {
  console.warn('[dotenv]', e && e.message);
}
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { otpEmailHTML } = require('./email-templates');

const PORT = Number(process.env.PORT || process.env.GATEWAY_PORT || 3000);
const SECRET = process.env.GATEWAY_SECRET || crypto.randomBytes(32).toString('hex');
const NODE_ID = process.env.NODE_ID || `pid${process.pid}`;
const ROOT = __dirname;

// PERBAIKAN VERCEL: Gunakan /tmp untuk direktori data karena filesystem Vercel bersifat read-only
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
const DATA_DIR = isVercel ? path.join('/tmp', 'data') : (process.env.DATA_DIR || path.join(ROOT, 'data'));
const memStore = {};
let fsWritable = false;
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
  fsWritable = true;
} catch {
  console.warn('[storage] Menggunakan in-memory / tmp (read-only filesystem)');
  fsWritable = false;
}

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
  } catch (e) {
    memStore[name] = d;
  }
}

const app = express();
const server = http.createServer(app);

// Socket.IO needs a long-lived process. Constructing it on Vercel attaches an
// engine that throws during the serverless request and crashes the function
// (500 FUNCTION_INVOCATION_FAILED). Only start it off Vercel.
let io = null;
if (!isVercel) {
  const { Server } = require('socket.io');
  io = new Server(server, {
    path: '/socket.io',
    cors: { origin: process.env.ALLOWED_ORIGINS?.split(',') || '*', credentials: false },
    maxHttpBufferSize: 15 * 1024 * 1024
  });
}

app.use(express.json({ limit: '15mb' }));

// The supplied project keeps index.html at the repository root.
const publicDir = path.join(ROOT, 'public');
const finalPublicDir = fs.existsSync(publicDir) ? publicDir : ROOT;

function authMw(req, res, next) {
  const k = req.headers['x-satria-key'] || req.query.key ||
            (req.headers['authorization'] || '').replace(/^Bearer /, '');
  if (k === SECRET) return next();
  res.status(401).json({ ok: false, msg: 'Unauthorized' });
}

app.get('/api/health', (req, res) =>
  res.json({ ok: true, id: NODE_ID, uptime: process.uptime(), ts: Date.now() }));

app.get('/api/config', authMw, (req, res) => res.json({
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
  if (h.n > 40) {
    return res.status(429).json({ ok: false, code: 'rate', msg: 'Terlalu banyak permintaan, coba lagi nanti', retryAfter: Math.ceil((h.start + OTP_WINDOW - now) / 1000) });
  }
  next();
}
const janitor = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore) if (v.expires < now && now - v.firstAt > OTP_WINDOW) otpStore.delete(k);
  for (const [k, v] of ipHits) if (now - v.start > OTP_WINDOW) ipHits.delete(k);
}, 5 * 60000);
if (typeof janitor.unref === 'function') janitor.unref();

function smtpMsg(e) {
  const c = e && e.code;
  if (c === 'EAUTH') return 'Login SMTP ditolak. Cek SMTP_USER / SMTP_PASS (Gmail wajib App Password).';
  if (c === 'ECONNECTION' || c === 'ETIMEDOUT' || c === 'ESOCKET' || c === 'EDNS') return 'Server tidak bisa konek ke SMTP. Cek SMTP_HOST / SMTP_PORT / koneksi.';
  return 'Email gagal terkirim: ' + (e && e.message ? e.message : 'unknown');
}

app.post('/api/otp/send', ipLimit, async (req, res) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ ok: false, code: 'bad', msg: 'Email tidak valid' });
    if (!transporter)
      return res.status(500).json({ ok: false, code: 'smtp', msg: 'SMTP belum diset di server (.env)' });

    const now = Date.now();
    let ex = otpStore.get(email);
    if (ex && now - ex.firstAt > OTP_WINDOW) ex = null;
    if (ex) {
      const wait = Math.ceil((ex.lastAt + OTP_COOLDOWN * 1000 - now) / 1000);
      if (wait > 0)
        return res.status(429).json({ ok: false, code: 'cooldown', msg: `Tunggu ${wait} detik sebelum kirim ulang`, retryAfter: wait });
      if (ex.sentCount >= OTP_MAX_SEND)
        return res.status(429).json({ ok: false, code: 'limit', msg: 'Terlalu sering minta kode. Coba lagi beberapa menit lagi.', retryAfter: Math.ceil((ex.firstAt + OTP_WINDOW - now) / 1000) });
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
      console.error('[otp] sendMail gagal:', e.code || '', e.message);
      return res.status(502).json({ ok: false, code: 'mail', msg: smtpMsg(e) });
    }

    otpStore.set(email, {
      code, expires: now + OTP_EXPIRY, tries: 0,
      sentCount: (ex?.sentCount || 0) + 1, firstAt: ex?.firstAt || now, lastAt: now
    });
    res.json({ ok: true, msg: 'Terkirim', expiresIn: OTP_EXPIRY / 1000, cooldown: OTP_COOLDOWN, length: OTP_LEN });
  } catch (e) {
    console.error('[otp] error:', e);
    res.status(500).json({ ok: false, code: 'err', msg: `Gagal: ${e.message}` });
  }
});

app.post('/api/otp/verify', ipLimit, (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const code = String((req.body || {}).code || '').trim();
  if (!email || !code) return res.status(400).json({ ok: false, code: 'bad', msg: 'Wajib diisi' });
  const rec = otpStore.get(email);
  if (!rec || !rec.code) return res.status(404).json({ ok: false, code: 'none', msg: 'Kode tidak ditemukan, kirim ulang kode' });
  if (rec.expires < Date.now()) { rec.code = null; return res.status(410).json({ ok: false, code: 'expired', msg: 'Kode kadaluarsa, kirim ulang kode' }); }
  if (rec.tries >= 5) { rec.code = null; return res.status(429).json({ ok: false, code: 'tries', msg: 'Terlalu banyak salah, kirim ulang kode' }); }
  rec.tries++;
  if (rec.code !== code) return res.status(401).json({ ok: false, code: 'wrong', msg: `Kode salah (${5 - rec.tries}x lagi)` });
  rec.code = null;
  const payload = Buffer.from(`${email}:${Date.now()}`).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  res.json({ ok: true, token: `${payload}.${sig}`, email });
});

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

// Otomatis inject GATEWAY_SECRET ke index.html agar API key sinkron otomatis
function findIndexHtml() {
  const candidates = [
    path.join(finalPublicDir, 'index.html'),
    path.join(ROOT, 'index.html'),
    path.join(process.cwd(), 'index.html'),
    path.join(__dirname, 'index.html'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch (_) {}
  }
  return null;
}

function serveIndex(req, res) {
  try {
    const idxPath = findIndexHtml();
    if (!idxPath) {
      return res.status(404).type('text/plain').send('index.html not found');
    }
    let html = fs.readFileSync(idxPath, 'utf8');
    // Escape so a secret with quotes cannot break the inline script.
    const safeSecret = String(SECRET).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    html = html.replace("'GANTI-DENGAN-GATEWAY_SECRET-DARI-.env-VPS'", `'${safeSecret}'`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);
  } catch (e) {
    console.error('[serveIndex]', e);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, msg: 'serveIndex failed', detail: e && e.message });
    }
  }
}

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Explicit routes — app.get('*') can throw on some Express/path-to-regexp builds
app.get('/', serveIndex);
app.get('/index.html', serveIndex);

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return res.status(404).json({ ok: false, msg: 'not found' });
  }
  // Do not expose server source, .env, or data files from ROOT.
  if (finalPublicDir !== ROOT) {
    try {
      const filePath = path.join(finalPublicDir, req.path);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return res.sendFile(filePath);
      }
    } catch (_) {}
  }
  return serveIndex(req, res);
});

// Socket.IO (local / VPS only)
if (io) {
  io.use((socket, next) => {
    const k = socket.handshake.auth?.key || socket.handshake.headers['x-satria-key'] || socket.handshake.query?.key;
    if (k !== SECRET) return next(new Error('Unauthorized'));
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

const shouldListen = require.main === module || process.env.START_SERVER === '1';
if (shouldListen) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SatriaReal Jalan di port :${PORT}`);
  });
}

module.exports = { app, server, io };
