'use strict';

/**
 * backend/routes/llmRoutes.js
 *
 * M7 Task 7.3: Internal LLM Assistant Routes
 * Read-only operational explanations and evidence pack drafting with full audit logging.
 *
 * [Phase S / S10]
 *  - POST endpoints accept only `{ problemId }`. The problem is loaded from the problem store,
 *    must belong to the caller's environment (404 otherwise, so other environments' ids are not
 *    disclosed), and the prompt is built server-side from the stored record. Any other body
 *    field (prompt text, inline problem/evidence objects) is ignored.
 *  - An authenticated user is required.
 *  - Every LLM call is audited (auditLog: file WAL + audit_event table + stdout) with user,
 *    environment, problemId, model, SHA-256 of the redacted prompt and the answer, token counts,
 *    timestamps and, when config/global.yaml `ai.audit.store_text` is true (default), the
 *    redacted prompt and answer text.
 */

const express = require('express');
const router = express.Router();
const llmClient = require('../../ai_analysis/llm_client');
const { auditLog } = require('../audit_logger');
const { requestEnvironment } = require('./_prototype');

let problemStore = null;
try {
  problemStore = require('@sentinel/correlation/problem_store');
} catch (_) {
  problemStore = require('../../correlation/problem_store');
}

const PROBLEM_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;

// AI Assistant Status
router.get('/status', (req, res) => {
  const cfg = llmClient.getConfig();
  res.json({
    configured: llmClient.isConfigured(),
    model: cfg.model,
    endpoint: cfg.url || null
  });
});

/**
 * Resolves the stored problem for the request, or sends the error response and returns null.
 */
async function loadScopedProblem(req, res) {
  if (!req.user || !req.user.username) {
    res.status(401).json({ error: 'Authentication required. Please provide a valid session.' });
    return null;
  }
  const problemId = req.body && typeof req.body === 'object' ? req.body.problemId : undefined;
  if (typeof problemId !== 'string' || !PROBLEM_ID_RE.test(problemId)) {
    res.status(400).json({ error: 'A valid problemId is required; prompts and inline problem/evidence payloads are not accepted.' });
    return null;
  }
  let problem = null;
  try {
    problem = await problemStore.get(problemId);
  } catch (err) {
    res.status(500).json({ error: 'Problem lookup failed' });
    return null;
  }
  const env = requestEnvironment(req);
  if (!problem || problem.environment !== env) {
    res.status(404).json({ error: `Problem ${problemId} not found in ${env}` });
    return null;
  }
  return problem;
}

// Sends the assistant result without its audit data.
function respond(res, result) {
  // `audit` carries prompt/answer text for the audit sink only; never return it.
  const { audit: _audit, ...body } = result || {};
  res.json(body);
}

// Runs one AI assistant action on a problem and audits it.
async function runAssistant(req, res, { action, call, failurePrefix }) {
  const problem = await loadScopedProblem(req, res);
  if (!problem) return;

  const base = {
    user: req.user.username,
    environment: requestEnvironment(req),
    problemId: problem.id,
    target: problem.id
  };

  try {
    const result = await call(problem);
    auditLog(req, action, {
      ...base,
      ...(result.audit || { model: result.model, prompt_sha256: null, answer_sha256: null }),
      tokensUsed: result.usage?.total_tokens || 0,
      status: result.status === 'DATA_UNAVAILABLE' ? 'DATA_UNAVAILABLE' : (result.ok ? 'SUCCESS' : 'FAILED')
    });
    respond(res, result);
  } catch (err) {
    const message = llmClient.redactText(String(err.message || 'unknown error'));
    auditLog(req, `${action}_FAILED`, {
      ...base,
      ...(err.audit || {}),
      error: message
    });
    res.status(502).json({ error: `${failurePrefix}: ${message}` });
  }
}

// Explain a stored problem in the caller's environment
router.post('/explain', (req, res) => runAssistant(req, res, {
  action: 'AI_ASSISTANT_EXPLAIN',
  call: problem => llmClient.explainProblem(problem),
  failurePrefix: 'AI explanation failed'
}));

// Draft summary paragraph for the evidence pack of a stored problem in the caller's environment
router.post('/draft-evidence', (req, res) => runAssistant(req, res, {
  action: 'AI_ASSISTANT_DRAFT_EVIDENCE',
  call: problem => llmClient.draftEvidenceSummary(problem),
  failurePrefix: 'AI evidence drafting failed'
}));

module.exports = router;
