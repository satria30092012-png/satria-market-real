const BRAND = { 
  name: 'SATRIA REAL', 
  tagline: 'MARKET & ARCADE', 
  wa: '6281271044597', 
  year: new Date().getFullYear() 
};

const esc = (v) => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function otpEmailHTML({ code, email, expiryMin = 5, name = 'Kak' }) {
  email = esc(email); name = esc(name);
  const digits = String(code).replace(/\D/g, '').split('');
  const digitCells = digits.map((d, i) => `
    <td align="center" valign="middle" class="digit"
        style="width:48px;height:60px;background:#ffffff;
               border:3px solid #1c1926;border-radius:14px;
               font-family:'Courier New',Consolas,monospace;
               font-size:30px;font-weight:900;color:#1c1926;
               box-shadow:3px 3px 0 #1c1926;padding:0;
               text-align:center;line-height:60px;">
      ${d}
    </td>${i < digits.length - 1 ? '<td style="width:6px;"></td>' : ''}
  `).join('');

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Verifikasi Email SatriaReal</title>
<style>
  @media (max-width:600px){
    .container{max-width:100%!important}
    .hero{padding:32px 20px 26px!important}
    .hero-title{font-size:24px!important}
    .body-pad{padding:30px 20px!important}
    .digit{width:42px!important;height:54px!important;font-size:24px!important;line-height:54px!important}
  }
  @media (prefers-color-scheme:dark){
    .body-bg{background:#0a0812!important}
    .card{background:#1a1826!important;border-color:#fff!important}
    .text-ink{color:#fff!important}
    .text-muted{color:#b0aabd!important}
    .info-bar{background:#252233!important;border-color:#fff!important}
    .digit{background:#252233!important;color:#fff!important;border-color:#fff!important}
    .hero{background:#4c1d95!important}
  }
</style>
</head>
<body class="body-bg" style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<div style="display:none;font-size:1px;color:#f0f2f5;opacity:0;max-height:0;overflow:hidden;">
  Kode verifikasi kamu sudah siap. Berlaku ${expiryMin} menit.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="body-bg" style="background:#f0f2f5;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" class="container card" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border:3px solid #1c1926;border-radius:26px;box-shadow:8px 8px 0 #1c1926;overflow:hidden;">
      <tr>
        <td class="hero" align="center" style="background:#1e1b4b;border-bottom:3px solid #1c1926;padding:40px 24px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
            <tr><td align="center" valign="middle" style="width:72px;height:72px;background:#fff;border-radius:20px;font-size:36px;line-height:72px;">🔐</td></tr>
          </table>
          <h1 class="hero-title" style="margin:18px 0 6px;font-size:28px;font-weight:900;color:#fff;">${BRAND.name}</h1>
          <p style="margin:0;font-size:11px;font-weight:900;color:#fff;letter-spacing:4px;text-transform:uppercase;opacity:0.7;">Verifikasi Email</p>
        </td>
      </tr>
      <tr>
        <td class="body-pad" style="padding:36px 32px 28px;">
          <p class="text-ink" style="margin:0 0 10px;font-size:18px;font-weight:800;color:#1c1926;">Halo ${name}! 👋</p>
          <p class="text-muted" style="margin:0 0 28px;font-size:14px;line-height:1.65;color:#6b6375;">
            Kami menerima permintaan untuk <strong style="color:#1c1926;">memverifikasi email</strong> kamu di SatriaReal. Gunakan kode di bawah ini.
          </p>
          <p class="text-muted" style="margin:0 0 14px;font-size:11px;font-weight:900;color:#6b6375;letter-spacing:2px;text-transform:uppercase;text-align:center;">✦ Kode Verifikasi ✦</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="padding:0 0 26px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>${digitCells}</tr></table>
            </td></tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="info-bar" style="background:#f8f7fb;border:2px solid #1c1926;border-radius:16px;margin-bottom:22px;">
            <tr><td style="padding:16px 20px;">
              <table role="presentation" width="100%">
                <tr><td style="padding:5px 0;font-size:13px;color:#1c1926;font-weight:700;">⏱️ &nbsp;Berlaku <strong>${expiryMin} menit</strong></td></tr>
                <tr><td style="padding:5px 0;font-size:13px;color:#6b6375;font-weight:600;word-break:break-all;">📧 &nbsp;${email}</td></tr>
                <tr><td style="padding:5px 0;font-size:13px;color:#6b6375;font-weight:600;">🔢 &nbsp;${digits.length} digit kode</td></tr>
              </table>
            </td></tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffe3e3;border:2px solid #ef4444;border-radius:16px;margin-bottom:22px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 6px;font-size:13px;font-weight:900;color:#b91c1c;">⚠️ PENTING — Baca dulu!</p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#b91c1c;font-weight:600;"><strong>Jangan bagikan kode ini</strong> ke siapa pun, termasuk yang mengaku admin SatriaReal. Kami <u>tidak akan pernah</u> meminta kode OTP kamu.</p>
            </td></tr>
          </table>
          <p class="text-muted" style="margin:0;font-size:12px;line-height:1.6;color:#9a94a8;"><strong style="color:#6b6375;">Tidak merasa melakukan ini?</strong> Abaikan email ini.</p>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:26px 32px 30px;background:#f8f7fb;border-top:2px solid #f0f2f5;">
          <p class="text-ink" style="margin:0 0 14px;font-size:13px;font-weight:800;color:#1c1926;">Butuh bantuan?</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 0 18px;">
            <tr><td align="center" style="background:#25D366;border:3px solid #1c1926;border-radius:12px;box-shadow:3px 3px 0 #1c1926;">
              <a href="https://wa.me/${BRAND.wa}?text=Halo%20admin" target="_blank" style="display:inline-block;padding:12px 28px;font-size:13px;font-weight:900;color:#fff;text-decoration:none;">💬 &nbsp; CHAT ADMIN</a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:11px;color:#9a94a8;">© ${BRAND.year} ${BRAND.name} — ${BRAND.tagline}<br>Email otomatis. Jangan dibalas.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

module.exports = { otpEmailHTML, BRAND };