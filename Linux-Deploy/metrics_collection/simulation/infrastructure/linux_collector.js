module.exports = {
  collect: (simulations, base) => {
    const linuxSim = simulations['linux_servers'];
    if (linuxSim && linuxSim.type === 'outage') {
      return { cpu: 0, memory: 0, load: 0 };
    }
    const jenkinsSim = simulations['jenkins_k8s'];
    const artifactorySim = simulations['artifactory'];
    const jCpu = jenkinsSim ? 0 : base.jenkins_cpu;
    const jMem = jenkinsSim ? 0 : base.jenkins_mem;
    const aCpu = artifactorySim ? base.artifactory_cpu + 35 : base.artifactory_cpu;
    const aMem = artifactorySim ? base.artifactory_mem + 15 : base.artifactory_mem;
    
    return {
      cpu: parseFloat((base.cpu + (Math.random() - 0.5) * 5).toFixed(2)),
      memory: parseFloat((base.memory + (Math.random() - 0.5) * 2).toFixed(2)),
      load: parseFloat((base.load + (Math.random() - 0.5) * 0.1).toFixed(2)),
      bitbucket_cpu: parseFloat((base.bitbucket_cpu + (Math.random() - 0.5) * 2).toFixed(2)),
      jenkins_cpu: parseFloat((jCpu + (Math.random() - 0.5) * 3).toFixed(2)),
      artifactory_cpu: parseFloat((aCpu + (Math.random() - 0.5) * 4).toFixed(2)),
      nexusiq_cpu: parseFloat((base.nexusiq_cpu + (Math.random() - 0.5) * 1).toFixed(2)),
      teamcity_cpu: parseFloat((base.teamcity_cpu + (Math.random() - 0.5) * 2).toFixed(2)),
      mcp_cpu: parseFloat((base.mcp_cpu + (Math.random() - 0.5) * 1).toFixed(2)),
      argocd_cpu: parseFloat((base.argocd_cpu + (Math.random() - 0.5) * 0.5).toFixed(2)),
      bitbucket_mem: parseFloat((base.bitbucket_mem + (Math.random() - 0.5) * 0.2).toFixed(2)),
      jenkins_mem: parseFloat((jMem + (Math.random() - 0.5) * 0.3).toFixed(2)),
      artifactory_mem: parseFloat((aMem + (Math.random() - 0.5) * 0.5).toFixed(2)),
      nexusiq_mem: parseFloat((base.nexusiq_mem + (Math.random() - 0.5) * 0.1).toFixed(2)),
      teamcity_mem: parseFloat((base.teamcity_mem + (Math.random() - 0.5) * 0.2).toFixed(2)),
      mcp_mem: parseFloat((base.mcp_mem + (Math.random() - 0.5) * 0.1).toFixed(2)),
      argocd_mem: parseFloat((base.argocd_mem + (Math.random() - 0.5) * 0.05).toFixed(2))
    };
  }
};
