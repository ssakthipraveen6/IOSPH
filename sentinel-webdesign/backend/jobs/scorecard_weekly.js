/**
 * backend/jobs/scorecard_weekly.js — P8
 *
 * Monday 06:00 server-local time (configurable `jobs.scorecard.weekday/hour`):
 * computes every enabled product's scorecard from stored data, stores it in
 * Postgres (`product_scorecard`) and sends one Teams summary per environment.
 * Runs once per week; a restart later on Monday still produces it.
 */

const scorecard = require('../../ai_analysis/scorecard');
const teams = require('../services/notify/teams');
const yamlConfig = require('../config/yaml_config');

/** Local date (YYYY-MM-DD) of the Monday that starts the week containing `date`. */
function weekStartOf(date, weekday = 1) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (d.getDay() - weekday + 7) % 7;
  d.setDate(d.getDate() - diff);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True when the weekly run is due and has not run for this week yet. */
function isScorecardDue(nowMs, lastWeekDone, { weekday = 1, hour = 6 } = {}) {
  const now = new Date(nowMs);
  if (now.getDay() !== weekday) return false; // only on the scorecard day (a restart later that day still runs it)
  const week = weekStartOf(now, weekday);
  if (lastWeekDone === week) return false;
  const [y, m, d] = week.split('-').map(Number);
  const dueAt = new Date(y, m - 1, d, hour, 0, 0, 0).getTime();
  return nowMs >= dueAt;
}

// Enabled products from the manifests.
function enabledProducts() {
  const apps = yamlConfig.loadAllApplications() || {};
  return Object.entries(apps)
    .filter(([id, app]) => app && app.enabled !== false && (!app.id || app.id === id))
    .map(([id, app]) => ({ id, name: app.name || id }));
}

// Builds the weekly scorecards and sends them to Teams.
async function runWeeklyScorecards({
  environments = ['prod', 'staging'],
  nowMs = Date.now(),
  weekday = 1,
  products = enabledProducts(),
  compute = scorecard.computeScorecardFromData,
  notifier = teams
} = {}) {
  const week = weekStartOf(new Date(nowMs), weekday);
  const summary = { week_start: week };
  for (const env of environments) {
    const cards = [];
    for (const p of products) {
      const card = await compute({ productId: p.id, environment: env, weekStart: week, nowMs });
      if (card) {
        card.product_name = p.name;
        cards.push(card);
      }
    }
    const sent = await notifier.sendScorecardSummary(cards, { environment: env, weekStart: week });
    summary[env] = { products: cards.length, teams: sent && sent.status };
  }
  return summary;
}

module.exports = { runWeeklyScorecards, isScorecardDue, weekStartOf };
