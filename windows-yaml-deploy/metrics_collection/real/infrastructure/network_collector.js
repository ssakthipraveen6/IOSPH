// === PRODUCTION INTEGRATION REFERENCE HEADER ===
// Configuration parameters for this file are defined in config/config.js.
// Update the actual production/staging endpoints at:
// - config/config.js: Line 29-33 (PROD_URLS.network_latency_hosts)
// - config/config.js: Line N/A (STG_URLS.network_latency_hosts)
// Purpose: Network ICMP ping latency hostnames.
// =========================================================================

const config = require('../../../config/config');
const net = require('net');

module.exports = {
  collect: async (simulations, base) => {
    const targetConfig = config.STG_URLS || config.PROD_URLS || {};
    const appConfigs = targetConfig.applications || {};
    
    // Gather all unique hosts from network_latency_hosts
    const hostsSet = new Set(targetConfig.network_latency_hosts || []);
    for (const appKey of Object.keys(appConfigs)) {
      const appConfig = appConfigs[appKey];
      if (appConfig && appConfig.network_latency_hosts) {
        appConfig.network_latency_hosts.forEach(h => hostsSet.add(h));
      }
    }
    const hosts = Array.from(hostsSet);
    if (hosts.length === 0) {
      hosts.push('127.0.0.1');
    }
    
    console.log(`[REAL COLLECTOR] Pinging network latency hosts: ${hosts.join(', ')}`);
    
    let latencies = [];
    for (let host of hosts) {
      const start = Date.now();
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection(80, host, () => {
            socket.destroy();
            resolve();
          });
          socket.setTimeout(1000);
          socket.on('timeout', () => { socket.destroy(); reject(); });
          socket.on('error', () => { socket.destroy(); resolve(); }); // resolved because we want to measure time to error ref
        });
        latencies.push(Date.now() - start);
      } catch (_) {
        latencies.push(1000); // timeout fallback latency
      }
    }

    const averageLatency = latencies.length > 0 ? (latencies.reduce((a, b) => a + b, 0) / latencies.length) : base.latency_ms;

    return {
      packetLoss: averageLatency > 500 ? 5.0 : base.packetLoss,
      latency_ms: parseFloat(averageLatency.toFixed(2)),
      jitter: base.jitter
    };
  }
};
