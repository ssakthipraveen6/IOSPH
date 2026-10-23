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
// SENTINEL_CONFIG_DIR lets tests check a scratch copy of config/.
const CONFIG = process.env.SENTINEL_CONFIG_DIR ? path.resolve(process.env.SENTINEL_CONFIG_DIR) : path.join(ROOT, 'config');
const APPS = path.join(CONFIG, 'apps');
const INFRA = path.join(CONFIG, 'infra');

const errors = [];
const warnings = [];
// Green text.
const g = (s) => `\x1b[32m${s}\x1b[0m`;
// Yellow text.
const y = (s) => `\x1b[33m${s}\x1b[0m`;
// Red text.
const r = (s) => `\x1b[31m${s}\x1b[0m`;
// Dim text.
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// Reads a YAML file.
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

// watch: paths feed the generated osquery packs (npm run agent:osquery-pack). osquery
// accepts '%' (one level) and '%%' (recursive) wildcards.
const BROAD_LINUX = new Set(['/', '/%', '/%%', '/etc/%%', '/opt/%%', '/var/%%', '/usr/%%', '/home/%%']);
// Checks a manifest's watch block.
function checkWatch(rel, watch) {
  if (watch === null || typeof watch !== 'object' || Array.isArray(watch)) {
    errors.push(`${rel}: \`watch\` must be a mapping with \`linux\` and/or \`windows\` lists.`);
    return;
  }
  for (const key of Object.keys(watch)) {
    if (!['linux', 'windows'].includes(key)) errors.push(`${rel}: watch.${key} is not recognised (expected linux, windows).`);
  }
  for (const osName of ['linux', 'windows']) {
    const list = watch[osName];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) { errors.push(`${rel}: watch.${osName} must be a list of paths.`); continue; }
    const seen = new Set();
    list.forEach((p, i) => {
      const where = `${rel}: watch.${osName}[${i}]`;
      if (typeof p !== 'string' || !p.trim()) { errors.push(`${where} must be a non-empty path.`); return; }
      if (seen.has(p)) warnings.push(`${where} "${p}" is listed twice.`);
      seen.add(p);
      if (/(^|[\\/])\.\.([\\/]|$)/.test(p)) errors.push(`${where} "${p}" must not contain "..".`);
      if (/[*?]/.test(p)) errors.push(`${where} "${p}": use osquery wildcards % or %%, not * or ?.`);
      if (osName === 'linux') {
        if (!p.startsWith('/')) errors.push(`${where} "${p}" must be an absolute Linux path.`);
        else if (BROAD_LINUX.has(p)) errors.push(`${where} "${p}" is too broad to watch.`);
      } else {
        if (!/^[A-Za-z]:[\\/]/.test(p)) errors.push(`${where} "${p}" must be an absolute Windows path (e.g. C:/Program Files/...).`);
        else if (/^[A-Za-z]:[\\/]?%{0,2}$/.test(p)) errors.push(`${where} "${p}" is too broad to watch.`);
      }
    });
  }
}

const RULE_TYPES = ['threshold', 'baseline', 'absence', 'journey_failure', 'composite', 'expiry', 'trend', 'runway', 'slo_burn_rate'];
const RULE_SEVERITIES = ['critical', 'warning', 'info', 'predictive-warning', 'predictive_warning'];
const THRESHOLD_OPS = ['>', '>=', '<', '<=', '=='];
const COMPOSITE_OPS = ['>', '>=', '<', '<='];
// True for a finite number.
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// True for a positive integer.
const isPosInt = (v) => Number.isInteger(v) && v >= 1;

