/**
 * tests/phase_q_vip_discovery.test.js — Phase Q4
 *
 * The P1 VIP probe's DNS answers and certificate SANs become topology:
 *   vip:<host> --resolves_to--> ip:<env>:<addr>   (kind ip_address)
 *   vip:<host> --cert_san-->    dns_name:<env>:<name> (kind dns_name)
 *
 * 1. runVipProbes (stubbed collector) hands results to inventory/sources/vip_discovery.js.
 * 2. A second run with different answers replaces the old ones (stale edges + orphan entities removed).
 * 3. A result that did not observe DNS (null) leaves the previous set alone.
 * 4. SANs are capped per VIP.
 * 5. Environment comes from the probe run; prod and staging do not overwrite each other; no default.
 * 6. GET /api/v2/topology/:productId shows them under the VIP, and a shared address does not
 *    drag another product's VIP into this product's graph.
 * 7. probeVip against a local TLS server captures SAN DNS names, the subject CN and DNS answers.
 *
 * Hostnames use the reserved .test TLD; addresses are documentation ranges (RFC 5737 / 3849).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { execFileSync } = require('child_process');

const inventory = require('../inventory');
const store = inventory.store;
const { runVipProbes } = require('../backend/jobs/vip_probes');
const discovery = require('../inventory/sources/vip_discovery');
const topologyRoutes = require('../backend/routes/topologyRoutes');
const { probeVip, parseSanDnsNames } = require('../metrics_collection/real/probers/url_probe_collector');

const VIP_HOST = 'vip.q4app.test';
const VIP_URL = `https://${VIP_HOST}/health`;
const VIP_ID = `vip:${VIP_HOST}`;
const OTHER_VIP_HOST = 'vip.q4other.test';

function probeResult(overrides = {}) {
  return {
    component: 'q4app_vip', productId: 'q4app', url: VIP_URL, status: 'HEALTHY', httpStatus: 200,
    dns_ms: 1, tcp_ms: 1, tls_ms: 1, ttfb_ms: 1, total_ms: 3, cert_days_left: 30,
    probe_node: 'node-a', source: 'probe', timestamp: new Date().toISOString(),
    dns_addresses: null, dns_cnames: null, cert_cn: null, cert_sans: null,
    ...overrides
  };
}

function stubCollector(byEnv) {
  return { collectVips: async (env) => byEnv[env] || [] };
}

async function outgoing(id, type) {
  const e = await store.getEntityById(id);
  return (e?.edges?.outgoing || []).filter(x => x.edge_type === type).map(x => x.to_entity).sort();
}

async function seedProduct(appId, vipHost, env = 'staging') {
  await store.upsertEntity({ entity_id: `app:${appId}`, kind: 'app', name: appId, app_id: appId, environment: env, source: 'yaml', status: 'Active' });
  await store.upsertEntity({ entity_id: `vip:${vipHost}`, kind: 'vip', name: `VIP: ${vipHost}`, app_id: appId, environment: env, labels: { url: `https://${vipHost}/`, layer: 'network' }, source: 'yaml', status: 'Active' });
  await store.upsertEdge({ from_entity: `vip:${vipHost}`, to_entity: `app:${appId}`, edge_type: 'routes_traffic_to', source: 'yaml' });
}

async function getJson(port, urlPath) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  return { status: res.status, body: await res.json() };
}

async function run() {
  store.clear();
  await seedProduct('q4app', VIP_HOST);

  // ---- 1. job -> discovery source
  const run1 = await runVipProbes({
    environments: ['staging'],
    store: {},
    collector: stubCollector({
      staging: [probeResult({
        dns_addresses: ['192.0.2.10', '192.0.2.11', '2001:db8::10'],
        dns_cnames: ['lb.q4app.test'],
        cert_cn: VIP_HOST,
        cert_sans: [VIP_HOST, '*.q4app.test', 'ALT.q4app.test']
      })]
    })
  });
  assert.strictEqual(run1.staging.vips, 1);
  assert.ok(run1.staging.discovery, `default onResults records discovery: ${JSON.stringify(run1.staging)}`);
  assert.strictEqual(run1.staging.discovery.addresses, 3);
  assert.strictEqual(run1.staging.discovery.sans, 3);

  assert.deepStrictEqual(await outgoing(VIP_ID, 'resolves_to'),
    ['ip:staging:192.0.2.10', 'ip:staging:192.0.2.11', 'ip:staging:2001_db8__10'].sort());
  assert.deepStrictEqual(await outgoing(VIP_ID, 'cert_san'),
    ['dns_name:staging:*.q4app.test'.replace('*', '_'), 'dns_name:staging:alt.q4app.test', `dns_name:staging:${VIP_HOST}`].sort());

  const ip = await store.getEntityById('ip:staging:192.0.2.10');
  assert.strictEqual(ip.kind, 'ip_address');
  assert.strictEqual(ip.name, '192.0.2.10');
  assert.strictEqual(ip.environment, 'staging');
  assert.strictEqual(ip.source, 'vip_probe');
  assert.strictEqual((await store.getEntityById('ip:staging:2001_db8__10')).labels.family, 6);
  const wildcard = await store.getEntityById('dns_name:staging:_.q4app.test');
  assert.strictEqual(wildcard.kind, 'dns_name');
  assert.strictEqual(wildcard.name, '*.q4app.test');
  assert.strictEqual(wildcard.labels.wildcard, true);

  const vip = await store.getEntityById(VIP_ID);
  assert.strictEqual(vip.source, 'yaml', 'manifest-owned VIP fields are kept');
  assert.strictEqual(vip.name, `VIP: ${VIP_HOST}`);
  assert.strictEqual(vip.labels.url, `https://${VIP_HOST}/`, 'existing labels kept');
  assert.deepStrictEqual(vip.labels.dns_cnames, ['lb.q4app.test']);
  assert.strictEqual(vip.labels.cert_cn, VIP_HOST);
  console.log('ok 1 - probe results become resolves_to / cert_san edges under the VIP');

  // ---- 2. second run replaces
  const run2 = await runVipProbes({
    environments: ['staging'], store: {},
    collector: stubCollector({ staging: [probeResult({ dns_addresses: ['192.0.2.20'], cert_sans: [VIP_HOST] })] })
  });
  assert.deepStrictEqual(await outgoing(VIP_ID, 'resolves_to'), ['ip:staging:192.0.2.20']);
  assert.deepStrictEqual(await outgoing(VIP_ID, 'cert_san'), [`dns_name:staging:${VIP_HOST}`]);
  assert.strictEqual(await store.getEntityById('ip:staging:192.0.2.10'), null, 'stale address entity removed');
  assert.strictEqual(await store.getEntityById('dns_name:staging:alt.q4app.test'), null, 'stale SAN entity removed');
  assert.strictEqual(run2.staging.discovery.removed, 5);
  console.log('ok 2 - a second run with different answers replaces the old ones');

  // ---- 3. not observed (probe failed before DNS / TLS) leaves the previous set
  await runVipProbes({
    environments: ['staging'], store: {},
    collector: stubCollector({ staging: [probeResult({ status: 'DATA_UNAVAILABLE', dns_addresses: null, cert_sans: null })] })
  });
  assert.deepStrictEqual(await outgoing(VIP_ID, 'resolves_to'), ['ip:staging:192.0.2.20']);
  assert.deepStrictEqual(await outgoing(VIP_ID, 'cert_san'), [`dns_name:staging:${VIP_HOST}`]);
  console.log('ok 3 - an unobserved set (null) is left as it was');

  // ---- 4. SAN cap
  const manySans = Array.from({ length: 60 }, (_, i) => `n${i}.q4app.test`);
  const capped = await discovery.recordVipDiscovery('staging', [probeResult({ dns_addresses: ['192.0.2.20'], cert_sans: manySans })]);
  assert.strictEqual(discovery.MAX_SANS_PER_VIP, 50);
  assert.strictEqual((await outgoing(VIP_ID, 'cert_san')).length, 50);
  assert.strictEqual(capped.sans_truncated, 10);
  await discovery.recordVipDiscovery('staging', [probeResult({ dns_addresses: ['192.0.2.20'], cert_sans: [VIP_HOST] })]);
  assert.strictEqual((await outgoing(VIP_ID, 'cert_san')).length, 1, 'cap does not leak entities on shrink');
  const leftovers = (await store.getEntities({ kind: 'dns_name', limit: 1000 })).entities;
  assert.strictEqual(leftovers.length, 1, `orphaned SAN entities removed, got ${leftovers.length}`);
  console.log('ok 4 - SANs are capped at 50 per VIP and shrink cleanly');

  // ---- 5. environment tagging
  const run5 = await runVipProbes({
    environments: ['prod'], store: {},
    collector: stubCollector({ prod: [probeResult({ dns_addresses: ['198.51.100.7'], cert_sans: [VIP_HOST] })] })
  });
  assert.strictEqual(run5.prod.discovery.environment, 'prod');
  assert.deepStrictEqual(await outgoing(VIP_ID, 'resolves_to'), ['ip:prod:198.51.100.7', 'ip:staging:192.0.2.20']);
  assert.strictEqual((await store.getEntityById('ip:prod:198.51.100.7')).environment, 'prod');
  assert.strictEqual((await store.getEntityById('ip:staging:192.0.2.20')).environment, 'staging', 'prod run does not touch staging answers');
  await assert.rejects(discovery.recordVipDiscovery(undefined, [probeResult({ dns_addresses: ['192.0.2.99'] })]), /invalid environment/);
  await assert.rejects(discovery.recordVipDiscovery('qa', [probeResult({ dns_addresses: ['192.0.2.99'] })]), /invalid environment/);
  assert.strictEqual(await store.getEntityById('ip:production:192.0.2.99'), null);
  const all = (await store.getEntities({ limit: 10000 })).entities.filter(e => e.source === 'vip_probe');
  assert.ok(all.every(e => e.environment === 'prod' || e.environment === 'staging'), 'never tagged production/default');
  console.log('ok 5 - environment comes from the probe run, per-environment sets, no default');

  // ---- 6. topology endpoint
  // A second product whose VIP shares the staging address (common on AVI) must not leak in.
  await seedProduct('q4other', OTHER_VIP_HOST);
  await discovery.recordVipDiscovery('staging', [probeResult({
    productId: 'q4other', component: 'q4other_vip', url: `https://${OTHER_VIP_HOST}/`, dns_addresses: ['192.0.2.20'], cert_sans: [OTHER_VIP_HOST]
  })]);

  const app = express();
  app.use((req, _res, next) => { req.sentinelEnv = req.query.environment || 'staging'; next(); });
  app.use('/api/v2/topology', topologyRoutes);
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const { status, body } = await getJson(port, '/api/v2/topology/q4app?environment=staging');
    assert.strictEqual(status, 200, JSON.stringify(body));
    assert.deepStrictEqual(body.layers.addresses.map(e => e.entity_id), ['ip:staging:192.0.2.20']);
    assert.deepStrictEqual(body.layers.cert_names.map(e => e.entity_id), [`dns_name:staging:${VIP_HOST}`]);
    assert.ok(body.edges.some(e => e.from_entity === VIP_ID && e.to_entity === 'ip:staging:192.0.2.20' && e.edge_type === 'resolves_to'));
    assert.ok(body.edges.some(e => e.from_entity === VIP_ID && e.edge_type === 'cert_san'));
    assert.deepStrictEqual(body.layers.vip.map(e => e.entity_id), [VIP_ID], 'shared address does not pull in the other product VIP');
    assert.ok(!body.entities.some(e => e.entity_id === 'app:q4other'));
    assert.ok(!body.edges.some(e => e.from_entity === `vip:${OTHER_VIP_HOST}`));

    const prod = await getJson(port, '/api/v2/topology/q4app?environment=prod');
    assert.strictEqual(prod.status, 200);
    assert.deepStrictEqual(prod.body.layers.addresses.map(e => e.entity_id), ['ip:prod:198.51.100.7'], 'prod view shows only prod answers');
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
  console.log('ok 6 - topology endpoint shows discovered nodes under the VIP, without cross-product leakage');

  // ---- 7. SAN parsing + local TLS capture
  assert.deepStrictEqual(parseSanDnsNames('DNS:a.q4.test, IP Address:192.0.2.1, DNS:*.B.q4.test'), ['a.q4.test', '*.b.q4.test']);
  assert.deepStrictEqual(parseSanDnsNames(undefined), []);

  const creds = makeSanCert();
  if (!creds) {
    console.log('skip 7 - openssl not available to mint a SAN certificate');
  } else {
    const tlsServer = https.createServer(creds, (_req, res) => { res.writeHead(200); res.end('ok'); });
    await new Promise(r => tlsServer.listen(0, '127.0.0.1', r));
    try {
      const res = await probeVip({ url: `https://127.0.0.1:${tlsServer.address().port}/`, productId: 'q4tls', timeoutMs: 4000 });
      assert.strictEqual(res.status, 'HEALTHY', JSON.stringify(res));
      assert.deepStrictEqual(res.dns_addresses, ['127.0.0.1']);
      assert.strictEqual(res.cert_cn, 'q4-local.test');
      assert.deepStrictEqual(res.cert_sans, ['q4-local.test', 'alt.q4-local.test']);
      assert.strictEqual(res.dns_cnames, null, 'IP literal: no CNAME lookup');
      const unreachable = await probeVip({ url: 'https://127.0.0.1:1/', timeoutMs: 2000 });
      assert.strictEqual(unreachable.status, 'DATA_UNAVAILABLE');
      assert.strictEqual(unreachable.cert_sans, null, 'not observed -> null, not []');
    } finally {
      tlsServer.closeAllConnections();
      tlsServer.close();
    }
    console.log('ok 7 - probeVip captures SANs, CN and DNS answers from a local TLS server');
  }

  store.clear();
  console.log('\nAll Phase Q4 VIP discovery tests passed.');
}

function makeSanCert() {
  const dir = path.resolve(__dirname, '../.runtime/test_tls_q4');
  const keyPath = path.join(dir, 'san_key.pem');
  const certPath = path.join(dir, 'san_cert.pem');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!(fs.existsSync(keyPath) && fs.existsSync(certPath))) {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=q4-local.test', '-days', '30',
        '-addext', 'subjectAltName=DNS:q4-local.test,DNS:alt.q4-local.test,IP:127.0.0.1',
        '-keyout', keyPath, '-out', certPath], { stdio: 'pipe' });
    }
    return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
  } catch (_) {
    return null;
  }
}

run()
  .then(() => setTimeout(() => process.exit(0), 50).unref())
  .catch(err => {
    console.error('FAIL', err);
    setTimeout(() => process.exit(1), 50).unref();
  });
