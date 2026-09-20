#!/usr/bin/env node
/**
 * scripts/config_check.js
 *
 *   npm run config:check
 *
 * Validates everything under config/ and prints what each application will do
 * when the app starts. Run it after adding or editing a manifest -- it is
 * faster and clearer than starting the server and reading logs.
 *
 * Exits 1 on any error so it can gate CI.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'config');
const APPS = path.join(CONFIG, 'apps');
const INFRA = path.join(CONFIG, 'infra');

const errors = [];
const warnings = [];
const g = (s) => `\x1b[32m${s}\x1b[0m`;
const y = (s) => `\x1b[33m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function loadYaml(file) {
  try {
    return yaml.load(fs.readFileSync(file, 'utf8')) || {};
  } catch (e) {
    errors.push(`${path.relative(ROOT, file)}: invalid YAML — ${e.message.split('\n')[0]}`);
    return null;
  }
}

// ---------------------------------------------------------------- global.yaml
const globalPath = path.join(CONFIG, 'global.yaml');
if (!fs.existsSync(globalPath)) {
  errors.push('config/global.yaml is missing.');
}
const globalCfg = fs.existsSync(globalPath) ? loadYaml(globalPath) : {};

const VALID_ENVS = ['prod', 'production', 'staging', 'stg', 'stage', 'demo'];
const env = globalCfg && globalCfg.environment;
if (!env) {
  errors.push('config/global.yaml: `environment` is not set. Expected prod, staging or demo.');
} else if (!VALID_ENVS.includes(String(env).toLowerCase())) {
  errors.push(`config/global.yaml: environment "${env}" is not recognised. Expected prod, staging or demo.`);
}

// ---------------------------------------------------------------- manifests
function collect(dir, kindLabel) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_'))
    .map(f => {
      const full = path.join(dir, f);
      const doc = loadYaml(full);
      return doc ? { file: f, doc, kindLabel } : null;
    })
    .filter(Boolean);
}

const apps = collect(APPS, 'application');
const infra = collect(INFRA, 'infrastructure');

const seenIds = new Map();
for (const { file, doc } of apps.concat(infra)) {
  const rel = `config/${doc.kind === 'infrastructure' ? 'infra' : 'apps'}/${file}`;

  if (!doc.id) {
    errors.push(`${rel}: missing required field \`id\`.`);
    continue;
  }
  if (!/^[a-z0-9_]+$/.test(doc.id)) {
    errors.push(`${rel}: id "${doc.id}" must be lowercase letters, numbers and underscores only.`);
  }
  if (seenIds.has(doc.id)) {
    errors.push(`${rel}: id "${doc.id}" is already declared by ${seenIds.get(doc.id)}.`);
  } else {
    seenIds.set(doc.id, rel);
  }
  if (!doc.display_name) warnings.push(`${rel}: no \`display_name\`, the UI will show the raw id.`);

  for (const alias of doc.aliases || []) {
    if (seenIds.has(alias) && seenIds.get(alias) !== rel) {
      warnings.push(`${rel}: alias "${alias}" collides with ${seenIds.get(alias)} — the real manifest wins.`);
    }
  }

  if (doc.kind !== 'infrastructure') {
    const prod = doc.endpoints && doc.endpoints.prod && doc.endpoints.prod.api;
    const stg = doc.endpoints && doc.endpoints.stg && doc.endpoints.stg.api;
    if (!prod && !stg && !doc.api) {
      warnings.push(`${rel}: no endpoint configured — this application will report DATA_UNAVAILABLE.`);
    }
    if (doc.auth && doc.auth.scheme && doc.auth.scheme !== 'none' && !doc.auth.credential_purpose) {
      errors.push(`${rel}: auth.scheme is "${doc.auth.scheme}" but auth.credential_purpose is missing.`);
    }
  }
}

// ---------------------------------------------------------------- report
console.log('');
console.log(`Environment : ${env || r('unset')}`);
console.log(`Applications: ${apps.length}    Infrastructure layers: ${infra.length}`);
console.log('');
console.log('  STATUS    ID                          ENDPOINT (active environment)');
console.log('  ' + '-'.repeat(74));

const overrides = globalCfg.applications_enabled || {};
const isProdEnv = String(env || '').toLowerCase().startsWith('prod');

for (const { doc } of apps.sort((a, b) => (a.doc.id || '').localeCompare(b.doc.id || ''))) {
  if (!doc.id) continue;
  let enabled;
  let why;
  if (overrides[doc.id] !== undefined) {
    enabled = Boolean(overrides[doc.id]);
    why = 'global.yaml override';
  } else if (doc.enabled !== undefined) {
    enabled = Boolean(doc.enabled);
    why = 'manifest';
  } else {
    enabled = true;
    why = 'default';
  }

  const ep = (doc.endpoints && ((isProdEnv ? doc.endpoints.prod : doc.endpoints.stg) || {}).api) || doc.api || '';
  const status = enabled ? g('ON ') : dim('off');
  const endpoint = ep || dim('(none — will report DATA_UNAVAILABLE)');
  console.log(`  ${status}       ${(doc.id || '').padEnd(27)} ${endpoint}`);
  if (!ep && enabled) warnings.push(`${doc.id}: enabled but has no endpoint for the active environment.`);
  void why;
}

console.log('');
if (warnings.length) {
  console.log(y(`${warnings.length} warning(s):`));
  warnings.forEach(w => console.log('  ' + y('!') + ' ' + w));
  console.log('');
}
if (errors.length) {
  console.log(r(`${errors.length} error(s):`));
  errors.forEach(e => console.log('  ' + r('x') + ' ' + e));
  console.log('');
  console.log(r('Configuration is not valid. The app will not start correctly.'));
  process.exit(1);
}

console.log(g('Configuration is valid.'));
