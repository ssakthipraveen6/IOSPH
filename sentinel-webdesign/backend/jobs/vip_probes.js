/**
 * backend/jobs/vip_probes.js — P1
 *
 * Probes every product VIP (`layers.vip` / `endpoints.<env>.vip`) through AVI.
 * Runs on BOTH app nodes; each result is tagged probe_node = this host, so the
 * two vantage points can be compared. Writes vip.* metrics and fills the cache
 * read by the AVI view (/api/avi/overview).
 *
 * [Q4] Each environment's results are then handed to onResults(env, results);
 * by default that is inventory/sources/vip_discovery.js recordVipDiscovery,
 * which adds the DNS answers (resolves_to) and certificate SANs (cert_san)
 * under each VIP in the topology. Pass onResults: null to disable.
 */

const networkCollector = require('../../metrics_collection/real/infrastructure/network_collector');
const db = require('../../database/db');

// VIP discovery hook, when the inventory module is present.
function defaultDiscovery() {
  try { return require('../../inventory/sources/vip_discovery').recordVipDiscovery; } catch (_) { return null; }
}

// Probes every VIP (DNS, TCP, TLS, total time) and stores the results.
async function runVipProbes({ environments = ['prod', 'staging'], collector = networkCollector, store = db, onResults } = {}) {
  if (onResults === undefined) onResults = defaultDiscovery();
  const summary = {};
  for (const env of environments) {
    const results = await collector.collectVips(env, store);
    summary[env] = {
      vips: results.length,
      healthy: results.filter(r => r.status === 'HEALTHY').length,
      unavailable: results.filter(r => r.status === 'DATA_UNAVAILABLE').length
    };
    if (typeof onResults === 'function') {
      try {
        const discovery = await onResults(env, results);
        if (discovery && typeof discovery === 'object') summary[env].discovery = discovery;
      } catch (err) { summary[env].discovery_error = err.message; }
    }
  }
  return summary;
}

module.exports = { runVipProbes };
