'use strict';
process.env.TZ = 'Asia/Jakarta';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-routes-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeApp } = require('./helpers');
const { register } = require('../routes');
const { createStore } = require('../lib/store');

function setup(envExtra = {}, { waFail = false, mailFail = false } = {}) {
  const app = createFakeApp();
  const sent = { mail: [], wa: [] };
  const env = { DEV_USERNAME: 'satria', DEV_EMAIL: 'dev@x.com', DEV_PASSWORD: 'Sup3rRahasia!', NAMA_TOKO: 'TOKO', QRIS_IMAGE: '', ...envExtra };
  const sendMail = async (m) => { if (mailFail) throw new Error('smtp down'); sent.mail.push(m); };
  const waSender = async (to, text) => { if (waFail) throw new Error('wa down'); sent.wa.push({ to, text }); };
  const store = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sr-st-')));
  const mountApi = ['ban', 'bot', 'yuki'].map((n) => [n, require('../api/' + n)]);
  register(app, { store, sendMail, env, waSender, mountApi });
  return { app, sent };
}
const withWA = async (fn) => { process.env.WA_PROVIDER = 'generic'; process.env.WA_GATEWAY_URL = 'http://x'; process.env.WA_GATEWAY_TOKEN = 't'; try { await fn(); } finally { delete process.env.WA_PROVIDER; delete process.env.WA_GATEWAY_URL; delete process.env.WA_GATEWAY_TOKEN; } };
const bearer = (t) => ({ authorization: 'Bearer ' + t });
const code6 = (txt) => txt.match(/\*(\d{6})\*/)[1];

