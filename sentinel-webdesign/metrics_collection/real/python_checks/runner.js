const { spawn } = require('child_process');
const path = require('path');
const config = require('@sentinel/config');

// [T0.15] Concurrency bound and timeout controls to prevent resource exhaustion and hanging processes
const MAX_CONCURRENT_SPAWNS = 3;
const SPAWN_TIMEOUT_MS = 5000;
let activeSpawns = 0;

/**
 * Executes the Python synthetic prober check with bounded concurrency,
 * strict execution timeout, and zero fabricated metrics on failure (T0.15).
 *
 * @param {string} url Endpoint URL to probe
 * @returns {Promise<{ status: string, latency_ms: number|null, error?: string, login_success: boolean|null, skipped?: boolean }>}
 */
function runSeleniumCheck(url) {
  return new Promise((resolve) => {
    // Check if Python synthetic metric prober is enabled in global config
    if (typeof config.isPythonMetricsEnabled === 'function' && !config.isPythonMetricsEnabled()) {
      return resolve({
        status: 'SKIPPED',
        skipped: true,
        latency_ms: null,
        error: 'Python metrics collector disabled in configuration',
        login_success: null
      });
    }

    // Bound concurrent process spawns
    if (activeSpawns >= MAX_CONCURRENT_SPAWNS) {
      return resolve({
        status: 'DATA_UNAVAILABLE',
        latency_ms: null,
        error: `Concurrent synthetic prober limit reached (${MAX_CONCURRENT_SPAWNS})`,
        login_success: null
      });
    }

    activeSpawns++;
    let resolved = false;

    function safeResolve(result) {
      if (!resolved) {
        resolved = true;
        activeSpawns = Math.max(0, activeSpawns - 1);
        resolve(result);
      }
    }

    const scriptPath = path.join(__dirname, 'selenium_ui_check.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    let py;
    try {
      py = spawn(pythonCmd, [scriptPath, '--url', url]);
    } catch (spawnError) {
      return safeResolve({
        status: 'DATA_UNAVAILABLE',
        latency_ms: null,
        error: `Failed to spawn python prober: ${spawnError.message}`,
        login_success: false
      });
    }

    // Strict 5s spawn timeout with process termination
    const timeoutHandle = setTimeout(() => {
      try {
        if (py && !py.killed) {
          py.kill('SIGKILL');
        }
      } catch (_) {}
      safeResolve({
        status: 'DATA_UNAVAILABLE',
        latency_ms: null,
        error: `Python synthetic prober timed out after ${SPAWN_TIMEOUT_MS}ms`,
        login_success: false
      });
    }, SPAWN_TIMEOUT_MS);

    let output = '';

    py.stdout.on('data', (data) => {
      output += data.toString();
    });

    py.stderr.on('data', () => {
      // Collect or drop stderr
    });

    py.on('error', (err) => {
      clearTimeout(timeoutHandle);
      safeResolve({
        status: 'DATA_UNAVAILABLE',
        latency_ms: null,
        error: `Python prober process error: ${err.message}`,
        login_success: false
      });
    });

    py.on('close', (code) => {
      clearTimeout(timeoutHandle);
      if (code !== 0) {
        return safeResolve({
          status: 'DATA_UNAVAILABLE',
          latency_ms: null,
          error: `Python prober exited with non-zero code ${code}`,
          login_success: false
        });
      }

      try {
        const parsed = JSON.parse(output.trim());
        safeResolve(parsed);
      } catch (parseError) {
        // [T0.15] Never fabricate Healthy or random latency on failure — return DATA_UNAVAILABLE
        safeResolve({
          status: 'DATA_UNAVAILABLE',
          latency_ms: null,
          error: `Invalid prober output format: ${parseError.message}`,
          login_success: false
        });
      }
    });
  });
}

module.exports = {
  runSeleniumCheck
};
