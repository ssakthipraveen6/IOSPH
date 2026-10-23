'use strict';

/**
 * ai_analysis/llm_client.js
 *
 * M7 Task 7.3: Internal LLM Assistant Client
 * Calls the bank's internal OpenAI-compatible endpoint.
 * Features:
 * - Inert when URL is blank
 * - Redacts tokens, passwords, private keys, and internal IPs
 * - Strictly read-only (no tool execution, no actions)
 * - Returns results labelled with is_draft: true, label: 'AI draft'
 */

const crypto = require('crypto');

let yamlConfig = null;
try {
  yamlConfig = require('../backend/config/yaml_config');
} catch (_) {
  yamlConfig = null;
}

let credentialProvider = null;
try {
  credentialProvider = require('../backend/config/cyberark/credential_provider');
} catch (_) {
  credentialProvider = null;
}

// llm section of config/global.yaml.
function getConfig() {
  const globalCfg = yamlConfig ? yamlConfig.loadGlobalConfig() : {};
  const block = globalCfg?.llm || {};

  const url = (process.env.LLM_URL !== undefined ? process.env.LLM_URL : (block.url || '')).trim().replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || block.model || 'internal-devops-assistant-v1';
  const timeoutMs = parseInt(process.env.LLM_TIMEOUT_MS || block.timeout_ms || 10000, 10);
  const redactIps = block.redact_ips !== false;

  return { url, model, timeoutMs, redactIps };
}

// LLM API key: environment variable, then CyberArk.
async function getApiKey() {
  if (process.env.CYBERARK_LLM_API_KEY) return process.env.CYBERARK_LLM_API_KEY;
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY;

  if (credentialProvider && credentialProvider.getCredential) {
    try {
      const cred = await credentialProvider.getCredential('llm', 'api_key');
      if (cred) return cred;
    } catch (_) {}
  }
  return '';
}

/**
 * [Phase S / S10] Audit storage policy. global.yaml:
 *   ai:
 *     audit:
 *       store_text: true   # default; false keeps only SHA-256 hashes of prompt and answer
 */
function getAuditConfig() {
  let block = {};
  try {
    const globalCfg = yamlConfig ? yamlConfig.loadGlobalConfig() : {};
    block = globalCfg?.ai?.audit || {};
  } catch (_) {
    block = {};
  }
  const v = block.store_text;
  const storeText = !(v === false || (typeof v === 'string' && ['false', '0', 'no', 'off'].includes(v.toLowerCase())));
  return { storeText };
}

// SHA-256 of a text.
function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

/** Canonical text form of the (already redacted) messages exactly as sent. */
function renderPrompt(messages) {
  return messages.map(m => `[${m.role}]\n${m.content}`).join('\n\n');
}

const MAX_AUDIT_TEXT = 32 * 1024;

/**
 * Builds the audit detail for one LLM call: SHA-256 of the redacted prompt and of the answer
 * always; the redacted prompt and (redacted) answer text too when ai.audit.store_text is on.
 */
function buildAuditRecord({ promptText, answerText, model, usage, startedAt, finishedAt, redactIps = true }) {
  const { storeText } = getAuditConfig();
  const record = {
    model: model || null,
    prompt_sha256: promptText === null || promptText === undefined ? null : sha256(promptText),
    answer_sha256: answerText === null || answerText === undefined ? null : sha256(answerText),
    started_at: startedAt || null,
    finished_at: finishedAt || null,
    prompt_tokens: usage?.prompt_tokens ?? null,
    completion_tokens: usage?.completion_tokens ?? null,
    total_tokens: usage?.total_tokens ?? null,
    text_stored: storeText
  };
  if (storeText) {
    record.prompt_text = promptText === null || promptText === undefined ? null : String(promptText).slice(0, MAX_AUDIT_TEXT);
    record.answer_text = answerText === null || answerText === undefined ? null : redactText(String(answerText), redactIps).slice(0, MAX_AUDIT_TEXT);
  }
  return record;
}

// True when an LLM endpoint is configured.
function isConfigured() {
  const cfg = getConfig();
  return Boolean(cfg.url && cfg.url.length > 0);
}

/**
 * Sanitizes and redacts secrets and internal IPs from prompt text
 */
