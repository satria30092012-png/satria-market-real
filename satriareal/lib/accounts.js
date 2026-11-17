'use strict';
// Registri akun sisi server (agar login bisa lintas HP). Penyimpanan JSON via adapter yang disuntik.
const { hashPassword, checkPassword } = require('./auth');

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const RESERVED = new Set(['yuki', 'admin', 'developer', 'system']);
const norm = (s) => String(s || '').trim().toLowerCase();

function createAccounts(store) {
  const load = () => store.read('accounts.json', {});
  const save = (d) => store.write('accounts.json', d);
  const pub = (a) => ({ username: a.username, avatar: a.avatar || null, joinedAt: a.joinedAt });

  return {
    USERNAME_RE,
    findByLogin(idRaw) {
      const id = norm(idRaw); if (!id) return null;
      const all = load();
      if (all[id]) return all[id];
      return Object.values(all).find((a) => a.email === id) || null;
    },
    create({ username, email, wa, password, devUsername }) {
      const name = String(username || '').trim();
      if (!USERNAME_RE.test(name)) return { ok: false, status: 400, msg: 'Username 3-20 karakter: huruf, angka, titik, strip, underscore' };
      const key = norm(name);
      if (RESERVED.has(key) || [].concat(devUsername || []).some((d) => d && norm(d) === key)) return { ok: false, status: 409, msg: 'Username itu tidak tersedia' };
      if (String(password || '').length < 6) return { ok: false, status: 400, msg: 'Password minimal 6 karakter' };
      const all = load();
      if (all[key]) return { ok: false, status: 409, msg: 'Username sudah dipakai' };
      const em = norm(email);
      if (Object.values(all).some((a) => a.email === em)) return { ok: false, status: 409, msg: 'Email sudah terdaftar' };
      if (Object.values(all).some((a) => a.wa === wa)) return { ok: false, status: 409, msg: 'Nomor WhatsApp sudah terdaftar' };
      all[key] = { username: name, email: em, wa, pass: hashPassword(password), avatar: null, joinedAt: new Date().toISOString() };
      save(all);
      return { ok: true, account: all[key] };
    },
    verifyLogin(idRaw, password) {
      const a = this.findByLogin(idRaw);
      // hitung hash palsu bila akun tidak ada agar waktu respons tidak membocorkan keberadaan akun
      if (!a) { checkPassword(password, 's1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'); return null; }
      return checkPassword(password, a.pass) ? a : null;
    },
    // Pencarian username: tidak sensitif huruf besar/kecil, spasi pinggir dipangkas (setara ILIKE '%q%')
    search(qRaw, limit = 20, exceptName = '') {
      const q = norm(qRaw).replace(/^@/, '');
      const ex = norm(exceptName);
      const all = Object.entries(load());
      const hits = all.filter(([k]) => k !== ex && (!q || k.includes(q)));
      hits.sort((a, b) => (a[0].startsWith(q) ? 0 : 1) - (b[0].startsWith(q) ? 0 : 1) || a[0].localeCompare(b[0]));
      return hits.slice(0, limit).map(([, a]) => pub(a));
    },
    setPassword(usernameRaw, oldPw, newPw) {
      const all = load(), a = all[norm(usernameRaw)];
      if (!a) return { ok: false, status: 404, msg: 'Akun tidak ditemukan' };
      if (!checkPassword(oldPw, a.pass)) return { ok: false, status: 401, msg: 'Password lama salah' };
      if (String(newPw || '').length < 6) return { ok: false, status: 400, msg: 'Password baru minimal 6 karakter' };
      a.pass = hashPassword(newPw); save(all);
      return { ok: true };
    },
    get(usernameRaw) { const a = load()[norm(usernameRaw)]; return a ? pub(a) : null; },
    setAvatar(usernameRaw, avatar) { const all = load(), k = norm(usernameRaw); if (!all[k]) return false; all[k].avatar = avatar; save(all); return true; },
    pub
  };
}
module.exports = { createAccounts, USERNAME_RE, norm };
