/**
 * Validation tool: opens each view in Chrome and saves screenshots.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUTPUT_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, 'screenshots/baseline');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Waits.
function wait(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// GET returning JSON.
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Minimal Chrome DevTools client.
class CdpClient {
  // Opens the connection.
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
  }

  // Waits for the connection.
  async connect() {
    await new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
      this.ws.on('message', data => {
        const msg = JSON.parse(data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(new Error(msg.error.message));
          else cb.resolve(msg.result);
        }
      });
    });
  }

  // Sends a command.
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

// Captures every view.
async function capture() {
  console.log(`[SCREENSHOT] Target output dir: ${OUTPUT_DIR}`);

  // 1. Ensure backend is running
  let serverProc = null;
  let serverRunning = false;
  try {
    await fetchJson('http://localhost:3001/api/settings');
    serverRunning = true;
    console.log('[SCREENSHOT] Backend already running on port 3001.');
  } catch (_) {
    console.log('[SCREENSHOT] Starting backend server on port 3001...');
    serverProc = spawn('node', ['backend/server.js'], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        PORT: '3001',
        SENTINEL_JWT_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        NODE_ENV: 'development'
      },
      stdio: 'ignore'
    });
    // Wait for server to start
    for (let i = 0; i < 30; i++) {
      await wait(500);
      try {
        await fetchJson('http://localhost:3001/api/settings');
        serverRunning = true;
        break;
      } catch (e) {}
    }
  }

  if (!serverRunning) {
    throw new Error('Failed to connect to backend on http://localhost:3001');
  }

  // 2. Launch headless Chrome with remote debugging
  console.log('[SCREENSHOT] Launching Chrome on port 9222...');
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + path.resolve(__dirname, 'chrome-profile')
  ]);

  await wait(2000);

  try {
    const targets = await fetchJson('http://localhost:9222/json');
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    if (!pageTarget) throw new Error('No Chrome target found');

    const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    console.log('[SCREENSHOT] Connected to Chrome CDP.');

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    await cdp.send('Page.navigate', { url: 'http://localhost:3001' });
    await wait(3000); // Allow initial load and WS connect

    const views = [
      { id: 'health', selector: '[data-tooltip*="NOC System Dashboard"]', name: 'health' },
      { id: 'metrics', selector: '[data-tooltip*="Telemetry & Historical"]', name: 'metrics' },
      { id: 'matrix', selector: '[data-tooltip*="Enterprise Health Matrix"]', name: 'matrix' },
      { id: 'command', selector: '[data-tooltip*="Autonomous Healing"]', name: 'command' },
      { id: 'sre', selector: '[data-tooltip*="SRE Platform"]', name: 'sre' },
      { id: 'entities', selector: '[data-tooltip*="Universal Entity"]', name: 'entities' },
      { id: 'timeline', selector: '[data-tooltip*="Correlation & RCA"]', name: 'timeline' },
      { id: 'yaml', selector: '[data-tooltip*="YAML Config Manager"]', name: 'yaml' },
      { id: 'admin', selector: '[data-tooltip*="DevSecOps Admin Control"]', name: 'admin' },
      { id: 'ailogs', cmdAction: 'ailogs', name: 'ailogs' },
      { id: 'misc', cmdAction: 'misc', name: 'misc' },
      { id: 'pbi', cmdAction: 'pbi', name: 'pbi' }
    ];

    const viewports = [
      { name: '1920x1080', width: 1920, height: 1080 },
      { name: '400px', width: 400, height: 800 }
    ];

    for (const view of views) {
      console.log(`[SCREENSHOT] Switching to view: ${view.name}`);
      if (view.selector) {
        await cdp.send('Runtime.evaluate', {
          expression: `
            (() => {
              const el = document.querySelector('${view.selector}');
              if (el) el.click();
              else console.warn('Element not found for selector: ${view.selector}');
            })()
          `
        });
      } else if (view.cmdAction) {
        // Switch via Command Palette
        await cdp.send('Runtime.evaluate', {
          expression: `
            (() => {
              // Trigger Cmd+K
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true }));
            })()
          `
        });
        await wait(300);
        await cdp.send('Runtime.evaluate', {
          expression: `
            (() => {
              const items = Array.from(document.querySelectorAll('.cmd-palette-item'));
              const target = items.find(el => el.textContent.toLowerCase().includes('${view.name}'));
              if (target) target.click();
            })()
          `
        });
      }

      await wait(800); // Allow view to render

      for (const vp of viewports) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: vp.width < 500
        });
        await wait(300);

        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const filePath = path.join(OUTPUT_DIR, `${view.name}_${vp.name}.png`);
        fs.writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'));
        console.log(`  ✓ Saved: ${path.basename(filePath)}`);
      }
    }

    cdp.close();
  } finally {
    try { chromeProc.kill(); } catch (_) {}
    if (serverProc) {
      try { serverProc.kill(); } catch (_) {}
    }
  }

  console.log('[SCREENSHOT] Completed capturing all reference screenshots.');
}

capture().catch(err => {
  console.error('[SCREENSHOT] Fatal error:', err);
  process.exit(1);
});
