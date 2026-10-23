'use strict';

/**
 * tests/llm_assistant.test.js
 *
 * M7 Task 7.3 Test Suite: Internal LLM assistant client,
 * redaction pipeline, fake OpenAI-compatible mock server,
 * and inert state when unconfigured.
 */

const assert = require('assert');
const http = require('http');
const llmClient = require('../ai_analysis/llm_client');

async function runTests() {
  console.log('=== Running Internal LLM Assistant Test Suite ===\n');

  // 1. Redaction Pipeline Unit Tests
  console.log('[TEST 1] Redaction pipeline sanitization...');
  const sensitiveText = `
    Connection established to 10.128.4.15 using token Bearer eyJhbGciOiJIUzI1Ni...
    Credentials: password: "super_secret_password" and api_key='secret_key_123'
    Connecting to secondary host 192.168.1.50 with url https://admin:p@ssword123@internal.corp
    -----BEGIN RSA PRIVATE KEY-----
    MIIEowIBAAKCAQEA0Y...
    -----END RSA PRIVATE KEY-----
  `;

  const redacted = llmClient.redactText(sensitiveText, true);

  assert(!redacted.includes('10.128.4.15'), 'Internal 10.x IP must be redacted');
  assert(!redacted.includes('192.168.1.50'), 'Internal 192.168.x IP must be redacted');
  assert(!redacted.includes('super_secret_password'), 'Password must be redacted');
  assert(!redacted.includes('secret_key_123'), 'API key must be redacted');
  assert(!redacted.includes('MIIEowIBAAKCAQEA0Y'), 'Private key body must be redacted');
  assert(redacted.includes('[REDACTED_INTERNAL_IP]'), 'Must contain [REDACTED_INTERNAL_IP]');
  assert(redacted.includes('[REDACTED_SECRET]'), 'Must contain [REDACTED_SECRET]');
  assert(redacted.includes('[REDACTED_PRIVATE_KEY]'), 'Must contain [REDACTED_PRIVATE_KEY]');
  console.log('  -> PASSED: Redaction pipeline sanitized tokens, passwords, keys, and IPs');

  // 2. Inert state when URL is unconfigured
  console.log('[TEST 2] Inert behavior when LLM_URL is blank...');
  const oldUrl = process.env.LLM_URL;
  process.env.LLM_URL = '';

  const inertStatus = llmClient.isConfigured();
  assert.strictEqual(inertStatus, false, 'isConfigured() must be false when URL is blank');

  const inertResponse = await llmClient.explainProblem({
    id: 'prob-001',
    title: 'Storage slowdown',
    top_layer: 'storage'
  });

  assert.strictEqual(inertResponse.ok, true, 'inert response must be ok: true');
  assert.strictEqual(inertResponse.status, 'DATA_UNAVAILABLE', 'status must be DATA_UNAVAILABLE');
  assert.strictEqual(inertResponse.is_draft, true, 'is_draft must be true');
  assert.strictEqual(inertResponse.label, 'AI draft', 'label must be AI draft');
  assert(inertResponse.text.includes('not configured'), 'must state LLM is not configured');
  console.log('  -> PASSED: Inert state handled gracefully with DATA_UNAVAILABLE');

  // 3. Fake OpenAI-Compatible Mock Server
  console.log('[TEST 3] Calling OpenAI-compatible endpoint with fake server...');
  let receivedPayload = null;
  let receivedAuth = null;

  const mockServer = http.createServer((req, res) => {
    receivedAuth = req.headers['authorization'];
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        receivedPayload = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-test-001',
          object: 'chat.completion',
          model: 'internal-devops-assistant-v1',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Based on the evidence, the storage volume is experiencing NFS lock timeouts affecting Artifactory metadata commits. Immediate action: verify NetApp controller IOPS and latency.'
              },
              finish_reason: 'stop'
            }
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 35,
            total_tokens: 155
          }
        }));
      } catch (err) {
        res.writeHead(400);
        res.end(err.message);
      }
    });
  });

  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  process.env.LLM_URL = `http://127.0.0.1:${port}`;
  process.env.LLM_API_KEY = 'mock-cyberark-api-key';

  try {
    // 3a. Test explainProblem
    const problemPayload = {
      id: 'prob-storage-404',
      title: 'Artifactory repository degraded response',
      top_layer: 'storage',
      suspect_entity: 'nas-volume-01 (10.200.5.12)',
      environment: 'production',
      severity: 'HIGH',
      alerts: [
        { rule_id: 'nfs_rpc_timeout', title: 'NFS RPC Timeout spike', severity: 'HIGH' }
      ]
    };

    const explainResult = await llmClient.explainProblem(problemPayload);

    assert.strictEqual(explainResult.ok, true);
    assert.strictEqual(explainResult.is_draft, true);
    assert.strictEqual(explainResult.label, 'AI draft');
    assert(explainResult.text.includes('storage volume is experiencing NFS lock timeouts'));
    assert.strictEqual(explainResult.usage.total_tokens, 155);

    // Verify mock server received the request with correct headers & redacted IP
    assert.strictEqual(receivedAuth, 'Bearer mock-cyberark-api-key');
    assert.strictEqual(receivedPayload.model, 'internal-devops-assistant-v1');
    assert(Array.isArray(receivedPayload.messages), 'messages should be an array');
    const userPrompt = receivedPayload.messages.find(m => m.role === 'user').content;
    assert(!userPrompt.includes('10.200.5.12'), 'IP 10.200.5.12 must be redacted before sending');
    assert(userPrompt.includes('[REDACTED_INTERNAL_IP]'), 'IP must be replaced by [REDACTED_INTERNAL_IP]');
    console.log('  -> PASSED: explainProblem verified against mock OpenAI server with IP redaction');

    // 3b. Test draftEvidenceSummary
    const evidencePayload = {
      id: 'prob-storage-404',
      top_layer: 'storage',
      suspect_entity: 'nas-volume-01',
      time_window: '2026-10-12T08:00:00Z to 2026-10-12T09:00:00Z',
      alerts: [{ title: 'NFS RPC Timeout spike' }]
    };

    const draftResult = await llmClient.draftEvidenceSummary(evidencePayload);
    assert.strictEqual(draftResult.ok, true);
    assert.strictEqual(draftResult.is_draft, true);
    assert(draftResult.text.length > 10);
    console.log('  -> PASSED: draftEvidenceSummary verified against mock OpenAI server');

  } finally {
    mockServer.close();
    process.env.LLM_URL = oldUrl || '';
    delete process.env.LLM_API_KEY;
  }

  console.log('\n=== All Internal LLM Assistant Tests Passed Successfully ===');
}

runTests().catch(err => {
  console.error('\n[FATAL] LLM assistant test failed:', err);
  process.exit(1);
});
