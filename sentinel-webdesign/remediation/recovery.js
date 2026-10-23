/**
 * Autonomous recovery: chooses and runs runbooks under four-eyes approval, with a circuit breaker
 * for Jenkins.
 */
const db = require('@sentinel/database');
const yamlConfig = require('@sentinel/config/yaml_config');
const { SEVERITY } = require('@sentinel/shared-constants');

// List of bespoke recovery workflows and their simulated execution steps
const bespokeWorkflows = {
  jenkins_k8s: {
    actionName: 'Re-rollout deployment/jenkins on Jenkins K8s Cluster',
    jobName: 'jenkins-pipeline-restart',
    steps: [
      'Analyzing pod crash-loop logs (exit code 137 - Out Of Memory)...',
      'Scaling down deployment/jenkins pods to 0 for state reset...',
      'Evicting stuck JVM garbage collection processes...',
      'Scaling deployment/jenkins up to 5 replicas...',
      'Polling container readiness probes... [1/3] Pending, [2/3] Running, [3/3] Ready',
      'Verifying endpoint http://jenkins.k8s.internal/login... HTTP 200 OK (Latency: 145ms)',
      'Closing Dynatrace incidents and sync ServiceNow status...'
    ]
  },
  nas_performance: {
    actionName: 'Purge temp workspaces & compress archives on NAS',
    jobName: 'nas-log-purge',
    steps: [
      'Scanning log mount /nas_logs/ for high-capacity directories...',
      'Compressing daily historical log bundles into gzip archives...',
      'Clearing transient /tmp build caches and orphan workspaces...',
      'Triggering NAS storage compression utilities...',
      'Verifying filesystem integrity check... OK',
      'NAS capacity reduced to 54.2% (Normal). Clearing warning states...'
    ]
  },
  artifactory: {
    actionName: 'Recycle Artifactory container instance and flush cache',
    jobName: 'artifactory-jvm-recycle',
    steps: [
      'Triggering thread dump for Artifactory diagnostic bundle...',
      'Performing explicit safe JVM Garbage Collection... Reclaimed 2.1 GB.',
      'Performing rolling restart of artifactory-0 and artifactory-1 pods...',
      'Verifying storage cluster connectivity... OK',
      'Re-routing API Gateway traffic back to Artifactory pool...',
      'Artifactory heap restored to 52.4%. Incident resolved.'
    ]
  },
  database: {
    actionName: 'Failover database connection to secondary replica',
    jobName: 'db-connection-flush',
    steps: [
      'Detecting connection loss on Primary database node (node-1)...',
      'Verifying cluster consensus. Confirming node-1 is offline...',
      'Promoting read replica node-2 to Primary node...',
      'Updating application data pool connection mappings...',
      'Verifying write transaction tests on node-2... Successful (32ms).',
      'Database status set to Healthy (Active Primary: node-2).'
    ]
  },
  avi_load_balancer: {
    actionName: 'Dynamic scale connections and throttle ingress',
    jobName: 'avi-ingress-scale',
    steps: [
      'Detecting AVI Ingress queue saturation. Active connections: 4500.',
      'Scaling up active workers on AVI virtual services...',
      'Activating secondary standby ingress controller gateway...',
      'Flushing stale TCP connection tables...',
      'Ingress traffic flow re-routed and stabilized.'
    ]
  }
};

/**
 * Resolves workflow for any component dynamically from YAML or bespoke definitions.
 */
function resolveWorkflow(component) {
  if (bespokeWorkflows[component]) {
    return bespokeWorkflows[component];
  }
  
  try {
    const appConfigs = yamlConfig.loadApplicationConfigs() || {};
    const appCfg = appConfigs[component];
    if (appCfg && appCfg.jenkins_remediation_job) {
      const job = appCfg.jenkins_remediation_job;
      return {
        actionName: `Restart & health verification via Jenkins job ${job}`,
        jobName: job,
        steps: [
          `Initiating automated Jenkins webhook trigger for job: ${job}...`,
          `Queuing executor on Kubernetes runner node for ${component}...`,
          `Executing health telemetry probes against ${component} ingress...`,
          `Applying rolling restart and clearing transaction caches...`,
          `Verifying health SLA and closing incident in ServiceNow...`
        ]
      };
    }
  } catch (e) {
    console.warn(`[RECOVERY] Error resolving YAML workflow for ${component}: ${e.message}`);
  }
  
  return null;
}