function redactText(text, redactIps = true) {
  if (typeof text !== 'string') return '';

  let out = text;

  // Redact private keys
  out = out.replace(/-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');

  // Redact bearer tokens
  out = out.replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED_TOKEN]');

  // Redact passwords and api keys in JSON / key-value forms
  out = out.replace(/(["']?(?:password|passwd|secret|api_key|token|auth_token)["']?\s*[:=]\s*["'])([^"'\r\n]+)(["'])/gi, '$1[REDACTED_SECRET]$3');

  // [Phase S / S10] Unquoted key=value / key: value secrets (password=hunter2, token: abc)
  out = out.replace(/(\b(?:password|passwd|pwd|secret|client_secret|api_key|apikey|api-key|token|auth_token|access_token|refresh_token)\s*[:=]\s*)(?!\[REDACTED)([^\s"',;&]+)/gi, '$1[REDACTED_SECRET]');

  // Redact basic auth in URLs
  out = out.replace(/:\/\/([^:/\s]+):([^@\s]+)@/g, '://[REDACTED_USER]:[REDACTED_PASS]@');

  // [Phase S / S10] JWTs, SENTINEL ingest keys (snk_...) and common provider API keys
  out = out.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[REDACTED_TOKEN]');
  out = out.replace(/\b(?:snk|sk|pk|ghp|gho|xox[abpr])[_-][A-Za-z0-9_-]{8,}/g, '[REDACTED_API_KEY]');
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_API_KEY]');

  // [Phase S / S10] Email addresses
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');

  // Redact internal RFC 1918 IPs if enabled
  if (redactIps) {
    out = out.replace(/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED_INTERNAL_IP]');
    out = out.replace(/\b172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED_INTERNAL_IP]');
    out = out.replace(/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED_INTERNAL_IP]');
  }

  return out;
}

/**
 * Low-level call to OpenAI-compatible completions endpoint
 */
async function callLlmEndpoint(messages, options = {}) {
  const cfg = getConfig();

  if (!cfg.url) {
    return {
      ok: true,
      status: 'DATA_UNAVAILABLE',
      text: 'Internal LLM assistant is not configured (URL is blank).',
      is_draft: true,
      label: 'AI draft',
      model: cfg.model,
      usage: null
    };
  }

  const apiKey = options.apiKey || (await getApiKey());
  const endpoint = `${cfg.url}/v1/chat/completions`;

  // Apply redaction to every message before it leaves the process (and before auditing)
  const sanitizedMessages = messages.map(m => ({
    role: m.role,
    content: redactText(m.content, cfg.redactIps)
  }));
  const promptText = renderPrompt(sanitizedMessages);
  const startedAt = new Date().toISOString();
  const auditFor = (answerText, model, usage) => buildAuditRecord({
    promptText, answerText, model, usage, startedAt, finishedAt: new Date().toISOString(), redactIps: cfg.redactIps
  });

  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || cfg.timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.model || cfg.model,
        messages: sanitizedMessages,
        temperature: 0.1,
        max_tokens: options.maxTokens || 800
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`LLM endpoint returned HTTP ${res.status}: ${errBody.slice(0, 500)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const model = data.model || cfg.model;
    const usage = data.usage || null;

    return {
      ok: true,
      text: text.trim(),
      is_draft: true,
      label: 'AI draft',
      model,
      usage,
      // Not for the HTTP response: callers strip `audit` and pass it to the audit sink.
      audit: auditFor(text.trim(), model, usage)
    };
  } catch (err) {
    const wrapped = err.name === 'AbortError'
      ? new Error(`LLM request timed out after ${options.timeoutMs || cfg.timeoutMs}ms`)
      : err;
    wrapped.audit = auditFor(null, options.model || cfg.model, null);
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

// Short text list of alerts for the prompt.
function describeAlerts(alerts, withSeverity) {
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  return alerts.slice(0, 50).map(a => {
    if (a && typeof a === 'object') {
      const name = a.rule_id || a.title || a.id || 'alert';
      return withSeverity && a.severity ? `${name} (${a.severity})` : String(a.title || name);
    }
    return String(a);
  }).join(withSeverity ? '; ' : ', ');
}

/**
 * Action: Explain problem and its diagnosed top cause
 */
async function explainProblem(problem, options = {}) {
  if (!problem || typeof problem !== 'object') {
    throw new Error('Problem object is required');
  }

  const problemContext = [
    `Problem ID: ${problem.id || 'N/A'}`,
    `Title: ${problem.title || 'Untitled Problem'}`,
    `Top Diagnosed Cause: ${problem.top_layer || 'Unknown'}`,
    `Suspect Entity: ${problem.suspect_entity || 'N/A'}`,
    `Impacted Environment: ${problem.environment || 'production'}`,
    `Severity: ${problem.severity || 'HIGH'}`,
    `Associated Symptoms/Alerts: ${describeAlerts(problem.alerts, true) || 'None'}`,
    ...(problem.confidence !== null && problem.confidence !== undefined ? [`Confidence: ${problem.confidence}`] : []),
    ...(problem.evidence_pack?.summary ? [`Evidence Summary: ${String(problem.evidence_pack.summary).slice(0, 2000)}`] : [])
  ].join('\n');

  const messages = [
    {
      role: 'system',
      content: 'You are SENTINEL, the in-house DevOps observability platform for an enterprise bank. Provide a crisp, structured operational explanation of the detected problem based strictly on the provided evidence. Highlight probable root cause layer, expected impact, and immediate verification steps. Do not speculate beyond the evidence.'
    },
    {
      role: 'user',
      content: `Please analyze this operational incident:\n\n${problemContext}`
    }
  ];

  return await callLlmEndpoint(messages, options);
}

/**
 * Action: Draft executive summary for an evidence pack
 */
async function draftEvidenceSummary(evidenceData, options = {}) {
  const summaryContext = [
    `Incident ID: ${evidenceData.id || 'N/A'}`,
    `Classification: ${evidenceData.top_layer || 'infrastructure'} layer degradation`,
    `Entity: ${evidenceData.suspect_entity || 'N/A'}`,
    `Timeline: ${evidenceData.time_window || 'Last 60 minutes'}`,
    `Key Symptoms: ${describeAlerts(evidenceData.alerts, false) || 'Reported slowdown'}`,
    ...(evidenceData.evidence_pack?.summary ? [`Evidence Summary: ${String(evidenceData.evidence_pack.summary).slice(0, 2000)}`] : [])
  ].join('\n');

  const messages = [
    {
      role: 'system',
      content: 'You are SENTINEL\'s evidence pack drafting assistant. Draft a 2-3 sentence executive briefing summarizing the incident, the evidence collected, and the layer responsible. Output clean markdown.'
    },
    {
      role: 'user',
      content: `Draft evidence summary for:\n\n${summaryContext}`
    }
  ];

  return await callLlmEndpoint(messages, options);
}

module.exports = {
  isConfigured,
  getConfig,
  redactText,
  getAuditConfig,
  buildAuditRecord,
  callLlmEndpoint,
  explainProblem,
  draftEvidenceSummary
};
