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

function triggerJenkinsSelfHealingJob(component, jobName, writeNasLog, onStepProgress, onComplete) {
  const steps = jenkinsJobSteps[jobName] || jenkinsJobSteps['generic-rollout'];
  let currentStep = 0;
  
  writeNasLog('INFO', 'JENKINS_SIMULATOR', `[JENKINS SIMULATOR] Triggering build trigger for job "${jobName}"`);
  
  const interval = setInterval(() => {
    if (currentStep < steps.length) {
      const stepText = `[JENKINS BUILDLOG] ${steps[currentStep]}`;
      writeNasLog('INFO', 'JENKINS_SIMULATOR', stepText);
      if (onStepProgress) onStepProgress(stepText);
      currentStep++;
    } else {
      clearInterval(interval);
      writeNasLog('INFO', 'JENKINS_SIMULATOR', `[JENKINS SIMULATOR] Build COMPLETED successfully for job "${jobName}".`);
      if (onComplete) onComplete();
    }
  }, 1500); 
}

module.exports = {
  triggerJenkinsSelfHealingJob
};