// Map of components that are currently in recovery to prevent duplicate runs
const activeRecoveries = new Map();

// Running recoveries.
function getActiveRecoveries() {
  return activeRecoveries;
}

// [P1-02] Jenkins Circuit Breaker State & Timeout Configuration
const jenkinsCircuitBreaker = {
  consecutiveFailures: 0,
  maxFailures: 3,
  state: 'CLOSED', // 'CLOSED', 'OPEN', 'HALF-OPEN'
  lastTripped: null,
  cooldownMs: 5 * 60 * 1000 // 5 minutes cooldown
};

const RECOVERY_TIMEOUT_MS = parseInt(process.env.RECOVERY_TIMEOUT_MS, 10) || (30 * 60 * 1000); // 30 minutes default

// Jenkins circuit-breaker state.
function getCircuitBreakerStatus() {
  return { ...jenkinsCircuitBreaker };
}

// Resets the Jenkins circuit breaker.
function resetCircuitBreaker() {
  jenkinsCircuitBreaker.consecutiveFailures = 0;
  jenkinsCircuitBreaker.state = 'CLOSED';
  jenkinsCircuitBreaker.lastTripped = null;
}

// Function to run the recovery workflow step-by-step
function executeRecoveryWorkflow(runId, component) {
  const workflow = resolveWorkflow(component);
  if (!workflow) {
    db.updateRecoveryRun(runId, { status: 'Failed', step: 'Error: No recovery workflow defined for this component.' });
    activeRecoveries.delete(component);
    return;
  }
  
  const startTime = Date.now();
  const { writeNasLog } = require('@sentinel/logger');
  const config = require('@sentinel/config');

  // [P1-02] Check Circuit Breaker before executing Jenkins remediation
  const now = Date.now();
  if (jenkinsCircuitBreaker.state === 'OPEN') {
    if (jenkinsCircuitBreaker.lastTripped && (now - jenkinsCircuitBreaker.lastTripped) > jenkinsCircuitBreaker.cooldownMs) {
      jenkinsCircuitBreaker.state = 'HALF-OPEN';
      writeNasLog('WARNING', 'RECOVERY', `[CIRCUIT BREAKER] Jenkins cooldown elapsed. Entering HALF-OPEN state.`);
    } else {
      const remainingSec = Math.ceil((jenkinsCircuitBreaker.cooldownMs - (now - (jenkinsCircuitBreaker.lastTripped || now))) / 1000);
      const breakerMsg = `Jenkins Circuit Breaker is OPEN (${jenkinsCircuitBreaker.consecutiveFailures} consecutive failures). Recovery blocked for ${remainingSec}s. Escalated to on-call SRE. Runbook: https://runbooks.enterprise.corp/${component}`;
      db.updateRecoveryRun(runId, {
        status: 'Failed',
        duration: 0,
        step: breakerMsg
      });
      activeRecoveries.delete(component);
      try {
        db.addAlert(component, 'Critical', breakerMsg, 'Active');
      } catch (_) {}
      return;
    }
  }

  const { triggerJenkinsSelfHealingJob } = require('./real/jenkins/jenkins_trigger');
  
  writeNasLog('INFO', 'RECOVERY', `[START] Triggering self-healing Jenkins Job for ${component}`);
  
  const jobName = workflow.jobName || 'generic-rollout';

  let isDone = false;
  // [P1-02] Enforce execution timeout
  const timeoutTimer = setTimeout(() => {
    if (isDone) return;
    isDone = true;
    const duration = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
    jenkinsCircuitBreaker.consecutiveFailures++;
    if (jenkinsCircuitBreaker.consecutiveFailures >= jenkinsCircuitBreaker.maxFailures) {
      jenkinsCircuitBreaker.state = 'OPEN';
      jenkinsCircuitBreaker.lastTripped = Date.now();
      writeNasLog('CRITICAL', 'RECOVERY', `[CIRCUIT BREAKER] Trip: 3 consecutive failures reached. Breaker OPEN.`);
    }
    const timeoutMsg = `Recovery workflow timed out after ${duration}s. Manual runbook intervention required: https://runbooks.enterprise.corp/${component}`;
    db.updateRecoveryRun(runId, {
      status: 'Failed',
      duration,
      step: timeoutMsg
    });
    try {
      db.addAlert(component, 'Critical', timeoutMsg, 'Active');
    } catch (_) {}
    activeRecoveries.delete(component);
    if (global.broadcastStateChange) {
      global.broadcastStateChange();
    }
  }, RECOVERY_TIMEOUT_MS);
  if (timeoutTimer.unref) timeoutTimer.unref();
  
  try {
    triggerJenkinsSelfHealingJob(
      component,
      jobName,
      writeNasLog,
      (progressStep) => {
        if (isDone) return;
        // Clean prefix for UI rendering
        const stepText = progressStep.replace('[JENKINS BUILDLOG] ', '');
        db.updateRecoveryRun(runId, { step: stepText });
        
        if (global.broadcastStateChange) {
          global.broadcastStateChange();
        }
      },
      () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutTimer);

        jenkinsCircuitBreaker.consecutiveFailures = 0;
        jenkinsCircuitBreaker.state = 'CLOSED';

        const duration = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
        
        // Update DB run
        db.updateRecoveryRun(runId, {
          status: 'Success',
          duration,
          step: `Jenkins job ${jobName} build completed successfully in ${duration}s.`
        });
        
        // Clear simulation in the simulations manager
        const { triggerSimulation } = require('@sentinel/config/simulations');
        triggerSimulation(component, 'clear');
        
        // Resolve Dynatrace Alert and ServiceNow Tickets
        db.resolveAlertsForComponent(component);
        
        writeNasLog('INFO', 'RECOVERY', `[SUCCESS] Jenkins Remediation Completed for ${component} in ${duration}s.`);
        
        if (global.broadcastStateChange) {
          global.broadcastStateChange();
        }
        
        activeRecoveries.delete(component);
      }
    );
  } catch (err) {
    if (!isDone) {
      isDone = true;
      clearTimeout(timeoutTimer);
      jenkinsCircuitBreaker.consecutiveFailures++;
      if (jenkinsCircuitBreaker.consecutiveFailures >= jenkinsCircuitBreaker.maxFailures) {
        jenkinsCircuitBreaker.state = 'OPEN';
        jenkinsCircuitBreaker.lastTripped = Date.now();
      }
      db.updateRecoveryRun(runId, {
        status: 'Failed',
        step: `Jenkins invocation failed: ${err.message}`
      });
      activeRecoveries.delete(component);
    }
  }
}

