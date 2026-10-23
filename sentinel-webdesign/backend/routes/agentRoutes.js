/**
 * backend/routes/agentRoutes.js
 *
 * M4 Task 4.1: SENTINEL Agent Dynamic Configuration API
 * Serves host-specific OpenTelemetry and sentinel-probe configurations.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const yaml = require('js-yaml');
const yamlConfig = require('../config/yaml_config');
const { requireIngestKey } = require('../auth/ingest_keys');

const OSQUERY_RESULTS = {
  linux: '/var/log/osquery/osqueryd.results.log',
  windows: 'C:/ProgramData/SentinelAgent/osquery/log/osqueryd.results.log'
};

/** Exact host equality: FQDN or short name on both sides, case-insensitive. No prefixes. */
function sameHost(a, b) {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  // A short name matches the FQDN that starts with exactly that label.
  const xs = x.split('.')[0];
  const ys = y.split('.')[0];
  const xShort = !x.includes('.');
  const yShort = !y.includes('.');
  return (xShort || yShort) && xs === ys;
}

/**
 * Parses a `layers.databases` entry (JDBC URL string or { jdbc|url, engine, host, port, database }).
 * Returns { engine, host, port, database } or null.
 */
function parseDatabase(entry) {
  if (!entry) return null;
  if (typeof entry === 'object') {
    if (entry.host) {
      return { engine: String(entry.engine || entry.type || '').toLowerCase(), host: entry.host, port: entry.port ? Number(entry.port) : null, database: entry.database || entry.name || null };
    }
    entry = entry.jdbc || entry.url || '';
  }
  const str = String(entry).trim();
  let m = /^jdbc:(postgresql|sqlserver):\/\/([^:/;]+)(?::(\d+))?(?:\/([^;?]+))?(?:;.*databaseName=([^;]+))?/i.exec(str);
  if (m) {
    return { engine: m[1].toLowerCase(), host: m[2], port: m[3] ? Number(m[3]) : null, database: m[4] || m[5] || null };
  }
  m = /^jdbc:oracle:thin:@(?:\/\/)?([^:/]+)(?::(\d+))?[:/]([^?]+)/i.exec(str);
  if (m) return { engine: 'oracle', host: m[1], port: m[2] ? Number(m[2]) : null, database: m[3] };
  return null;
}

/** Collector receiver for one database on this host. Credentials come from the host's environment. */
function databaseReceiver(dbInfo) {
  const port = dbInfo.port;
  if (dbInfo.engine === 'postgresql') {
    return ['postgresql', {
      endpoint: `127.0.0.1:${port || 5432}`,
      transport: 'tcp',
      username: '${env:SENTINEL_DB_PG_USER}',
      password: '${env:SENTINEL_DB_PG_PASSWORD}',
      databases: dbInfo.database ? [dbInfo.database] : [],
      collection_interval: '60s',
      // Loopback only (the agent runs on the database server), so no TLS on this hop.
      tls: { insecure: true }
    }];
  }
  if (dbInfo.engine === 'oracle') {
    return ['oracledb', {
      endpoint: `127.0.0.1:${port || 1521}`,
      service: dbInfo.database || '',
      username: '${env:SENTINEL_DB_ORACLE_USER}',
      password: '${env:SENTINEL_DB_ORACLE_PASSWORD}',
      collection_interval: '60s'
    }];
  }
  if (dbInfo.engine === 'sqlserver') {
    return ['sqlserver', {
      server: '127.0.0.1',
      port: port || 1433,
      username: '${env:SENTINEL_DB_MSSQL_USER}',
      password: '${env:SENTINEL_DB_MSSQL_PASSWORD}',
      collection_interval: '60s'
    }];
  }
  return null;
}

/** Loads read-only queries for the specified database engine from agent/sql/<engine>.yaml */
function loadSqlQueries(engine) {
  try {
    const sqlFile = path.join(__dirname, '..', '..', 'agent', 'sql', `${engine}.yaml`);
    if (fs.existsSync(sqlFile)) {
      const doc = yaml.load(fs.readFileSync(sqlFile, 'utf8'));
      if (doc && doc.queries) {
        return doc.queries;
      }
    }
  } catch (_) {}
  return null;
}

