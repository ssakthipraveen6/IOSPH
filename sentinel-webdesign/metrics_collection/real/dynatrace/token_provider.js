/**
 * metrics_collection/real/dynatrace/token_provider.js
 *
 * Dedicated short-lived (30-second) token provider for Dynatrace API v2 (T5.1).
 * Features:
 * - Single-flight lock preventing concurrent redundant mints
 * - Strict 25s TTL enforcement (min(token_ttl - 5s, 25s))
 * - Automatic 401 refresh-and-retry-once
 * - Overrides 15-minute CyberArk cache to ensure credentials never expire in-flight
 */

const credentialProvider = require('@sentinel/config/cyberark/credential_provider');

let cachedToken = null;
let tokenExpiresAt = 0;
let inFlightPromise = null;

const DEFAULT_TOKEN_LIFETIME_MS = 30 * 1000; // 30s token lifetime
const SAFETY_MARGIN_MS = 5 * 1000; // 5s safety margin before expiration
const MAX_CACHE_TTL_MS = 25 * 1000; // 25s ceiling

/**
 * Returns a valid Dynatrace API token, reusing cache if within 25s window,
 * with single-flight concurrency lock.
 */
async function getApiToken(forceRefresh = false) {
  const now = Date.now();

  // Return cached token if valid and not forcing refresh
  if (!forceRefresh && cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  // Join in-flight promise if one is already resolving
  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      if (forceRefresh) {
        credentialProvider.clearCache('dynatrace', 'api_token');
      }

      let token = null;
      try {
        // Pass ttlMs override to CyberArk credential provider (T5.1)
        token = await credentialProvider.getCredential('dynatrace', 'api_token', { ttlMs: MAX_CACHE_TTL_MS });
      } catch (_) {
        const envToken = process.env.DYNATRACE_API_TOKEN;
        if (envToken && envToken.trim().length > 0) {
          token = envToken.trim();
        }
      }

      if (!token) {
        cachedToken = null;
        tokenExpiresAt = 0;
        return null;
      }

      cachedToken = token;
      // TTL = min(token_ttl - 5s, 25s)
      const effectiveTtl = Math.min(DEFAULT_TOKEN_LIFETIME_MS - SAFETY_MARGIN_MS, MAX_CACHE_TTL_MS);
      tokenExpiresAt = Date.now() + effectiveTtl;

      return cachedToken;
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}

/**
 * Executes a Dynatrace API call with automatic token injection and refresh-and-retry-once on 401.
 */
async function executeWithTokenRetry(apiCallFn) {
  let token = await getApiToken(false);
  try {
    return await apiCallFn(token);
  } catch (err) {
    const is401 = err.status === 401 || err.statusCode === 401 || (err.message && err.message.includes('401'));
    if (is401) {
      // Invalidate and refresh token
      token = await getApiToken(true);
      return await apiCallFn(token);
    }
    throw err;
  }
}

// Forgets the cached token.
function resetTokenState() {
  cachedToken = null;
  tokenExpiresAt = 0;
  inFlightPromise = null;
}

module.exports = {
  getApiToken,
  executeWithTokenRetry,
  resetTokenState,
  DEFAULT_TOKEN_LIFETIME_MS,
  MAX_CACHE_TTL_MS
};