// Manual trigger or automated initiation of a pending action
function triggerRecovery(component, triggerReason, options = {}) {
  // [T0.1 REMEDIATED] Options object { manual: false, env } prevents environment string from bypassing four-eyes queue
  let isManualTrigger = false;
  let env = null;
  let initiatedBy = null;

  if (typeof options === 'boolean') {
    isManualTrigger = options;
  } else if (typeof options === 'object' && options !== null) {
    isManualTrigger = !!options.manual;
    env = options.env || null;
    initiatedBy = options.initiatedBy || null;
  }

  const workflow = resolveWorkflow(component);
  if (!workflow) return null;
  
  // Don't run multiple recoveries concurrently for the same component
  if (activeRecoveries.has(component)) {
    return activeRecoveries.get(component);
  }
  
  const settings = db.getSettings();
  const run = db.addRecoveryRun(component, workflow.actionName, triggerReason, env, initiatedBy);
  
  activeRecoveries.set(component, run);
  
  if (settings.autonomousMode || isManualTrigger) {
    db.updateRecoveryRun(run.id, { status: 'In-Progress' });
    executeRecoveryWorkflow(run.id, component);
  } else {
    // Awaiting Approval (Four-Eyes requirement)
    db.updateRecoveryRun(run.id, {
      status: 'Awaiting-Approval',
      step: `Awaiting administrator approval (0 of 2 signatures) to execute: "${workflow.actionName}"`
    });
    
    // [P3-06] Auto-dispatch ServiceNow Incident & tag active On-Call engineer
    try {
      const { createIncidentForRecovery } = require('./integrations/servicenow_client');
      createIncidentForRecovery(run).catch(() => {});
    } catch (_) {}

    const { writeNasLog } = require('@sentinel/logger');
    writeNasLog('WARNING', 'RECOVERY', `[PENDING APPROVAL] Self-healing action for ${component} requires Four-Eyes approval.`);
  }
  
  // Broadcast update
  if (global.broadcastStateChange) {
    global.broadcastStateChange();
  }
  
  return run;
}

/**
 * Four-Eyes Dual-Approval Handler
 * Requires 2 distinct approvers before execution.
 * @param {string} runId
 * @param {object|string} approvingUser - User object from JWT { username, role }
 */
