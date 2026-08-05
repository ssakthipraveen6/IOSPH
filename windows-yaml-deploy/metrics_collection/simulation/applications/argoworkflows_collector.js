module.exports = {
  collect: (simulations, base) => {
    const sim = simulations['argoworkflows_k8s'];
    if (sim && sim.type === 'outage') {
      return { activeWorkflows: 0, failedWorkflows: 15, responseTime: 8500 };
    }
    return {
      activeWorkflows: base.activeWorkflows + Math.floor((Math.random() - 0.5) * 2),
      failedWorkflows: Math.max(0, base.failedWorkflows + (Math.random() > 0.95 ? 1 : 0)),
      responseTime: base.responseTime + Math.floor((Math.random() - 0.5) * 8)
    };
  }
};
