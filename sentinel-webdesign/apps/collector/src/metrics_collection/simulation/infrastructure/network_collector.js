module.exports = {
  collect: (simulations, base) => {
    const sim = simulations['network_latency'];
    if (sim && sim.type === 'outage') {
      return { packetLoss: 88.5, latency_ms: 1250, jitter: 120 };
    }
    return {
      packetLoss: parseFloat((base.packetLoss + (Math.random() > 0.99 ? 0.2 : 0.0)).toFixed(2)),
      latency_ms: parseFloat((base.latency_ms + (Math.random() - 0.5) * 2).toFixed(2)),
      jitter: parseFloat((base.jitter + (Math.random() - 0.5) * 0.5).toFixed(2))
    };
  }
};
