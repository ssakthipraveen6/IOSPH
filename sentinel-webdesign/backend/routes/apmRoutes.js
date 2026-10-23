/**
 * APM routes (/api/apm): answer DATA_UNAVAILABLE until an APM source is connected.
 */
const express = require('express');
const router = express.Router();
const { requestEnvironment, dataUnavailable } = require('./_prototype');

// APM Overview
router.get('/overview', (req, res) => {
  const env = requestEnvironment(req);
  return dataUnavailable(res, env, 'Transaction APM is not wired to real telemetry yet. It will be fed by golden journeys and agent timings.');
});

module.exports = router;
