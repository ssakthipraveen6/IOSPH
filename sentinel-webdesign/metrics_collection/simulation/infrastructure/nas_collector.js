module.exports = {
  collect: (simulations, base) => {
    const nasSim = simulations['nas_performance'];
    if (nasSim && nasSim.type === 'outage') {
      return { iops: 0, throughput: 0, spaceUsed: 100 };
    }
    
    if (nasSim && nasSim.type === 'disk_full') {
      return {
        iops: 420, throughput: 85, spaceUsed: 98.4,
        bitbucket_spaceUsed: 15.4 + 40, jenkins_spaceUsed: 8.2 + 50, artifactory_spaceUsed: 22.5 + 25,
        nexusiq_spaceUsed: 1.8 + 35, teamcity_spaceUsed: 6.3 + 40
      };
    }
    
    const artifactorySim = simulations['artifactory'];
    const aSpace = artifactorySim ? base.artifactory_spaceUsed + 12 : base.artifactory_spaceUsed;
    
    return {
      iops: base.iops + Math.floor((Math.random() - 0.5) * 100),
      throughput: base.throughput + Math.floor((Math.random() - 0.5) * 20),
      spaceUsed: parseFloat((base.spaceUsed + (Math.random() - 0.5) * 0.05).toFixed(2)),
      bitbucket_spaceUsed: parseFloat((base.bitbucket_spaceUsed + (Math.random() - 0.5) * 0.02).toFixed(2)),
      jenkins_spaceUsed: parseFloat((base.jenkins_spaceUsed + (Math.random() - 0.5) * 0.02).toFixed(2)),
      artifactory_spaceUsed: parseFloat((aSpace + (Math.random() - 0.5) * 0.05).toFixed(2)),
      nexusiq_spaceUsed: parseFloat((base.nexusiq_spaceUsed + (Math.random() - 0.5) * 0.01).toFixed(2)),
      teamcity_spaceUsed: parseFloat((base.teamcity_spaceUsed + (Math.random() - 0.5) * 0.02).toFixed(2)),
      bitbucket_iops: base.bitbucket_iops + Math.floor((Math.random() - 0.5) * 10),
      jenkins_iops: base.jenkins_iops + Math.floor((Math.random() - 0.5) * 5),
      artifactory_iops: base.artifactory_iops + Math.floor((Math.random() - 0.5) * 40),
      nexusiq_iops: base.nexusiq_iops + Math.floor((Math.random() - 0.5) * 1),
      teamcity_iops: base.teamcity_iops + Math.floor((Math.random() - 0.5) * 8)
    };
  }
};
