'use strict';
// A production process must never accept simulated logins unless explicitly told to,
// whatever config/global.yaml says the default environment is.
const assert = require('assert');
const ldap = require('../backend/auth/ldap_client');

(async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, ALLOW: process.env.SENTINEL_ALLOW_SIMULATED_LOGIN };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.SENTINEL_ALLOW_SIMULATED_LOGIN;
    const origWarn = console.warn; const origErr = console.error;
    console.warn = () => {}; console.error = () => {};
    let r;
    try { r = await ldap.authenticate('admin_sentinel', 'anything-at-all'); } finally { console.warn = origWarn; console.error = origErr; }
    assert.strictEqual(r.success, false, 'production does not accept a simulated login');
    assert.notStrictEqual(r.user && r.user.authenticatedVia, 'STAGING_SIMULATION');

    process.env.SENTINEL_ALLOW_SIMULATED_LOGIN = 'true';
    const w = console.warn; let warned = false; console.warn = (m) => { if (/SECURITY/.test(String(m))) warned = true; };
    const ok = await ldap.authenticate('admin_sentinel', 'anything-at-all');
    console.warn = w;
    assert.strictEqual(ok.success, true, 'explicit opt-in keeps a staging server usable');
    assert.ok(warned, 'opt-in in production is logged as a security warning');
    console.log('prod_login_lockdown: all assertions passed');
  } finally {
    if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.ALLOW === undefined) delete process.env.SENTINEL_ALLOW_SIMULATED_LOGIN; else process.env.SENTINEL_ALLOW_SIMULATED_LOGIN = saved.ALLOW;
  }
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
