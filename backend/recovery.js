const db = require('./db');

// List of recovery workflows and their simulated execution steps
const workflows = {
  jenkins_k8s: {
    actionName: 'Re-rollout deployment/jenkins on Jenkins K8s Cluster',
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
    steps: [
      'Detecting AVI Ingress queue saturation. Active connections: 4500.',
      'Scaling up active workers on AVI virtual services...',
      'Activating secondary standby ingress controller gateway...',
      'Flushing stale TCP connection tables...',
      'Ingress traffic flow re-routed and stabilized.'
    ]
  }
};

// Map of components that are currently in recovery to prevent duplicate runs
const activeRecoveries = new Map();

function getActiveRecoveries() {
  return activeRecoveries;
}

// Function to run the recovery workflow step-by-step
function executeRecoveryWorkflow(runId, component) {
  const workflow = workflows[component];
  if (!workflow) {
    db.updateRecoveryRun(runId, { status: 'Failed', step: 'Error: No recovery workflow defined for this component.' });
    activeRecoveries.delete(component);
    return;
  }
  
  const startTime = Date.now();
  const { writeNasLog } = require('./logger');
  const config = require('./config');
  const mode = config.USE_SIMULATED_COLLECTORS ? 'simulation' : 'real';
  const { triggerJenkinsSelfHealingJob } = require(`./collectors/${mode}/jenkins/jenkins_trigger`);
  
  writeNasLog('INFO', 'RECOVERY', `[START] Triggering self-healing Jenkins Job for ${component}`);
  
  // Map component to Jenkins Job Name
  let jobName = 'generic-rollout';
  if (component === 'artifactory') jobName = 'artifactory-jvm-recycle';
  if (component === 'nas_performance') jobName = 'nas-log-purge';
  if (component === 'database') jobName = 'db-connection-flush';
  if (component === 'avi_load_balancer') jobName = 'avi-ingress-scale';
  
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
      const { triggerSimulation } = require('./simulations');
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

// Manual trigger or manual approval of a pending action
function triggerRecovery(component, triggerReason, isManualTrigger = false) {
  const workflow = workflows[component];
  if (!workflow) return null;
  
  // Don't run multiple recoveries concurrently for the same component
  if (activeRecoveries.has(component)) {
    return activeRecoveries.get(component);
  }
  
  const settings = db.getSettings();
  const run = db.addRecoveryRun(component, workflow.actionName, triggerReason);
  
  activeRecoveries.set(component, run);
  
  if (settings.autonomousMode || isManualTrigger) {
    db.updateRecoveryRun(run.id, { status: 'In-Progress' });
    executeRecoveryWorkflow(run.id, component);
  } else {
    // Awaiting Approval
    db.updateRecoveryRun(run.id, {
      status: 'Awaiting-Approval',
      step: `Awaiting administrator approval to execute: "${workflow.actionName}"`
    });
    
    const { writeNasLog } = require('./logger');
    writeNasLog('WARNING', 'RECOVERY', `[PENDING APPROVAL] Self-healing action for ${component} requires manual approval.`);
  }
  
  // Broadcast update
  if (global.broadcastStateChange) {
    global.broadcastStateChange();
  }
  
  return run;
}

function approveRecovery(runId) {
  const run = db.getRecoveryLogs().find(r => r.id === runId);
  if (run && run.status === 'Awaiting-Approval') {
    db.updateRecoveryRun(runId, {
      status: 'In-Progress',
      step: 'Administrator approved action. Initiating self-healing sequence...'
    });
    
    // Add to active recoveries list if not already there
    activeRecoveries.set(run.component, run);
    
    executeRecoveryWorkflow(runId, run.component);
    
    if (global.broadcastStateChange) {
      global.broadcastStateChange();
    }
    
    return true;
  }
  return false;
}

// Evaluates the current system metrics and triggers self-healing if needed
function runSelfHealingOrchestrator(currentMetrics) {
  Object.keys(currentMetrics).forEach(component => {
    const data = currentMetrics[component];
    
    // Trigger recovery if status is Critical and we have an automated runbook for it
    if (data.status === 'Critical' && workflows[component]) {
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
  triggerRecovery,
  approveRecovery,
  getActiveRecoveries,
  runSelfHealingOrchestrator
};
