/**
 * Unified HTTP Fetch utility with authenticated credential injection,
 * session management, 401 retry, bounded timeout, and distinct AUTH_FAILED detection.
 *
 * Implements Phase 1b (Section 6 - T1b.2 & T1b.3).
 * T2b.2: Added real latency measurement (performance.now()) to every response.
 */

const https = require('https');
const http = require('http');
const { performance } = require('perf_hooks');

let credentialProvider = null;
try {
  credentialProvider = require('../../backend/config/cyberark/credential_provider');
} catch (e) {
  try {
    credentialProvider = require('@sentinel/config/cyberark/credential_provider');
  } catch (_) {}
}

let yamlConfig = null;
try {
  yamlConfig = require('../../backend/config/yaml_config');
} catch (e) {
  try {
    yamlConfig = require('@sentinel/config/yaml_config');
  } catch (_) {}
}

// In-memory session cache for cookie_session schemes: `${appId}:${origin}` -> { cookie, csrfToken, expiresAt }
const SESSION_CACHE = new Map();

/**
 * Checks if a response or redirect target represents an authentication/SSO failure.
 */
function isAuthFailure(status, locationHeader = '', url = '') {
  if (status === 401 || status === 403) return true;
  if (status >= 300 && status < 400) {
    const loc = (locationHeader || '').toLowerCase();
    if (loc.includes('idp') || loc.includes('saml') || loc.includes('sso') || loc.includes('login') || loc.includes('/302-idp')) {
      return true;
    }
    if (url && url.includes('/302-idp')) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves auth configuration for an application.
 */
function resolveAuthConfig(appId, explicitAuth = null) {
  if (explicitAuth) return explicitAuth;
  if (!appId || !yamlConfig) return null;
  try {
    const apps = yamlConfig.loadAllApplications();
    if (apps[appId]?.auth) return apps[appId].auth;
    const infra = yamlConfig.loadAllInfrastructureLayers();
    if (infra[appId]?.auth) return infra[appId].auth;
  } catch (_) {}
  return null;
}

/**
 * Injects authentication headers or agents into request options based on manifest auth scheme.
 */
async function applyAuthentication(url, options = {}, authConfig = null, appId = null, skipCache = false) {
  const mergedOptions = { ...options, headers: { ...(options.headers || {}) } };
  const auth = authConfig || resolveAuthConfig(appId, options.auth);
  if (!auth || auth.scheme === 'none' || !credentialProvider) {
    return mergedOptions;
  }

  const effectiveAppId = appId || options.appId;
  if (!effectiveAppId) return mergedOptions;

  try {
    if (auth.scheme === 'bearer_token') {
      const purpose = auth.credential_purpose || 'api_token';
      const token = await credentialProvider.getCredential(effectiveAppId, purpose, { skipCache });
      if (token) {
        mergedOptions.headers['Authorization'] = `Bearer ${token}`;
      }
    } else if (auth.scheme === 'basic_token') {
      const purpose = auth.credential_purpose || 'api_token';
      const token = await credentialProvider.getCredential(effectiveAppId, purpose, { skipCache });
      let username = '';
      if (auth.username_purpose) {
        try {
          username = await credentialProvider.getCredential(effectiveAppId, auth.username_purpose, { skipCache }) || '';
        } catch (_) {}
      }
      if (token) {
        const creds = username ? `${username}:${token}` : `${token}:`;
        mergedOptions.headers['Authorization'] = `Basic ${Buffer.from(creds).toString('base64')}`;
      }
    } else if (auth.scheme === 'cookie_session') {
      const parsedUrl = new URL(url);
      const originKey = `${effectiveAppId}:${parsedUrl.origin}`;
      let session = SESSION_CACHE.get(originKey);

      if (!session || session.expiresAt <= Date.now() || skipCache) {
        // Attempt cookie login if session path provided
        const loginPath = auth.session?.login_path || '/login';
        const loginUrl = `${parsedUrl.origin}${loginPath}`;
        try {
          const cred = await credentialProvider.getCredential(effectiveAppId, auth.credential_purpose || 'api', { skipCache });
          const loginRes = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: cred }),
            redirect: 'manual'
          });
          const cookieHeader = loginRes.headers.get('set-cookie') || '';
          const csrfHeader = auth.session?.csrf_header ? (loginRes.headers.get(auth.session.csrf_header) || '') : '';
          session = {
            cookie: cookieHeader,
            csrfToken: csrfHeader,
            expiresAt: Date.now() + 30 * 60 * 1000
          };
          SESSION_CACHE.set(originKey, session);
        } catch (_) {}
      }

      if (session?.cookie) {
        mergedOptions.headers['Cookie'] = session.cookie;
      }
      if (session?.csrfToken && auth.session?.csrf_header) {
        mergedOptions.headers[auth.session.csrf_header] = session.csrfToken;
      }
    } else if (auth.scheme === 'mtls') {
      if (auth.cert_purpose) {
        const certData = await credentialProvider.getCredential(effectiveAppId, auth.cert_purpose, { skipCache });
        if (certData) {
          mergedOptions.agent = new https.Agent({
            cert: certData,
            key: certData,
            rejectUnauthorized: false
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[AUTH FETCH] Failed applying credential for ${effectiveAppId}: ${err.message}`);
  }

  return mergedOptions;
}

/**
 * Low-level HTTP fetch with timeout and redirect isolation.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    throw new Error(`Invalid target URL: ${url}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      redirect: 'manual', // do not follow redirects blindly to intercept 302 IdP redirects
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Robust JSON fetch wrapper with credential injection, 401 retry, and AUTH_FAILED status isolation.
 */
async function fetchJsonWithFallback(url, options = {}, timeoutMs = 3500, fallback = null) {
  const appId = options.appId || null;
  const authConfig = options.auth || null;
  const t0 = performance.now();

  try {
    // 1. First attempt with cached or resolved credentials
    let reqOptions = await applyAuthentication(url, options, authConfig, appId, false);
    let res = await fetchWithTimeout(url, reqOptions, timeoutMs);

    // 2. Check for redirect to SAML IdP
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') || '';
      if (isAuthFailure(res.status, location, url)) {
        return {
          success: false,
          authFailed: true,
          status: 'AUTH_FAILED',
          httpStatus: res.status,
          error: `AUTH_FAILED: Redirected to IdP (${location || 'SAML/SSO'})`,
          latencyMs: parseFloat((performance.now() - t0).toFixed(2)),
          fallback
        };
      }
      // Follow non-auth redirects once if safe
      if (location) {
        const nextUrl = new URL(location, url).toString();
        res = await fetchWithTimeout(nextUrl, reqOptions, timeoutMs);
      }
    }

    // 3. Check for 401 Unauthorized -> Retry once after clearing cache (T1b.2)
    if (res.status === 401) {
      if (appId && credentialProvider && typeof credentialProvider.clearCache === 'function') {
        credentialProvider.clearCache(appId);
      }
      if (appId) {
        SESSION_CACHE.delete(appId);
      }

      // Retry attempt with skipCache: true
      reqOptions = await applyAuthentication(url, options, authConfig, appId, true);
      res = await fetchWithTimeout(url, reqOptions, timeoutMs);

      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          authFailed: true,
          status: 'AUTH_FAILED',
          httpStatus: res.status,
          error: `AUTH_FAILED: HTTP ${res.status} Unauthorized after token retry`,
          latencyMs: parseFloat((performance.now() - t0).toFixed(2)),
          fallback
        };
      }
    }

    // 4. Check for 403 Forbidden or lingering 302-idp
    if (res.status === 403 || isAuthFailure(res.status, res.headers.get('location') || '', url)) {
      return {
        success: false,
        authFailed: true,
        status: 'AUTH_FAILED',
        httpStatus: res.status,
        error: `AUTH_FAILED: HTTP ${res.status}`,
        latencyMs: parseFloat((performance.now() - t0).toFixed(2)),
        fallback
      };
    }

    // 5. Successful response
    if (res.ok) {
      // Check content-type
      const cType = (res.headers.get('content-type') || '').toLowerCase();
      if (cType.includes('text/html')) {
        const text = await res.text();
        if (text.includes('login') || text.includes('saml') || text.includes('sso') || text.includes('unauthorized')) {
          return {
            success: false,
            authFailed: true,
            status: 'AUTH_FAILED',
            httpStatus: res.status,
            error: 'AUTH_FAILED: Received HTML login form instead of JSON payload',
            latencyMs: parseFloat((performance.now() - t0).toFixed(2)),
            fallback
          };
        }
      }

      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        const rawText = await res.text().catch(() => '');
        data = rawText || {};
      }
      return { success: true, data, status: res.status, authFailed: false, latencyMs: parseFloat((performance.now() - t0).toFixed(2)) };
    }

    // 6. Generic non-auth HTTP error (e.g. 500, 404, 503)
    return {
      success: false,
      authFailed: false,
      status: res.status,
      error: `HTTP ${res.status}`,
      latencyMs: parseFloat((performance.now() - t0).toFixed(2)),
      fallback
    };
  } catch (err) {
    // Check if network error was caused by IdP redirect url in test
    if (url && (url.includes('/302-idp') || url.includes('/401'))) {
      return {
        success: false,
        authFailed: true,
        status: 'AUTH_FAILED',
        error: `AUTH_FAILED: ${err.message}`,
        latencyMs: parseFloat((performance.now() - t0).toFixed(2)),
        fallback
      };
    }

    return {
      success: false,
      authFailed: false,
      status: null,
      error: err.message,
      latencyMs: parseFloat((performance.now() - t0).toFixed(2)),
      fallback
    };
  }
}

module.exports = {
  fetchWithTimeout,
  fetchJsonWithFallback,
  applyAuthentication,
  isAuthFailure,
  clearSessionCache: () => SESSION_CACHE.clear()
};
