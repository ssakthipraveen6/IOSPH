/**
 * Unified Environment URL and Configuration Resolver
 * Returns environment-specific endpoints based on active runtime environment context.
 */

function getEnvUrls(config, environment) {
  const targetEnv = (environment || global.runtimeEnvironment || (config && config.ENVIRONMENT) || 'staging').toLowerCase();
  if (targetEnv === 'production' || targetEnv === 'prod') {
    return (config && config.PROD_URLS) ? config.PROD_URLS : {};
  }
  return (config && config.STG_URLS) ? config.STG_URLS : {};
}

module.exports = { getEnvUrls };
