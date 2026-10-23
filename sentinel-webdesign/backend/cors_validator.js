/**
 * cors_validator.js
 * 
 * Strict CORS origin validator for Sentinel API.
 * Replaces loose substring/suffix matching with parsed hostname verification
 * anchored against approved corporate intranet domains.
 */

function isAllowedOrigin(origin, allowedOrigins = []) {
  // No origin = same-origin request (RefWeb reverse proxy, CLI tools, server-to-server) — allow
  if (!origin) return true;

  // [Phase S8] Loopback origins only when explicitly enabled (test runners, local dev),
  // never in production and never merely because NODE_ENV is unset.
  if (process.env.SENTINEL_ALLOW_LOCALHOST_CORS === 'true' && process.env.NODE_ENV !== 'production'
      && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    return true;
  }

  // [T0.12 REMEDIATED] Exact match against explicit allowlist from config only. Suffix matching deleted.
  return allowedOrigins.includes(origin);
}

// CORS origin callback that allows only the configured origins.
function createCorsOriginCallback(allowedOrigins = []) {
  return (origin, callback) => {
    if (isAllowedOrigin(origin, allowedOrigins)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: Origin '${origin}' is not in the allowed list.`));
  };
}

module.exports = {
  isAllowedOrigin,
  createCorsOriginCallback
};
