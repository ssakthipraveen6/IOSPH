/**
 * Triggers a Jenkins self-healing job for a component and reports its progress.
 */
const config = require('@sentinel/config');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');

const jenkinsJobSteps = {
  'artifactory-jvm-recycle': [
    'Triggering Jenkins Job "artifactory-jvm-recycle" (Build #45)',
    'Retrieving Artifactory pod selectors for staging environment...',
    'Injecting SIGTERM JVM Garbage Collector signal...',
    'Performing container termination rollout in K8s...',
    'Success: Artifactory heap pool recycled. Heap usage dropped to 48.2%.'
  ],
  'nas-log-purge': [
    'Triggering Jenkins Job "nas-log-purge" (Build #112)',
    'Scanning NAS folder shares /nas_logs/tmp/...',
    'Deleting 145GB of historical test workspace binaries...',
    'Running disk compactors on NAS mount...',
    'Success: NAS capacity utilization reclaimed to 54.2%.'
  ],
  'db-connection-flush': [
    'Triggering Jenkins Job "db-connection-flush" (Build #82)',
    'Identifying PostgreSQL client TCP connections...',
    'Executing pg_terminate_backend queries to flush inactive pools...',
    'Resetting pool limits to baseline settings...',
    'Success: Database connections active dropped below warning threshold.'
  ],
  'avi-ingress-scale': [
    'Triggering Jenkins Job "avi-ingress-scale" (Build #19)',
    'Verifying load balancer gateway ingress metrics...',
    'Provisioning secondary worker threads in F5/AVI configuration...',
    'Success: Load balancer queue cleared. Latency restored below 100ms.'
  ],
  'generic-rollout': [
    'Triggering Jenkins Job "generic-remediate-rollout" (Build #8)',
    'Verifying application status alerts...',
    'Restarting cluster deployment pods natively...',
    'Success: Infrastructure parameters returned to baseline defaults.'
  ]
};

const REQUEST_TIMEOUT_MS = 10000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// GET a Jenkins JSON document; throws on a non-2xx answer.
async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`[JENKINS] GET ${url} returned HTTP ${res.status}`);
  return res.json();
}

/**
 * Starts the Jenkins job and follows it until it finishes.
 *
 * Simulation mode (USE_SIMULATED_COLLECTORS) plays the scripted steps and makes no network call.
 * Real mode resolves only when Jenkins reports the build result SUCCESS; any other outcome
 * (trigger refused, queue item cancelled, build failed, deadline passed) rejects, so the caller
 * never records a success that Jenkins did not report.
 *
 * `env` (prod|staging) selects the Jenkins of the run's own environment.
 */
async function triggerJenkinsSelfHealingJob(component, jobName, writeNasLog, onStepProgress, onComplete, env = null, opts = {}) {
  if (config.USE_SIMULATED_COLLECTORS) {
    const steps = jenkinsJobSteps[jobName] || jenkinsJobSteps['generic-rollout'];
    for (const step of steps) {
      await sleep(opts.pollMs || 1500);
      const stepText = `[JENKINS BUILDLOG] ${step}`;
      writeNasLog('INFO', 'JENKINS_SIM', stepText);
      if (onStepProgress) onStepProgress(stepText);
    }
    if (onComplete) onComplete();
    return;
  }

  const urls = env === 'prod' ? config.PROD_URLS : env === 'staging' ? config.STG_URLS : config.ACTIVE_URLS;
  const masterUrl = urls && urls.jenkins_master_url;
  if (!masterUrl) {
    throw new Error(`[JENKINS] No Jenkins master URL configured for remediation (${env || 'active'} environment)`);
  }
  const origin = new URL(masterUrl).origin;
  const url = `${masterUrl}/${jobName}/build`;

  let token = null;
  try {
    token = await credentialProvider.getCredential('cloudbees_jenkins', 'remediation_token');
  } catch (e) {
    console.warn(`[JENKINS] Could not resolve remediation token via CyberArk/env for cloudbees_jenkins: ${e.message}`);
  }
  if (!token) {
    throw new Error('[JENKINS] No remediation token resolved for cloudbees_jenkins');
  }
  const headers = { 'Authorization': `Basic ${Buffer.from(token).toString('base64')}` };

  const pollMs = opts.pollMs || 5000;
  const deadline = Date.now() + (opts.deadlineMs || parseInt(process.env.RECOVERY_TIMEOUT_MS, 10) || 30 * 60 * 1000);
  const progress = (text) => {
    writeNasLog('INFO', 'JENKINS_REAL', text);
    if (onStepProgress) onStepProgress(`[JENKINS BUILDLOG] ${text}`);
  };
  // The token is only ever sent to the configured Jenkins, whatever URL a response names.
  const sameOrigin = (u) => {
    const resolved = new URL(u, masterUrl);
    if (resolved.origin !== origin) throw new Error(`[JENKINS] Refusing to follow ${resolved.origin}: not the configured Jenkins`);
    return resolved.href.replace(/\/?$/, '/');
  };

  const res = await fetch(url, { method: 'POST', headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`[JENKINS] Trigger of job "${jobName}" returned HTTP ${res.status}`);
  }
  const location = res.headers.get('location');
  if (!location) {
    throw new Error(`[JENKINS] Trigger of job "${jobName}" returned no queue item location`);
  }
  progress(`Jenkins job "${jobName}" queued.`);

  const queueUrl = `${sameOrigin(location)}api/json`;
  let item;
  for (;;) {
    item = await getJson(queueUrl, headers);
    if (item.cancelled) throw new Error(`[JENKINS] Queued job "${jobName}" was cancelled`);
    if (item.executable && item.executable.url) break;
    if (Date.now() > deadline) throw new Error(`[JENKINS] Job "${jobName}" did not start before the deadline`);
    await sleep(pollMs);
  }
  progress(`Jenkins job "${jobName}" build #${item.executable.number} started.`);

  const buildUrl = `${sameOrigin(item.executable.url)}api/json`;
  let build;
  for (;;) {
    build = await getJson(buildUrl, headers);
    if (build.building === false && build.result) break;
    if (Date.now() > deadline) throw new Error(`[JENKINS] Build #${item.executable.number} of "${jobName}" did not finish before the deadline`);
    await sleep(pollMs);
  }
  if (build.result !== 'SUCCESS') {
    throw new Error(`[JENKINS] Build #${item.executable.number} of "${jobName}" finished with result ${build.result}`);
  }
  progress(`Jenkins job "${jobName}" build #${item.executable.number} finished with result SUCCESS.`);
  if (onComplete) onComplete();
}

module.exports = {
  triggerJenkinsSelfHealingJob
};