async function registerUser(app, sent, { username, email, wa, ip }) {
  const s = await app.call('POST', '/api/otp/send', { body: { email, wa }, ip });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const code = code6(sent.wa[sent.wa.length - 1].text);
  const v = await app.call('POST', '/api/otp/verify', { body: { email, code }, ip });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const r = await app.call('POST', '/api/auth/register', { body: { proof: v.body.proof, username, password: 'secret12', wa }, ip });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

test('Config publik: tanpa DEVELOPER/password, tanpa nilai kosong (QR tidak tertimpa string kosong)', async () => {
  const { app } = setup();
  const r = await app.call('GET', '/api/config');
  assert.equal(r.body.NAMA_TOKO, 'TOKO');
  assert.ok(!('QRIS_IMAGE' in r.body), 'QRIS kosong tidak boleh dikirim');
  assert.ok(!JSON.stringify(r.body).includes('Sup3rRahasia'));
  assert.ok(!('DEVELOPER' in r.body)); assert.equal(r.body.tz, 'Asia/Jakarta');
  assert.match(r.body.serverTime, /\+07:00$/);
});

test('OTP ganda: kode SAMA dikirim ke Email dan WhatsApp, lalu daftar + login', async () => {
  await withWA(async () => {
    const { app, sent } = setup();
    const out = await registerUser(app, sent, { username: 'SatriaReal', email: 'satria@gmail.com', wa: '081271044597', ip: '1.1.1.1' });
    assert.equal(sent.mail.length, 1); assert.equal(sent.wa.length, 1);
    assert.equal(sent.wa[0].to, '6281271044597');
    const mailCode = sent.mail[0].html.match(/>\s*(\d)\s*<\/td>/g).map((x) => x.replace(/\D/g, '')).join('');
    assert.equal(mailCode, code6(sent.wa[0].text), 'kode email == kode WhatsApp');
    assert.equal(out.user.wa, '6281271044597'); assert.ok(!('pass' in out.user));
    const lg = await app.call('POST', '/api/auth/login', { body: { id: '  SATRIAREAL ', password: 'secret12' }, ip: '1.1.1.2' });
    assert.equal(lg.status, 200);
    const bad = await app.call('POST', '/api/auth/login', { body: { id: 'satriareal', password: 'salah' }, ip: '1.1.1.3' });
    assert.equal(bad.status, 401);
  });
});

test('OTP: 3x salah -> hangus; tanpa bukti OTP tidak bisa daftar', async () => {
  await withWA(async () => {
    const { app, sent } = setup();
    await app.call('POST', '/api/otp/send', { body: { email: 'b@x.com', wa: '081200000001' }, ip: '2.2.2.2' });
    const real = code6(sent.wa[0].text); const wrong = real === '000000' ? '111111' : '000000';
    const r = []; for (let i = 0; i < 3; i++) r.push(await app.call('POST', '/api/otp/verify', { body: { email: 'b@x.com', code: wrong }, ip: '2.2.2.2' }));
    assert.deepEqual(r.map((x) => x.status), [401, 401, 429]);
    assert.equal((await app.call('POST', '/api/otp/verify', { body: { email: 'b@x.com', code: real }, ip: '2.2.2.2' })).status, 404);
    const reg = await app.call('POST', '/api/auth/register', { body: { username: 'hacker', password: 'secret12', wa: '081200000001', proof: 'palsu' }, ip: '2.2.2.2' });
    assert.equal(reg.status, 401);
  });
});

test('OTP: WhatsApp mati tapi email sukses -> tetap terkirim & dilaporkan; keduanya gagal -> 502', async () => {
  await withWA(async () => {
    const a = setup({}, { waFail: true });
    const r = await a.app.call('POST', '/api/otp/send', { body: { email: 'c@x.com', wa: '081200000002' }, ip: '3.3.3.3' });
    assert.equal(r.status, 200); assert.equal(r.body.channels.email, true); assert.equal(r.body.channels.wa, false);
    const b = setup({}, { waFail: true, mailFail: true });
    const r2 = await b.app.call('POST', '/api/otp/send', { body: { email: 'd@x.com', wa: '081200000003' }, ip: '3.3.3.4' });
    assert.equal(r2.status, 502);
    const r3 = await b.app.call('POST', '/api/otp/send', { body: { email: 'bukanemail', wa: '081200000003' }, ip: '3.3.3.5' });
    assert.equal(r3.status, 400);
    const r4 = await b.app.call('POST', '/api/otp/send', { body: { email: 'e@x.com', wa: '123' }, ip: '3.3.3.6' });
    assert.equal(r4.status, 400, 'nomor WA tidak valid ditolak saat gateway aktif');
  });
});

test('OTP: cooldown 60 detik & rate limit per IP', async () => {
  await withWA(async () => {
    const { app } = setup();
    assert.equal((await app.call('POST', '/api/otp/send', { body: { email: 'f@x.com', wa: '081200000004' }, ip: '4.4.4.4' })).status, 200);
    assert.equal((await app.call('POST', '/api/otp/send', { body: { email: 'f@x.com', wa: '081200000004' }, ip: '4.4.4.4' })).status, 429);
    let last; for (let i = 0; i < 12; i++) last = await app.call('POST', '/api/otp/send', { body: { email: `z${i}@x.com`, wa: '081200000005' }, ip: '4.4.4.9' });
    assert.equal(last.status, 429);
  });
});

test('Pencarian user & profil: butuh login, tidak sensitif huruf, 404 bersih', async () => {
  await withWA(async () => {
    const { app, sent } = setup();
    const a = await registerUser(app, sent, { username: 'BudiSantoso', email: 'budi@x.com', wa: '081211110001', ip: '5.5.5.1' });
    const b = await registerUser(app, sent, { username: 'AniWati', email: 'ani@x.com', wa: '081211110002', ip: '5.5.5.2' });
    assert.equal((await app.call('GET', '/api/users/search', { query: { q: 'budi' } })).status, 401);
    const s = await app.call('GET', '/api/users/search', { query: { q: '  bUdI ' }, headers: bearer(b.token) });
    assert.deepEqual(s.body.data.map((u) => u.username), ['BudiSantoso']);
    assert.ok(!('email' in s.body.data[0]) && !('wa' in s.body.data[0]) && !('pass' in s.body.data[0]), 'data privat tidak bocor');
    const p = await app.call('GET', '/api/users/BUDISANTOSO', { headers: bearer(b.token) }); assert.equal(p.body.user.username, 'BudiSantoso');
    assert.equal((await app.call('GET', '/api/users/ghost', { headers: bearer(b.token) })).status, 404);
    assert.equal((await app.call('GET', '/api/auth/me', { headers: bearer(a.token) })).body.user.email, 'budi@x.com');
  });
});

test('Ban: dev memblokir -> login ditolak; non-dev tidak bisa ban; cek publik minim', async () => {
  await withWA(async () => {
    const { app, sent } = setup();
    const u = await registerUser(app, sent, { username: 'Nakal', email: 'nakal@x.com', wa: '081233330001', ip: '6.6.6.1' });
    const noDev = await app.call('POST', '/api/ban', { body: { action: 'ban', username: 'nakal', reason: 'x' }, headers: bearer(u.token) });
    assert.equal(noDev.status, 401);
    const dl = await app.call('POST', '/api/owner/login', { body: { username: 'SATRIA', password: 'Sup3rRahasia!' }, ip: '6.6.6.2' });
    assert.equal(dl.status, 200);
    const ban = await app.call('POST', '/api/ban', { body: { action: 'ban', username: 'NAKAL', reason: 'spam bot', duration: 0 }, headers: bearer(dl.body.token) });
    assert.equal(ban.status, 200);
    const lg = await app.call('POST', '/api/auth/login', { body: { id: 'nakal', password: 'secret12' }, ip: '6.6.6.3' });
    assert.equal(lg.status, 403); assert.match(lg.body.msg, /spam bot/);
    const chk = await app.call('GET', '/api/ban', { query: { check: 'Nakal' } }); assert.equal(chk.body.banned, true);
    assert.equal((await app.call('GET', '/api/ban', { headers: bearer(u.token) })).status, 401, 'daftar ban khusus dev');
    await app.call('POST', '/api/ban', { body: { action: 'unban', username: 'nakal' }, headers: bearer(dl.body.token) });
    assert.equal((await app.call('POST', '/api/auth/login', { body: { id: 'nakal', password: 'secret12' }, ip: '6.6.6.4' })).status, 200);
  });
});

test('Login developer: kredensial dari server, password salah ditolak, dibatasi 5x', async () => {
  const { app } = setup();
  assert.equal((await app.call('POST', '/api/owner/login', { body: { username: 'satria', password: '30092012' }, ip: '7.7.7.1' })).status, 401, 'password lama di repo tidak berlaku');
  assert.equal((await app.call('POST', '/api/owner/login', { body: { username: 'dev@x.com', password: 'Sup3rRahasia!' }, ip: '7.7.7.2' })).status, 200, 'email dev juga bisa');
  let last; for (let i = 0; i < 6; i++) last = await app.call('POST', '/api/owner/login', { body: { username: 'satria', password: 'x' + i }, ip: '7.7.7.3' });
  assert.equal(last.status, 429);
  const nc = setup({ DEV_PASSWORD: '' });
  assert.equal((await nc.app.call('POST', '/api/owner/login', { body: { username: 'satria', password: '' }, ip: '7.7.7.4' })).status, 503, 'tanpa konfigurasi = tertutup, bukan terbuka');
});

test('Pesanan & Yuki & Bot: wajib sesi yang benar', async () => {
  await withWA(async () => {
    const { app, sent } = setup();
    const u = await registerUser(app, sent, { username: 'Pembeli', email: 'p@x.com', wa: '081244440001', ip: '8.8.8.1' });
    assert.equal((await app.call('POST', '/api/orders', { body: { produk: 'x', bayar: 5000 } })).status, 401);
    assert.equal((await app.call('GET', '/api/orders', { headers: bearer(u.token) })).status, 401, 'daftar pesanan khusus dev');
    const o = await app.call('POST', '/api/orders', { body: { produk: 'JASA BAN', bayar: 5000 }, headers: bearer(u.token) });
    assert.equal(o.body.spending.total, 5000);
    assert.match((await app.call('POST', '/api/orders', { body: { produk: 'y', bayar: 1000 }, headers: bearer(u.token) })).body.spending.count + '', /2/);
    assert.equal((await app.call('GET', '/api/spending/p@x.com', { headers: bearer(u.token) })).body.total, 6000);
    assert.equal((await app.call('GET', '/api/spending/orang@lain.com', { headers: bearer(u.token) })).status, 403);
    assert.equal((await app.call('POST', '/api/yuki', { body: { message: 'halo' } })).status, 401);
    const y = await app.call('POST', '/api/yuki', { body: { message: 'hitung total' }, headers: bearer(u.token) });
    assert.equal(y.status, 200); assert.ok(!/^Halo!/.test(y.body.reply), '"hitung" tidak lagi dianggap sapaan "hi"');
    const dev = (await app.call('POST', '/api/owner/login', { body: { username: 'satria', password: 'Sup3rRahasia!' }, ip: '8.8.8.2' })).body.token;
    assert.equal((await app.call('POST', '/api/bot', { body: { action: 'list' } })).status, 401);
    const gc = await app.call('POST', '/api/bot', { body: { action: 'generate-code', username: 'yukibot' }, headers: bearer(dev) });
    const pr = await app.call('POST', '/api/bot', { body: { action: 'pair', username: 'yukibot', code: gc.body.code } });
    assert.equal(pr.status, 200);
    assert.equal((await app.call('POST', '/api/bot', { body: { action: 'pair', username: 'yukibot', code: gc.body.code } })).status, 400, 'kode pairing sekali pakai');
    assert.equal((await app.call('POST', '/api/bot', { body: { action: 'me' }, headers: bearer(pr.body.token) })).status, 200);
    await app.call('POST', '/api/bot', { body: { action: 'revoke', username: 'yukibot' }, headers: bearer(dev) });
    assert.equal((await app.call('POST', '/api/bot', { body: { action: 'me' }, headers: bearer(pr.body.token) })).status, 401, 'token bot dicabut');
    assert.equal((await app.call('POST', '/api/bot', { body: { action: 'me' }, headers: bearer(u.token) })).status, 401, 'token user bukan token bot');
  });
});