/** Collector sqlquery receiver for database monitoring (cache, storage, lag, long running, idle locks, backup age) */
function sqlqueryReceiver(dbInfo) {
  const engine = dbInfo.engine;
  const queries = loadSqlQueries(engine);
  if (!queries) return null;

  const port = dbInfo.port;
  let driver = '';
  let datasource = '';

  if (engine === 'postgresql') {
    driver = 'postgres';
    datasource = `host=127.0.0.1 port=${port || 5432} user=\${env:SENTINEL_DB_PG_USER} password=\${env:SENTINEL_DB_PG_PASSWORD} dbname=${dbInfo.database || 'postgres'} sslmode=disable`;
  } else if (engine === 'oracle') {
    driver = 'godror';
    datasource = `\${env:SENTINEL_DB_ORACLE_USER}/\${env:SENTINEL_DB_ORACLE_PASSWORD}@127.0.0.1:${port || 1521}/${dbInfo.database || 'XE'}`;
  } else if (engine === 'sqlserver') {
    driver = 'sqlserver';
    datasource = `sqlserver://\${env:SENTINEL_DB_MSSQL_USER}:\${env:SENTINEL_DB_MSSQL_PASSWORD}@127.0.0.1:${port || 1433}?database=${dbInfo.database || 'master'}`;
  } else {
    return null;
  }

  const queryList = Object.entries(queries).map(([key, q]) => ({
    name: q.name || key,
    interval: q.interval || '60s',
    sql: q.statement || q.sql
  }));

  return ['sqlquery', {
    driver,
    datasource,
    collection_interval: '60s',
    queries: queryList
  }];
}

// Normalises an OS name to linux or windows.
function normaliseOs(os) {
  const v = String(os || '').toLowerCase();
  if (v === 'windows' || v === 'win' || v === 'win32') return 'windows';
  if (v === 'kubernetes' || v === 'k8s') return 'kubernetes';
  return 'linux';
}

/**
 * Renders the collector configuration for one host. Used by GET /config and by the
 * fleet-health job (P10) to compute the hash a correctly configured agent reports.
 *
 * role: 'node' (default; one agent per server or K8s node) or 'cluster' (the single
 * k8s_cluster Deployment per cluster, see deployments/k8s/sentinel-agent).
 */
