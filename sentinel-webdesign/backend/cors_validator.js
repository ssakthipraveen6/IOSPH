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

  // [T0.12 REMEDIATED] Exact match against explicit allowlist from config only. Suffix matching deleted.
  return allowedOrigins.includes(origin);
}

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
