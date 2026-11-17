'use strict';
// Pengirim WhatsApp lewat gateway HTTP. Tanpa dependency (pakai fetch bawaan Node >= 18).
// WA_PROVIDER=fonnte  -> POST https://api.fonnte.com/send (header Authorization: <token>)
// WA_PROVIDER=generic -> POST WA_GATEWAY_URL  JSON {to, message}  (header Authorization: Bearer <token>)
function waConfigured() {
  const p = process.env.WA_PROVIDER || (process.env.WA_GATEWAY_URL ? 'generic' : '');
  if (p === 'fonnte') return !!process.env.WA_GATEWAY_TOKEN;
  if (p === 'generic') return !!(process.env.WA_GATEWAY_URL && process.env.WA_GATEWAY_TOKEN);
  return false;
}
async function postJson(url, headers, body, timeoutMs = 8000, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (j && (j.status === false || j.success === false || j.ok === false)) throw new Error(String(j.reason || j.message || j.msg || 'ditolak gateway').slice(0, 120));
    return j;
  } finally { clearTimeout(t); }
}
async function sendWA(to, message, fetchImpl = fetch) {
  if (!waConfigured()) throw new Error('Gateway WhatsApp belum dikonfigurasi');
  const p = process.env.WA_PROVIDER || 'generic';
  if (p === 'fonnte') return postJson('https://api.fonnte.com/send', { Authorization: process.env.WA_GATEWAY_TOKEN }, { target: to, message, countryCode: '62' }, 8000, fetchImpl);
  return postJson(process.env.WA_GATEWAY_URL, { Authorization: 'Bearer ' + process.env.WA_GATEWAY_TOKEN }, { to, message }, 8000, fetchImpl);
}
const otpWAText = (code, minutes) =>
  `*SATRIA REAL*\nKode verifikasi kamu: *${code}*\nBerlaku ${minutes} menit.\nJangan bagikan kode ini ke siapa pun, termasuk yang mengaku admin.`;

module.exports = { sendWA, waConfigured, otpWAText };