function renderAgentConfig({ host, os = '', agentVersion = null, env = 'staging', role = 'node' }) {
  const reportedVersion = agentVersion || null;
  const detectedOs = normaliseOs(os);
  const isCluster = role === 'cluster';

  let allApps = [];
  try {
    allApps = yamlConfig.loadAllApplications() || [];
  } catch (_) {
    allApps = [];
  }
  // The loader also registers each app under its aliases: keep one entry per id.
  const appList = [...new Map((Array.isArray(allApps) ? allApps : Object.values(allApps || {}))
    .filter(a => a && a.id).map(a => [a.id, a])).values()];

  const matchedApps = [];
  const matchedShares = [];
  const probeTargets = [];
  const logPaths = [];
  const watchPaths = [];
  const hostDatabases = [];

  appList.forEach(app => {
    const layers = app.layers || {};
    const hosts = Array.isArray(layers.hosts) ? layers.hosts : [];

    // Databases this host serves (the host is the DB server itself).
    (Array.isArray(layers.databases) ? layers.databases : []).forEach(entry => {
      const info = parseDatabase(entry);
      if (info && sameHost(info.host, host) && !hostDatabases.some(d => d.engine === info.engine && d.port === info.port && d.database === info.database)) {
        hostDatabases.push({ ...info, productId: app.id });
      }
    });

    if (!hosts.some(h => sameHost(h, host))) return;
    matchedApps.push({
      id: app.id,
      name: app.display_name || app.name || app.id,
      type: app.kind || app.type || null,
      iis: Boolean(app.iis),
      jvm: app.jvm || null
    });

    (Array.isArray(layers.shares) ? layers.shares : []).forEach(s => {
      if (!matchedShares.includes(s)) matchedShares.push(s);
    });

    const logs = app.logs || {};
    (Array.isArray(logs.host_paths) ? logs.host_paths : []).forEach(p => {
      if (p && !logPaths.includes(p)) logPaths.push(p);
    });

    const watch = app.watch || {};
    const osWatch = Array.isArray(watch[detectedOs]) ? watch[detectedOs] : (Array.isArray(watch) ? watch : []);
    osWatch.forEach(p => { if (p && !watchPaths.includes(p)) watchPaths.push(p); });

    if (app.endpoints && app.endpoints.localhost) {
      probeTargets.push({ productId: app.id, url: app.endpoints.localhost, type: 'localhost' });
    } else if (app.endpoints && app.endpoints.health) {
      try {
        const u = new URL(app.endpoints.health);
        probeTargets.push({
          productId: app.id,
          url: `${u.protocol}//127.0.0.1:${u.port || (u.protocol === 'https:' ? 443 : 80)}${u.pathname}`,
          type: 'localhost'
        });
      } catch (_) {}
    }
  });

  const isIisHost = matchedApps.some(a => a.iis);
  const jmxApps = matchedApps.filter(a => a.jvm && a.jvm.jmx_port);

  const receivers = {
    otlp: {
      protocols: {
        grpc: { endpoint: '127.0.0.1:4317' },
        http: { endpoint: '127.0.0.1:4318' }
      }
    }
  };
  const metricReceivers = ['otlp'];
  const logReceivers = [];

  if (isCluster) {
    receivers.k8s_cluster = {
      auth_type: 'serviceAccount',
      collection_interval: '60s',
      node_conditions_to_report: ['Ready', 'MemoryPressure', 'DiskPressure'],
      allocatable_types_to_report: ['cpu', 'memory', 'storage']
    };
    metricReceivers.push('k8s_cluster');

    // Pod and deployment readiness from kube-state-metrics (one scrape per cluster, not per
    // node). The endpoint can be overridden with SENTINEL_KSM_ENDPOINT in the Deployment.
    receivers['prometheus/kube_state_metrics'] = {
      config: {
        scrape_configs: [{
          job_name: 'kube_state_metrics',
          scrape_interval: '60s',
          static_configs: [{ targets: ['${env:SENTINEL_KSM_ENDPOINT:-kube-state-metrics.kube-system.svc:8080}'] }],
          metric_relabel_configs: [{
            source_labels: ['__name__'],
            regex: 'kube_pod_status_(phase|ready)|kube_deployment_status_replicas(_available)?',
            action: 'keep'
          }]
        }]
      }
    };
    metricReceivers.push('prometheus/kube_state_metrics');
  } else {
    receivers.hostmetrics = {
      collection_interval: '30s',
      ...(detectedOs === 'kubernetes' ? { root_path: '/hostfs' } : {}),
      scrapers: {
        cpu: {},
        memory: {},
        disk: {},
        filesystem: {},
        network: {},
        ...(detectedOs === 'windows' ? {} : { load: {}, paging: {}, processes: {}, tcp: {} })
      }
    };
    metricReceivers.push('hostmetrics');

    if (detectedOs !== 'kubernetes') {
      receivers.process = { collection_interval: '30s', mute_process_name_error: true, mute_process_exe_error: true, mute_process_io_error: true };
      metricReceivers.push('process');
    }

    if (detectedOs === 'kubernetes') {
      receivers.kubeletstats = {
        auth_type: 'serviceAccount',
        endpoint: 'https://${env:K8S_NODE_NAME}:10250',
        ca_file: '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt',
        collection_interval: '30s',
        metric_groups: ['node', 'pod', 'container', 'volume']
      };
      metricReceivers.push('kubeletstats');
    }

    // NFS client statistics per mount (retransmissions, RPC round trip) from the local
    // node_exporter (run with --collector.mountstats). Only on Linux hosts whose manifests
    // list shares; if node_exporter is absent the scrape simply reports the target as down.
    if (detectedOs === 'linux' && matchedShares.length > 0) {
      receivers['prometheus/node_nfs'] = {
        config: {
          scrape_configs: [{
            job_name: 'node_nfs',
            scrape_interval: '30s',
            static_configs: [{ targets: ['127.0.0.1:9100'] }],
            metric_relabel_configs: [{
              source_labels: ['__name__'],
              regex: 'node_mountstats_nfs_.*|node_nfs_.*',
              action: 'keep'
            }]
          }]
        }
      };
      metricReceivers.push('prometheus/node_nfs');
    }

    if (detectedOs === 'windows') {
      const perfCounters = [
        { object: 'Processor Information', counters: ['% Processor Time'], instances: ['_Total'] },
        { object: 'System', counters: ['Processor Queue Length'] },
        { object: 'Memory', counters: ['Available MBytes', '% Committed Bytes In Use', 'Pages/sec'] },
        { object: 'PhysicalDisk', counters: ['Avg. Disk sec/Read', 'Avg. Disk sec/Write', 'Current Disk Queue Length'], instances: ['*'] },
        { object: 'LogicalDisk', counters: ['% Free Space'], instances: ['*'] },
        { object: 'Network Interface', counters: ['Bytes Total/sec', 'Packets Received Discarded', 'Current Bandwidth'], instances: ['*'] },
        { object: 'TCPv4', counters: ['Connections Established', 'Connection Failures', 'Connections Reset'] },
        { object: 'Process', counters: ['Handle Count', 'Thread Count'], instances: ['*'] }
      ];

      if (isIisHost) {
        perfCounters.push(
          { object: 'Web Service', counters: ['Current Connections', 'Total Bytes Sent', 'Total Bytes Received', 'ISAPI Extension Requests/sec'], instances: ['*'] },
          { object: 'APP_POOL_WAS', counters: ['Current Application Pool State', 'Current Application Pool Uptime'], instances: ['*'] }
        );
      }

      receivers.windowsperfcounters = {
        collection_interval: '30s',
        perf_counters: perfCounters
      };
      metricReceivers.push('windowsperfcounters');

      receivers.windowseventlog = {
        channel: 'System',
        channels: ['Application', 'System'],
        max_reads: 100
      };
      logReceivers.push('windowseventlog');
    }

    for (const dbInfo of hostDatabases) {
      const r = databaseReceiver(dbInfo);
      if (r) {
        const name = `${r[0]}/${dbInfo.productId}${dbInfo.database ? '_' + dbInfo.database : ''}`.replace(/[^A-Za-z0-9_/.-]/g, '_');
        if (!receivers[name]) {
          receivers[name] = r[1];
          metricReceivers.push(name);
        }
      }

      const sq = sqlqueryReceiver(dbInfo);
      if (sq) {
        const sqName = `${sq[0]}/${dbInfo.engine}_${dbInfo.productId}${dbInfo.database ? '_' + dbInfo.database : ''}`.replace(/[^A-Za-z0-9_/.-]/g, '_');
        if (!receivers[sqName]) {
          receivers[sqName] = sq[1];
          metricReceivers.push(sqName);
        }
      }
    }

    for (const app of jmxApps) {
      const jmxName = `jmx/${app.id}`.replace(/[^A-Za-z0-9_/.-]/g, '_');
      if (!receivers[jmxName]) {
        receivers[jmxName] = {
          jar_path: '/opt/sentinel/bin/opentelemetry-jmx-metrics.jar',
          endpoint: `127.0.0.1:${app.jvm.jmx_port}`,
          target_system: 'jvm',
          collection_interval: '30s',
          metrics: {
            'jvm.memory.pool.bytes.used': { enabled: true },
            'jvm.gc.collections.count': { enabled: true },
            'jvm.gc.collections.elapsed': { enabled: true },
            'jvm.threads.count': { enabled: true },
            'jvm.threads.deadlocked.count': { enabled: true },
            'jvm.memory.metaspace.bytes.used': { enabled: true }
          }
        };
        metricReceivers.push(jmxName);
      }
    }

    // osquery results (file changes, packages) and product logs listed in the manifests.
    if (detectedOs !== 'kubernetes') {
      receivers['filelog/osquery'] = {
        include: [OSQUERY_RESULTS[detectedOs]],
        start_at: 'end',
        operators: [{ type: 'json_parser' }],
        resource: { 'sentinel.log.source': 'osquery' }
      };
      logReceivers.push('filelog/osquery');
    }
    if (logPaths.length > 0) {
      receivers['filelog/products'] = { include: logPaths, start_at: 'end', include_file_path: true };
      logReceivers.push('filelog/products');
    }
  }

  const resourceAttrs = [
    ...(reportedVersion ? [{ key: 'sentinel.agent.version', value: String(reportedVersion), action: 'upsert' }] : []),
    { key: 'sentinel.agent.host', value: host, action: 'upsert' },
    { key: 'sentinel.agent.os', value: detectedOs, action: 'upsert' },
    { key: 'sentinel.agent.role', value: isCluster ? 'cluster' : 'node', action: 'upsert' }
  ];

  if (matchedApps.length > 0) {
    resourceAttrs.push({
      key: 'sentinel.product',
      value: matchedApps[0].id,
      action: 'upsert'
    });
  }

  const processors = {
    memory_limiter: { check_interval: '1s', limit_percentage: 75, spike_limit_percentage: 20 },
    resourcedetection: { detectors: ['env', 'system'], timeout: '2s' },
    resource: {
      attributes: resourceAttrs
    },
    batch: { send_batch_size: 512, timeout: '5s' }
  };
  const chain = ['memory_limiter', 'resourcedetection', 'resource', 'batch'];

  const collectorConfig = {
    receivers,
    processors,
    exporters: {
      // Agents talk to the OTel gateway with a bearer token (A1). The gateway forwards
      // to SENTINEL with its own X-Sentinel-Api-Key; the key's environment wins there.
      otlphttp: {
        endpoint: '${env:SENTINEL_GATEWAY_URL}',
        headers: { Authorization: 'Bearer ${env:SENTINEL_GATEWAY_TOKEN}' },
        compression: 'gzip',
        timeout: '10s'
      }
    },
    service: {
      pipelines: {
        metrics: { receivers: metricReceivers, processors: chain, exporters: ['otlphttp'] },
        ...(logReceivers.length ? { logs: { receivers: logReceivers, processors: chain, exporters: ['otlphttp'] } } : {})
      }
    }
  };

  const yamlString = yaml.dump(collectorConfig, { lineWidth: -1, noRefs: true });
  const configHash = crypto.createHash('sha256').update(yamlString).digest('hex');

  return {
    host,
    environment: env,
    os: detectedOs,
    role: isCluster ? 'cluster' : 'node',
    config_hash: configHash,
    apps: matchedApps,
    shares: matchedShares,
    probe_targets: probeTargets,
    watch_paths: watchPaths,
    databases: hostDatabases.map(d => ({ engine: d.engine, port: d.port, database: d.database, product_id: d.productId })),
    collector_config: collectorConfig,
    config_yaml: yamlString
  };
}

/**
 * GET /api/v2/agent/config?host=&os=&agent_version=&role=
 * Authenticated with an ingest key (scope: agent, admin, or gateway).
 * The environment comes only from the ingest key.
 */
router.get('/config', requireIngestKey('agent'), (req, res) => {
  try {
    const host = (req.query.host || '').trim();
    if (!host) {
      return res.status(400).json({ error: 'Query parameter "host" is required.' });
    }
    res.json(renderAgentConfig({
      host,
      os: req.query.os || '',
      agentVersion: req.query.agent_version || req.query.version || null,
      env: req.ingestEnv || 'staging',
      role: req.query.role === 'cluster' ? 'cluster' : 'node'
    }));
  } catch (err) {
    console.error('[AGENT_CONFIG_ERROR]', err);
    res.status(500).json({ error: `Internal error: ${err.message}` });
  }
});

module.exports = router;
module.exports.renderAgentConfig = renderAgentConfig;
module.exports.sameHost = sameHost;
module.exports.parseDatabase = parseDatabase;
module.exports.sqlqueryReceiver = sqlqueryReceiver;
module.exports.loadSqlQueries = loadSqlQueries;
