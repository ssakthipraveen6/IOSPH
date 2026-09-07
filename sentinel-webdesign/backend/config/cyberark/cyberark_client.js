const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const candidateScript = path.resolve(__dirname, '../../../scripts/cyberark_fetch.py');
const fallbackScript = path.resolve(__dirname, '../../scripts/cyberark_fetch.py');
const DEFAULT_SCRIPT = fs.existsSync(candidateScript) ? candidateScript : fallbackScript;
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

/**
 * Invokes cyberark_fetch.py to retrieve a credential value.
 * @param {string} safe CyberArk Safe identifier
 * @param {string} object CyberArk Object identifier
 * @param {object} options Optional parameters ({ timeoutMs, scriptPath })
 * @returns {Promise<string>} Secret value
 */
function fetchFromCyberArk(safe, object, { timeoutMs = 5000, scriptPath = DEFAULT_SCRIPT } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_CMD, [scriptPath, '--safe', safe, '--object', object]);
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`CyberArk fetch timed out after ${timeoutMs}ms (safe=${safe}, object=${object})`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`cyberark_fetch.py exited ${code} for safe=${safe} object=${object}`));
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (!parsed.value) {
          return reject(new Error('cyberark_fetch.py returned output without "value" field'));
        }
        resolve(parsed.value);
      } catch (e) {
        reject(new Error(`Failed to parse cyberark_fetch.py output: ${e.message}`));
      }
    });

    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

module.exports = { fetchFromCyberArk };
