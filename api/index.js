// Vercel Serverless Function entry point.
process.env.START_SERVER = '0';
process.env.VERCEL = process.env.VERCEL || '1';

let app;
try {
  app = require('../server.js').app;
} catch (e) {
  console.error('[boot]', e);
  module.exports = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, msg: 'Boot gagal', detail: String(e && e.message) }));
  };
  return;
}

module.exports = (req, res) => {
  try {
    // Normalize empty path so Express always sees a routable URL.
    if (!req.url || req.url === '') req.url = '/';
    return app(req, res);
  } catch (e) {
    console.error('[handler]', e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, msg: String(e && e.message) }));
    }
  }
};
