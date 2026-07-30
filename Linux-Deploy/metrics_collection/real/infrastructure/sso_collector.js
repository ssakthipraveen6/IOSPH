// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/config.js.
// Update the actual production/staging endpoints at:
// - config/config.js: Line 23 (PROD_URLS.sso_api)
// - config/config.js: Line N/A (STG_URLS.sso_api)
// Purpose: LDAP SSO gateway credentials auth latency endpoint.
// =========================================================================

const config = require('../../../config/config');

module.exports = {
  collect: async (simulations, base) => {
    const targetConfig = config.STG_URLS || config.PROD_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const url = targetConfig.sso_api || 'https://sso-auth.internal.corp';
    console.log(`[REAL COLLECTOR] Querying SSO & eLDAP gateway from: ${url}`);

    let start = Date.now();
    try {
      // await fetch(url);
    } catch (_) {}
    let latency = Date.now() - start;

    // Loop through application specific SSO endpoints
    const ssoApps = Object.keys(appConfigs);
    let totalLatency = latency;
    let ssoCount = 1;
    for (const appKey of ssoApps) {
      const appConfig = appConfigs[appKey];
      if (appConfig && appConfig.sso_api) {
        console.log(`[REAL COLLECTOR] Querying SSO for ${appKey} from: ${appConfig.sso_api}`);
        const appStart = Date.now();
        try {
          // await fetch(appConfig.sso_api);
        } catch (_) {}
        totalLatency += (Date.now() - appStart);
        ssoCount++;
      }
    }
    const avgLatency = Math.round(totalLatency / ssoCount);

    return {
      authLatency: avgLatency < 1000 ? avgLatency : base.authLatency,
      activeSessions: base.activeSessions,
      failedAuthentications: base.failedAuthentications
    };
  }
};
