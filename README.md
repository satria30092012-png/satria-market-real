# SatriaReal Market v2.3.0

Marketplace + chat + status camera + order QRIS + panel developer + Yuki AI.
Jalan di **VPS / Termux (Node.js >= 18)**, kode disimpan di GitHub. Tidak memakai Vercel.

## Jalankan
```bash
git clone https://github.com/USERNAME/satriareal.git
cd satriareal
npm install
cp .env.example .env     # isi SMTP, GATEWAY_SECRET, dll
npm start                # http://localhost:3000
```

Termux: `pkg install nodejs git` dulu, lalu langkah di atas.

## Agar tetap hidup
```bash
npm i -g pm2
pm2 start server.js --name satriareal
pm2 save && pm2 startup
```
Termux: `pm2 start server.js` lalu `termux-wake-lock` agar tidak dimatikan sistem.

## HTTPS (wajib untuk kamera, mic, video call)
Browser hanya mengizinkan kamera/mic di HTTPS. Pakai Caddy (`reverse_proxy localhost:3000`) atau
`cloudflared tunnel --url http://localhost:3000` untuk Termux.

## Fitur
- Cuaca di samping baterai (mock; isi `WEATHER_API_KEY` untuk OpenWeatherMap)
- Yuki AI `/api/yuki`: OpenAI, Groq, DeepSeek, lalu mock
- Ban user dan Bot pairing di Developer Panel (`/api/ban`, `/api/bot`), data tersimpan di `data/`
- Chat realtime lewat Socket.IO

## Keamanan
- Jangan commit `.env` (sudah di `.gitignore`).
- Isi `GATEWAY_SECRET` agar API ban/bot tidak terbuka untuk umum.
