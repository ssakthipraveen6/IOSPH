module.exports = {
  collect: (simulations, base) => {
    const sim = simulations['performance_center'];
    if (sim && sim.type === 'outage') {
      return { activeTests: 0, avgResponseTime: 25000, throughput: 0 };
    }
    
    return {
      activeTests: Math.max(0, base.activeTests + Math.floor((Math.random() - 0.5) * 3)),
      avgResponseTime: base.avgResponseTime + Math.floor((Math.random() - 0.5) * 20),
      throughput: Math.max(0, base.throughput + Math.floor((Math.random() - 0.5) * 8))
    };
  }
};
