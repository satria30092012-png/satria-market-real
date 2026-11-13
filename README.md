# SatriaReal Market

Aplikasi toko + chat. **Jalankan dengan Node.js di VPS / PC** (`npm start`), bukan Vercel serverless.

## Persyaratan

- Node.js 18+ (disarankan 20+)
- Git (untuk clone dari GitHub)

## Setup cepat

```bash
git clone https://github.com/USERNAME/satriareal.git
cd satriareal
cp .env.example .env
nano .env
npm install
npm start
```

Buka: `http://localhost:3000` atau `http://IP-SERVER:3000`

## Environment (`.env`)

| Variabel | Wajib | Keterangan |
|----------|-------|------------|
| `GATEWAY_SECRET` | ya | Kunci API (otomatis di-inject ke HTML) |
| `PORT` | tidak | Default `3000` |
| `SMTP_*` | untuk OTP | Email kode verifikasi |
| `NAMA_TOKO`, `WA_ORDER`, ... | tidak | Data toko |

## Tetap hidup di VPS (PM2)

```bash
sudo npm i -g pm2
pm2 start server.js --name satriareal
pm2 save
pm2 startup
```

## Fitur

- Halaman toko dilayani Express
- API order / OTP / config
- Socket.IO chat (jalan selama proses Node hidup)

## Catatan

- Folder `data/` dibuat otomatis untuk JSON
- Jangan commit `.env` (sudah di `.gitignore`)
- Mode utama: `node server.js` / `npm start`
