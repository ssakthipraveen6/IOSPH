/**
 * Prototype-view guard (M1.1).
 *
 * Some views were built as UI prototypes with sample data. The project rule is
 * "never fabricate in prod or staging", so their sample payloads are served
 * only in the demo environment. Prod and staging get an explicit
 * DATA_UNAVAILABLE answer until the view is wired to real telemetry.
 */
function requestEnvironment(req) {
  return req.sentinelEnv || 'staging';
}

// Sends the standard DATA_UNAVAILABLE response with a reason.
function dataUnavailable(res, env, reason) {
  return res.json({
    status: 'DATA_UNAVAILABLE',
    environment: env,
    prototype: true,
    reason
  });
}

module.exports = { requestEnvironment, dataUnavailable };
