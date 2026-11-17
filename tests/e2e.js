'use strict';
// Uji browser sungguhan (Chromium headless). Zona waktu perangkat sengaja UTC untuk membuktikan jam tetap WIB.
const { start } = require('./devserver');
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright')); }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const wibHM = () => { const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()).forEach((x) => p[x.type] = x.value); return +p.hour * 60 + +p.minute; };

async function newPage(browser, base, { qrisOk = true } = {}) {
  const ctx = await browser.newContext({ timezoneId: 'UTC', locale: 'id-ID', viewport: { width: 420, height: 900 } });
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.hostname === '127.0.0.1') return r.continue(); if (qrisOk && u.hostname === 'files.catbox.moe' && /\.jpg$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); return r.abort(); });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(base + '/'); await page.addStyleTag({ content: '.hidden{display:none!important}' });
  await page.waitForFunction(() => typeof window.bukaAuth === 'function'); await page.waitForTimeout(400);
  page.__errs = errs; return page;
}
const lastCode = async (base, key) => { const o = await (await fetch(base + '/__test/outbox')).json(); const t = o.wa[o.wa.length - 1]; return t && t.text.match(/\*(\d{6})\*/)[1]; };

async function registerViaUI(page, base, { username, email, wa }) {
  await page.evaluate(() => { bukaAuth(); switchAuthTab('register'); });
  await page.fill('#reg-username', username); await page.fill('#reg-wa', wa); await page.fill('#reg-email', email);
  await page.fill('#reg-password', 'rahasia12'); await page.fill('#reg-password2', 'rahasia12');
  await page.click('#form-register button:has-text("Verifikasi")');
  await page.click('#otp-btn-send'); await page.waitForSelector('#otp-step-2:not(.hidden)');
  const code = await lastCode(base);
  const domHasCode = (await page.content()).includes(code);
  const wrong = code === '000000' ? '111111' : '000000';
  await page.click('.otp-box >> nth=0'); await page.keyboard.type(wrong);
  await page.waitForFunction(() => /2x lagi/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => {});
  const sawWrong = /Kode salah \(2x lagi\)/.test(await page.evaluate(() => document.body.innerText));
  await page.waitForTimeout(900);
  await page.click('.otp-box >> nth=0'); await page.keyboard.type(code);
  await page.waitForFunction(() => !document.querySelector('#reg-verified-badge').classList.contains('hidden'), null, { timeout: 6000 });
  await page.click('#form-register button[type=submit]');
  await page.waitForFunction(() => !!localStorage.getItem('fr_token'), null, { timeout: 5000 });
  return { domHasCode, sawWrong };
}

