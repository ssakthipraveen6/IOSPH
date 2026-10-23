// [T0.15 / M2] Python selenium prober retired in favor of @sentinel/synthetics Golden Journeys.
let hasLoggedRetirement = false;

/**
 * Formerly executed Python synthetic prober check.
 * Retired in favor of @sentinel/synthetics Golden Journeys.
 *
 * @param {string} url Endpoint URL to probe
 * @returns {Promise<{ status: string, latency_ms: number|null, error?: string, login_success: boolean|null, skipped?: boolean }>}
 */
function runSeleniumCheck(url) {
  if (!hasLoggedRetirement) {
    console.info('[PROBER] Python selenium prober retired in favor of @sentinel/synthetics Golden Journeys.');
    hasLoggedRetirement = true;
  }
  return Promise.resolve({
    status: 'DATA_UNAVAILABLE',
    skipped: true,
    latency_ms: null,
    error: 'Python prober retired in favor of @sentinel/synthetics',
    login_success: false
  });
}

module.exports = {
  runSeleniumCheck
};
