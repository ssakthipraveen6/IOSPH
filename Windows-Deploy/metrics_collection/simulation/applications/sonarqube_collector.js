module.exports = {
  collect: (simulations, base) => {
    const sim = simulations['sonarqube'];
    if (sim && sim.type === 'outage') {
      return { qualityGatesPassed: 0, analysisQueue: 45, responseTime: 9200 };
    }
    return {
      qualityGatesPassed: base.qualityGatesPassed,
      analysisQueue: Math.max(0, base.analysisQueue + Math.floor((Math.random() - 0.5) * 2)),
      responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 12)
    };
  }
};
