module.exports = {
  collect: (simulations, base) => {
    const s3Sim = simulations['s3_storage'];
    if (s3Sim && s3Sim.type === 'outage') {
      return { latency: 5000, space: base.space, bandwidth: 0 };
    }
    
    return {
      latency: parseFloat((base.latency + (Math.random() - 0.5) * 2).toFixed(2)),
      space: base.space + Math.floor(Math.random() * 5),
      bandwidth: base.bandwidth + Math.floor((Math.random() - 0.5) * 8),
      bitbucket_space: base.bitbucket_space + Math.floor(Math.random() * 2),
      jenkins_space: base.jenkins_space + Math.floor(Math.random() * 1),
      artifactory_space: base.artifactory_space + Math.floor(Math.random() * 3),
      fortify_space: base.fortify_space,
      teamcity_space: base.teamcity_space,
      bitbucket_bandwidth: parseFloat((base.bitbucket_bandwidth + (Math.random() - 0.5) * 1).toFixed(2)),
      jenkins_bandwidth: parseFloat((base.jenkins_bandwidth + (Math.random() - 0.5) * 0.5).toFixed(2)),
      artifactory_bandwidth: parseFloat((base.artifactory_bandwidth + (Math.random() - 0.5) * 4).toFixed(2))
    };
  }
};
