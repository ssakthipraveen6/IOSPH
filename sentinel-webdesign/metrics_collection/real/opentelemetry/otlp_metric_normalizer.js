/**
 * OpenTelemetry (OTLP) Semantic Convention Metric Normalizer
 * Translates standard OTel metric names into Project Sentinel dashboard metrics
 * (Supports OTel Hostmetrics, Process, JVM, Docker, and K8s receivers).
 */

// Mapping of standard OpenTelemetry metric names to Sentinel dashboard metric keys
const OTEL_METRIC_MAP = {
  // CPU Metrics
  'system.cpu.utilization': 'cpu',
  'system.cpu.usage': 'cpu',
  'host.cpu.usage': 'cpu',
  'process.cpu.utilization': 'process_cpu',

  // Memory Metrics
  'system.memory.utilization': 'memory',
  'system.memory.usage': 'memory_used_bytes',
  'host.memory.usage': 'memory',
  'process.memory.usage': 'process_memory_mb',
  'jvm.memory.used': 'jvm_heap_used_mb',
  'jvm.memory.heap.used': 'jvm_heap_used_mb',

  // Disk & Filesystem
  'system.filesystem.utilization': 'disk',
  'system.filesystem.usage': 'disk_used_bytes',
  'system.disk.io': 'iops',
  'system.disk.operations': 'iops',

  // Network
  'system.network.io': 'network_io',
  'system.network.dropped': 'packet_loss',

  // Container & Kubernetes cgroups
  'container.cpu.usage.total': 'container_cpu_pct',
  'container.memory.usage.total': 'container_mem_mb',
  'k8s.pod.cpu_limit_cores': 'k8s_cpu_limit_cores',
  'k8s.pod.memory_working_set_bytes': 'k8s_memory_working_set_mb'
};

// [Phase A] Metric families whose OTel names are used verbatim downstream (jobs, alert
// rules, Database view). They keep their dotted names and are not rescaled.
const PRESERVED_PREFIXES = ['agent.', 'nas.', 'vip.', 'journey.', 'avi.', 'postgresql.', 'oracledb.', 'sqlserver.'];

// True for metric names kept as is.
function isPreserved(name) {
  return PRESERVED_PREFIXES.some(p => name.startsWith(p));
}

// Attributes of a data point.
function pointAttributes(dp) {
  const out = {};
  (dp.attributes || []).forEach(a => {
    if (!a || !a.key || !a.value) return;
    const v = a.value;
    const val = v.stringValue !== undefined ? v.stringValue
      : v.intValue !== undefined ? v.intValue
      : v.doubleValue !== undefined ? v.doubleValue
      : v.boolValue !== undefined ? v.boolValue : undefined;
    if (val !== undefined) out[a.key] = String(val);
  });
  return out;
}

/**
 * Normalizes an incoming OTLP JSON payload into clean Sentinel metric rows.
 * @param {object} otlpPayload Standard OTLP HTTP JSON payload
 * @returns {Array<object>} Normalized metric objects for TimescaleDB / WebSocket broadcast
 */
function normalizeOtlpPayload(otlpPayload, options = {}) {
  const resultBatch = [];
  if (!otlpPayload || typeof otlpPayload !== 'object') return resultBatch;

  const resourceMetrics = otlpPayload.resourceMetrics || [];

  resourceMetrics.forEach(rm => {
    const attributes = rm.resource?.attributes || [];
    
    const rawHost = attributes.find(a => a.key === 'host.name')?.value?.stringValue || null;
    const rawService = attributes.find(a => a.key === 'service.name')?.value?.stringValue || null;
    const hostAttr = rawHost || rawService || 'unknown_host';
                     
    const appIdAttr = attributes.find(a => a.key === 'application.id')?.value?.stringValue || 
                      attributes.find(a => a.key === 'app.kubernetes.io/name')?.value?.stringValue || 
                      rawService || 
                      hostAttr;

    const rawEnv = attributes.find(a => 
      a.key === 'deployment.environment' || 
      a.key === 'environment' || 
      a.key === 'env' || 
      a.key === 'service.environment'
    )?.value?.stringValue || null;

    // Resolve deterministic entity_id (T1.7)
    let entityId = null;
    try {
      const resolver = require('../../../inventory/entity_resolver');
      if (rawHost) {
        entityId = resolver.host(rawHost);
      } else if (appIdAttr) {
        entityId = resolver.app(appIdAttr);
      }
    } catch (_) {}

    // Database receivers name the database in resource attributes; keep those on their points.
    const resourceDbAttrs = pointAttributes({
      attributes: attributes.filter(a => a && /^(postgresql|sqlserver|oracledb|db)\./.test(a.key || ''))
    });

    (rm.scopeMetrics || []).forEach(sm => {
      (sm.metrics || []).forEach(m => {
        const rawMetricName = m.name;
        const preserved = isPreserved(rawMetricName);
        const normalizedName = OTEL_METRIC_MAP[rawMetricName] || (preserved ? rawMetricName : rawMetricName.replace(/\./g, '_'));
        
        const dataPoints = m.gauge?.dataPoints || m.sum?.dataPoints || [];
        dataPoints.forEach(dp => {
          let rawVal = dp.asDouble !== undefined ? dp.asDouble : 
                       (dp.asInt !== undefined ? dp.asInt : parseFloat(dp.value || 0));

          rawVal = Number(rawVal);
          if (isNaN(rawVal)) return;

          // Normalize percentage scales (0.0 - 1.0 -> 0 - 100%) if needed
          if (!preserved && (rawMetricName.includes('utilization') || rawMetricName.includes('pct')) && rawVal <= 1.0 && rawVal > 0) {
            rawVal = rawVal * 100;
          }

          // Normalize bytes to MB for JVM and container memory (> 1MB)
          if (!preserved && (rawMetricName.includes('memory') || rawMetricName.includes('working_set') || rawMetricName.includes('bytes')) && rawVal > 1000000) {
            rawVal = rawVal / (1024 * 1024);
          }

          const timestamp = dp.timeUnixNano 
            ? new Date(Number(BigInt(dp.timeUnixNano) / BigInt(1000000))).toISOString()
            : new Date().toISOString();

          const row = {
            timestamp,
            component: appIdAttr.toLowerCase(),
            entity_id: entityId,
            metricName: normalizedName,
            value: typeof rawVal === 'number' ? parseFloat(rawVal.toFixed(2)) : rawVal,
            env: rawEnv ? rawEnv.toLowerCase() : undefined
          };
          const attrs = preserved ? { ...resourceDbAttrs, ...pointAttributes(dp) } : pointAttributes(dp);
          if (Object.keys(attrs).length > 0) row.attributes = attrs;
          resultBatch.push(row);
        });
      });
    });
  });

  return applyProcessCardinalityGuard(resultBatch, options);
}

