module.exports = {
  collect: (simulations, base) => {
    const teamcitySim = simulations['teamcity'];
    if (teamcitySim && teamcitySim.type === 'outage') {
      return { activeBuilds: 0, agents: 0, load: 100 };
    }
    
    return {
      activeBuilds: Math.max(0, base.activeBuilds + Math.floor((Math.random() - 0.5) * 2)),
      agents: base.agents,
      load: parseFloat((base.load + (Math.random() - 0.5) * 4).toFixed(2))
    };
  }
};