// Mirrors what ai_analysis/alert_engine.js evaluates; a rule it would silently skip is an error here.
function checkAlertRules(dir, appIds) {
  if (!fs.existsSync(dir)) return;
  const ruleIds = new Map();
  const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f) && !f.startsWith('_'));
  for (const f of files) {
    const rel = `config/alerts/${f}`;
    const doc = loadYaml(path.join(dir, f));
    if (!doc) continue;
    if (!Array.isArray(doc.alerts)) { errors.push(`${rel}: expected a top-level \`alerts:\` list.`); continue; }
    doc.alerts.forEach((rule, i) => {
      const name = (rule && rule.id) || `alerts[${i}]`;
      const at = `${rel}: rule "${name}"`;
      if (!rule || typeof rule !== 'object') { errors.push(`${rel}: alerts[${i}] is not a mapping.`); return; }
      if (!rule.id) errors.push(`${rel}: alerts[${i}] missing \`id\`.`);
      else if (ruleIds.has(rule.id)) errors.push(`${at} duplicates the id in ${ruleIds.get(rule.id)}.`);
      else ruleIds.set(rule.id, rel);
      if (!RULE_TYPES.includes(rule.type)) { errors.push(`${at} has unknown type "${rule.type}". Expected one of: ${RULE_TYPES.join(', ')}.`); return; }
      if (rule.severity !== undefined && !RULE_SEVERITIES.includes(String(rule.severity).toLowerCase())) {
        errors.push(`${at} has unknown severity "${rule.severity}". Expected critical, warning, info or predictive-warning.`);
      }
      if (rule.component !== undefined && !appIds.has(rule.component)) {
        errors.push(`${at}: component "${rule.component}" is not a manifest id under config/apps or config/infra.`);
      }
      if (rule.runbook_url !== undefined) {
        if (typeof rule.runbook_url !== 'string' || !/^https?:\/\//i.test(rule.runbook_url)) {
          errors.push(`${at}: runbook_url must be a valid HTTP(S) URL.`);
        }
      }
      const needMetric = () => { if (!rule.metric || typeof rule.metric !== 'string') errors.push(`${at} (${rule.type}) needs \`metric\`.`); };
      switch (rule.type) {
        case 'threshold':
          needMetric();
          if (!THRESHOLD_OPS.includes(rule.operator)) errors.push(`${at}: operator "${rule.operator}" must be one of ${THRESHOLD_OPS.join(' ')}.`);
          if (!isNum(rule.threshold)) errors.push(`${at}: threshold must be a number.`);
          if (rule.for_seconds !== undefined && !(isNum(rule.for_seconds) && rule.for_seconds >= 0)) errors.push(`${at}: for_seconds must be a number >= 0.`);
          break;
        case 'baseline':
          needMetric();
          if (rule.z_threshold !== undefined && !(isNum(rule.z_threshold) && rule.z_threshold > 0)) errors.push(`${at}: z_threshold must be a number > 0.`);
          if (rule.consecutive_points !== undefined && !isPosInt(rule.consecutive_points)) errors.push(`${at}: consecutive_points must be an integer >= 1.`);
          break;
        case 'absence':
          needMetric();
          if (!(isNum(rule.absence_seconds) && rule.absence_seconds > 0)) errors.push(`${at}: absence_seconds must be a number > 0.`);
          break;
        case 'journey_failure':
          if (rule.consecutive_failures !== undefined && !isPosInt(rule.consecutive_failures)) errors.push(`${at}: consecutive_failures must be an integer >= 1.`);
          break;
        case 'composite':
          if (!['AND', 'OR'].includes(rule.operator)) errors.push(`${at}: composite operator must be AND or OR.`);
          if (!Array.isArray(rule.conditions) || rule.conditions.length < 2) {
            errors.push(`${at}: composite rules need at least two \`conditions\`.`);
          } else {
            rule.conditions.forEach((c, ci) => {
              if (!c || !c.metric) errors.push(`${at}: conditions[${ci}] needs \`metric\`.`);
              if (!c || !COMPOSITE_OPS.includes(c.operator)) errors.push(`${at}: conditions[${ci}] operator must be one of ${COMPOSITE_OPS.join(' ')}.`);
              if (!c || !isNum(c.threshold)) errors.push(`${at}: conditions[${ci}] threshold must be a number.`);
            });
          }
          break;
        case 'expiry':
          if (rule.days_threshold !== undefined && !isNum(rule.days_threshold)) {
            errors.push(`${at}: days_threshold must be a number.`);
          }
          if (rule.capacity_pct_threshold !== undefined && !isNum(rule.capacity_pct_threshold)) {
            errors.push(`${at}: capacity_pct_threshold must be a number.`);
          }
          break;
        case 'trend':
          needMetric();
          break;
        case 'runway':
          break;
        case 'slo_burn_rate':
          if (rule.slo_target !== undefined && (!isNum(rule.slo_target) || rule.slo_target <= 0 || rule.slo_target > 100)) {
            errors.push(`${at}: slo_target must be a number between 0 and 100.`);
          }
          if (rule.burn_rate_threshold !== undefined && (!isNum(rule.burn_rate_threshold) || rule.burn_rate_threshold <= 0)) {
            errors.push(`${at}: burn_rate_threshold must be a positive number.`);
          }
          break;
        default:
          break;
      }
    });
  }
  console.log(`Alert rules : ${ruleIds.size} in ${files.length} file(s)`);
}
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

    if (Array.isArray(doc.journeys)) {
      const VALID_STEP_TYPES = ['http', 'browser', 'git', 'upload_download', 'jenkins'];
      const VALID_LAYERS = ['network', 'app', 'db', 'storage'];
      doc.journeys.forEach((j, jIdx) => {
        const jName = j.id || `journey[${jIdx}]`;
        if (!j.id) {
          errors.push(`${rel}: journey at index ${jIdx} missing \`id\`.`);
        }
        if (j.interval_seconds !== undefined && Number(j.interval_seconds) < 30) {
          errors.push(`${rel}: journey "${jName}" interval_seconds (${j.interval_seconds}) must be >= 30.`);
        }
        if (!Array.isArray(j.steps) || j.steps.length === 0) {
          errors.push(`${rel}: journey "${jName}" has no steps.`);
        } else {
          j.steps.forEach((s, sIdx) => {
            const sName = s.id || `step[${sIdx}]`;
            if (!s.type || !VALID_STEP_TYPES.includes(s.type)) {
              errors.push(`${rel}: journey "${jName}" step "${sName}" has unknown type "${s.type}". Expected one of: ${VALID_STEP_TYPES.join(', ')}.`);
            }
            if (!s.layer) {
              errors.push(`${rel}: journey "${jName}" step "${sName}" missing required field \`layer\`.`);
            } else if (!VALID_LAYERS.includes(s.layer)) {
              errors.push(`${rel}: journey "${jName}" step "${sName}" has invalid layer "${s.layer}". Expected one of: ${VALID_LAYERS.join(', ')}.`);
            }
          });
        }
      });
    }

    if (doc.watch !== undefined) checkWatch(rel, doc.watch);

    if (doc.layers) {
      if (doc.layers.hosts && !Array.isArray(doc.layers.hosts)) {
        errors.push(`${rel}: \`layers.hosts\` must be an array of hostnames.`);
      }
      if (doc.layers.shares && !Array.isArray(doc.layers.shares)) {
        errors.push(`${rel}: \`layers.shares\` must be an array of share paths.`);
      }
      if (doc.layers.databases && !Array.isArray(doc.layers.databases)) {
        errors.push(`${rel}: \`layers.databases\` must be an array of database connection strings.`);
      }
      if (doc.layers.clusters && !Array.isArray(doc.layers.clusters)) {
        errors.push(`${rel}: \`layers.clusters\` must be an array of cluster names.`);
      }
    }

    // [O2.10] processes: { names, max_age_hours, expected_instances }
    if (doc.processes !== undefined) {
      if (!doc.processes || typeof doc.processes !== 'object' || Array.isArray(doc.processes)) {
        errors.push(`${rel}: \`processes\` must be an object.`);
      } else {
        if (doc.processes.names !== undefined && (!Array.isArray(doc.processes.names) || doc.processes.names.some(n => typeof n !== 'string' || !n.trim()))) {
          errors.push(`${rel}: \`processes.names\` must be an array of non-empty strings.`);
        }
        if (doc.processes.max_age_hours !== undefined && (typeof doc.processes.max_age_hours !== 'number' || doc.processes.max_age_hours <= 0)) {
          errors.push(`${rel}: \`processes.max_age_hours\` must be a positive number.`);
        }
        if (doc.processes.expected_instances !== undefined && (!Number.isInteger(doc.processes.expected_instances) || doc.processes.expected_instances < 0)) {
          errors.push(`${rel}: \`processes.expected_instances\` must be a non-negative integer.`);
        }
      }
    }

    // [O2.10] certificates: { paths, keystores }
    if (doc.certificates !== undefined) {
      if (!doc.certificates || typeof doc.certificates !== 'object' || Array.isArray(doc.certificates)) {
        errors.push(`${rel}: \`certificates\` must be an object.`);
      } else {
        if (doc.certificates.paths !== undefined && (!Array.isArray(doc.certificates.paths) || doc.certificates.paths.some(p => typeof p !== 'string' || !p.trim()))) {
          errors.push(`${rel}: \`certificates.paths\` must be an array of non-empty path strings.`);
        }
        if (doc.certificates.keystores !== undefined && (!Array.isArray(doc.certificates.keystores) || doc.certificates.keystores.some(k => typeof k !== 'string' || !k.trim()))) {
          errors.push(`${rel}: \`certificates.keystores\` must be an array of non-empty keystore path strings.`);
        }
      }
    }

    // [O2.10] jvm: { jmx_port }
    if (doc.jvm !== undefined) {
      if (!doc.jvm || typeof doc.jvm !== 'object' || Array.isArray(doc.jvm)) {
        errors.push(`${rel}: \`jvm\` must be an object.`);
      } else {
        if (doc.jvm.jmx_port !== undefined && (!Number.isInteger(doc.jvm.jmx_port) || doc.jvm.jmx_port < 1 || doc.jvm.jmx_port > 65535)) {
          errors.push(`${rel}: \`jvm.jmx_port\` must be an integer between 1 and 65535.`);
        }
      }
    }

    // [O2.10] iis: boolean
    if (doc.iis !== undefined && typeof doc.iis !== 'boolean') {
      errors.push(`${rel}: \`iis\` must be a boolean.`);
    }

    // [O2.10] health_checks: [{ url, expect_status, expect_json }]
    if (doc.health_checks !== undefined) {
      if (!Array.isArray(doc.health_checks)) {
        errors.push(`${rel}: \`health_checks\` must be an array of check objects.`);
      } else {
        doc.health_checks.forEach((hc, idx) => {
          if (!hc || typeof hc !== 'object' || Array.isArray(hc)) {
            errors.push(`${rel}: health_checks[${idx}] must be an object.`);
          } else {
            if (!hc.url || typeof hc.url !== 'string') {
              errors.push(`${rel}: health_checks[${idx}] missing required string \`url\`.`);
            }
            if (hc.expect_status !== undefined && (!Number.isInteger(hc.expect_status) || hc.expect_status < 100 || hc.expect_status > 599)) {
              errors.push(`${rel}: health_checks[${idx}].expect_status must be a valid HTTP status code.`);
            }
            if (hc.expect_json !== undefined && (typeof hc.expect_json !== 'object' || hc.expect_json === null || Array.isArray(hc.expect_json))) {
              errors.push(`${rel}: health_checks[${idx}].expect_json must be an object.`);
            }
          }
        });
      }
    }

    // [O2.10] license: { api, file, expiry, seats_total, limit_kind }
    if (doc.license !== undefined) {
      if (!doc.license || typeof doc.license !== 'object' || Array.isArray(doc.license)) {
        errors.push(`${rel}: \`license\` must be an object.`);
      } else {
        if (doc.license.api !== undefined && typeof doc.license.api !== 'string') {
          errors.push(`${rel}: \`license.api\` must be a string URL.`);
        }
        if (doc.license.file !== undefined && typeof doc.license.file !== 'string') {
          errors.push(`${rel}: \`license.file\` must be a string file path.`);
        }
        if (doc.license.seats_total !== undefined && (typeof doc.license.seats_total !== 'number' || doc.license.seats_total < 0)) {
          errors.push(`${rel}: \`license.seats_total\` must be a non-negative number.`);
        }
        if (doc.license.limit_kind !== undefined && typeof doc.license.limit_kind !== 'string') {
          errors.push(`${rel}: \`license.limit_kind\` must be a string.`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- alert rules (Q5)
checkAlertRules(path.join(CONFIG, 'alerts'), new Set(seenIds.keys()));

// ---------------------------------------------------------------- component metric catalogue (O1.1)
const ALLOWED_COMPONENT_KINDS = new Set([
  'vip', 'host_linux', 'host_windows', 'k8s_cluster', 'k8s_namespace',
  'k8s_pod', 'storage_share', 'db_postgresql', 'db_oracle', 'db_sqlserver',
  'sso', 'journey_step', 'jvm', 'product'
]);

// Checks config/component_metrics.yaml.
function checkComponentMetrics(filePath) {
  const rel = path.relative(ROOT, filePath) || 'config/component_metrics.yaml';
  if (!fs.existsSync(filePath)) {
    errors.push(`${rel} is missing.`);
    return;
  }

  const doc = loadYaml(filePath);
  if (!doc) return;

  if (typeof doc !== 'object' || Array.isArray(doc)) {
    errors.push(`${rel}: expected top-level mapping by component kind.`);
    return;
  }

  const rawKinds = doc.kinds && typeof doc.kinds === 'object' && !Array.isArray(doc.kinds) ? doc.kinds : doc;
  let chartCount = 0;

  for (const [kind, def] of Object.entries(rawKinds)) {
    if (kind === 'version' || kind === 'kinds') continue;
    if (!ALLOWED_COMPONENT_KINDS.has(kind)) {
      errors.push(`${rel}: unknown kind "${kind}". Expected one of: ${[...ALLOWED_COMPONENT_KINDS].join(', ')}.`);
      continue;
    }

    const charts = Array.isArray(def) ? def : (def && Array.isArray(def.charts) ? def.charts : null);
    if (!charts) {
      errors.push(`${rel}: kind "${kind}" must be a list of charts or have a \`charts:\` list.`);
      continue;
    }

    const seenChartIds = new Set();
    charts.forEach((chart, idx) => {
      chartCount++;
      const chartName = (chart && chart.id) || `charts[${idx}]`;
      const at = `${rel}: kind "${kind}" chart "${chartName}"`;

      if (!chart || typeof chart !== 'object' || Array.isArray(chart)) {
        errors.push(`${at} is not a mapping.`);
        return;
      }

      if (!chart.id) {
        errors.push(`${rel}: kind "${kind}" chart at index ${idx} missing \`id\`.`);
      } else if (seenChartIds.has(chart.id)) {
        errors.push(`${rel}: duplicate chart id "${chart.id}" in kind "${kind}".`);
      } else {
        seenChartIds.add(chart.id);
      }

      if (!chart.title || typeof chart.title !== 'string') {
        errors.push(`${at} missing required string \`title\`.`);
      }

      if (!chart.metrics || !Array.isArray(chart.metrics) || chart.metrics.length === 0) {
        errors.push(`${at} missing metric list.`);
      } else {
        chart.metrics.forEach((m, mi) => {
          if (typeof m !== 'string' || !m.trim()) {
            errors.push(`${at}: metrics[${mi}] must be a non-empty string.`);
          }
        });
      }

      if (chart.capacity !== undefined) {
        if (!chart.capacity || typeof chart.capacity !== 'object' || Array.isArray(chart.capacity)) {
          errors.push(`${at}: bad capacity mapping (must be an object with total/used/available).`);
        } else {
          const capKeys = Object.keys(chart.capacity);
          const validCapKeys = ['total', 'used', 'available'];
          for (const k of capKeys) {
            if (!validCapKeys.includes(k)) {
              errors.push(`${at}: bad capacity mapping (unknown field "${k}", expected total, used, available).`);
            } else if (typeof chart.capacity[k] !== 'string' || !chart.capacity[k].trim()) {
              errors.push(`${at}: bad capacity mapping (${k} must be a non-empty metric name string).`);
            }
          }
          if (capKeys.length === 0) {
            errors.push(`${at}: bad capacity mapping (must specify at least one of total, used, available).`);
          }
        }
      }
    });
  }

  console.log(`Metric catalogue: ${Object.keys(rawKinds).length} kinds, ${chartCount} charts in 1 file(s)`);
}

checkComponentMetrics(path.join(CONFIG, 'component_metrics.yaml'));

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
