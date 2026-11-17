'use strict';
// Penyimpanan JSON atomik; jatuh ke memori bila filesystem read-only (mis. Vercel).
const fs = require('fs'), path = require('path');

function resolveDir(root) {
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) return '/tmp/data';
  return process.env.DATA_DIR || path.join(root, 'data');
}
function createStore(dir) {
  const mem = {};
  let writable = true;
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); }
  catch { writable = false; console.warn('[storage] filesystem read-only, data hanya di memori (hilang saat restart)'); }
  return {
    persistent: () => writable,
    read(name, def) {
      if (name in mem) return mem[name];
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return def; }
    },
    write(name, data) {
      mem[name] = data;
      if (!writable) return;
      try {
        const tmp = path.join(dir, `${name}.tmp.${process.pid}.${Date.now()}`);
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, path.join(dir, name));
      } catch (e) { console.error('[storage] gagal tulis', name, e.message); }
    }
  };
}
module.exports = { createStore, resolveDir };
