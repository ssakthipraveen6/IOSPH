module.exports = {
  collect: (simulations, base) => {
    const fortifySim = simulations['fortify'];
    if (fortifySim && fortifySim.type === 'outage') {
      return { scanQueue: 50, cpu: 100, failures: 10 };
    }
    
    return {
      scanQueue: Math.max(0, base.scanQueue + Math.floor((Math.random() - 0.5) * 2)),
      cpu: parseFloat((base.cpu + (Math.random() - 0.5) * 3).toFixed(2)),
      failures: base.failures
    };
  }
};
