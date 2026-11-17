'use strict';
// Aplikasi palsu mirip Express: cukup untuk menjalankan rantai middleware + handler tanpa dependency.
function createFakeApp() {
  const routes = [];
  const add = (method) => (path, ...handlers) => routes.push({ method, path, handlers });
  const app = { get: add('GET'), post: add('POST'), all: (p, ...h) => routes.push({ method: '*', path: p, handlers: h }), _routes: routes };
  function match(route, method, url) {
    if (route.method !== '*' && route.method !== method) return null;
    const a = route.path.split('/'), b = url.split('/');
    if (a.length !== b.length) return null;
    const params = {};
    for (let i = 0; i < a.length; i++) { if (a[i].startsWith(':')) params[a[i].slice(1)] = b[i]; else if (a[i] !== b[i]) return null; }
    return params;
  }
  app.call = async (method, url, { body, headers = {}, query = {}, ip = '10.0.0.1' } = {}) => {
    const route = routes.find((r) => match(r, method, url));
    if (!route) return { status: 404, body: null };
    const req = { method, headers: { 'x-forwarded-for': ip, ...headers }, body, query, params: match(route, method, url), socket: { remoteAddress: ip } };
    return new Promise((resolve, reject) => {
      const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
        json(o) { resolve({ status: this.statusCode, body: o, headers: this.headers }); }, sendStatus(c) { resolve({ status: c }); } };
      let i = 0;
      const next = (err) => { if (err) return reject(err); const h = route.handlers[i++]; if (!h) return resolve({ status: res.statusCode, body: null }); try { const r = h(req, res, next); if (r && r.catch) r.catch(reject); } catch (e) { reject(e); } };
      next();
    });
  };
  return app;
}
module.exports = { createFakeApp };
