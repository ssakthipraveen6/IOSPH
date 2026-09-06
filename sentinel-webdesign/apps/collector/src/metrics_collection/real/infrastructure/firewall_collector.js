const config = require('../../../config/config');

/**
 * firewall_collector.js
 * 
 * Domain-Expert Firewall & Network Security Collector
 * Models 5-tuple ACL rules, hit-count velocity, shadow rule detection,
 * and zero-trust perimeter segmentation compliance.
 */
module.exports = {
  collect: async (simulations, base = {}) => {
    const isOutage = simulations && simulations.firewall && simulations.firewall.type === 'outage';

    return {
      firewall_status: isOutage ? 'CRITICAL - ACL DROP SPIKE' : 'HEALTHY',
      total_active_rules: 1420,
      shadow_rules_detected: 0,
      rule_hit_count_delta_24h: isOutage ? 4892000 : 3840120,
      denied_packets_per_sec: isOutage ? 480 : 12,
      permitted_packets_per_sec: isOutage ? 1200 : 18500,
      syn_flood_mitigation_active: false,
      threat_prevention_engine_status: 'Active (Signatures Current)',
      policy_drift_compliance_pct: isOutage ? 78.5 : 100.0,
      dmz_transit_latency_ms: isOutage ? 48.2 : 0.85
    };
  }
};
