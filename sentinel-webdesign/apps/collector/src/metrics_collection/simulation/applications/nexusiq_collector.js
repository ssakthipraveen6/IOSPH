module.exports = {
  collect: (simulations, base) => {
    const nexusSim = simulations['nexusiq'];
    if (nexusSim && nexusSim.type === 'outage') {
      return { scanQueue: 100, violations: 500, responseTime: 10000 };
    }
    
    return {
      scanQueue: Math.max(0, base.scanQueue + Math.floor((Math.random() - 0.5) * 2)),
      violations: base.violations,
      responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 20)
    };
  }
};
