'use strict';
// Semua waktu proses ini = WIB. Harus diset sebelum modul lain memakai Date.
process.env.TZ = 'Asia/Jakarta';
try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) {}
process.env.TZ = 'Asia/Jakarta';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const auth = require('./lib/auth');
const { createStore, resolveDir } = require('./lib/store');
const { register } = require('./routes');
const { createSignaling } = require('./lib/signaling');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const store = createStore(resolveDir(ROOT));

const app = express();
const server = http.createServer(app);
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ===== CORS (hanya origin yang diizinkan) =====
const allowedOrigins = ['http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500', process.env.FRONTEND_URL].filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '2mb' }));

// ===== Email (Nodemailer) =====
const transporter = process.env.SMTP_HOST && process.env.SMTP_USER ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
}) : null;
const sendMail = transporter ? (m) => transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, ...m }) : null;
if (!sendMail) console.warn('[smtp] SMTP_HOST/SMTP_USER kosong: OTP email tidak akan terkirim');

// ===== Routes =====
const mountApi = [];
['yuki', 'ban', 'bot'].forEach((n) => {
  try { mountApi.push([n, require('./api/' + n + '.js')]); console.log('[api] loaded:', n); }
  catch (e) { console.error('[api/' + n + '] gagal load:', e.message); }
});
register(app, { store, sendMail, mountApi });

// ===== Frontend =====
function serveIndex(req, res) {
  try {
    const p = path.join(ROOT, 'index.html');
    if (!fs.existsSync(p)) return res.status(404).type('text/plain').send('index.html tidak ditemukan');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    // Tidak ada rahasia yang disisipkan ke HTML.
    res.status(200).send(fs.readFileSync(p, 'utf8'));
  } catch (e) { console.error('[serveIndex]', e); res.status(500).json({ ok: false, msg: 'Gagal memuat halaman' }); }
}
app.get('/', serveIndex);
app.get('/index.html', serveIndex);
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return res.status(404).json({ ok: false, msg: 'Endpoint tidak ditemukan' });
  return serveIndex(req, res);
});
app.use((err, req, res, next) => { // body JSON rusak / error tak terduga
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ ok: false, msg: 'JSON tidak valid' });
  console.error('[error]', err);
  res.status(500).json({ ok: false, msg: 'Server error' });
});

// ===== Socket.IO (wajib token sesi; username diambil dari token, bukan dari klien) =====
let io = null;
try {
  const { Server } = require('socket.io');
  io = new Server(server, { path: '/socket.io', cors: { origin: allowedOrigins.includes('*') ? true : allowedOrigins }, maxHttpBufferSize: 5 * 1024 * 1024 });
  io.use((socket, next) => {
    const s = auth.verify(String((socket.handshake.auth && socket.handshake.auth.token) || ''));
    if (!s || (s.role !== 'user' && s.role !== 'dev')) return next(new Error('Unauthorized'));
    socket.data.user = s.name || s.sub; socket.data.key = String(s.sub).toLowerCase();
    next();
  });
  const sig = createSignaling({
    emitTo: (id, ev, payload) => io.to(id).emit(ev, payload),
    broadcastFrom: (id, ev, payload) => { const sk = io.sockets.sockets.get(id); if (sk) sk.broadcast.emit(ev, payload); }
  });
  io.on('connection', (socket) => {
    sig.connect(socket.id, socket.data.user);
    socket.emit('joined', { ok: true, username: socket.data.user });
    ['chat-message', 'new-status', 'status-reply', 'call-user', 'global-call-user', 'answer-call', 'ice-candidate', 'call-ended']
      .forEach((ev) => socket.on(ev, (d) => sig.handle(socket.id, ev, d)));
    socket.on('disconnect', () => sig.disconnect(socket.id));
  });
} catch (e) { console.error('[socket.io] gagal init:', e.message); }

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SatriaReal jalan di port :${PORT} (zona waktu ${process.env.TZ}, sekarang ${new Date().toString()})`);
});
module.exports = { app, server, io };
