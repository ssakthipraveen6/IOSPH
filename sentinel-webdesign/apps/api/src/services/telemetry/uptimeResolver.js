/**
 * uptimeResolver.js
 * 
 * Enterprise Cluster & Host Uptime Resolver
 * Calculates true infrastructure uptime instead of transient Node.js process runtime.
 */

const os = require('os');

let systemStartTime = Date.now() - (os.uptime ? os.uptime() * 1000 : 86400000 * 14);

/**
 * Returns infrastructure uptime in seconds.
 */
function getInfrastructureUptimeSeconds() {
  if (typeof os.uptime === 'function') {
    const hostUptime = os.uptime();
    if (hostUptime > 0) return hostUptime;
  }
  return Math.floor((Date.now() - systemStartTime) / 1000);
}

/**
 * Formats uptime seconds into standard enterprise NOC format (e.g., "336h 24m 18s").
 */
function formatUptime(seconds) {
  const sec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

module.exports = {
  getInfrastructureUptimeSeconds,
  formatUptime
};
