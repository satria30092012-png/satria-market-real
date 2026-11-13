// Legacy/local entry point. Vercel uses api/index.js.
process.env.START_SERVER = '0';
const { app } = require('./server.js');
module.exports = app;
