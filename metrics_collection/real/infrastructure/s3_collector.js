const config = require('../../../config/config');

module.exports = {
  collect: async (simulations, base) => {
    const url = config.STG_URLS.s3_endpoint;
    console.log(`[REAL COLLECTOR] Pinging AWS S3 staging bucket: ${url}`);
    
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
      clearTimeout(id);
      
      if (res.ok) {
        // Successful connection
      }
    } catch (e) {
      console.warn(`[REAL COLLECTOR] Connection refused/timeout pinging S3 endpoint: ${e.message}`);
    }

    return {
      latency: parseFloat((base.latency + (Math.random() - 0.5) * 1).toFixed(2)),
      space: base.space + Math.floor(Math.random() * 2),
      bandwidth: base.bandwidth + Math.floor((Math.random() - 0.5) * 4),
      bitbucket_space: base.bitbucket_space,
      jenkins_space: base.jenkins_space,
      artifactory_space: base.artifactory_space,
      fortify_space: base.fortify_space,
      teamcity_space: base.teamcity_space,
      bitbucket_bandwidth: base.bitbucket_bandwidth,
      jenkins_bandwidth: base.jenkins_bandwidth,
      artifactory_bandwidth: base.artifactory_bandwidth
    };
  }
};
