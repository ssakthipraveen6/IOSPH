/**
 * tests/helpers/tls.js — self-signed certificate for local HTTPS test servers.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function getTestTlsCredentials() {
  const dir = path.resolve(__dirname, '../../.runtime/test_tls');
  fs.mkdirSync(dir, { recursive: true });
  const keyPath = path.join(dir, 'test_key.pem');
  const certPath = path.join(dir, 'test_cert.pem');
  if (!(fs.existsSync(keyPath) && fs.existsSync(certPath))) {
    const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
    for (const bin of candidates) {
      try {
        execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=127.0.0.1', '-days', '30', '-keyout', keyPath, '-out', certPath], { stdio: 'pipe' });
        if (fs.existsSync(keyPath)) break;
      } catch (_) { /* try next */ }
    }
  }
  return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
}

module.exports = { getTestTlsCredentials };
