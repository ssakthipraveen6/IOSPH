'use strict';
// P1.5: log archiver uploads to S3 (SigV4, no SDK) and only trusts a confirmed upload.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const s3 = require('../logs_collection/archival/s3_client');
const clickhouse = require('../database/clickhouse');

async function main() {
  // 1. SigV4 key derivation against the published AWS example (service "iam").
  const key = s3.deriveSigningKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam');
  assert.strictEqual(key.toString('hex'), 'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
  console.log('✔ SigV4 signing key matches the AWS reference vector');

  // 2. Credential parsing
  assert.deepStrictEqual(s3.parseS3Credential('AKIA123:se/cret+x'), { accessKeyId: 'AKIA123', secretAccessKey: 'se/cret+x' });
  assert.deepStrictEqual(s3.parseS3Credential('{"access_key_id":"A","secret_access_key":"B"}'), { accessKeyId: 'A', secretAccessKey: 'B' });
  assert.strictEqual(s3.parseS3Credential('nocolon'), null);
  assert.strictEqual(s3.parseS3Credential(''), null);
  console.log('✔ credential formats parsed; malformed ones rejected');

  // 3. Real PUT against a local server that recomputes the signature independently.
  const secret = 'testsecret';
  let seen = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen = { url: req.url, method: req.method, auth: req.headers.authorization, hash: req.headers['x-amz-content-sha256'], bodyHash: crypto.createHash('sha256').update(body).digest('hex') };
      res.writeHead(200, { ETag: `"${crypto.createHash('md5').update(body).digest('hex')}"` });
      res.end();
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const body = Buffer.from('hello archive');
  const out = await s3.putObject({ endpoint, region: 'eu-west-1', bucket: 'bkt', key: 'a/b c/file.gz', body, accessKeyId: 'AK', secretAccessKey: secret });
  server.close();
  assert.ok(out.ok && out.confirmed, 'matching ETag confirms the upload');
  assert.strictEqual(seen.method, 'PUT');
  assert.strictEqual(seen.url, '/bkt/a/b%20c/file.gz', 'path-style key with encoded space');
  assert.strictEqual(seen.hash, seen.bodyHash, 'payload hash header matches the bytes received');
  assert.ok(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/eu-west-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(seen.auth));
  console.log('✔ PUT is path-style, signed, and its payload hash matches');

  // 4. A wrong ETag is not a confirmed upload
  const bad = await s3.putObject({ endpoint: 'http://x', region: 'r', bucket: 'b', key: 'k', body, accessKeyId: 'A', secretAccessKey: 'S' },
    { send: async () => ({ status: 200, headers: { etag: '"deadbeef"' } }) });
  assert.strictEqual(bad.ok, true);
  assert.strictEqual(bad.confirmed, false);
  const fail = await s3.putObject({ endpoint: 'http://x', region: 'r', bucket: 'b', key: 'k', body, accessKeyId: 'A', secretAccessKey: 'S' },
    { send: async () => ({ status: 403, headers: {} }) });
  assert.strictEqual(fail.confirmed, false);
  console.log('✔ ETag mismatch and HTTP errors are not treated as confirmed');

  // 5. Archiver behaviour
  const realQuery = clickhouse.query; const realConfigured = clickhouse.isConfigured;
  clickhouse.isConfigured = () => true;
  clickhouse.query = async () => [{ ts: '2026-10-01 10:00:00', entity_id: 'h', app_id: 'h_app', env: 'staging', level: 'INFO', message: 'm', fields: {} }];
  const cred = require('@sentinel/config/cyberark/credential_provider');
  const realGet = cred.getCredential;
  const { archiveLogs } = require('../logs_collection/archival/s3_archiver');

  // 5a. blank bucket: stays local, says so
  let r = await archiveLogs({ environment: 'staging', date: '2026-10-01' });
  assert.strictEqual(r.s3.status, 'NOT_CONFIGURED');
  assert.strictEqual(r.files[0].uploaded, false);
  assert.ok(fs.existsSync(r.files[0].file));

  // 5b. bucket set but no credential: AUTH_FAILED, nothing uploaded
  cred.getCredential = async () => { throw new Error('none'); };
  r = await archiveLogs({ environment: 'staging', date: '2026-10-01', s3Bucket: 'bkt', s3Endpoint: 'http://x' });
  assert.strictEqual(r.s3.status, 'AUTH_FAILED');
  assert.strictEqual(r.files[0].uploaded, false);

  // 5c. confirmed upload; local copy kept unless asked to delete
  cred.getCredential = async () => 'AK:SK';
  const calls = [];
  const put = async (o) => { calls.push(o); return { ok: true, status: 200, confirmed: true }; };
  r = await archiveLogs({ environment: 'staging', date: '2026-10-01', s3Bucket: 'bkt', s3Endpoint: 'http://x', putObject: put });
  assert.strictEqual(r.s3.uploaded, 1);
  assert.strictEqual(calls[0].key, 'sentinel/logs/staging/h_app/2026-10-01/logs_2026-10-01_h_app.ndjson.gz');
  assert.ok(fs.existsSync(r.files[0].file), 'local copy kept by default');

  // 5d. delete only after confirmation
  r = await archiveLogs({ environment: 'staging', date: '2026-10-01', s3Bucket: 'bkt', s3Endpoint: 'http://x', putObject: put, deleteLocalAfterUpload: true });
  assert.strictEqual(r.files[0].local_removed, true);
  assert.ok(!fs.existsSync(r.files[0].file));
  const unconfirmed = async () => ({ ok: true, status: 200, confirmed: false });
  r = await archiveLogs({ environment: 'staging', date: '2026-10-01', s3Bucket: 'bkt', s3Endpoint: 'http://x', putObject: unconfirmed, deleteLocalAfterUpload: true });
  assert.strictEqual(r.files[0].uploaded, false);
  assert.ok(fs.existsSync(r.files[0].file), 'unconfirmed upload never removes the local copy');
  assert.strictEqual(r.s3.failed, 1);
  const thrower = async () => { throw new Error('network down'); };
  r = await archiveLogs({ environment: 'staging', date: '2026-10-01', s3Bucket: 'bkt', s3Endpoint: 'http://x', putObject: thrower, deleteLocalAfterUpload: true });
  assert.ok(r.files[0].upload_error && fs.existsSync(r.files[0].file));
  console.log('✔ archiver: blank bucket local-only, no credential AUTH_FAILED, local copy kept until S3 confirms');

  cred.getCredential = realGet; clickhouse.query = realQuery; clickhouse.isConfigured = realConfigured;
  console.log('PHASE H S3 UPLOAD TESTS PASSED');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
