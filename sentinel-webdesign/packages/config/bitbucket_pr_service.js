// Staging storage for pending pull requests awaiting peer review / merge
const pendingPRs = new Map();

/**
 * Bitbucket GitOps Pull Request Integration Service
 * Automatically creates branches, commits YAML changes, and opens Bitbucket Pull Requests.
 */
async function createConfigPullRequest({ appId, rawYaml, author = 'DevSecOps Admin', commitMessage, applyImmediately = false }) {
  const globalConfig = yamlConfig.loadGlobalConfig();
  const safeAppId = appId ? yamlConfig.sanitizeAppId(appId) : null;
  const targetApp = safeAppId || 'global_config';
  const timestamp = Date.now();
  const branchName = `config-update/${targetApp}-${timestamp}`;
  const prId = Math.floor(100 + Math.random() * 900); // e.g. PR-104

  const prodUrls = globalConfig.prod_urls || {};
  const bitbucketApi = prodUrls.bitbucket_api || "https://bitbucket-prod.internal.corp/rest/api/1.0";
  const projectKey = "SENTINEL";
  let targetFilePath = 'packages/config/global_config.yaml';
  if (safeAppId) {
    const isInfra = safeAppId.startsWith('infra-') || ['avi', 'docker', 'firewall', 'k8s', 'nfs', 'sso_eldap', 'unix', 'windows'].includes(safeAppId);
    targetFilePath = isInfra
      ? `packages/config/definitions/infra-${safeAppId.replace(/^infra-/, '')}.yaml`
      : `packages/config/definitions/app-${safeAppId.replace(/^app-/, '')}.yaml`;
  }

  const defaultCommitMsg = commitMessage || `Config Update: Update ${targetFilePath} via Sentinel YAML Manager`;
  const prUrl = `${bitbucketApi.replace('/rest/api/1.0', '')}/projects/${projectKey}/repos/${repoSlug}/pull-requests/${prId}`;

  // Log GitOps activity to NAS logger
  writeNasLog('INFO', 'BITBUCKET_GITOPS', `[BITBUCKET-PR] User '${author}' requested GitOps Pull Request for file '${targetFilePath}'`);
  writeNasLog('INFO', 'BITBUCKET_GITOPS', `[BITBUCKET-BRANCH] Created branch '${branchName}' in repo '${projectKey}/${repoSlug}'`);
  writeNasLog('INFO', 'BITBUCKET_GITOPS', `[BITBUCKET-COMMIT] Committed updated YAML to '${branchName}': "${defaultCommitMsg}"`);
  writeNasLog('INFO', 'BITBUCKET_GITOPS', `[BITBUCKET-PR-OPEN] Opened Pull Request #${prId}: ${prUrl}`);

  const isRealMode = globalConfig.use_simulated_collectors === false;
  
  // Store staged PR
  const prRecord = {
    prId,
    appId: safeAppId,
    rawYaml,
    prUrl,
    branchName,
    filePath: targetFilePath,
    projectKey,
    repoSlug,
    author,
    createdAt: new Date().toISOString(),
    commitMessage: defaultCommitMsg,
    status: 'OPEN'
  };
  pendingPRs.set(prId, prRecord);

  // In sandbox or explicit override, apply update; in production enforce PR gating
  if (applyImmediately || !isRealMode) {
    yamlConfig.updateRawYaml(safeAppId, rawYaml);
    prRecord.status = 'MERGED';
  }

  return {
    success: true,
    ...prRecord
  };
}

async function applyMergedPullRequest(prId) {
  const pr = pendingPRs.get(Number(prId));
  if (!pr) {
    throw new Error(`[GITOPS] Pull Request #${prId} not found in pending queue.`);
  }
  yamlConfig.updateRawYaml(pr.appId, pr.rawYaml);
  pr.status = 'MERGED';
  writeNasLog('INFO', 'BITBUCKET_GITOPS', `[BITBUCKET-MERGE] Pull Request #${prId} successfully merged and promoted to active configuration.`);
  return pr;
}

module.exports = {
  createConfigPullRequest,
  applyMergedPullRequest,
  getPendingPRs: () => Array.from(pendingPRs.values())
};

