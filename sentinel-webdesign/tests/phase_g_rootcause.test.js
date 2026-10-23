/**
 * tests/phase_g_rootcause.test.js
 *
 * Root-cause gap fixes:
 *  1. k8s collector authenticates (Bearer service-account token) and reports AUTH_FAILED on 401/403
 *  2. Inventory links PVC -> PV -> NFS share / Trident volume, and pod -> PVC
 *  3. Correlation rules for k8s workload failures and storage mount / Trident failures
 */
const assert = require('assert');
const http = require('http');

async function main() {
  // ---- 1. k8s collector auth -------------------------------------------------
  const seen = [];
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization || null });
    if (mode === 'deny') { res.statusCode = 401; return res.end('{}'); }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/healthz') return res.end('ok');
    if (req.url === '/api/v1/nodes') return res.end(JSON.stringify({ items: [{ metadata: { name: 'n1' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } }] }));
    if (req.url === '/api/v1/pods') return res.end(JSON.stringify({ items: [{ metadata: { name: 'p1', namespace: 'a' }, status: { phase: 'Running' } }] }));
    res.end(JSON.stringify({ items: [] }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const config = require('@sentinel/config');
  const original = Object.getOwnPropertyDescriptor(config, 'ACTIVE_URLS');
  Object.defineProperty(config, 'ACTIVE_URLS', { configurable: true, get: () => ({ k8s_api: base, applications: {} }) });
  const k8sCollector = require('../metrics_collection/real/infrastructure/k8s_collector');

  const ok = await k8sCollector.collect({}, {});
  assert.ok(seen.length >= 3, 'collector should call healthz, nodes, pods');
  assert.ok(seen.every(s => /^Bearer \S+$/.test(s.auth || '')), 'every K8s API call must carry the bearer token');
  assert.strictEqual(ok.nodes_total, 1);
  assert.strictEqual(ok.authFailed, undefined);
  console.log('✔ k8s collector sends the service-account bearer token');

  mode = 'deny';
  const denied = await k8sCollector.collect({}, {});
  assert.strictEqual(denied.status, 'AUTH_FAILED');
  assert.strictEqual(denied.authFailed, true);
  assert.strictEqual(denied.nodes_total, null, 'no fabricated values on AUTH_FAILED');
  console.log('✔ k8s collector reports AUTH_FAILED (not "down") on 401');

  if (original) Object.defineProperty(config, 'ACTIVE_URLS', original); else delete config.ACTIVE_URLS;
  server.close();

  // ---- 2. PVC -> PV -> storage chain ----------------------------------------
  const inventory = require('@sentinel/inventory');
  const k8s = inventory.sources.k8s;

  assert.strictEqual(k8s.storageTargetForPv({ spec: {} }), null);
  const nfs = k8s.storageTargetForPv({ spec: { nfs: { server: 'nas01', path: '/vol/builds' } } });
  assert.ok(nfs.entityId.startsWith('share:') && nfs.backing === 'nfs');
  const trident = k8s.storageTargetForPv({ spec: { csi: { driver: 'csi.trident.netapp.io', volumeAttributes: { internalName: 'trident_pvc_abc' } } } });
  assert.ok(trident.entityId.startsWith('storage:') && trident.backing === 'trident');

  const res = await k8s.syncK8sStorage('c1', {
    pvs: { items: [
      { metadata: { name: 'pv-1' }, spec: { storageClassName: 'ontap-nas', capacity: { storage: '10Gi' }, csi: { driver: 'csi.trident.netapp.io', volumeAttributes: { internalName: 'trident_pvc_abc' } } }, status: { phase: 'Bound' } },
      { metadata: { name: 'pv-2' }, spec: { nfs: { server: 'nas01', path: '/vol/builds' } }, status: { phase: 'Bound' } }
    ] },
    pvcs: { items: [
      { metadata: { name: 'data', namespace: 'ci' }, spec: { volumeName: 'pv-1', storageClassName: 'ontap-nas' }, status: { phase: 'Bound' } },
      { metadata: { name: 'unbound', namespace: 'ci' }, spec: {}, status: { phase: 'Pending' } }
    ] },
    pods: { items: [{ metadata: { name: 'runner-0', namespace: 'ci' }, spec: { nodeName: 'n1', volumes: [{ persistentVolumeClaim: { claimName: 'data' } }] }, status: { phase: 'Running' } }] }
  });
  assert.deepStrictEqual({ pvcs: res.pvcs, pvs: res.pvs, pods: res.pods, links: res.storageLinks }, { pvcs: 2, pvs: 2, pods: 1, links: 2 });

  const pvcId = inventory.resolver.k8sPvc('c1', 'ci', 'data');
  const graph = await inventory.getEntityGraph(pvcId, 3);
  const edgeKeys = graph.edges.map(e => `${e.from_entity}>${e.edge_type}>${e.to_entity}`);
  assert.ok(edgeKeys.includes(`${pvcId}>bound_to>${inventory.resolver.k8sPv('c1', 'pv-1')}`), 'PVC bound_to PV');
  assert.ok(edgeKeys.includes(`${inventory.resolver.k8sPv('c1', 'pv-1')}>backed_by>${inventory.resolver.storage('trident_pvc_abc')}`), 'PV backed_by Trident volume');
  assert.ok(edgeKeys.some(k => k.includes('>mounts>' + pvcId)), 'pod mounts PVC');
  console.log('✔ inventory links pod -> PVC -> PV -> NFS/Trident storage');

  // ---- 3. correlation rules --------------------------------------------------
  const correlation = require('@sentinel/correlation');
  const mount = correlation.diagnoseLayer({ events: [
    { kind: 'k8s_event', reason: 'FailedMount', entity_id: 'k8spvc:c1:ci:data', message: 'MountVolume.SetUp failed: mount.nfs timed out' }
  ] });
  assert.ok(mount.some(h => h.rule_id === 'rule_storage_mount' && h.layer === 'storage'), 'mount failure -> storage layer');

  const wl = correlation.diagnoseLayer({ events: [{ kind: 'k8s_event', reason: 'OOMKilled', entity_id: 'k8spod:c1:ci:runner-0' }] });
  assert.ok(wl.some(h => h.rule_id === 'rule_k8s_workload' && h.layer === 'k8s'), 'OOMKilled -> k8s layer');
  assert.ok(!wl.some(h => h.rule_id === 'rule_storage_mount'));

  assert.deepStrictEqual(correlation.diagnoseLayer({ events: [{ kind: 'k8s_event', reason: 'Pulled', entity_id: 'k8spod:x' }] }), []);
  console.log('✔ correlation: k8s workload and storage-mount rules fire only on matching evidence');

  console.log('PHASE G ROOT-CAUSE TESTS PASSED');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
