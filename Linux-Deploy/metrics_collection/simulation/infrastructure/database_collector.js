module.exports = {
  collect: (simulations, base) => {
    const dbSim = simulations['database'];
    if (dbSim && dbSim.type === 'outage') {
      return { 
        cpu: 100, memory: 99.9, transactions: 0, iops: 0,
        bitbucket_connections: 0, jenkins_connections: 0, artifactory_connections: 0, teamcity_connections: 0,
        bitbucket_tps: 0, jenkins_tps: 0, artifactory_tps: 0, teamcity_tps: 0,
        bitbucket_dbLatency: 5000, jenkins_dbLatency: 5000, artifactory_dbLatency: 5000, teamcity_dbLatency: 5000
      };
    }
    
    const jenkinsSim = simulations['jenkins_k8s'];
    const artifactorySim = simulations['artifactory'];
    const jConn = jenkinsSim ? 0 : base.jenkins_connections;
    const jTps = jenkinsSim ? 0 : base.jenkins_tps;
    const jLat = jenkinsSim ? 5000 : base.jenkins_dbLatency;
    const aConn = artifactorySim ? base.artifactory_connections + 40 : base.artifactory_connections;
    const aTps = artifactorySim ? base.artifactory_tps + 60 : base.artifactory_tps;
    
    return {
      cpu: parseFloat((base.cpu + (Math.random() - 0.5) * 5 + (artifactorySim ? 45 : 0)).toFixed(2)),
      memory: parseFloat((base.memory + (Math.random() - 0.5) * 2 + (artifactorySim ? 25 : 0)).toFixed(2)),
      transactions: base.transactions + Math.floor((Math.random() - 0.5) * 30),
      iops: base.iops + Math.floor((Math.random() - 0.5) * 50),
      bitbucket_connections: base.bitbucket_connections + Math.floor((Math.random() - 0.5) * 4),
      jenkins_connections: base.jenkins_connections + Math.floor((Math.random() - 0.5) * 2),
      artifactory_connections: aConn + Math.floor((Math.random() - 0.5) * 5),
      teamcity_connections: base.teamcity_connections + Math.floor((Math.random() - 0.5) * 2),
      bitbucket_tps: base.bitbucket_tps + Math.floor((Math.random() - 0.5) * 10),
      jenkins_tps: Math.max(0, jTps + Math.floor((Math.random() - 0.5) * 2)),
      artifactory_tps: aTps + Math.floor((Math.random() - 0.5) * 12),
      teamcity_tps: base.teamcity_tps + Math.floor((Math.random() - 0.5) * 5),
      bitbucket_dbLatency: parseFloat((base.bitbucket_dbLatency + (Math.random() - 0.5) * 1).toFixed(2)),
      jenkins_dbLatency: parseFloat((jLat + (Math.random() - 0.5) * 2).toFixed(2)),
      artifactory_dbLatency: parseFloat((base.artifactory_dbLatency + (Math.random() - 0.5) * 1.5).toFixed(2)),
      teamcity_dbLatency: parseFloat((base.teamcity_dbLatency + (Math.random() - 0.5) * 0.8).toFixed(2))
    };
  }
};