(async () => {
  const { server, url } = await start({ env: { NAMA_TOKO: 'TOKO UJI' } });
  process.env.WA_PROVIDER = 'generic'; process.env.WA_GATEWAY_URL = 'http://x'; process.env.WA_GATEWAY_TOKEN = 't';
  const browser = await chromium.launch();
  try {
    console.log('== 1. Daftar via UI: OTP dari server, kode tidak bocor ke layar');
    const A = await newPage(browser, url);
    const r = await registerViaUI(A, url, { username: 'Satria_Test', email: 'satria@gmail.com', wa: '081271044597' });
    ok(await A.evaluate(() => new Date().getTimezoneOffset()) === 0, 'zona waktu perangkat uji = UTC (bukan WIB)');
    ok(!r.domHasCode, 'kode OTP tidak tampil di halaman (tidak ada toast kode lagi)');
    ok(r.sawWrong, 'kode salah ditolak server dengan sisa percobaan "2x lagi"');
    const st = await A.evaluate(() => ({ cu: JSON.parse(localStorage.getItem('fr_current_user') || 'null'), users: localStorage.getItem('fr_users') || '', tok: localStorage.getItem('fr_token'), authHidden: document.getElementById('auth-screen').classList.contains('hidden') }));
    ok(st.cu && st.cu.username === 'Satria_Test' && !('pass' in st.cu), 'login otomatis setelah daftar, tanpa password tersimpan di HP');
    ok(!/pass/.test(st.users), 'daftar user lokal tidak menyimpan password');
    ok(st.authHidden, 'layar login tertutup');
    const o = await (await fetch(url + '/__test/outbox')).json();
    ok(o.mail.length === 1 && o.wa.length === 1 && o.wa[0].to === '6281271044597', 'OTP terkirim ke email DAN WhatsApp (628...)');

    console.log('== 2. Daftar tanpa OTP harus gagal');
    const bypass = await fetch(url + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'BotJahat', password: 'secret12', wa: '081200000009', proof: 'palsu' }) });
    ok(bypass.status === 401, 'pendaftaran tanpa bukti OTP ditolak server (401)');

    console.log('== 3. Cari username (huruf besar/kecil + spasi) lalu mulai chat');
    for (const [n, e, w] of [['Budi_Santoso', 'budi@x.com', '081211110001']]) {
      await fetch(url + '/api/otp/send', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({ email: e, wa: w }) });
      const c = await lastCode(url); const v = await (await fetch(url + '/api/otp/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, code: c }) })).json();
      await fetch(url + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: n, password: 'secret12', wa: w, proof: v.proof }) });
    }
    await A.evaluate(() => bukaChatBaru()); await A.fill('#new-chat-username', '  BUDI ');
    await A.waitForSelector('#new-chat-user-list [data-user="Budi_Santoso"]', { timeout: 5000 }).then(() => ok(true, 'pencarian "  BUDI " menemukan Budi_Santoso'), () => ok(false, 'pencarian "  BUDI " menemukan Budi_Santoso'));
    await A.fill('#new-chat-username', 'budi_santoso'); await A.click('#modal-new-chat button[type=submit]');
    await A.waitForFunction(() => document.getElementById('modal-new-chat').classList.contains('hidden') || getComputedStyle(document.getElementById('modal-new-chat')).display === 'none', null, { timeout: 4000 }).then(() => ok(true, '"Mulai" dengan username huruf kecil membuka chat'), () => ok(false, '"Mulai" membuka chat'));

    console.log('== 4. Order: jam di pesan WA = WIB walau jam perangkat UTC');
    await A.evaluate(() => { window.__waUrl = null; window.open = (u) => { window.__waUrl = u; return null; }; bukaFormOrder('jasaban'); });
    await A.fill('#buyer-nama', 'Satria'); await A.fill('#buyer-wa', '081271044597'); await A.fill('#order-input-1', 'https://chat.whatsapp.com/abc');
    await A.click('#btn-lanjut-bayar'); await A.waitForTimeout(400); await A.click('#btn-bayar-qris'); await A.waitForTimeout(500);
    const qr = await A.evaluate(() => { const i = document.getElementById('img-qris'), f = document.getElementById('qris-fallback'); return { shown: getComputedStyle(i).display !== 'none', w: i.naturalWidth, fb: getComputedStyle(f).display !== 'none', src: i.src }; });
    ok(qr.shown && qr.w > 0 && !qr.fb, 'QR/QRIS tampil (default tidak tertimpa string kosong dari server): ' + qr.src.slice(0, 40));
    await A.click('#btn-konfirmasi-wa'); await A.waitForTimeout(500);
    const url2 = await A.evaluate(() => window.__waUrl); const txt = decodeURIComponent(String(url2 || '').split('text=')[1] || '');
    const m = txt.match(/waktu\s*:\s*\*(\d{2}):(\d{2}) WIB\*/);
    ok(!!m, 'pesan WA berisi baris waktu WIB'); if (m) { const d = Math.abs((+m[1] * 60 + +m[2]) - wibHM()); ok(d <= 1 || d >= 1439, `jam di WA ${m[1]}:${m[2]} cocok dengan WIB sekarang (selisih ${d} menit; perangkat UTC)`); }
    await A.waitForTimeout(500);
    const ord = await (await fetch(url + '/api/orders', { headers: { authorization: 'Bearer ' + await A.evaluate(() => localStorage.getItem('fr_token')) } })).status;
    ok(ord === 401, 'daftar semua pesanan tertutup untuk member biasa');

    console.log('== 5. QR gagal dimuat -> fallback jelas, bukan kotak kosong');
    const B = await newPage(browser, url, { qrisOk: false });
    await B.evaluate(() => { bukaAuth(); });
    const tok = (await (await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'satria_test', password: 'rahasia12' }) })).json());
    await B.evaluate((d) => { localStorage.setItem('fr_token', d.token); localStorage.setItem('fr_current_user', JSON.stringify(d.user)); }, tok);
    await B.reload(); await B.addStyleTag({ content: '.hidden{display:none!important}' }); await B.waitForFunction(() => typeof window.bukaFormOrder === 'function'); await B.waitForTimeout(400);
    await B.evaluate(() => bukaFormOrder('jasaban')); await B.fill('#buyer-nama', 'S'); await B.fill('#buyer-wa', '081271044597'); await B.fill('#order-input-1', 'https://chat.whatsapp.com/abc');
    await B.click('#btn-lanjut-bayar'); await B.waitForTimeout(400); await B.click('#btn-bayar-qris'); await B.waitForTimeout(800);
    const fb = await B.evaluate(() => ({ img: getComputedStyle(document.getElementById('img-qris')).display, fb: getComputedStyle(document.getElementById('qris-fallback')).display }));
    ok(fb.img === 'none' && fb.fb !== 'none', 'saat gambar QR gagal dimuat, pesan fallback ditampilkan');
    ok(B.__errs.length === 0, 'tidak ada error JS di sesi login tersimpan ' + JSON.stringify(B.__errs));

    ok(A.__errs.length === 0, 'tidak ada error JS/console di seluruh alur ' + JSON.stringify(A.__errs));
  } catch (e) { fail++; console.log('  FAIL (exception)', e.message); }
  await browser.close(); server.close();
  console.log(`\nHASIL E2E: ${pass} lulus, ${fail} gagal`); process.exit(fail ? 1 : 0);
})();
