'use strict';
// P1.4: expiry_sync reads lifecycle.certificates probes declared in manifests.
const assert = require('assert');
const { collectDeclaredCertProbes, runExpirySync } = require('../backend/jobs/expiry_sync');

(async () => {
  const apps = {
    app_a: { lifecycle: { certificates: [{ name: 'ingress-tls', probe: 'a.example.test:443' }, { name: 'dead', probe: 'b.example.test:443' }] } },
    app_b: { lifecycle: { certificates: [{ name: 'no-probe' }] } },
    app_c: {}
  };
  const fakeProbe = async (target) => (target.startsWith('a.')
    ? { subject: 'a.example.test', issuer: 'Test CA', fingerprint: 'AA:BB:CC', valid_to: '2027-05-01T00:00:00.000Z', protocol: 'TLSv1.3' }
    : null);

  const r = await collectDeclaredCertProbes(apps, fakeProbe);
  assert.strictEqual(r.found.length, 1, 'only the reachable probe yields a certificate');
  assert.strictEqual(r.found[0].product, 'app_a');
  assert.strictEqual(r.found[0].not_after, '2027-05-01T00:00:00.000Z');
  assert.deepStrictEqual(r.unprobed, [{ app: 'app_a', name: 'dead', probe: 'b.example.test:443' }], 'unreachable probe is reported, not invented');
  console.log('✔ declared probes: reachable -> cert, unreachable -> unprobed, entries without a probe ignored');

  const saved = [];
  const store = { upsertExpiryItem: async (rec) => { saved.push(rec); return rec; } };
  const out = await runExpirySync({ apps, store, certProbe: fakeProbe, nowMs: Date.parse('2026-10-22T00:00:00Z') });
  assert.strictEqual(out.certificates_count, 1);
  assert.strictEqual(out.unprobed.length, 1);
  const cert = saved.find(x => x.product === 'app_a');
  assert.ok(cert && cert.locations.includes('probe:a.example.test:443'));
  assert.ok(!saved.some(x => x.not_after === null && x.kind === 'tls_cert'), 'no certificate record without a real date');
  console.log('✔ runExpirySync stores the probed certificate and surfaces unprobed ones');

  const bad = await collectDeclaredCertProbes(apps, async () => { throw new Error('boom'); });
  assert.strictEqual(bad.found.length, 0);
  assert.strictEqual(bad.unprobed.length, 2);
  console.log('✔ a throwing probe is treated as unreachable');
  console.log('PHASE H EXPIRY PROBE TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
