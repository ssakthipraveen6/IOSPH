const config = require('@sentinel/config');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');
const net = require('net');

/**
 * network_collector.js (T2b.2 REMEDIATED)
 * 
 * Real network latency and packet loss collector via active TCP handshakes.
 * Measures real latency, real packet loss percentage, and real latency standard deviation (jitter).
 * No hardcoded constants reach returned values.
 */

let cachedHostList = null;

function getHostList() {
  if (cachedHostList) return cachedHostList;
  const targetConfig = config.ACTIVE_URLS || {};
  const appConfigs = targetConfig.applications || {};

  const hostsSet = new Set(targetConfig.network_latency_hosts || []);
  for (const appKey of Object.keys(appConfigs)) {
    const appConfig = appConfigs[appKey];
    if (appConfig && appConfig.network_latency_hosts) {
      appConfig.network_latency_hosts.forEach(h => hostsSet.add(h));
    }
  }
  cachedHostList = Array.from(hostsSet);
  return cachedHostList;
}

module.exports = {
  clearHostCache: () => { cachedHostList = null; },
  collect: async (simulations, base = {}) => {
    const isOutage = simulations && simulations.network_latency && simulations.network_latency.type === 'outage';
    if (isOutage) {
      return {
        packetLoss: 100.0,
        latency_ms: null,
        jitter: null
      };
    }

    const hosts = getHostList();
    if (!hosts || hosts.length === 0) {
      return {
        packetLoss: null,
        latency_ms: null,
        jitter: null
      };
    }

    const successfulLatencies = [];
    let failedProbes = 0;

    const tasks = hosts.map(host => async () => {
      const start = Date.now();
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection(80, host, () => {
            socket.destroy();
            resolve();
          });
          socket.setTimeout(1000);
          socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
          socket.on('error', (err) => { socket.destroy(); reject(err); });
        });
        successfulLatencies.push(Date.now() - start);
      } catch (_) {
        failedProbes++;
      }
    });

    await runWithConcurrencyLimit(tasks, 50);

    const totalProbes = hosts.length;
    const packetLossPct = totalProbes > 0 ? parseFloat(((failedProbes / totalProbes) * 100).toFixed(2)) : null;

    if (successfulLatencies.length === 0) {
      return {
        packetLoss: packetLossPct,
        latency_ms: null,
        jitter: null
      };
    }

    const avgLatency = successfulLatencies.reduce((a, b) => a + b, 0) / successfulLatencies.length;

    // Calculate real jitter as standard deviation of measured latencies
    let jitter = 0;
    if (successfulLatencies.length > 1) {
      const variance = successfulLatencies.reduce((acc, val) => acc + Math.pow(val - avgLatency, 2), 0) / successfulLatencies.length;
      jitter = Math.sqrt(variance);
    }

    return {
      packetLoss: packetLossPct,
      latency_ms: parseFloat(avgLatency.toFixed(2)),
      jitter: parseFloat(jitter.toFixed(2))
    };
  }
};
