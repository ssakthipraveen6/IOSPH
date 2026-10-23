/**
 * tests/helpers/fake_clickhouse.js
 * Minimal ClickHouse HTTP stand-in: records every request and answers through a
 * responder(sql, entry) that returns JSONEachRow rows (array) or { status, text }.
 */
const http = require('http');

function toText(rows) {
  return rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}

async function startFakeClickHouse(responder = () => []) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const sql = url.searchParams.get('query') || body;
      const entry = { url, sql, body, params: Object.fromEntries([...url.searchParams].filter(([k]) => k.startsWith('param_'))) };
      requests.push(entry);
      let out;
      try { out = responder(sql, entry); } catch (e) { out = { status: 500, text: e.message }; }
      if (Array.isArray(out)) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(toText(out)); }
      out = out || {};
      res.writeHead(out.status || 200, { 'Content-Type': 'text/plain' });
      res.end(out.text || '');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    server,
    requests,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => { if (server.closeAllConnections) server.closeAllConnections(); return new Promise(r => server.close(r)); }
  };
}

module.exports = { startFakeClickHouse };
