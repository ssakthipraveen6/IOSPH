module.exports = {
  collect: (simulations, base) => {
    const sim = simulations['github'];
    if (sim && sim.type === 'outage') {
      return { apiRateLimitRemaining: 0, pendingPullRequests: 120, responseTime: 15000 };
    }
    return {
      apiRateLimitRemaining: base.apiRateLimitRemaining - Math.floor(Math.random() * 5),
      pendingPullRequests: base.pendingPullRequests + Math.floor((Math.random() - 0.5) * 3),
      responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 10)
    };
  }
};
