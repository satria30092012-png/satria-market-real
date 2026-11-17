# SatriaReal — Status Fix & Cara Jalan 100%

## Bug yang sudah ditangani di build audited ini

| # | Laporan user | Status di kode | Yang harus kamu lakukan |
|---|--------------|----------------|-------------------------|
| 1 | Cari username tidak ketemu | Backend `accounts.search` + `/api/users/search` sudah trim + lower (ILIKE style). Frontend `cariUserApi` memakai endpoint itu. | 1) Login dulu. 2) Daftarkan minimal 1 user lain. 3) Pastikan `JWT_SECRET` fixed (bukan ephemeral). Kalau 401, search gagal. |
| 2 | QR tidak muncul | Fallback UI sudah ada. `loadConfig` tidak menimpa default dengan string kosong. | Isi `QRIS_IMAGE` di `.env` dengan URL gambar QRIS yang **publik & stabil** (https, bukan butuh login). Contoh catbox / imgur / host sendiri. |
| 3 | Jam order beda di WA (12 → 5) | Semua waktu pakai `Asia/Jakarta` + `CLOCK_OFFSET` dari `/api/config`. Pesan WA pakai `wibTime()`. | Pastikan server bisa di-hit `/api/config` (SERVER_ONLINE=true). Kalau config gagal, HP pakai jam UTC → beda 7 jam. |
| 4 | Username tidak bisa dicari untuk VC/chat | Routing search → profil → call memakai username dari hasil search / `socketsOf`. | Sama seperti #1. Target harus online (Socket.IO connect dengan token valid). |
| 5 | AI / bot masih bisa "masuk" | OTP 6 digit, 5 menit, max 3 coba, rate-limit IP + email. Register wajib proof OTP. | Isi SMTP + (opsional) WA gateway. Jangan biarkan DEV_PASSWORD lemah. |
| 6 | Typo / error UI | Banyak teks sudah dibersihkan di audit. | Laporkan string spesifik jika masih ada. |
| 7 | Setelah login beberapa menit disuruh login lagi ("sesi telah berakhir") | Frontend hanya logout jika server kirim `code: "auth"`. TTL user = 7 hari. | **WAJIB** set `JWT_SECRET` panjang & tetap di `.env`. Kalau kosong, setiap restart server membuat token lama invalid. Jangan deploy multi-instance tanpa shared secret + shared storage. |
| 8 | Camera 0.5–10 blur | Optical zoom hanya jika hardware support `getCapabilities().zoom`. Sisanya digital (CSS / crop) → bisa buram. | Normal di HP tanpa ultrawide / optical zoom. |
| 9 | Service Worker error | **Tidak ada** service worker di build ini. | Hard refresh / clear cache site. |
| 10 | Call / WebRTC | Signaling Socket.IO + STUN/TURN openrelay. | HTTPS (atau localhost). TURN private lebih baik di production (isi `TURN_*` di env). |
| 11 | API key AI sudah dimasukkan | Key **hanya** dibaca di server (`api/yuki.js`). Frontend tidak boleh punya key. | Pastikan di Environment Variables hosting / `.env`, bukan di index.html. Cek log `[yuki]`. |

## Keamanan (sudah ada)

- Semua secret hanya di env / server.
- Password: scrypt + salt.
- Token: HMAC-SHA256, expiry.
- OTP: hash di server, max 3 try, cooldown, rate limit.
- Rate limit per endpoint sensitif.
- CORS / origin bisa dikunci lewat FRONTEND_URL.

## Cara run (Termux / Ubuntu / Debian)

```bash
# Termux
pkg update -y && pkg install nodejs-lts -y
# Ubuntu/Debian
# sudo apt update && sudo apt install -y nodejs npm

cd satriareal
cp .env.example .env
# edit .env — minimal:
# JWT_SECRET=... (node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
# DEV_USERNAME=... DEV_PASSWORD=... (kuat)
# SMTP_* untuk OTP Gmail (App Password)
# QRIS_IMAGE=https://...
# GROQ_API_KEY=... atau OPENAI_ / DEEPSEEK_

npm install
npm test          # harus 21 pass
npm start         # http://0.0.0.0:3000
```

Termux: kalau mau tetap hidup di background pakai `termux-wake-lock` + `nohup npm start &` atau pm2 jika terinstall.

## Firebase + Vercel

**Belum diintegrasikan.** Alasan:

- Storage saat ini = file JSON / memori → tidak cocok multi-instance Vercel.
- Socket.IO butuh proses Node **persisten** (bukan serverless cold-start).
- OTP, session, akun harus shared across instances.

Rekomendasi production sekarang:
1. Frontend bisa di Vercel / static.
2. Backend Node di **Render / Railway / Fly.io / VPS / Termux** (satu instance dulu).
3. Nanti migrasi store + auth ke Firestore + Firebase Auth + Realtime Database untuk signaling jika ingin fully serverless.

Jangan taruh Firebase client API key di frontend untuk admin operations.

## Verifikasi cepat

```bash
curl -s http://127.0.0.1:3000/api/health
# {"ok":true,"ts":...,"wib":"...+07:00"}

# Setelah set .env dan register 1 user, login, lalu:
# Cari username dari UI chat → harus muncul.
# Order → scan QR (atau fallback) → konfirmasi WA → jam harus WIB.
```

Jika masih ada error spesifik (screenshot console / log server), kirim ulang dengan langkah reproduksi.
