const auth = require('../lib/auth');
const SYSTEM_PROMPT =
  "Kamu adalah Yuki (❄️), asisten AI di SatriaReal Market. Ramah, cerdas, tenang, efisien. " +
  "Panggil user 'kamu' (netral). Bahasa Indonesia santai, ganti ke English kalau user pakai English. " +
  "Emoji maksimal 1-2 per balasan. Jawab langsung ke poin, tidak bertele-tele. " +
  "Bisa bantu: tanya produk & harga, cara order, cek voucher, hitung total, tulis caption, translate, koding, ringkas teks, jelaskan konsep. " +
  "Kalau tidak tahu, bilang tidak tahu. Kalau ditanya di luar konteks toko, tetap bantu dengan sopan. " +
  "Jangan pernah mengaku manusia. Tolak dengan halus permintaan ilegal atau berbahaya.";

const hits = new Map();
function clientIp(req) {
  return String((req.headers && req.headers['x-forwarded-for']) || (req.socket && req.socket.remoteAddress) || 'x').split(',')[0].trim();
}
function send(res, code, obj) {
  if (typeof res.status === 'function') return res.status(code).json(obj);
  res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function mockReply(msg) {
  const m = msg.toLowerCase();
  if (/\b(halo|hai|hi|hello|pagi|siang|malam)\b/.test(m)) return 'Halo! Aku Yuki ❄️. Mau tanya produk, harga, atau cara order?';
  if (/(produk|katalog|jual|tersedia)/.test(m)) return 'Semua produk ada di menu Katalog. Buka Katalog, pilih produk, lalu tekan Order ya ❄️';
  if (/(harga|biaya|berapa)/.test(m)) return 'Harga tiap produk tertera di kartu produk di Katalog, tergantung paket yang kamu pilih.';
  if (/(order|pesan|beli|cara)/.test(m)) return 'Cara order: pilih produk, pilih paket, isi form, terapkan voucher kalau ada, bayar via QRIS, lalu konfirmasi.';
  if (/(voucher|diskon|promo)/.test(m)) return 'Voucher aktif tampil di Beranda dan halaman Promo. Masukkan kodenya di form order ya 🎟️';
  return 'Aku sedang di mode sederhana (AI belum dihubungkan), jadi jawabanku terbatas. Coba tanya soal produk, harga, order, atau voucher ❄️';
}
async function callProvider(url, key, model, messages) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages, max_tokens: 500, temperature: 0.7 })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!text) throw new Error('empty');
    return String(text).trim();
  } finally { clearTimeout(t); }
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method !== 'POST') return send(res, 405, { ok: false, msg: 'Method not allowed' });
    const sess = auth.fromReq(req);
    if (!sess || (sess.role !== 'user' && sess.role !== 'dev')) return send(res, 401, { ok: false, msg: 'Login dulu untuk chat dengan Yuki' });
    const body = await readBody(req);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return send(res, 400, { ok: false, msg: 'Pesan kosong' });
    if (message.length > 1000) return send(res, 400, { ok: false, msg: 'Pesan max 1000 karakter' });

    const ip = String(sess.sub || clientIp(req)), now = Date.now();
    if (hits.size > 500) hits.clear();
    if (now - (hits.get(ip) || 0) < 2000) return send(res, 429, { ok: false, msg: 'Pelan-pelan ya, tunggu 2 detik ❄️' });
    hits.set(ip, now);

    const history = (Array.isArray(body.history) ? body.history : []).slice(-10)
      .filter((h) => h && typeof h.content === 'string' && (h.role === 'user' || h.role === 'assistant'))
      .map((h) => ({ role: h.role, content: h.content.slice(0, 1000) }));
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: message }];

    const providers = [];
    if (process.env.OPENAI_API_KEY) providers.push(['https://api.openai.com/v1/chat/completions', process.env.OPENAI_API_KEY, 'gpt-4o-mini']);
    if (process.env.GROQ_API_KEY) providers.push(['https://api.groq.com/openai/v1/chat/completions', process.env.GROQ_API_KEY, 'llama-3.3-70b-versatile']);
    if (process.env.DEEPSEEK_API_KEY) providers.push(['https://api.deepseek.com/chat/completions', process.env.DEEPSEEK_API_KEY, 'deepseek-chat']);

    for (const [url, key, model] of providers) {
      try { return send(res, 200, { ok: true, reply: await callProvider(url, key, model, messages) }); }
      catch (e) { console.error('[yuki]', model, e && e.message); }
    }
    return send(res, 200, { ok: true, reply: mockReply(message), mock: true });
  } catch (e) {
    console.error('[yuki] fatal', e);
    return send(res, 200, { ok: true, reply: mockReply(''), mock: true });
  }
};