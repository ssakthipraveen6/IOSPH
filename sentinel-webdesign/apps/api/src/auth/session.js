const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Auto-load .env if present and SENTINEL_JWT_SECRET is not already in process.env
if (!process.env.SENTINEL_JWT_SECRET) {
  try {
    const candidatePaths = [
      path.resolve(__dirname, '../../../.env'),
      path.resolve(__dirname, '../../.env'),
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

const TOKEN_TTL_MS = parseInt(process.env.JWT_TTL_MS, 10) || (8 * 60 * 60 * 1000); // 8 hours default

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

function sign(header, payload, secret) {
  const data = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${signature}`;
}

function generateToken(user, ttlMs = TOKEN_TTL_MS) {
  const now = Date.now();
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    username: user.username,
    role: user.role || 'Operator',
    email: user.email || `${user.username}@enterprise.corp`,
    iat: now,
    exp: now + ttlMs
  };
  return sign(header, payload, JWT_SECRET);
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  const data = `${headerB64}.${payloadB64}`;

  // [SEC-01] Constant-time comparison to prevent timing attacks
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);

  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null; // Invalid signature
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (payload.exp && payload.exp < Date.now()) {
      return null; // Token expired
    }
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = {
  generateToken,
  verifyToken
};
