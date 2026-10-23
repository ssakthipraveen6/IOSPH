/**
 * synthetics/steps/upload_download.js
 *
 * Synthetic Canary Artifact Upload / Download / Delete step.
 */

const { performance } = require('perf_hooks');

// Uploads and downloads a test file and checks it.
async function executeUploadDownloadStep(step, context = {}) {
  const t0 = performance.now();
  let baseTarget = step.url || step.target_url || '/';
  if (!baseTarget.startsWith('http://') && !baseTarget.startsWith('https://')) {
    const base = (context.baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
    const pathPart = baseTarget.startsWith('/') ? baseTarget : `/${baseTarget}`;
    baseTarget = `${base}${pathPart}`;
  }

  const canaryContent = step.payload || `sentinel-canary-payload-${Date.now()}`;
  const headers = { ...(step.headers || {}) };
  if (context.credential) {
    headers['Authorization'] = `Bearer ${context.credential}`;
  }

  const action = step.action || 'roundtrip'; // 'upload' | 'download' | 'delete' | 'roundtrip'

  try {
    if (action === 'roundtrip' || action === 'upload') {
      const putRes = await fetch(baseTarget, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        body: canaryContent
      });
      if (step.assert?.status && putRes.status !== step.assert.status && putRes.status >= 400) {
        return {
          success: false,
          status: 'ERROR',
          durationMs: performance.now() - t0,
          error: `Upload failed with status ${putRes.status}`
        };
      }
    }

    if (action === 'roundtrip' || action === 'download') {
      const getRes = await fetch(baseTarget, { method: 'GET', headers });
      if (getRes.status >= 400) {
        return {
          success: false,
          status: 'ERROR',
          durationMs: performance.now() - t0,
          error: `Download failed with status ${getRes.status}`
        };
      }
      const data = await getRes.text();
      if (step.assert?.body_contains && !data.includes(step.assert.body_contains)) {
        return {
          success: false,
          status: 'ERROR',
          durationMs: performance.now() - t0,
          error: `Artifact content mismatch`
        };
      }
    }

    if (action === 'roundtrip' || action === 'delete') {
      await fetch(baseTarget, { method: 'DELETE', headers }).catch(() => {});
    }

    const durationMs = performance.now() - t0;
    if (step.assert?.max_ms && durationMs > step.assert.max_ms) {
      return {
        success: false,
        status: 'ERROR',
        durationMs,
        error: `Exceeded max latency: ${durationMs.toFixed(1)}ms > ${step.assert.max_ms}ms`
      };
    }

    return {
      success: true,
      status: 'OK',
      durationMs
    };
  } catch (err) {
    return {
      success: false,
      status: 'ERROR',
      durationMs: performance.now() - t0,
      error: err.message
    };
  }
}

module.exports = {
  executeUploadDownloadStep
};
