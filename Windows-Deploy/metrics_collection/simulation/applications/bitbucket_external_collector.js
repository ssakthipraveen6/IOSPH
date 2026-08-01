module.exports = {
  collect: (simulations, base) => {
    const sim = simulations['bitbucket_external'];
    if (sim && sim.type === 'outage') {
      return { responseTime: 15000, successRate: 8.2, requests: 0 };
    }
    
    return {
      responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 12),
      successRate: parseFloat((base.successRate - Math.random() * 0.08).toFixed(2)),
      requests: base.requests + Math.floor((Math.random() - 0.5) * 4)
    };
  }
};
