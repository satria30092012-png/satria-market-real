'use strict';
// Relay realtime: chat, status, dan sinyal WebRTC (VC). Murni logika; transport disuntik agar bisa diuji.
// Identitas pengirim SELALU dari token sesi (meta.user), tidak pernah dari data klien.
function createSignaling({ emitTo, broadcastFrom }) {
  const online = new Map();   // key(lowercase) -> Set(socketId)
  const meta = new Map();     // socketId -> { user, key, peer, rate }
  const pending = new Map();  // calleeKey -> callerSocketId (panggilan belum dijawab)

  const socketsOf = (key) => [...(online.get(String(key || '').toLowerCase()) || [])];
  const allow = (m) => { const now = Date.now(); if (now - m.rate.t > 10000) { m.rate.t = now; m.rate.n = 0; } return ++m.rate.n <= 60; };
  const isObj = (d) => d && typeof d === 'object' && !Array.isArray(d);

  function connect(id, user) {
    const key = String(user).toLowerCase();
    meta.set(id, { user, key, peer: null, rate: { t: Date.now(), n: 0 } });
    if (!online.has(key)) online.set(key, new Set());
    online.get(key).add(id);
  }
  function endFor(id) {
    const m = meta.get(id); if (!m) return;
    if (m.peer) { emitTo(m.peer, 'call-ended', {}); const pm = meta.get(m.peer); if (pm) pm.peer = null; m.peer = null; }
    for (const [callee, caller] of pending) if (caller === id || callee === m.key) {
      if (caller === id) for (const s of socketsOf(callee)) emitTo(s, 'call-ended', {});
      else emitTo(caller, 'call-ended', {});
      pending.delete(callee);
    }
  }
  function disconnect(id) {
    const m = meta.get(id); if (!m) return;
    endFor(id);
    const set = online.get(m.key); if (set) { set.delete(id); if (!set.size) online.delete(m.key); }
    meta.delete(id);
  }

  function handle(id, ev, d) {
    const m = meta.get(id); if (!m || !allow(m)) return false;
    switch (ev) {
      case 'chat-message': {
        if (!isObj(d) || !d.roomId) return false;
        const p = { ...d, from: m.user };
        if (String(d.roomId).toLowerCase() === 'global') broadcastFrom(id, 'chat-message', p);
        else for (const s of socketsOf(d.roomId)) emitTo(s, 'chat-message', p);
        return true;
      }
      case 'new-status': if (!isObj(d)) return false; broadcastFrom(id, 'new-status', d); return true;
      case 'status-reply': {
        if (!isObj(d) || !d.owner) return false;
        for (const s of socketsOf(d.owner)) emitTo(s, 'status-reply', { ...d, from: m.user });
        return true;
      }
      case 'call-user': {
        if (!isObj(d) || !d.to || !d.signal) return false;
        const targets = socketsOf(d.to);
        if (!targets.length || String(d.to).toLowerCase() === m.key) { emitTo(id, 'call-ended', {}); emitTo(id, 'call-unavailable', { to: d.to }); return false; }
        pending.set(String(d.to).toLowerCase(), id);
        for (const s of targets) emitTo(s, 'incoming-call', { from: m.user, signal: d.signal, type: d.type });
        return true;
      }
      case 'global-call-user': {
        if (!isObj(d) || !d.signal) return false;
        broadcastFrom(id, 'global-incoming-call', { from: m.user, signal: d.signal, type: d.type });
        return true;
      }
      case 'answer-call': {
        const caller = pending.get(m.key);
        if (!caller || !isObj(d) || !d.signal) return false;
        pending.delete(m.key);
        m.peer = caller; const cm = meta.get(caller); if (cm) cm.peer = id;
        emitTo(caller, 'call-answered', d.signal); // klien mengharapkan objek SDP langsung
        return true;
      }
      case 'ice-candidate': {
        if (!isObj(d) || !d.candidate) return false;
        let to = m.peer;
        if (!to) { // penelepon belum dijawab: kirim ke penerima yang dipanggil
          for (const [callee, caller] of pending) if (caller === id) { for (const s of socketsOf(callee)) emitTo(s, 'ice-candidate', d.candidate); return true; }
          return false;
        }
        emitTo(to, 'ice-candidate', d.candidate); // klien mengharapkan kandidat langsung
        return true;
      }
      case 'call-ended': endFor(id); return true;
      default: return false;
    }
  }
  return { connect, disconnect, handle, _online: online, _pending: pending };
}
module.exports = { createSignaling };
