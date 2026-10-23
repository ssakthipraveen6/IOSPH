#!/usr/bin/env node
/**
 * scripts/dev_backend.js  (npm run dev-backend)
 * Starts the backend for local development with the Vite dev origins allowed by CORS
 * (SENTINEL_ALLOW_LOCALHOST_CORS=true). Production never sets this flag.
 */
const { spawn } = require('child_process');
const path = require('path');

const child = spawn(process.execPath, [path.join(__dirname, '..', 'backend', 'server.js')], {
  stdio: 'inherit',
  env: { ...process.env, SENTINEL_ALLOW_LOCALHOST_CORS: 'true' }
});
child.on('exit', (code) => process.exit(code === null ? 1 : code));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
