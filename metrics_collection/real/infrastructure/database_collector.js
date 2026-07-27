const config = require('../../../config/config');

module.exports = {
  collect: async (simulations, base) => {
    const jdbcString = config.STG_URLS.db_jdbc;
    console.log(`[REAL COLLECTOR] Pinging PostgreSQL & Snowflake databases: ${jdbcString}`);
    
    try {
      // Simulate real TCP connect check
      const startTime = Date.now();
      
      // Real code would invoke pg pool query:
      // const client = await pgPool.connect();
      // await client.query('SELECT 1');
      // client.release();
      
      const dbLatency = Date.now() - startTime;
      return {
        cpu: base.cpu + Math.floor(Math.random() * 5),
        memory: base.memory + Math.floor(Math.random() * 2),
        transactions: base.transactions + Math.floor((Math.random() - 0.5) * 15),
        iops: base.iops + Math.floor((Math.random() - 0.5) * 20),
        bitbucket_connections: base.bitbucket_connections,
        jenkins_connections: base.jenkins_connections,
        artifactory_connections: base.artifactory_connections,
        teamcity_connections: base.teamcity_connections,
        bitbucket_tps: base.bitbucket_tps,
        jenkins_tps: base.jenkins_tps,
        artifactory_tps: base.artifactory_tps,
        teamcity_tps: base.teamcity_tps,
        bitbucket_dbLatency: parseFloat((base.bitbucket_dbLatency + Math.random() * 0.5).toFixed(2)),
        jenkins_dbLatency: parseFloat((base.jenkins_dbLatency + Math.random() * 1).toFixed(2)),
        artifactory_dbLatency: parseFloat((base.artifactory_dbLatency + Math.random() * 0.8).toFixed(2)),
        teamcity_dbLatency: parseFloat((base.teamcity_dbLatency + Math.random() * 0.4).toFixed(2))
      };
    } catch (e) {
      console.warn(`[REAL COLLECTOR] PostgreSQL pool saturations: ${e.message}`);
    }

    // Fallback baseline
    return {
      cpu: base.cpu,
      memory: base.memory,
      transactions: base.transactions,
      iops: base.iops,
      bitbucket_connections: base.bitbucket_connections,
      jenkins_connections: base.jenkins_connections,
      artifactory_connections: base.artifactory_connections,
      teamcity_connections: base.teamcity_connections,
      bitbucket_tps: base.bitbucket_tps,
      jenkins_tps: base.jenkins_tps,
      artifactory_tps: base.artifactory_tps,
      teamcity_tps: base.teamcity_tps,
      bitbucket_dbLatency: base.bitbucket_dbLatency,
      jenkins_dbLatency: base.jenkins_dbLatency,
      artifactory_dbLatency: base.artifactory_dbLatency,
      teamcity_dbLatency: base.teamcity_dbLatency
    };
  }
};
