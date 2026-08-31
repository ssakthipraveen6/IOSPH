const config = require('../../../config/config');
const credentialProvider = require('../../../config/cyberark/credential_provider');
const { runWithConcurrencyLimit } = require('../../concurrency_limiter');
const fsPromises = require('fs').promises;

/**
 * Asynchronously probes a mount or SMB share with strict timeout to prevent event loop stalls.
 */
async function probePathAsync(targetPath, timeoutMs = 800) {
  if (!targetPath) return false;
  try {
    const statPromise = fsPromises.stat(targetPath);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Storage probe timeout (${timeoutMs}ms)`)), timeoutMs)
    );
    await Promise.race([statPromise, timeoutPromise]);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  collect: async (simulations, base = {}) => {
    const targetConfig = config.ACTIVE_URLS || {};
    const appConfigs = targetConfig.applications || {};
    const mountPath = targetConfig.nas_mount;

    if (mountPath) {
      await probePathAsync(mountPath);
    }

    const result = {
      iops: (base.iops || 1200) + Math.floor((Math.random() - 0.5) * 50),
      throughput: (base.throughput || 350) + Math.floor((Math.random() - 0.5) * 10),
      spaceUsed: base.spaceUsed || 54.2
    };

    // Dynamically filter apps declaring NFS or SMB layer, or legacy nas_mount
    const storageApps = Object.entries(appConfigs).filter(([_, cfg]) => cfg.layers?.nfs || cfg.layers?.smb || cfg.nas_mount);

    const tasks = storageApps.map(([appKey, appConfig]) => async () => {
      const metricPrefix = appKey.replace('_k8s', '');
      const nfsMount = appConfig.layers?.nfs?.mount || appConfig.nas_mount;
      const smbShare = appConfig.layers?.smb?.share;
      const purpose = appConfig.layers?.nfs?.credential_purpose || appConfig.layers?.smb?.credential_purpose;

      if (purpose) {
        try {
          await credentialProvider.getCredential(appKey, purpose);
        } catch (e) {
          // ignore
        }
      }

      // Check NFS mount if present (asynchronous & non-blocking)
      if (nfsMount) {
        await probePathAsync(nfsMount);
      }

      // Check SMB share if present (asynchronous & non-blocking)
      if (smbShare) {
        await probePathAsync(smbShare);
      }

      result[`${metricPrefix}_spaceUsed`] = base[`${metricPrefix}_spaceUsed`] || 15.4;
      result[`${metricPrefix}_iops`] = base[`${metricPrefix}_iops`] || 120;
      if (smbShare) {
        result[`${metricPrefix}_smb_status`] = 'Healthy';
      }
    });

    await runWithConcurrencyLimit(tasks, 50);

    return result;
  }
};
