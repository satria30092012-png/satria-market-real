# Catatan Audit SatriaReal Market

## Temuan yang diverifikasi dari source
1. `.env.example` yang dikirim memuat nilai rahasia yang tampak nyata. File sudah
   diganti placeholder. Semua nilai lama wajib dirotasi karena sudah terpapar.
2. `apiFetch()` sebelumnya memanggil `onSessionExpired()` pada setiap HTTP 401.
   Endpoint yang menolak role member (misalnya endpoint khusus developer) juga
   mengembalikan 401, sehingga frontend dapat menghapus sesi valid. Perbaikan:
   hanya logout bila payload memiliki `code: "auth"`.
3. `lib/store.js` menggunakan file JSON lokal dan fallback memori. Di Vercel,
   `/tmp` bersifat sementara dan setiap function instance dapat memiliki memori
   berbeda. Ini tidak memenuhi penyimpanan akun/OTP/order lintas instance.
4. Belum ditemukan Firebase SDK, Firebase Admin SDK, Firestore, Realtime Database,
   atau aturan keamanan Firebase dalam proyek.
5. `server.js` memulai listener HTTP dan Socket.IO persisten. Belum ada adapter
   Vercel serverless (`vercel.json`/function handler). Socket.IO tidak akan
   berperilaku seperti server Node persisten di Vercel Functions.
6. Zoom 0.5x–10x pada kamera status mengandalkan `getCapabilities().zoom` bila
   tersedia, lalu fallback CSS transform. Zoom digital fallback dapat buram.
   Lensa 0.5x dan zoom optik bergantung hardware perangkat.
7. QRIS memakai URL eksternal dari konfigurasi publik. Kegagalan host gambar
   eksternal dapat menyebabkan QR tidak termuat; UI fallback sudah tersedia.
8. Provider AI fallback dapat menyamarkan kegagalan provider sebagai balasan
   sederhana. Log server `[yuki]` perlu diperiksa jika AI tidak memakai model.

## Tes yang dijalankan
- `node --test tests/core.test.js tests/routes.test.js`
- Hasil: 21 lulus, 0 gagal.
- Instalasi dependency penuh terhenti karena timeout; tes browser Playwright belum
  dapat dijalankan di lingkungan audit ini.
- Belum ada Firebase project credentials, SMTP, WhatsApp gateway, TURN server,
  atau domain produksi untuk menguji integrasi eksternal.

## Belum boleh diklaim selesai
Firebase migration, production Vercel architecture, persistent Socket.IO,
real-device camera zoom quality, QR provider availability, SMTP/WhatsApp delivery,
dan end-to-end call antar perangkat belum diverifikasi.
