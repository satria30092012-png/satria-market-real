'use strict';
// Server uji tanpa dependency (pengganti Express) yang menjalankan routes.js ASLI + index.html.
// Hanya untuk pengujian; tidak dipakai di produksi.
process.env.TZ = 'Asia/Jakarta';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { register } = require('../routes');
const { createStore } = require('../lib/store');

function start({ port = 0, env = {} } = {}) {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-e2e-'));
  const routes = []; const add = (m) => (p, ...h) => routes.push({ m, p, h });
  const app = { get: add('GET'), post: add('POST'), all: add('*') };
  const outbox = { mail: [], wa: [] };
  const mountApi = ['ban', 'bot', 'yuki'].map((n) => [n, require('../api/' + n)]);
  register(app, {
    store: createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sr-e2e-st-'))),
    sendMail: async (m) => { outbox.mail.push(m); },
    waSender: async (to, text) => { outbox.wa.push({ to, text }); },
    env: { DEV_USERNAME: 'satria', DEV_PASSWORD: 'Sup3rRahasia!', QRIS_IMAGE: '', ...env }, mountApi
  });
  const match = (r, method, p) => {
    if (r.m !== '*' && r.m !== method) return null;
    const a = r.p.split('/'), b = p.split('/'); if (a.length !== b.length) return null;
    const params = {}; for (let i = 0; i < a.length; i++) { if (a[i][0] === ':') params[a[i].slice(1)] = decodeURIComponent(b[i]); else if (a[i] !== b[i]) return null; }
    return params;
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname === '/__test/outbox') return res.json(outbox);
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(path.join(__dirname, '..', 'index.html'))); }
    let raw = ''; req.on('data', (c) => raw += c); req.on('end', () => {
      const route = routes.find((r) => match(r, req.method, u.pathname));
      if (!route) return res.status(404).json({ ok: false, msg: 'Endpoint tidak ditemukan' });
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { return res.status(400).json({ ok: false, msg: 'JSON tidak valid' }); }
      req.query = Object.fromEntries(u.searchParams); req.params = match(route, req.method, u.pathname);
      let i = 0; const next = () => { const h = route.h[i++]; if (h) { const r = h(req, res, next); if (r && r.catch) r.catch((e) => res.status(500).json({ ok: false, msg: e.message })); } };
      next();
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, outbox, url: 'http://127.0.0.1:' + server.address().port })));
}
module.exports = { start };
