'use strict';
// The Dynatrace API address can be set per environment with PROD_/STG_DYNATRACE_API_ENDPOINT.
const assert = require('assert');
const http = require('http');
const tokenProvider = require('../metrics_collection/real/dynatrace/token_provider');
const dynatrace = require('../metrics_collection/real/dynatrace/dynatrace_collector');

(async () => {
  let seen = null;
  const server = http.createServer((req, res) => {
    seen = { url: req.url, auth: req.headers.authorization };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ totalCount: 1, problems: [{ problemId: 'P-1', title: 'Disk full', severityLevel: 'RESOURCE_CONTENTION', status: 'OPEN', affectedEntities: [{ name: 'host-a' }] }] }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origToken = tokenProvider.getApiToken;
  tokenProvider.getApiToken = async () => 'dt-test-token';
  const url = `http://127.0.0.1:${server.address().port}/`; // trailing slash is tolerated
  try {
    assert.deepStrictEqual(await dynatrace.getActiveProblems('prod'), [], 'no endpoint configured = no problems, no invented data');
    process.env.PROD_DYNATRACE_API_ENDPOINT = url;
    const problems = await dynatrace.getActiveProblems('prod');
    assert.strictEqual(problems.length, 1, 'the prod override is used');
    assert.ok(seen.url.startsWith('/api/v2/problems?'), `calls the v2 problems API (${seen.url})`);
    assert.strictEqual(seen.auth, 'Api-Token dt-test-token');
    seen = null;
    assert.deepStrictEqual(await dynatrace.getActiveProblems('staging'), [], 'the prod address is not used for staging');
    assert.strictEqual(seen, null);
    console.log('dynatrace_endpoint_env: all assertions passed');
  } finally {
    delete process.env.PROD_DYNATRACE_API_ENDPOINT;
    tokenProvider.getApiToken = origToken;
    server.close();
  }
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
