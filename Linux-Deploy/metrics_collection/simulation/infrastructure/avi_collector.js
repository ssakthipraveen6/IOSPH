module.exports = {
  collect: (simulations, base) => {
    const aviSim = simulations['avi_load_balancer'];
    if (aviSim && aviSim.type === 'outage') {
      return { connections: 0, ingressFlow: 0, throughput: 0 };
    }
    if (aviSim) {
      return {
        connections: 4600, ingressFlow: 188.2, throughput: 15,
        bitbucket_ingressFlow: 82.1, jenkins_ingressFlow: 36.4, artifactory_ingressFlow: 66.8, argocd_ingressFlow: 26.5,
        bitbucket_latency: 220, jenkins_latency: 860, artifactory_latency: 480, argocd_latency: 190
      };
    }
    const jenkinsSim = simulations['jenkins_k8s'];
    const jFlow = jenkinsSim ? 0 : base.jenkins_ingressFlow;
    const jLat = jenkinsSim ? 10000 : base.jenkins_latency;
    return {
      connections: base.connections + Math.floor((Math.random() - 0.5) * 150),
      ingressFlow: parseFloat((base.ingressFlow + (Math.random() - 0.5) * 4).toFixed(2)),
      throughput: base.throughput + Math.floor((Math.random() - 0.5) * 10),
      bitbucket_ingressFlow: parseFloat((base.bitbucket_ingressFlow + (Math.random() - 0.5) * 2).toFixed(2)),
      jenkins_ingressFlow: parseFloat((jFlow + (Math.random() - 0.5) * 0.5).toFixed(2)),
      artifactory_ingressFlow: parseFloat((base.artifactory_ingressFlow + (Math.random() - 0.5) * 1.5).toFixed(2)),
      argocd_ingressFlow: parseFloat((base.argocd_ingressFlow + (Math.random() - 0.5) * 0.8).toFixed(2)),
      bitbucket_latency: parseFloat((base.bitbucket_latency + (Math.random() - 0.5) * 5).toFixed(2)),
      jenkins_latency: parseFloat((jLat + (Math.random() - 0.5) * 15).toFixed(2)),
      artifactory_latency: parseFloat((base.artifactory_latency + (Math.random() - 0.5) * 8).toFixed(2)),
      argocd_latency: parseFloat((base.argocd_latency + (Math.random() - 0.5) * 4).toFixed(2))
    };
  }
};
