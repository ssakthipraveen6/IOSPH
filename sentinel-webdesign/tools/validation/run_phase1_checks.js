const { spawn } = require('child_process');
const http = require('http');
const assert = require('assert');
const { pushMetrics } = require('./fixture-otlp-agent/agent');

const JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    }).on('error', reject);
  });
}

async function waitForServer(port = 3001, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchJson(`http://localhost:${port}/healthz`);
      if (res.status === 200) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`Server failed to start on port ${port} within ${timeoutMs}ms`);
}

async function run() {
  console.log('=== RUNNING PHASE 1 LAUNCH VALIDATION (Section 23.4) ===');

  const serverProc = spawn(process.execPath, ['backend/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SENTINEL_JWT_SECRET: JWT_SECRET,
      PORT: '3001',
      USE_SIMULATED_COLLECTORS: 'true',
      NODE_ENV: 'test'
    },
    stdio: 'pipe'
  });

  serverProc.stdout.on('data', d => process.stdout.write(`[SERVER] ${d}`));
  serverProc.stderr.on('data', d => process.stderr.write(`[SERVER-ERR] ${d}`));

  try {
    await waitForServer(3001);
    console.log('[CHECK] Server is healthy on :3001');

    console.log('[CHECK] Pushing synthetic OTLP payload for unknown host: newhost-01.corp');
    const pushRes = await pushMetrics({
      options: {
        hostName: 'newhost-01.corp',
        serviceName: 'cloudbees_jenkins',
        environment: 'staging'
      }
    });
    assert.strictEqual(pushRes.statusCode, 200, `Expected 200 from OTLP push, got ${pushRes.statusCode}`);
    console.log('[CHECK] OTLP push accepted:', pushRes.data);

    // Wait a brief moment for async write
    await new Promise(r => setTimeout(r, 500));

    console.log('[CHECK] Querying GET /api/v2/entities?kind=host');
    const entitiesRes = await fetchJson('http://localhost:3001/api/v2/entities?kind=host');
    assert.strictEqual(entitiesRes.status, 200);
    const hosts = entitiesRes.data.entities || [];
    console.log(`[CHECK] Found ${hosts.length} host entities`);
    const foundHost = hosts.find(h => h.entity_id === 'host:newhost-01.corp' || h.name === 'newhost-01.corp');
    assert(foundHost, 'Expected host:newhost-01.corp to be in entities list');
    console.log('[CHECK] Host entity found:', foundHost.entity_id, foundHost.app_id);

    console.log('[CHECK] Querying GET /api/v2/entities/host:newhost-01.corp/graph');
    const graphRes = await fetchJson('http://localhost:3001/api/v2/entities/host:newhost-01.corp/graph');
    assert.strictEqual(graphRes.status, 200);
    const edges = graphRes.data.edges || [];
    const runsOnEdge = edges.find(e => e.edge_type === 'runs_on' && e.to_entity === 'app:cloudbees_jenkins');
    assert(runsOnEdge, 'Expected runs_on edge linking host:newhost-01.corp to app:cloudbees_jenkins');
    console.log('[CHECK] Topology edge confirmed:', runsOnEdge.from_entity, '->', runsOnEdge.edge_type, '->', runsOnEdge.to_entity);

    console.log('=== PHASE 1 LAUNCH VALIDATION PASSED SUCCESSFULLY ===');
  } finally {
    serverProc.kill('SIGKILL');
  }
}

run().catch(err => {
  console.error('=== PHASE 1 LAUNCH VALIDATION FAILED ===', err);
  process.exit(1);
});
