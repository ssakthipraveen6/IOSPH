const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Auto-load .env if present and SENTINEL_JWT_SECRET is not already in process.env
if (!process.env.SENTINEL_JWT_SECRET) {
  try {
    const candidatePaths = [
      path.resolve(__dirname, '../../config/.env'),
      path.resolve(__dirname, '../../../.env'),
      path.resolve(__dirname, '../../.env'),
      path.resolve(process.cwd(), 'config', '.env'),
      path.resolve(process.cwd(), '.env')
    ];
    for (const envPath of candidatePaths) {
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [k, ...v] = trimmed.split('=');
            if (k && !process.env[k.trim()]) {
              process.env[k.trim()] = v.join('=').trim();
            }
          }
        });
        if (process.env.SENTINEL_JWT_SECRET) break;
      }
    }
  } catch (e) {}
}

// [SEC-01 REMEDIATED] — CWE-321: Hard-coded Cryptographic Key
// JWT secret MUST be provided via environment variable. No fallback string is permitted.
// Startup is aborted if the secret is absent, preventing accidental insecure deployments.
const JWT_SECRET = process.env.SENTINEL_JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] [SEC-01] SENTINEL_JWT_SECRET environment variable is not set.');
  console.error('[FATAL] Refusing to start. Set SENTINEL_JWT_SECRET to a strong random secret (min 64 chars).');
  process.exit(1);
}

if (JWT_SECRET.length < 32) {
  console.error('[FATAL] [SEC-01] SENTINEL_JWT_SECRET is too short (minimum 32 characters required for HS256).');
  process.exit(1);
}

// [T0.7] Key rotation support — active key and previous key for smooth migration
function getActiveKid() {
  return process.env.SENTINEL_JWT_KID || 'k1';
}
function getPrevKid() {
  return process.env.SENTINEL_JWT_KID_PREV || 'k0';
}
function getPrevSecret() {
  return process.env.SENTINEL_JWT_SECRET_PREV || null;
}

const TOKEN_TTL_MS = parseInt(process.env.JWT_TTL_MS, 10) || (8 * 60 * 60 * 1000); // 8 hours default

// Lazy reference to database for revocation checks
function getDb() {
  try {
    return require('@sentinel/database');
  } catch (e) {
    try {
      return require('../../database/db');
    } catch (_) {
      return null;
    }
  }
}

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

function signHmac(data, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sign(header, payload, secret) {
  const data = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = signHmac(data, secret);
  return `${data}.${signature}`;
}

/**
 * Generates a signed JWT session token with `kid` and unique `jti` claim (T0.7).
 */
function generateToken(user, ttlMs = TOKEN_TTL_MS) {
  const now = Date.now();
  const jti = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const header = { alg: 'HS256', typ: 'JWT', kid: getActiveKid() };
  const payload = {
    username: user.username,
    role: user.role || 'Operator',
    email: user.email || `${user.username}@enterprise.corp`,
    environment: user.environment || 'staging',
    iat: now,
    exp: now + ttlMs,
    jti
  };
  return sign(header, payload, JWT_SECRET);
}

/**
 * Verifies a JWT token:
 * - Checks signature against active key or previous rotation key via `kid`
 * - Checks expiration
 * - Checks revocation list keyed by `jti` in database
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  const data = `${headerB64}.${payloadB64}`;

  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch (e) {
    return null;
  }

  if (!header || header.alg !== 'HS256') return null;

  // Determine which secret(s) to verify against based on kid
  const secretsToTry = [];
  const prevSecret = getPrevSecret();
  const prevKid = getPrevKid();
  const activeKid = getActiveKid();

  if (header.kid === prevKid && prevSecret) {
    secretsToTry.push(prevSecret);
  } else if (header.kid === activeKid) {
    secretsToTry.push(JWT_SECRET);
  } else {
    // If no kid or unknown kid, try active secret first, then previous secret if configured
    secretsToTry.push(JWT_SECRET);
    if (prevSecret) secretsToTry.push(prevSecret);
  }

  const sigBuf = Buffer.from(signature);
  let signatureValid = false;

  for (const secret of secretsToTry) {
    const expectedSig = signHmac(data, secret);
    const expectedBuf = Buffer.from(expectedSig);
    if (
      sigBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      signatureValid = true;
      break;
    }
  }

  if (!signatureValid) return null;

  // Expiration check
  if (payload.exp && payload.exp < Date.now()) {
    return null; // Token expired
  }

  // Revocation list check by jti (T0.7)
  if (payload.jti) {
    const db = getDb();
    if (db && typeof db.isTokenRevoked === 'function' && db.isTokenRevoked(payload.jti)) {
      return null; // Token revoked
    }
  }

  return payload;
}

function revokeToken(jti, reason) {
  const db = getDb();
  if (db && typeof db.revokeToken === 'function') {
    return db.revokeToken(jti, reason);
  }
  return false;
}

module.exports = {
  generateToken,
  verifyToken,
  revokeToken
};
