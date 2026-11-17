# SatriaReal Market v3.0.0

Marketplace + chat realtime + panggilan (VC) + status kamera + order QRIS + panel developer + Yuki AI.
Jalan di Node.js >= 18 (VPS / Render / Termux). Semua waktu distandarkan ke **WIB (Asia/Jakarta, UTC+7)**.

## Jalankan
```bash
npm install
cp .env.example .env      # isi JWT_SECRET, SMTP_*, DEV_*, WA_* (lihat komentar di file)
npm start                 # http://localhost:3000
```
Kamera, mikrofon, dan VC butuh HTTPS (Caddy `reverse_proxy localhost:3000` atau `cloudflared tunnel`).
Agar hidup terus: `pm2 start server.js --name satriareal && pm2 save`.

## Alur keamanan
- **Daftar**: isi form, tekan *Verifikasi* -> satu kode 6 digit dikirim bersamaan ke Gmail (Nodemailer) dan WhatsApp
  -> masukkan kode -> server memberi bukti OTP -> baru bisa daftar. Tanpa bukti OTP, server menolak (401).
- OTP: kedaluwarsa 5 menit, maksimal 3 kali salah (lalu hangus), jeda kirim ulang 60 detik, maksimal 3 kirim per 10 menit per email,
  batas per IP. Kode disimpan sebagai hash dan tidak pernah dikirim ke browser.
- Password di-hash (scrypt). Sesi = token bertanda tangan (7 hari). Login developer 2 jam, dibatasi 5 percobaan / 15 menit.
- Rahasia **tidak** lagi ditanam di HTML atau `/api/config`. Socket.IO wajib token; nama pengirim diambil dari token.
- Ban dicek di server saat login. Endpoint ban/bot/daftar-pesanan khusus developer.

## OTP WhatsApp
Perlu gateway. Set `WA_PROVIDER=fonnte` + `WA_GATEWAY_TOKEN`, atau `WA_PROVIDER=generic` + `WA_GATEWAY_URL` + `WA_GATEWAY_TOKEN`
(endpoint menerima POST JSON `{to, message}` dengan header `Authorization: Bearer <token>`).
Tanpa gateway, OTP hanya lewat email (UI menyesuaikan teks otomatis).

## Tes
```bash
npm test          # 21 tes: OTP, rute, pencarian, ban, VC signaling, WIB, gateway WA
npm run test:e2e  # Chromium headless: daftar via UI, cari user, order+jam WIB, QR (butuh playwright)
```

## Catatan penyimpanan
Data akun/order disimpan di `data/*.json` (butuh disk yang bisa ditulis). OTP dan rate limit ada di memori proses,
jadi jalankan **satu instance Node yang terus hidup** (VPS/Render). Di Vercel serverless OTP tidak andal tanpa Redis/DB bersama.
