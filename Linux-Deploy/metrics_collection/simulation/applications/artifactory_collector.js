module.exports = {
  collect: (simulations, base) => {
    const artifactorySim = simulations['artifactory'];
    if (artifactorySim && artifactorySim.type === 'outage') {
      return { heap: 100, space: base.space, responseTime: 10000, status: 'Critical' };
    }
    
    if (artifactorySim) {
      const volume = artifactorySim.leakVolume || 50;
      return {
        heap: 50 + (volume / 100) * 49.9,
        space: base.space,
        latency: 45 + (volume * 4)
      };
    }
    
    return {
      heap: parseFloat((base.heap + (Math.random() - 0.5) * 1.5).toFixed(2)),
      space: base.space,
      latency: base.latency + Math.floor((Math.random() - 0.5) * 5)
    };
  }
};