function approveRecovery(runId, approvingUser = { username: 'devsecops-admin', role: 'Super Admin' }) {
  const userIdentifier = typeof approvingUser === 'string' 
    ? approvingUser 
    : (approvingUser.username || approvingUser.email || 'unknown_admin');
  
  const userRole = typeof approvingUser === 'object' ? (approvingUser.role || 'Admin') : 'Admin';

  const allLogs = (db.recovery && Array.isArray(db.recovery)) 
    ? db.recovery 
    : [...db.getRecoveryLogs('prod'), ...db.getRecoveryLogs('staging'), ...db.getRecoveryLogs('demo')];
  const run = allLogs.find(r => r.id === runId);
  if (!run || run.status !== 'Awaiting-Approval') {
    return false;
  }

  // [SEC-SOD] Segregation of Duties: Initiator cannot approve their own recovery action
  if (run.initiated_by && userIdentifier === run.initiated_by) {
    try {
      const { writeNasLog } = require('@sentinel/logger');
      writeNasLog('SECURITY', 'RECOVERY', `[SOD VIOLATION] User '${userIdentifier}' attempted to approve recovery '${runId}' which they initiated.`);
    } catch (_) {}
    return {
      success: false,
      error: `SOD violation: initiator (${userIdentifier}) cannot approve their own recovery.`
    };
  }

  run.approvals = run.approvals || [];

  // Deduplicate by username to prevent self-double-approval
  const alreadyApproved = run.approvals.some(a => {
    const existingName = typeof a === 'string' ? a : (a.username || a.email);
    return existingName === userIdentifier;
  });

  if (!alreadyApproved) {
    run.approvals.push({
      username: userIdentifier,
      role: userRole,
      timestamp: new Date().toISOString()
    });
  }

  // Check if we have reached 2 distinct signatures
  if (run.approvals.length >= 2) {
    const approverNames = run.approvals.map(a => a.username || a).join(', ');
    db.updateRecoveryRun(runId, {
      status: 'In-Progress',
      approvals: run.approvals,
      step: `Dual-authorization verified (2 of 2 signatures by: ${approverNames}). Initiating self-healing sequence...`
    });
    
    activeRecoveries.set(run.component, run);
    executeRecoveryWorkflow(runId, run.component);
    
    if (global.broadcastStateChange) {
      global.broadcastStateChange();
    }
    return true;
  } else {
    // 1 of 2 signatures collected
    db.updateRecoveryRun(runId, {
      approvals: run.approvals,
      step: `Signature 1 of 2 collected (Approved by ${userIdentifier} [${userRole}]). Awaiting 2nd distinct administrator approval.`
    });
    
    if (global.broadcastStateChange) {
      global.broadcastStateChange();
    }
    return true;
  }
}

// [T0.3 REMEDIATED] Evaluates current system metrics and honors env parameter
function runSelfHealingOrchestrator(currentMetrics, env = 'staging') {
  Object.keys(currentMetrics).forEach(component => {
    const data = currentMetrics[component];
    const workflow = resolveWorkflow(component);
    
    // Trigger recovery if status is Critical and we have an automated runbook for it
    if (data.status === SEVERITY.CRITICAL && workflow) {
      // Create Dynatrace critical alert and ServiceNow Ticket if they don't exist yet
      const activeAlerts = db.getAlerts(env).filter(
        a => a.component === component && a.status === 'Active' && a.severity === SEVERITY.CRITICAL
      );
      
      if (activeAlerts.length === 0) {
        db.addAlert(component, SEVERITY.CRITICAL, `Outage/Critical event detected on component: ${component}. System offline or threshold breached.`, 'Active', env);
        
        // [M1.1] No ServiceNow write integration: record that a ticket draft is due,
        // without inventing an incident number.
        db.addAlert('servicenow', SEVERITY.WARNING, `ServiceNow ticket draft due for ${component} critical failure (not submitted by SENTINEL).`, 'Active', env);
      }
      
      // Trigger recovery with explicit options object
      triggerRecovery(component, `Automatic health check detected 'Critical' status.`, { manual: false, env });
    }
  });
}

global.runSelfHealingOrchestrator = runSelfHealingOrchestrator;

module.exports = {
  workflows: bespokeWorkflows,
  resolveWorkflow,
  getActiveRecoveries,
  executeRecoveryWorkflow,
  triggerRecovery,
  approveRecovery,
  runSelfHealingOrchestrator,
  getCircuitBreakerStatus,
  resetCircuitBreaker
};
