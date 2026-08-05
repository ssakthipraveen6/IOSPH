module.exports = {
  collect: (simulations, base) => {
    const sim = simulations['otkr'];
    if (sim && sim.type === 'outage') {
      return { scanQueue: 99, findings: 0, responseTime: 18000 };
    }
    
    return {
      scanQueue: Math.max(0, base.scanQueue + Math.floor((Math.random() - 0.5) * 3)),
      findings: Math.max(0, base.findings + Math.floor((Math.random() - 0.5) * 4)),
      responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 15)
    };
  }
};
