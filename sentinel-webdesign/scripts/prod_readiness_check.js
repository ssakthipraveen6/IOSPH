#!/usr/bin/env node
'use strict';
/**
 * Production readiness check. Run it ON the production host, with the environment the service will really use:
 *
 *   npm run readiness
 *
 * It reads settings only. It sends no traffic, so it is safe to run at any time.
 * Exit code 1 when anything is FAIL. WARN means "works, but read this first".
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const yamlConfig = require(path.join(ROOT, 'backend', 'config', 'yaml_config'));

const results = [];
// Adds a result row.
const add = (level, area, message, fix) => results.push({ level, area, message, fix });
// Environment variable.
const env = (n) => process.env[n];

// Checks NODE_ENV, JWT secret, sign-in and ingest settings.
function checkProcess() {
  if (env('NODE_ENV') === 'production') add('PASS', 'process', 'NODE_ENV=production');
  else add('FAIL', 'process', `NODE_ENV is "${env('NODE_ENV') || 'unset'}"`, 'Set NODE_ENV=production (web.config does this under IIS). Without it, logins are simulated and reads are open.');

  const secret = env('SENTINEL_JWT_SECRET') || '';
  if (secret.length >= 32) add('PASS', 'process', 'SENTINEL_JWT_SECRET is set (32+ characters)');
  else add('FAIL', 'process', 'SENTINEL_JWT_SECRET is missing or shorter than 32 characters', 'Set the same long random value as a machine variable on both servers.');

  if (env('SENTINEL_ALLOW_SIMULATED_LOGIN') === 'true') add('FAIL', 'login', 'SENTINEL_ALLOW_SIMULATED_LOGIN=true: anyone can sign in', 'Remove it. It exists only for a staging server.');
  else add('PASS', 'login', 'Simulated login is off; sign-in goes to LDAP');

  if (env('SENTINEL_REQUIRE_AUTH_READS') === 'false') add('FAIL', 'login', 'SENTINEL_REQUIRE_AUTH_READS=false: data can be read without signing in', 'Remove it.');

  if (env('ALLOWED_ORIGIN') || env('ALLOWED_ORIGINS')) add('PASS', 'process', 'ALLOWED_ORIGIN is set');
  else add('FAIL', 'process', 'ALLOWED_ORIGIN is not set; the built-in placeholder origin would be used', 'Set ALLOWED_ORIGIN=https://<your sentinel URL>.');

  const mode = env('SENTINEL_INGEST_AUTH_MODE');
  if (mode && mode !== 'enforce') add('FAIL', 'ingest', `SENTINEL_INGEST_AUTH_MODE=${mode}: agents can push without a key`, 'Remove it (production enforces keys by default).');
  else add('PASS', 'ingest', 'Ingest keys are enforced');
  if (env('SENTINEL_INGEST_API_KEYS')) add('PASS', 'ingest', 'Ingest keys are provided by environment');
  else add('WARN', 'ingest', 'No SENTINEL_INGEST_API_KEYS; keys must exist in the database', 'Create a key per environment with: npm run ingest-key. Without one no agent can send data.');
}

// Checks LDAP settings.
function checkLdap() {
  const g = yamlConfig.loadGlobalConfig() || {};
  const ldap = g.sso_ldap_config || {};
  const url = ldap.ldap_url || ldap.url || '';
  if (!url || /enterprise\.corp/.test(url)) add('FAIL', 'login', `LDAP URL is still the shipped placeholder (${url || 'empty'})`, 'Set sso_ldap_config.ldap_url, bind_dn and search_base in config/global.yaml.');
  else add('PASS', 'login', `LDAP URL set (${url})`);
  const bind = String(ldap.bind_dn || '');
  if (!bind || /dc=enterprise,dc=corp/.test(bind)) add('WARN', 'login', 'LDAP bind_dn looks like the shipped placeholder', 'Set the real service account DN.');
  const hasBindSecret = (loadRegistry().applications || {}).sso_eldap || env('SSO_ELDAP_BIND');
  if (hasBindSecret) add('PASS', 'login', 'LDAP bind credential has a CyberArk entry or SSO_ELDAP_BIND');
  else add('FAIL', 'login', 'No CyberArk entry (sso_eldap/bind) and no SSO_ELDAP_BIND for the LDAP service account', 'Add sso_eldap to config/cyberark.yaml, or set SSO_ELDAP_BIND.');
}

// Checks CyberArk CCP settings.
function checkVault() {
  if (env('CYBERARK_CCP_URL') && env('CYBERARK_APP_ID')) add('PASS', 'vault', 'CyberArk CCP URL and AppID are set (scripts/cyberark_fetch.py)');
  else add('FAIL', 'vault', 'CYBERARK_CCP_URL / CYBERARK_APP_ID are not set; no real credential can be read', 'Set both on the server (and CYBERARK_CLIENT_CERT / CYBERARK_CLIENT_KEY if the AppID uses a certificate). Production refuses the built-in fake.');
}

// Reads config/cyberark.yaml.
function loadRegistry() {
  try { return require('js-yaml').load(fs.readFileSync(path.join(ROOT, 'config', 'cyberark.yaml'), 'utf8')) || {}; } catch (_) { return {}; }
}

// Checks production endpoints and credentials of each application.
function checkApplications() {
  const apps = Object.values(yamlConfig.loadAllApplications() || {}).filter((a, i, all) => a && a.kind === 'application' && a.enabled !== false && all.findIndex(b => b.id === a.id) === i);
  const registry = (loadRegistry().applications || {});
  let missingProd = [];
  let sameAsStg = [];
  const noCred = [];
  for (const a of apps) {
    const prod = (a.endpoints && a.endpoints.prod) || {};
    const stg = (a.endpoints && a.endpoints.stg) || {};
    if (!prod.api && !prod.vip) missingProd.push(a.id);
    else if (JSON.stringify(prod) === JSON.stringify(stg)) sameAsStg.push(a.id);
    const purpose = a.auth && a.auth.credential_purpose;
    if (purpose && a.auth.scheme !== 'none') {
      const inRegistry = registry[a.id] && registry[a.id].objects && registry[a.id].objects[purpose];
      const inEnv = env(`${a.id.toUpperCase()}_${String(purpose).toUpperCase()}`);
      if (!inRegistry && !inEnv) noCred.push(`${a.id}/${purpose}`);
    }
  }
  if (!missingProd.length) add('PASS', 'urls', `All ${apps.length} applications declare production endpoints`);
  else add('FAIL', 'urls', `No production endpoint for: ${missingProd.join(', ')}`, 'Fill endpoints.prod in config/apps/<app>.yaml.');
  if (sameAsStg.length) add('FAIL', 'urls', `Production endpoints equal the staging ones for: ${sameAsStg.join(', ')}`, 'Production would read staging systems.');
  const placeholder = apps.filter(a => JSON.stringify((a.endpoints || {}).prod || {}).includes('-prod.internal.corp'));
  if (placeholder.length) add('WARN', 'urls', `${placeholder.length} applications still use the shipped *-prod.internal.corp addresses`, 'Replace each with the real production address, then run: npm run config:check');
  if (!noCred.length) add('PASS', 'credentials', 'Every application with authentication has a CyberArk entry or an environment variable');
  else add('WARN', 'credentials', `No credential source for: ${noCred.join(', ')}`, 'Add the CyberArk object to config/cyberark.yaml or set <APPID>_<PURPOSE>. That collector reports AUTH_FAILED until then (the screen says so; nothing is invented).');
}

// Checks PostgreSQL / ClickHouse / runtime folder.
function checkStore() {
  const g = yamlConfig.loadGlobalConfig() || {};
  const apps = yamlConfig.loadAllInfrastructureLayers ? yamlConfig.loadAllInfrastructureLayers() : {};
  const hasPg = JSON.stringify(apps).includes('jdbc:postgresql') || env('PGHOST');
  if (hasPg) add('PASS', 'storage', 'PostgreSQL connection is declared');
  else add('WARN', 'storage', 'No PostgreSQL connection is declared; state lives in .runtime/sentinel_db.json on one server', 'Fine for one node. Two nodes sharing state, and history that survives a rebuild, need PostgreSQL/Timescale (run: npm run migrate).');
  if (env('CLICKHOUSE_URL') || (g.clickhouse && g.clickhouse.enabled)) add('PASS', 'storage', 'ClickHouse is enabled for long metric history');
  else add('WARN', 'storage', 'ClickHouse is off; metric history is limited to the in-memory ring and Postgres', 'Optional; needed for the 13-month and capacity-forecast views at 2,000 hosts.');
  try { fs.accessSync(path.join(ROOT, '.runtime'), fs.constants.W_OK); add('PASS', 'storage', '.runtime is writable'); }
  catch (_) { try { fs.mkdirSync(path.join(ROOT, '.runtime'), { recursive: true }); add('PASS', 'storage', '.runtime created'); } catch (e) { add('FAIL', 'storage', `.runtime is not writable: ${e.message}`, 'Give the service account write access.'); } }
}

// Checks the front-end build.
function checkBuild() {
  try {
    const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify_dist.js')], { encoding: 'utf8' });
    if (r.status === 0) add('PASS', 'build', 'frontend/dist matches frontend/src');
    else add('FAIL', 'build', 'frontend/dist is out of date or missing', 'Run: npm run build');
  } catch (e) { add('WARN', 'build', `Could not verify the build: ${e.message}`); }
}

// Runs all checks and prints the result.
function main() {
  checkProcess(); checkVault(); checkLdap(); checkApplications(); checkStore(); checkBuild();
  const mark = { PASS: '✔', WARN: '!', FAIL: '✖' };
  for (const r of results) {
    console.log(`${mark[r.level]} [${r.level}] ${r.area.padEnd(11)} ${r.message}`);
    if (r.fix && r.level !== 'PASS') console.log(`             → ${r.fix}`);
  }
  const n = (l) => results.filter(r => r.level === l).length;
  console.log(`\n${n('PASS')} passed, ${n('WARN')} to read, ${n('FAIL')} blocking`);
  console.log(n('FAIL') ? 'NOT READY for production.' : (n('WARN') ? 'Ready to start; read the warnings.' : 'Ready.'));
  process.exit(n('FAIL') ? 1 : 0);
}
if (require.main === module) main();
module.exports = { results };
