const config = require('@sentinel/config');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');
const net = require('net');

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
  if (cachedHostList.length === 0) {
    cachedHostList.push('127.0.0.1');
  }
  return cachedHostList;
}

module.exports = {
  clearHostCache: () => { cachedHostList = null; },
  collect: async (simulations, base = {}) => {
    const hosts = getHostList();
    const latencies = [];

    const tasks = hosts.map(host => async () => {
      const start = Date.now();
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection(80, host, () => {
            socket.destroy();
            resolve();
          });
          socket.setTimeout(1000);
          socket.on('timeout', () => { socket.destroy(); reject(); });
          socket.on('error', () => { socket.destroy(); resolve(); });
        });
        latencies.push(Date.now() - start);
      } catch (_) {
        latencies.push(1000);
      }
    });

    await runWithConcurrencyLimit(tasks, 50);

    const averageLatency = latencies.length > 0 ? (latencies.reduce((a, b) => a + b, 0) / latencies.length) : (base.latency_ms || 1.25);

    return {
      packetLoss: averageLatency > 500 ? 5.0 : (base.packetLoss || 0.0),
      latency_ms: parseFloat(averageLatency.toFixed(2)),
      jitter: base.jitter || 0.15
    };
  }
};
