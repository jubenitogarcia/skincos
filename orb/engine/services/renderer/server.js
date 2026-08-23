const http = require('http');
const { renderStill } = require('./index');
const server = http.createServer((req, res) => { if (req.method !== 'POST' || req.url !== '/render/still') { res.writeHead(404); return res.end(); } let body = ''; req.on('data', (chunk) => { body += chunk; }); req.on('end', () => { try { const input = JSON.parse(body || '{}'); const result = renderStill(input); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result)); } catch (error) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); } }); });
if (require.main === module) server.listen(Number(process.env.RENDERER_PORT || 8787), '127.0.0.1');
module.exports = server;
