'use strict';
process.env.TZ = 'Asia/Jakarta';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { createOtpService, normalizeWA } = require('../lib/otp');
const { wibISO, wibText } = require('../lib/time');
const auth = require('../lib/auth');
const { createLimiter } = require('../lib/ratelimit');
const { createAccounts } = require('../lib/accounts');
const { createStore } = require('../lib/store');
const { createSignaling } = require('../lib/signaling');
const { otpEmailHTML } = require('../email-templates');
const wa = require('../lib/wa');

const tmpStore = () => createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sr-')));

test('OTP: 6 digit, unik, kedaluwarsa 5 menit', () => {
  const o = createOtpService(); const codes = new Set();
  for (let i = 0; i < 30; i++) { const b = o.begin(`u${i}@x.com`); assert.match(b.code, /^\d{6}$/); codes.add(b.code); }
  assert.ok(codes.size > 25, 'kode harus acak');
  const t0 = 1_000_000;
  const b = o.begin('a@x.com', t0); o.commit('a@x.com', b.code, t0);
  assert.equal(o.verify('a@x.com', b.code, t0 + 5 * 60000 + 1).status, 410);
  const b2 = o.begin('b@x.com', t0); o.commit('b@x.com', b2.code, t0);
  assert.equal(o.verify('b@x.com', b2.code, t0 + 4 * 60000).ok, true);
});
test('OTP: maksimal 3 kali salah lalu kode hangus (kode benar pun ditolak)', () => {
  const o = createOtpService(); const t0 = 5_000_000;
  const b = o.begin('c@x.com', t0); o.commit('c@x.com', b.code, t0);
  const wrong = b.code === '000000' ? '111111' : '000000';
  assert.equal(o.verify('c@x.com', wrong, t0 + 1).left, 2);
  assert.equal(o.verify('c@x.com', wrong, t0 + 2).left, 1);
  const third = o.verify('c@x.com', wrong, t0 + 3); assert.equal(third.status, 429); assert.equal(third.code, 'locked');
  assert.equal(o.verify('c@x.com', b.code, t0 + 4).ok, false);
});
test('OTP: kode sekali pakai, cooldown, batas kirim, kunci klik ganda', () => {
  const o = createOtpService(); const t0 = 9_000_000;
  const b = o.begin('d@x.com', t0);
  assert.equal(o.begin('d@x.com', t0 + 10).ok, false, 'klik ganda saat proses kirim ditolak');
  o.commit('d@x.com', b.code, t0);
  assert.equal(o.verify('d@x.com', b.code, t0 + 1).ok, true);
  assert.equal(o.verify('d@x.com', b.code, t0 + 2).ok, false, 'tidak bisa dipakai dua kali');
  assert.equal(o.begin('d@x.com', t0 + 30_000).status, 429, 'cooldown 60 detik');
  let now = t0; for (let i = 0; i < 2; i++) { now += 61_000; const x = o.begin('d@x.com', now); assert.ok(x.ok); o.commit('d@x.com', x.code, now); }
  assert.equal(o.begin('d@x.com', now + 61_000).status, 429, 'maks 3 kirim per jendela');
});
test('normalizeWA', () => {
  assert.equal(normalizeWA('0812-7104-4597'), '6281271044597');
  assert.equal(normalizeWA('+62 812 7104 4597'), '6281271044597');
  assert.equal(normalizeWA('81271044597'), '6281271044597');
  assert.equal(normalizeWA('123'), null); assert.equal(normalizeWA(''), null);
});
test('Zona waktu: WIB UTC+7 (12:00 WIB = 05:00 UTC, bukan selisih 7 jam)', () => {
  const d = new Date('2026-11-15T05:00:00Z');
  assert.equal(wibISO(d), '2026-11-15T12:00:00+07:00');
  assert.equal(wibText(d), '15/11/2026 12:00 WIB');
  assert.equal(wibISO(new Date('2026-11-15T17:30:00Z')), '2026-11-16T00:30:00+07:00');
  assert.equal(new Date(wibISO(d)).getTime(), d.getTime());
});
test('Token: tanda tangan, kedaluwarsa, manipulasi ditolak', () => {
  const t = auth.issue({ role: 'user', sub: 'a' }, 60);
  assert.equal(auth.verify(t).sub, 'a');
  const [p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ role: 'dev', sub: 'a', exp: 9999999999 })).toString('base64url') + '.' + s;
  assert.equal(auth.verify(forged), null);
  assert.equal(auth.verify(auth.issue({ role: 'user', sub: 'a' }, -1)), null);
  assert.equal(auth.verify('x'), null); assert.equal(auth.verify(undefined), null);
});
test('Password di-hash scrypt', () => {
  const h = auth.hashPassword('rahasia123'); assert.ok(!h.includes('rahasia123'));
  assert.equal(auth.checkPassword('rahasia123', h), true); assert.equal(auth.checkPassword('salah', h), false);
});
test('Rate limiter memblokir setelah batas', () => {
  const l = createLimiter({ windowMs: 1000, max: 2, name: 't' }); const hit = () => { let st = 200; l({ headers: { 'x-forwarded-for': '1.1.1.1' } }, { status(c) { st = c; return { json() {} }; }, setHeader() {} }, () => {}); return st; };
  assert.equal(hit(), 200); assert.equal(hit(), 200); assert.equal(hit(), 429);
});
test('Pencarian username: tidak sensitif huruf besar/kecil + spasi dipangkas', () => {
  const a = createAccounts(tmpStore());
  for (const u of ['SatriaReal', 'budi_01', 'Ani.Wati']) assert.ok(a.create({ username: u, email: u + '@x.com', wa: '62812' + Math.floor(Math.random() * 1e8), password: 'secret1' }).ok);
  assert.deepEqual(a.search('  SATRIA  ').map((x) => x.username), ['SatriaReal']);
  assert.deepEqual(a.search('@ani').map((x) => x.username), ['Ani.Wati']);
  assert.equal(a.search('').length, 3);
  assert.equal(a.search('satria', 20, 'satriareal').length, 0, 'tidak menampilkan diri sendiri');
  assert.equal(a.create({ username: 'SATRIAREAL', email: 'z@x.com', wa: '628100000001', password: 'secret1' }).status, 409, 'username unik tanpa peduli huruf besar');
  assert.equal(a.create({ username: "a'b", email: 'q@x.com', wa: '628100000002', password: 'secret1' }).ok, false, 'karakter berbahaya ditolak');
  assert.equal(a.create({ username: 'Yuki', email: 'y@x.com', wa: '628100000003', password: 'secret1' }).ok, false);
  assert.ok(a.verifyLogin('BUDI_01', 'secret1')); assert.ok(a.verifyLogin('budi_01@x.com', 'secret1')); assert.equal(a.verifyLogin('budi_01', 'x'), null);
});
test('Template email: tidak ada injeksi HTML, tidak ada kuning', () => {
  const h = otpEmailHTML({ code: '123456', email: '<img src=x onerror=1>@a.com', expiryMin: 5 });
  assert.ok(!h.includes('<img src=x')); assert.ok(h.includes('&lt;img'));
  assert.ok(!/#(ffda79|facc15|fde047|fbbf24|ffd700|ffe066)/i.test(h));
});
test('Gateway WhatsApp generic: kirim JSON + Bearer, error ditangkap', async () => {
  let seen = null;
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { seen = { h: req.headers, b: JSON.parse(b) }; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.url === '/fail' ? { status: false, reason: 'device offline' } : { status: true })); }); });
  await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;
  process.env.WA_PROVIDER = 'generic'; process.env.WA_GATEWAY_TOKEN = 'tok'; process.env.WA_GATEWAY_URL = `http://127.0.0.1:${port}/send`;
  await wa.sendWA('6281271044597', wa.otpWAText('123456', 5));
  assert.equal(seen.h.authorization, 'Bearer tok'); assert.equal(seen.b.to, '6281271044597'); assert.ok(seen.b.message.includes('123456'));
  process.env.WA_GATEWAY_URL = `http://127.0.0.1:${port}/fail`;
  await assert.rejects(() => wa.sendWA('6281271044597', 'x'), /device offline/);
  srv.close(); delete process.env.WA_PROVIDER; delete process.env.WA_GATEWAY_TOKEN; delete process.env.WA_GATEWAY_URL;
});
test('Signaling VC: panggil -> jawab -> ICE -> akhiri, identitas tidak bisa dipalsukan', () => {
  const log = []; const emitTo = (id, ev, p) => log.push([id, ev, p]);
  const s = createSignaling({ emitTo, broadcastFrom: (id, ev, p) => log.push(['*', ev, p]) });
  s.connect('s1', 'Budi'); s.connect('s2', 'Ani');
  s.handle('s1', 'call-user', { to: 'ANI', signal: { sdp: 'offer' }, type: 'video' });
  assert.deepEqual(log.pop(), ['s2', 'incoming-call', { from: 'Budi', signal: { sdp: 'offer' }, type: 'video' }]);
  s.handle('s2', 'answer-call', { signal: { sdp: 'ans' } });
  assert.deepEqual(log.pop(), ['s1', 'call-answered', { sdp: 'ans' }]);
  s.handle('s1', 'ice-candidate', { candidate: { c: 1 } }); assert.deepEqual(log.pop(), ['s2', 'ice-candidate', { c: 1 }]);
  s.handle('s2', 'ice-candidate', { candidate: { c: 2 } }); assert.deepEqual(log.pop(), ['s1', 'ice-candidate', { c: 2 }]);
  s.handle('s1', 'call-ended', {}); assert.deepEqual(log.pop(), ['s2', 'call-ended', {}]);
  s.handle('s1', 'chat-message', { roomId: 'ani', from: 'Admin', text: 'hi', time: 1 });
  assert.equal(log.pop()[2].from, 'Budi', 'from dipaksa dari token');
  s.handle('s1', 'call-user', { to: 'tidakada', signal: {} }); assert.ok(log.some((l) => l[1] === 'call-unavailable'));
  s.connect('s3', 'Cici'); s.handle('s3', 'status-reply', { owner: 'budi', text: 'x' }); assert.equal(log.pop()[0], 's1');
});
