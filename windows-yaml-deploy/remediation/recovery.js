const db = require('../database/db');
const yamlConfig = require('../config/yaml_config');

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

function getActiveRecoveries() {
  return activeRecoveries;
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
  const { writeNasLog } = require('../backend/logger');
  const config = require('../config/config');
  const mode = config.USE_SIMULATED_COLLECTORS ? 'simulation' : 'real';
  const { triggerJenkinsSelfHealingJob } = require(`./${mode}/jenkins/jenkins_trigger`);
  
  writeNasLog('INFO', 'RECOVERY', `[START] Triggering self-healing Jenkins Job for ${component}`);
  
  const jobName = workflow.jobName || 'generic-rollout';
  
  triggerJenkinsSelfHealingJob(
    component,
    jobName,
    writeNasLog,
    (progressStep) => {
      // Clean prefix for UI rendering
      const stepText = progressStep.replace('[JENKINS BUILDLOG] ', '');
      db.updateRecoveryRun(runId, { step: stepText });
      
      if (global.broadcastStateChange) {
        global.broadcastStateChange();
      }
    },
    () => {
      const duration = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
      
      // Update DB run
      db.updateRecoveryRun(runId, {
        status: 'Success',
        duration,
        step: `Jenkins job ${jobName} build completed successfully in ${duration}s.`
      });
      
      // Clear simulation in the simulations manager
      const { triggerSimulation } = require('../config/simulations');
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
}

// Manual trigger or automated initiation of a pending action
function triggerRecovery(component, triggerReason, isManualTrigger = false, env = null) {
  const workflow = resolveWorkflow(component);
  if (!workflow) return null;
  
  // Don't run multiple recoveries concurrently for the same component
  if (activeRecoveries.has(component)) {
    return activeRecoveries.get(component);
  }
  
  const settings = db.getSettings();
  const run = db.addRecoveryRun(component, workflow.actionName, triggerReason, env);
  
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
    
    const { writeNasLog } = require('../backend/logger');
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

  const run = db.getRecoveryLogs().find(r => r.id === runId);
  if (!run || run.status !== 'Awaiting-Approval') {
    return false;
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

// Evaluates the current system metrics and triggers self-healing if needed
function runSelfHealingOrchestrator(currentMetrics) {
  Object.keys(currentMetrics).forEach(component => {
    const data = currentMetrics[component];
    const workflow = resolveWorkflow(component);
    
    // Trigger recovery if status is Critical and we have an automated runbook for it
    if (data.status === 'Critical' && workflow) {
      // Create Dynatrace critical alert and ServiceNow Ticket if they don't exist yet
      const activeAlerts = db.getAlerts().filter(
        a => a.component === component && a.status === 'Active' && a.severity === 'Critical'
      );
      
      if (activeAlerts.length === 0) {
        db.addAlert(component, 'Critical', `Outage/Critical event detected on component: ${component}. System offline or threshold breached.`);
        
        // Also log to the simulated ServiceNow ticket queue
        const ticketId = 'INC-' + Math.floor(100000 + Math.random() * 900000);
        db.addAlert('servicenow', 'Warning', `Ticket ${ticketId} created in ServiceNow for ${component} critical failure.`, 'Active');
      }
      
      // Trigger recovery
      triggerRecovery(component, `Automatic health check detected 'Critical' status.`);
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
  runSelfHealingOrchestrator
};
