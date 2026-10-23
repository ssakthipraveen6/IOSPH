'use strict';
/**
 * Minimal S3 PUT with AWS Signature V4, using only Node's crypto and https.
 * No SDK is bundled because the deployment has no package registry access.
 * Path-style addressing (endpoint/bucket/key) works for AWS and for S3-compatible stores.
 */
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// SHA-256 hex.
const sha256Hex = (d) => crypto.createHash('sha256').update(d).digest('hex');
// HMAC-SHA256.
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// AWS Signature V4 signing key.
function deriveSigningKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, date), region), service), 'aws4_request');
}

// S3 path encoding.
const encodePath = (p) => p.split('/').map(s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');

/** Builds the signed request (pure; unit-testable against fixed inputs). */
function signPut({ endpoint, region, bucket, key, body, accessKeyId, secretAccessKey, now = new Date(), contentType = 'application/gzip' }) {
  const u = new URL(endpoint);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const basePath = u.pathname.replace(/\/+$/, '');
  const canonicalUri = encodePath(`${basePath}/${bucket}/${key}`);
  const payloadHash = sha256Hex(body);
  const headers = { host: u.host, 'content-type': contentType, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(n => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = deriveSigningKey(secretAccessKey, date, region, 's3');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    url: `${u.protocol}//${u.host}${canonicalUri}`,
    headers: {
      'Content-Type': contentType,
      'Content-Length': body.length,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    },
    canonicalRequest,
    stringToSign,
    signature
  };
}

/** Parses the credential secret: "ACCESS_KEY_ID:SECRET" or {"access_key_id","secret_access_key"}. */
function parseS3Credential(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  try {
    const j = JSON.parse(s);
    const id = j.access_key_id || j.accessKeyId;
    const secret = j.secret_access_key || j.secretAccessKey;
    return id && secret ? { accessKeyId: id, secretAccessKey: secret } : null;
  } catch (_) { /* not JSON */ }
  const i = s.indexOf(':');
  return i > 0 && i < s.length - 1 ? { accessKeyId: s.slice(0, i), secretAccessKey: s.slice(i + 1) } : null;
}

// Raw HTTP(S) request.
function rawRequest(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({ method: 'PUT', hostname: u.hostname, port: u.port || undefined, path: u.pathname, headers, timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('timeout', () => req.destroy(new Error('S3 request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Uploads one object. `confirmed` is true only when S3 answers 2xx and, where the store
 * returns a plain MD5 ETag, that ETag matches what we sent.
 */
async function putObject(opts, { send = rawRequest, timeoutMs = 30000 } = {}) {
  const signed = signPut(opts);
  const res = await send(signed.url, signed.headers, opts.body, timeoutMs);
  const ok = res.status >= 200 && res.status < 300;
  const etag = res.headers && res.headers.etag ? String(res.headers.etag).replace(/"/g, '') : null;
  const sse = res.headers && res.headers['x-amz-server-side-encryption'];
  const md5 = crypto.createHash('md5').update(opts.body).digest('hex');
  const etagMatches = etag ? (sse ? null : etag === md5) : null;
  return { ok, status: res.status, etag, confirmed: ok && etagMatches !== false };
}

module.exports = { deriveSigningKey, signPut, putObject, parseS3Credential };
