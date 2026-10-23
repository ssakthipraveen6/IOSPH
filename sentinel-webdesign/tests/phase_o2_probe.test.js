/**
 * tests/phase_o2_probe.test.js
 *
 * Acceptance tests for Phase O2 probe functionality:
 * - O2.1: NTP offset parsing (system.ntp.offset_ms)
 * - O2.1: File-handle parsing (/proc/sys/fs/file-nr -> used, max)
 * - O2.1: TCP connection states parser (system.network.connections by state)
 * - O2.7: Local TLS listener probe (subject, SAN, not_after, chain, tls_version, cipher)
 * - O2.7: Keystore listing (JKS / PKCS12, aliases + not_after only, UNREADABLE when password needed)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const {
  parseNtpOffset,
  parseFileNr,
  parseTcpConnections,
  probeLocalTls,
  listKeystoreEntries
} = require('../agent/probe');

async function run() {
  console.log('--- Phase O2: Probe & Telemetry Parsing Tests ---');

  // 1. O2.1: NTP offset parsing
  {
    // chronyc tracking output
    const chronySample = `
Reference ID    : 192.168.1.1 (ntp.corp)
Stratum         : 2
Ref time (UTC)  : Mon Oct 12 12:00:00 2026
System time     : 0.000012345 seconds slow of NTP time
Last offset     : +0.000543210 s
RMS offset      : 0.000012345 s
Frequency       : 12.345 ppm slow
`;
    const r1 = parseNtpOffset(chronySample);
    assert.strictEqual(r1.error, null);
    assert(Math.abs(r1.offset_ms - 0.0123) < 0.001, `Expected offset_ms ~0.0123, got ${r1.offset_ms}`);

    // ntpq output
    const ntpqSample = `*192.168.1.1    .GPS.    1 u   42   64  377    0.456   -1.2345   0.050 offset=-1.2345 ms`;
    const r2 = parseNtpOffset(ntpqSample);
    assert.strictEqual(r2.error, null);
    assert.strictEqual(r2.offset_ms, -1.2345);

    // Negative case
    const rEmpty = parseNtpOffset('invalid output');
    assert(rEmpty.error !== null);
    console.log('  ✓ O2.1: NTP offset parsing verified for chrony and ntpq formats');
  }

  // 2. O2.1: File-handle parsing
  {
    // Linux /proc/sys/fs/file-nr format: <allocated> <allocated_unused> <max>
    const fileNrSample = '1280 0 100000\n';
    const parsed = parseFileNr(fileNrSample);
    assert.strictEqual(parsed.error, null);
    assert.strictEqual(parsed.allocated, 1280);
    assert.strictEqual(parsed.used, 1280);
    assert.strictEqual(parsed.max, 100000);
    assert.strictEqual(parsed.utilization_pct, 1.28);

    const withUnused = '2500 500 50000';
    const parsed2 = parseFileNr(withUnused);
    assert.strictEqual(parsed2.used, 2000);
    assert.strictEqual(parsed2.max, 50000);
    assert.strictEqual(parsed2.utilization_pct, 4.0);

    const badSample = parseFileNr('');
    assert(badSample.error !== null);
    console.log('  ✓ O2.1: /proc/sys/fs/file-nr parsing verified (allocated, used, max, utilization)');
  }

  // 3. O2.1: TCP connection states parsing
  {
    // Linux /proc/net/tcp format snippet (01 = ESTABLISHED, 0A = LISTEN, 06 = TIME_WAIT)
    const tcpSample = `
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0
   1: 0100007F:1000 0200007F:2000 01 00000000:00000000 00:00000000 00000000  1000        0 12346 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1001 0200007F:2001 01 00000000:00000000 00:00000000 00000000  1000        0 12347 1 0000000000000000 100 0 0 10 0
   3: 0100007F:1002 0200007F:2002 06 00000000:00000000 00:00000000 00000000  1000        0 12348 1 0000000000000000 100 0 0 10 0
`;
    const counts = parseTcpConnections(tcpSample);
    assert.strictEqual(counts.LISTEN, 1);
    assert.strictEqual(counts.ESTABLISHED, 2);
    assert.strictEqual(counts.TIME_WAIT, 1);
    assert.strictEqual(counts.CLOSE_WAIT, 0);
    console.log('  ✓ O2.1: TCP connection states parser verified (by state count)');
  }

  // 4. O2.7: Local TLS listener probe
  {
    const certPath = path.join(__dirname, '..', '.runtime', 'test_tls', 'test_cert.pem');
    const keyPath = path.join(__dirname, '..', '.runtime', 'test_tls', 'test_key.pem');

    assert(fs.existsSync(certPath) && fs.existsSync(keyPath), 'TLS test certificate fixtures must exist');
    const certPem = fs.readFileSync(certPath, 'utf8');
    const keyPem = fs.readFileSync(keyPath, 'utf8');

    // Create a local TLS server
    const server = tls.createServer({ cert: certPem, key: keyPem });
    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', resolve);
      server.on('error', reject);
    });

    const port = server.address().port;

    try {
      const probeRes = await probeLocalTls({ port, host: '127.0.0.1', timeoutMs: 3000 });
      assert.strictEqual(probeRes.status, 'HEALTHY');
      assert.strictEqual(probeRes.error, null);
      assert(probeRes.subject, 'subject must be present');
      assert(probeRes.not_after, 'not_after date must be present');
      assert(Array.isArray(probeRes.chain) && probeRes.chain.length > 0, 'certificate chain must be present');
      assert(probeRes.tls_version, 'tls_version must be recorded');
      assert(probeRes.cipher, 'cipher must be recorded');
    } finally {
      server.close();
    }
    console.log('  ✓ O2.7: Local TLS listener probe verified with live TLS server fixture');
  }

  // 5. O2.7: Keystore listing (JKS / PKCS12)
  {
    const fixtureDir = path.join(__dirname, '..', '.runtime', 'test_tls');
    const certPath = path.join(fixtureDir, 'test_cert.pem');
    const certPem = fs.readFileSync(certPath, 'utf8');
    const derBytes = Buffer.from(certPem.replace(/-----[^\n]+-----/g, '').replace(/\s+/g, ''), 'base64');

    // Create a mock PKCS12 file containing the DER certificate
    const testP12Path = path.join(fixtureDir, 'test_store.p12');
    fs.writeFileSync(testP12Path, derBytes);

    try {
      const p12Res = listKeystoreEntries(testP12Path);
      assert.strictEqual(p12Res.status, 'HEALTHY');
      assert.strictEqual(p12Res.error, null);
      assert(Array.isArray(p12Res.entries) && p12Res.entries.length > 0, 'Keystore must list entries');
      const entry = p12Res.entries[0];
      assert(entry.alias, 'entry must contain alias');
      assert(entry.not_after, 'entry must contain not_after date');
      assert(!entry.private_key, 'keystore listing must NOT expose private keys');
      assert(!entry.password, 'keystore listing must NOT expose password');
    } finally {
      try { fs.unlinkSync(testP12Path); } catch (_) {}
    }

    // Test JKS format (magic bytes 0xFEEDFEED) reporting UNREADABLE
    const testJksPath = path.join(fixtureDir, 'test_store.jks');
    const jksBuf = Buffer.alloc(16);
    jksBuf.writeUInt32BE(0xfeedfeed, 0);
    fs.writeFileSync(testJksPath, jksBuf);

    try {
      const jksRes = listKeystoreEntries(testJksPath);
      assert.strictEqual(jksRes.status, 'UNREADABLE');
      assert.strictEqual(jksRes.entries.length, 0);
      assert(jksRes.error.includes('password') || jksRes.error.includes('UNREADABLE') || jksRes.error.includes('JKS'));
    } finally {
      try { fs.unlinkSync(testJksPath); } catch (_) {}
    }
    console.log('  ✓ O2.7: Keystore listing verified (aliases + not_after only; UNREADABLE when password required)');
  }

  console.log('All Phase O2 Probe tests passed!\n');
}

run().catch(err => {
  console.error('[TEST FAILURE]', err);
  process.exit(1);
});
