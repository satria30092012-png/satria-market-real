'use strict';
// Semua endpoint HTTP. Dependensi (mailer, WA, storage) disuntik agar bisa diuji tanpa Express/SMTP.
const auth = require('./lib/auth');
const { createLimiter } = require('./lib/ratelimit');
const { createOtpService, normalizeWA, TTL_MS } = require('./lib/otp');
const { createAccounts } = require('./lib/accounts');
const { waConfigured, sendWA, otpWAText } = require('./lib/wa');
const { wibISO } = require('./lib/time');
const { otpEmailHTML } = require('./email-templates');

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const SESSION_TTL = 7 * 24 * 3600;
const DEV_TTL = 2 * 3600;
const PROOF_TTL = 15 * 60;

function register(app, deps) {
  const { store, sendMail, env = process.env, waSender = sendWA, mountApi = [] } = deps;
  const accounts = createAccounts(store);
  const otp = createOtpService();
  const wibNow = () => wibISO();

  const L = {
    global: createLimiter({ name: 'g', windowMs: 60000, max: 120 }),
    otpIp: createLimiter({ name: 'otpip', windowMs: 10 * 60000, max: 10, message: 'Terlalu banyak permintaan OTP dari jaringan ini' }),
    otpMail: createLimiter({ name: 'otpmail', windowMs: 10 * 60000, max: 6, key: (r) => String((r.body && r.body.email) || '').trim().toLowerCase(), message: 'Terlalu banyak permintaan untuk email ini' }),
    verifyIp: createLimiter({ name: 'vip', windowMs: 10 * 60000, max: 30, message: 'Terlalu banyak percobaan verifikasi' }),
    login: createLimiter({ name: 'login', windowMs: 15 * 60000, max: 10, message: 'Terlalu banyak percobaan login, tunggu beberapa menit' }),
    loginId: createLimiter({ name: 'loginid', windowMs: 15 * 60000, max: 8, key: (r) => String((r.body && r.body.id) || '').trim().toLowerCase(), message: 'Terlalu banyak percobaan untuk akun ini' }),
    owner: createLimiter({ name: 'owner', windowMs: 15 * 60000, max: 5, message: 'Terlalu banyak percobaan login developer' }),
    search: createLimiter({ name: 'search', windowMs: 60000, max: 60 })
  };

  app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now(), wib: wibNow() }));

  // Konfigurasi publik: hanya nilai yang terisi (nilai kosong tidak boleh menimpa default frontend), tanpa kredensial.
  app.get('/api/config', (req, res) => {
    const out = { serverTime: wibNow(), tz: 'Asia/Jakarta', waOtp: waConfigured() };
    for (const k of ['NAMA_TOKO', 'WA_ORDER', 'TG_ADMIN', 'QRIS_IMAGE', 'MUSIC_URL', 'DEV_PUBLIC_NAME']) if (env[k]) out[k] = env[k];
    try { const f = JSON.parse(env.FOTO_PRODUK || '{}'); if (f && typeof f === 'object') out.FOTO_PRODUK = f; } catch {}
    res.json(out);
  });

  // ===== OTP ganda: satu kode, dikirim bersamaan ke Gmail + WhatsApp =====
  app.post('/api/otp/send', L.otpIp, L.otpMail, async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 120) return res.status(400).json({ ok: false, msg: 'Email tidak valid' });
    const waOn = waConfigured();
    const wa = normalizeWA((req.body || {}).wa);
    if (waOn && !wa) return res.status(400).json({ ok: false, msg: 'Nomor WhatsApp tidak valid (contoh 08123456789)' });
    if (!sendMail) return res.status(503).json({ ok: false, msg: 'SMTP belum diset di server' });

    const b = otp.begin(email);
    if (!b.ok) return res.status(b.status).json({ ok: false, msg: b.msg, retryAfter: b.retryAfter });
    const minutes = TTL_MS / 60000;

    const jobs = [
      Promise.resolve().then(() => sendMail({ to: email, subject: '🔐 Kode Verifikasi SatriaReal', html: otpEmailHTML({ code: b.code, email, expiryMin: minutes }), text: `Kode verifikasi SatriaReal: ${b.code}. Berlaku ${minutes} menit. Jangan bagikan ke siapa pun.` }))
    ];
    if (waOn && wa) jobs.push(Promise.resolve().then(() => waSender(wa, otpWAText(b.code, minutes))));
    const settled = await Promise.allSettled(jobs); // dikirim paralel
    const emailOk = settled[0].status === 'fulfilled';
    const waOk = waOn ? (settled[1] && settled[1].status === 'fulfilled') : null;
    settled.forEach((s, i) => { if (s.status === 'rejected') console.error('[otp]', i === 0 ? 'email' : 'wa', 'gagal:', s.reason && s.reason.message); });

    if (!emailOk && !waOk) { otp.abort(email); return res.status(502).json({ ok: false, msg: 'Kode gagal terkirim. Periksa email/nomor WhatsApp lalu coba lagi.' }); }
    otp.commit(email, b.code, Date.now(), { wa });
    const via = [emailOk && 'email', waOk && 'WhatsApp'].filter(Boolean).join(' & ');
    res.json({ ok: true, msg: `Kode dikirim lewat ${via}`, channels: { email: emailOk, wa: waOn ? !!waOk : 'off' }, expiresIn: TTL_MS / 1000, cooldown: 60, length: 6 });
  });

  app.post('/api/otp/verify', L.verifyIp, (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const code = String((req.body || {}).code || '').trim();
    if (!email || !code) return res.status(400).json({ ok: false, msg: 'Email dan kode wajib diisi' });
    const r = otp.verify(email, code);
    if (!r.ok) return res.status(r.status).json({ ok: false, code: r.code, msg: r.msg, left: r.left });
    const proof = auth.issue({ role: 'otp', sub: email, wa: (r.meta && r.meta.wa) || null }, PROOF_TTL);
    res.json({ ok: true, proof, email });
  });

  // ===== Akun =====
  app.post('/api/auth/register', L.login, (req, res) => {
    const b = req.body || {};
    const p = auth.verify(String(b.proof || ''));
    if (!p || p.role !== 'otp') return res.status(401).json({ ok: false, msg: 'Verifikasi email dulu (OTP)' });
    const wa = normalizeWA(b.wa) || p.wa;
    if (!wa) return res.status(400).json({ ok: false, msg: 'Nomor WhatsApp tidak valid' });
    if (p.wa && wa !== p.wa) return res.status(400).json({ ok: false, msg: 'Nomor WhatsApp berbeda dari yang diverifikasi' });
    const r = accounts.create({ username: b.username, email: p.sub, wa, password: b.password, devUsername: [env.DEV_USERNAME, env.DEV_PUBLIC_NAME] });
    if (!r.ok) return res.status(r.status).json({ ok: false, msg: r.msg });
    const a = r.account;
    res.json({ ok: true, token: auth.issue({ role: 'user', sub: a.username.toLowerCase(), name: a.username }, SESSION_TTL), user: { username: a.username, email: a.email, wa: a.wa, avatar: a.avatar, joinedAt: a.joinedAt } });
  });

  app.post('/api/auth/login', L.login, L.loginId, (req, res) => {
    const id = String((req.body || {}).id || '').trim();
    const pw = String((req.body || {}).password || '');
    if (!id || !pw) return res.status(400).json({ ok: false, msg: 'Isi semua kolom' });
    const a = accounts.verifyLogin(id, pw);
    if (!a) return res.status(401).json({ ok: false, msg: 'Username/email atau password salah' });
    let ban = null;
    try { ban = require('./api/ban').getBan(a.username); } catch {}
    if (ban) return res.status(403).json({ ok: false, code: 'banned', msg: 'Akun diblokir: ' + (ban.reason || '-') });
    res.json({ ok: true, token: auth.issue({ role: 'user', sub: a.username.toLowerCase(), name: a.username }, SESSION_TTL), user: { username: a.username, email: a.email, wa: a.wa, avatar: a.avatar, joinedAt: a.joinedAt } });
  });

  app.get('/api/auth/me', auth.requireUser, (req, res) => {
    if (req.session.role === 'dev') return res.json({ ok: true, role: 'dev' });
    const a = accounts.findByLogin(req.session.sub);
    if (!a) return res.status(401).json({ ok: false, msg: 'Akun tidak ditemukan' });
    res.json({ ok: true, user: { username: a.username, email: a.email, wa: a.wa, avatar: a.avatar, joinedAt: a.joinedAt } });
  });

  app.post('/api/auth/password', L.login, auth.requireUser, (req, res) => {
    if (req.session.role !== 'user') return res.status(403).json({ ok: false, msg: 'Khusus akun member' });
    const r = accounts.setPassword(req.session.sub, String((req.body || {}).old || ''), String((req.body || {}).next || ''));
    if (!r.ok) return res.status(r.status === 401 ? 403 : r.status).json({ ok: false, msg: r.msg }); // 403: jangan memicu logout otomatis di klien
    res.json({ ok: true });
  });

  // ===== Pencarian & profil user (tidak sensitif huruf besar/kecil, spasi dipangkas) =====
  app.get('/api/users/search', L.search, auth.requireUser, (req, res) => {
    const q = String((req.query && req.query.q) || '');
    res.json({ ok: true, data: accounts.search(q.slice(0, 40), 20, req.session.sub) });
  });
  app.get('/api/users/:name', L.search, auth.requireUser, (req, res) => {
    const u = accounts.get(decodeURIComponent(String(req.params.name || '')));
    if (!u) return res.status(404).json({ ok: false, msg: 'User tidak ditemukan' });
    res.json({ ok: true, user: u });
  });
  app.post('/api/users/avatar', auth.requireUser, (req, res) => {
    const av = String((req.body || {}).avatar || '');
    if (av.length > 700000) return res.status(413).json({ ok: false, msg: 'Foto terlalu besar' });
    if (av && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(av) && !/^https:\/\//.test(av)) return res.status(400).json({ ok: false, msg: 'Format foto tidak valid' });
    res.json({ ok: accounts.setAvatar(req.session.sub, av || null) });
  });

  // ===== Developer =====
  app.post('/api/owner/login', L.owner, (req, res) => {
    const du = env.DEV_USERNAME, de = env.DEV_EMAIL, dp = env.DEV_PASSWORD;
    if (!dp || (!du && !de)) return res.status(503).json({ ok: false, msg: 'Developer belum dikonfigurasi di server (.env)' });
    const u = String((req.body || {}).username || '').trim().toLowerCase();
    const p = String((req.body || {}).password || '');
    const uOk = (du && auth.safeEq(u, du.toLowerCase())) || (de && auth.safeEq(u, de.toLowerCase()));
    const pOk = auth.safeEq(p, dp);
    if (!(uOk && pOk)) return res.status(401).json({ ok: false, msg: 'Username atau password salah' });
    res.json({ ok: true, token: auth.issue({ role: 'dev', sub: 'developer' }, DEV_TTL) });
  });

  // ===== Pesanan =====
  app.get('/api/orders', auth.requireDev, (req, res) => res.json(store.read('orders.json', [])));
  app.post('/api/orders', L.global, auth.requireUser, (req, res) => {
    const b = req.body || {};
    const order = { ...b, email: undefined, user: req.session.sub, _id: Date.now(), _ts: wibISO() };
    const list = store.read('orders.json', []); list.unshift(order); store.write('orders.json', list.slice(0, 1000));
    const acct = accounts.findByLogin(req.session.sub);
    let spending = { total: 0, count: 0, history: [] };
    if (acct) {
      const sp = store.read('spending.json', {});
      const rec = sp[acct.email] || { total: 0, count: 0, history: [] };
      const amt = Math.max(0, Number(b.bayar) || 0);
      rec.total += amt; rec.count += 1; rec.history.unshift({ ts: Date.now(), amount: amt, produk: String(b.produk || '').slice(0, 80) });
      rec.history = rec.history.slice(0, 200);
      sp[acct.email] = rec; store.write('spending.json', sp); spending = rec;
    }
    res.json({ ok: true, id: order._id, spending });
  });
  app.get('/api/spending/:email', auth.requireUser, (req, res) => {
    const me = accounts.findByLogin(req.session.sub);
    const want = String(req.params.email || '').toLowerCase();
    if (req.session.role !== 'dev' && (!me || me.email !== want)) return res.status(403).json({ ok: false, msg: 'Bukan data kamu' });
    res.json(store.read('spending.json', {})[want] || { total: 0, count: 0, history: [] });
  });

  // ===== ban / bot / yuki =====
  for (const [name, handler] of mountApi) app.all('/api/' + name, name === 'ban' ? L.global : L.global, handler);

  return { accounts, otp, limiters: L };
}
module.exports = { register };