// Process names that may be stored individually.
function loadNamedProcessSet() {
  const named = new Set();
  try {
    const yamlConfig = require('../../../backend/config/yaml_config');
    const apps = yamlConfig.loadAllApplications() || [];
    const appList = Array.isArray(apps) ? apps : Object.values(apps || {});
    for (const app of appList) {
      if (app && app.processes && Array.isArray(app.processes.names)) {
        app.processes.names.forEach(n => {
          if (typeof n === 'string' && n.trim()) named.add(n.trim().toLowerCase());
        });
      }
    }
  } catch (_) {}
  return named;
}

// Limits per-process series so cardinality stays bounded.
function applyProcessCardinalityGuard(rows, options = {}) {
  const namedProcesses = options.namedProcesses instanceof Set
    ? options.namedProcesses
    : (Array.isArray(options.namedProcesses) ? new Set(options.namedProcesses.map(n => String(n).toLowerCase())) : loadNamedProcessSet());
  const maxTop = Number.isInteger(options.maxTop) ? options.maxTop : 10;

  const isProcessRow = (r) => {
    if (!r) return false;
    const name = r.metricName || '';
    if (name.startsWith('process.') || name.startsWith('process_')) return true;
    const attrs = r.attributes || {};
    return Boolean(attrs['process.executable.name'] || attrs['process.name'] || attrs['process.pid'] || attrs['process_name']);
  };

  const nonProcessRows = [];
  const processGroups = new Map();

  for (const row of rows) {
    if (!isProcessRow(row)) {
      nonProcessRows.push(row);
      continue;
    }
    const key = `${row.entity_id || row.component || ''}|${row.metricName}`;
    if (!processGroups.has(key)) processGroups.set(key, []);
    processGroups.get(key).push(row);
  }

  const guardedRows = [...nonProcessRows];

  for (const group of processGroups.values()) {
    if (group.length <= maxTop) {
      guardedRows.push(...group);
      continue;
    }

    const getProcName = (r) => {
      const a = r.attributes || {};
      return String(a['process.executable.name'] || a['process.name'] || a['process_name'] || (a['process.pid'] ? 'pid_' + a['process.pid'] : 'unknown'));
    };

    const namedRows = [];
    const nonNamedRows = [];

    for (const row of group) {
      const pName = getProcName(row).toLowerCase();
      if (namedProcesses.has(pName)) {
        namedRows.push(row);
      } else {
        nonNamedRows.push(row);
      }
    }

    nonNamedRows.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));

    const topRows = nonNamedRows.slice(0, maxTop);
    const otherRows = nonNamedRows.slice(maxTop);

    guardedRows.push(...namedRows, ...topRows);

    if (otherRows.length > 0) {
      const sumValue = otherRows.reduce((acc, r) => acc + (Number(r.value) || 0), 0);
      const rep = otherRows[0];
      const otherAttributes = { ...(rep.attributes || {}) };
      if ('process.executable.name' in otherAttributes) otherAttributes['process.executable.name'] = 'other';
      if ('process.name' in otherAttributes) otherAttributes['process.name'] = 'other';
      if ('process_name' in otherAttributes) otherAttributes['process_name'] = 'other';
      if ('process.pid' in otherAttributes) delete otherAttributes['process.pid'];

      guardedRows.push({
        timestamp: rep.timestamp,
        component: rep.component,
        entity_id: rep.entity_id,
        metricName: rep.metricName,
        value: typeof sumValue === 'number' ? parseFloat(sumValue.toFixed(2)) : sumValue,
        env: rep.env,
        attributes: otherAttributes
      });
    }
  }

  return guardedRows;
}

module.exports = {
  normalizeOtlpPayload,
  applyProcessCardinalityGuard,
  loadNamedProcessSet,
  OTEL_METRIC_MAP,
  PRESERVED_PREFIXES
};
