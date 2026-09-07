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

  // Exact match against explicit allowlist (localhost, dev ports, explicit env var)
  if (allowedOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();

    // Check that hostname strictly equals or ends with a .-anchored suffix of approved domains
    if (
      hostname === 'internal' ||
      hostname.endsWith('.internal') ||
      hostname === 'corp' ||
      hostname.endsWith('.corp') ||
      hostname === 'refweb.internal.corp' ||
      hostname.endsWith('.refweb.internal.corp')
    ) {
      return true;
    }
  } catch (err) {
    // Malformed origin URL
    return false;
  }

  return false;
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
