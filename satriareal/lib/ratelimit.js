'use strict';
// Rate limiter sederhana (in-memory, sliding window per kunci). Tanpa dependency.
function clientIp(req) {
  const xf = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || (req.ip) || 'unknown';
}

function createLimiter({ windowMs, max, name = 'rate', key, message = 'Terlalu banyak permintaan, coba lagi nanti' }) {
  const hits = new Map();
  let lastSweep = Date.now();
  function sweep(now) {
    if (now - lastSweep < windowMs && hits.size < 5000) return;
    lastSweep = now;
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    if (hits.size > 20000) hits.clear(); // pagar memori
  }
  function take(k, now = Date.now()) {
    sweep(now);
    let h = hits.get(k);
    if (!h || now - h.start > windowMs) h = { start: now, n: 0 };
    h.n++; hits.set(k, h);
    return { allowed: h.n <= max, retryAfter: Math.max(1, Math.ceil((h.start + windowMs - now) / 1000)) };
  }
  function mw(req, res, next) {
    const k = name + ':' + (key ? key(req) : clientIp(req));
    const r = take(k);
    if (!r.allowed) {
      if (res.setHeader) res.setHeader('Retry-After', String(r.retryAfter));
      return res.status(429).json({ ok: false, code: 'rate', msg: message, retryAfter: r.retryAfter });
    }
    next();
  }
  mw.take = take; mw.reset = () => hits.clear();
  return mw;
}

module.exports = { createLimiter, clientIp };
