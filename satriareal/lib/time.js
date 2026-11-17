'use strict';
// Semua waktu aplikasi distandarkan ke WIB (Asia/Jakarta, UTC+7).
const TZ = 'Asia/Jakarta';
function wibParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = {}; for (const p of f.formatToParts(d)) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}
// ISO-8601 dengan offset +07:00 (bukan UTC "Z")
function wibISO(d = new Date()) {
  const o = wibParts(d);
  return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}+07:00`;
}
function wibText(d = new Date()) {
  const o = wibParts(d);
  return `${o.day}/${o.month}/${o.year} ${o.hour}:${o.minute} WIB`;
}
module.exports = { TZ, wibISO, wibText, wibParts };
