'use strict';
// Mesin OTP: satu kode unik 6 digit untuk dikirim ke Email + WhatsApp sekaligus.
const crypto = require('crypto');

const OTP_LEN = 6;                                   // dikunci 6 digit sesuai spesifikasi
const TTL_MS = 5 * 60 * 1000;                        // kedaluwarsa 5 menit
const MAX_TRIES = 3;                                 // maksimal 3 kali salah
const COOLDOWN_MS = (Number(process.env.OTP_COOLDOWN_SEC) || 60) * 1000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_SENDS = 3;                                 // maks kirim per email per jendela

function createOtpService() {
  const store = new Map(); // email -> record
  const hash = (email, code) => crypto.createHmac('sha256', email).update(String(code)).digest('hex');

  function sweep(now) {
    for (const [k, r] of store) if (now - r.firstAt > WINDOW_MS && (!r.hash || r.expires < now)) store.delete(k);
  }
  function generate() {
    let c = '';
    for (let i = 0; i < OTP_LEN; i++) c += crypto.randomInt(0, 10);
    return c;
  }

  // Tahap 1: cek batas + kunci slot (mencegah klik ganda lolos bersamaan)
  function begin(email, now = Date.now()) {
    sweep(now);
    let r = store.get(email);
    if (r && now - r.firstAt > WINDOW_MS) r = null;
    if (r && r.pending && now - r.pending < 15000) return { ok: false, status: 429, msg: 'Permintaan sebelumnya masih diproses', retryAfter: 5 };
    if (r) {
      const wait = Math.ceil((r.lastAt + COOLDOWN_MS - now) / 1000);
      if (wait > 0) return { ok: false, status: 429, msg: `Tunggu ${wait} detik`, retryAfter: wait };
      if (r.sentCount >= MAX_SENDS) return { ok: false, status: 429, msg: 'Terlalu sering meminta kode, coba lagi nanti', retryAfter: Math.ceil((r.firstAt + WINDOW_MS - now) / 1000) };
    }
    const cur = r || { firstAt: now, lastAt: 0, sentCount: 0, hash: null, expires: 0, tries: 0 };
    cur.pending = now;
    store.set(email, cur);
    return { ok: true, code: generate() };
  }
  // Tahap 2: dipanggil setelah pengiriman berhasil
  function commit(email, code, now = Date.now(), meta = null) {
    const r = store.get(email); if (!r) return;
    r.hash = hash(email, code); r.expires = now + TTL_MS; r.tries = 0; r.meta = meta;
    r.sentCount += 1; r.lastAt = now; r.pending = 0;
  }
  // Pengiriman gagal: lepas kunci tanpa menghitung sebagai kirim
  function abort(email) {
    const r = store.get(email); if (!r) return;
    r.pending = 0;
    if (!r.hash && r.sentCount === 0) store.delete(email);
  }
  function verify(email, code, now = Date.now()) {
    const r = store.get(email);
    if (!r || !r.hash) return { ok: false, status: 404, msg: 'Kode tidak ditemukan, kirim ulang kode' };
    if (r.expires < now) { r.hash = null; return { ok: false, status: 410, msg: 'Kode kedaluwarsa, kirim ulang kode' }; }
    if (!/^\d{6}$/.test(String(code))) return { ok: false, status: 400, msg: 'Kode harus 6 digit angka' };
    r.tries += 1;
    const a = Buffer.from(hash(email, code)), b = Buffer.from(r.hash);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) { const meta = r.meta; r.hash = null; r.expires = 0; r.meta = null; return { ok: true, meta }; }
    const left = MAX_TRIES - r.tries;
    if (left <= 0) { r.hash = null; return { ok: false, status: 429, code: 'locked', msg: 'Salah 3 kali. Kode dihanguskan, kirim ulang kode baru' }; }
    return { ok: false, status: 401, msg: `Kode salah (${left}x lagi)`, left };
  }
  return { begin, commit, abort, verify, _store: store };
}

// Normalisasi nomor WhatsApp Indonesia -> 62xxxxxxxxxx (null jika tidak valid)
function normalizeWA(raw) {
  let n = String(raw || '').replace(/\D/g, '');
  if (!n) return null;
  if (n.startsWith('0')) n = '62' + n.slice(1);
  else if (n.startsWith('8')) n = '62' + n;
  return /^62\d{8,13}$/.test(n) ? n : null;
}

module.exports = { createOtpService, normalizeWA, OTP_LEN, TTL_MS, MAX_TRIES, COOLDOWN_MS };
