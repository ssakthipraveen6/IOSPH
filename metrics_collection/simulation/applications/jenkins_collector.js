module.exports = {
  collect: (simulations, base) => {
    const jenkinsSim = simulations['jenkins_k8s'];
    if (jenkinsSim && jenkinsSim.type === 'outage') {
      return { executors: 0, queue: 45, responseTime: 15000, podsOnline: 0, podsTotal: 5 };
    }
    
    return {
      executors: base.executors,
      queue: Math.max(0, base.queue + Math.floor((Math.random() - 0.5) * 2)),
      responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 15),
      podsOnline: base.podsOnline,
      podsTotal: base.podsTotal
    };
  }
};
