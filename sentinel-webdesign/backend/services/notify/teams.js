/**
 * backend/services/notify/teams.js
 *
 * M5 Task 5.5: Microsoft Teams Incoming Webhook Notification Provider
 * Formats structured problem notification cards with link to SENTINEL.
 * If webhook URL is blank/unconfigured, safely skips with zero side effects.
 */

const { SEVERITY, normalizeSeverity } = require('@sentinel/shared-constants');

/**
 * Sends a problem notification to Microsoft Teams via Incoming Webhook
 * @param {Object} problem Problem details
 * @param {string} [webhookUrl] Optional explicit webhook URL, otherwise loaded from env/config
 * @returns {Promise<{status: string, reason?: string, httpStatus?: number}>}
 */
function loadNotifyConfig() {
  try {
    const yamlConfig = require('../../config/yaml_config');
    return (yamlConfig.loadGlobalConfig() || {}).notifications || {};
  } catch (_) {
    return {};
  }
}

/**
 * @param {Object} problem
 * @param {string} [webhookUrl] explicit URL; otherwise SENTINEL_TEAMS_WEBHOOK_URL or notifications.teams_webhook_url
 * @param {Object} [options]
 * @param {'opened'|'resolved'} [options.event='opened']
 * @param {string} [options.baseUrl] SENTINEL UI base URL for links (notifications.sentinel_base_url)
 */
async function sendProblemNotification(problem, webhookUrl = null, options = {}) {
  const cfg = loadNotifyConfig();
  const url = (webhookUrl || process.env.SENTINEL_TEAMS_WEBHOOK_URL || cfg.teams_webhook_url || '').trim();
  const event = options.event === 'resolved' ? 'resolved' : 'opened';
  const baseUrl = String(options.baseUrl || process.env.SENTINEL_BASE_URL || cfg.sentinel_base_url || '').replace(/\/+$/, '');

  // Acceptance criteria: blank URL turns it off
  if (!url) {
    return {
      status: 'SKIPPED',
      reason: 'Teams incoming webhook URL is blank or unconfigured'
    };
  }

  const title = problem.title || `Incident on ${problem.suspect_entity || 'System'}`;
  const normSev = normalizeSeverity(problem.severity || 'Critical');
  const themeColor = event === 'resolved' ? '16A34A' : (normSev === SEVERITY.CRITICAL ? 'DC2626' : normSev === SEVERITY.WARNING ? 'F59E0B' : '2563EB');
  const env = problem.environment || 'staging';
  const confidenceText = typeof problem.confidence === 'number' ? `${Math.round(problem.confidence * 100)}%` : 'Unknown';
  const actions = baseUrl ? [
    {
      '@type': 'OpenURI',
      name: 'Open Problem in SENTINEL',
      targets: [{ os: 'default', uri: `${baseUrl}/?tab=problems&env=${encodeURIComponent(env)}&problem=${encodeURIComponent(problem.id)}` }]
    },
    {
      '@type': 'OpenURI',
      name: 'Download Evidence Pack',
      targets: [{ os: 'default', uri: `${baseUrl}/api/problems/${encodeURIComponent(problem.id)}/evidence?format=html` }]
    }
  ] : [];

  const cardPayload = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    summary: `SENTINEL Problem ${event === 'resolved' ? 'resolved' : 'opened'}: ${title}`,
    themeColor,
    title: event === 'resolved'
      ? `✅ SENTINEL Problem Resolved: ${title}`
      : `🚨 [${normSev}] SENTINEL Problem Detected: ${title}`,
    sections: [
      {
        activityTitle: `Suspected layer: ${problem.top_layer || 'unknown'}`,
        activitySubtitle: `Suspect entity: ${problem.suspect_entity || 'unknown'}`,
        facts: [
          { name: 'Problem ID', value: problem.id },
          { name: 'Environment', value: String(env).toUpperCase() },
          { name: 'Diagnosis Layer', value: problem.top_layer || 'unknown' },
          { name: 'Confidence', value: confidenceText },
          { name: 'Grouped Alerts', value: String(problem.alert_count || 1) },
          { name: event === 'resolved' ? 'Resolved At' : 'Detected At', value: (event === 'resolved' ? problem.resolved_at : problem.created_at) || new Date().toISOString() }
        ],
        markdown: true
      }
    ],
    potentialAction: actions
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cardPayload)
    });

    return {
      status: res.ok ? 'DELIVERED' : 'FAILED',
      httpStatus: res.status
    };
  } catch (err) {
    return {
      status: 'FAILED',
      error: err.message
    };
  }
}

/**
 * Weekly scorecard summary (P8): one card listing every product's numbers.
 * Missing values are shown as "n/a", never as 0.
 */
async function sendScorecardSummary(scorecards = [], { environment = 'staging', weekStart = null, webhookUrl = null } = {}) {
  const cfg = loadNotifyConfig();
  const url = (webhookUrl || process.env.SENTINEL_TEAMS_WEBHOOK_URL || cfg.teams_webhook_url || '').trim();
  if (!url) {
    return { status: 'SKIPPED', reason: 'Teams incoming webhook URL is blank or unconfigured' };
  }
  const fmt = (v, suffix = '') => (typeof v === 'number' ? `${v}${suffix}` : 'n/a');
  const cardPayload = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    summary: `SENTINEL weekly scorecard ${weekStart || ''}`.trim(),
    themeColor: '2563EB',
    title: `📊 SENTINEL weekly scorecard · ${String(environment).toUpperCase()} · week of ${weekStart || 'n/a'}`,
    sections: scorecards.map(sc => ({
      activityTitle: sc.product_name || sc.product_id,
      facts: [
        { name: 'Availability', value: fmt(sc.availability_pct, '%') },
        { name: 'p95', value: fmt(sc.p95_ms, ' ms') },
        { name: 'p95 vs last week', value: fmt(sc.p95_change_pct, '%') },
        { name: 'Change points', value: fmt(sc.change_points_count) },
        { name: 'Open CVEs', value: fmt(sc.open_cves_count) },
        { name: 'Top cause', value: sc.top_cause || 'n/a' }
      ]
    }))
  };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cardPayload) });
    return { status: res.ok ? 'DELIVERED' : 'FAILED', httpStatus: res.status };
  } catch (err) {
    return { status: 'FAILED', error: err.message };
  }
}

module.exports = {
  sendProblemNotification,
  sendScorecardSummary
};
