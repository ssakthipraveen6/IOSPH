module.exports = {
  collect: (simulations, base) => {
    const argoSim = simulations['argocd_k8s'];
    if (argoSim && argoSim.type === 'outage') {
      return { syncStatus: 'Failed', latency: 10000, clusterCount: 0 };
    }
    
    return {
      syncStatus: 'Synced',
      latency: base.latency + Math.floor((Math.random() - 0.5) * 5),
      clusterCount: base.clusterCount
    };
  }
};
