const customChecks = require('./custom_checks');
const recovery = require('./recovery');

module.exports = {
  customChecks,
  recovery,
  CUSTOM_CHECKS_REGISTRY: customChecks.CUSTOM_CHECKS_REGISTRY,
  runCustomChecks: customChecks.runCustomChecks,
  workflows: recovery.workflows,
  resolveWorkflow: recovery.resolveWorkflow,
  getActiveRecoveries: recovery.getActiveRecoveries,
  executeRecoveryWorkflow: recovery.executeRecoveryWorkflow,
  triggerRecovery: recovery.triggerRecovery,
  approveRecovery: recovery.approveRecovery,
  runSelfHealingOrchestrator: recovery.runSelfHealingOrchestrator
};
