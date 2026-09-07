module.exports = {
  collect: (simulations, base) => {
    const bitbucketSim = simulations['bitbucket'];
    if (bitbucketSim && bitbucketSim.type === 'outage') {
      return { responseTime: 12000, successRate: 15.4, requests: 0 };
    }
    
    return {
      responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 10),
      successRate: parseFloat((base.successRate - Math.random() * 0.1).toFixed(2)),
      requests: base.requests + Math.floor((Math.random() - 0.5) * 5)
    };
  }
};
