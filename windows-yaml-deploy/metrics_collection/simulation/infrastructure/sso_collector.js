module.exports = {
  collect: (simulations, base) => {
    const sim = simulations['sso_gateway'];
    if (sim && sim.type === 'outage') {
      return { authLatency: 9500, activeSessions: 120, failedAuthentications: 850 };
    }
    return {
      authLatency: parseFloat((base.authLatency + (Math.random() - 0.5) * 5).toFixed(2)),
      activeSessions: base.activeSessions + Math.floor((Math.random() - 0.5) * 50),
      failedAuthentications: Math.max(0, base.failedAuthentications + (Math.random() > 0.98 ? 1 : 0))
    };
  }
};
