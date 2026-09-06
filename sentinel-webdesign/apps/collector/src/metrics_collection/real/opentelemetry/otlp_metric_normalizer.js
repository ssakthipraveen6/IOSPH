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

/**
 * Normalizes an incoming OTLP JSON payload into clean Sentinel metric rows.
 * @param {object} otlpPayload Standard OTLP HTTP JSON payload
 * @returns {Array<object>} Normalized metric objects for TimescaleDB / WebSocket broadcast
 */
function normalizeOtlpPayload(otlpPayload) {
  const resultBatch = [];
  if (!otlpPayload || typeof otlpPayload !== 'object') return resultBatch;

  const resourceMetrics = otlpPayload.resourceMetrics || [];

  resourceMetrics.forEach(rm => {
    const attributes = rm.resource?.attributes || [];
    
    // Resolve host and application IDs from resource attributes
    const hostAttr = attributes.find(a => a.key === 'host.name')?.value?.stringValue || 
                     attributes.find(a => a.key === 'service.name')?.value?.stringValue || 
                     'unknown_host';
                     
    const appIdAttr = attributes.find(a => a.key === 'application.id')?.value?.stringValue || 
                      attributes.find(a => a.key === 'app.kubernetes.io/name')?.value?.stringValue || 
                      hostAttr;

    (rm.scopeMetrics || []).forEach(sm => {
      (sm.metrics || []).forEach(m => {
        const rawMetricName = m.name;
        const normalizedName = OTEL_METRIC_MAP[rawMetricName] || rawMetricName.replace(/\./g, '_');
        
        const dataPoints = m.gauge?.dataPoints || m.sum?.dataPoints || [];
        dataPoints.forEach(dp => {
          let rawVal = dp.asDouble !== undefined ? dp.asDouble : 
                       (dp.asInt !== undefined ? dp.asInt : parseFloat(dp.value || 0));

          if (isNaN(rawVal)) return;

          // Normalize percentage scales (0.0 - 1.0 -> 0 - 100%) if needed
          if ((rawMetricName.includes('utilization') || rawMetricName.includes('pct')) && rawVal <= 1.0 && rawVal > 0) {
            rawVal = rawVal * 100;
          }

          // Normalize bytes to MB for JVM and container memory (> 1MB)
          if ((rawMetricName.includes('memory') || rawMetricName.includes('working_set') || rawMetricName.includes('bytes')) && rawVal > 1000000) {
            rawVal = rawVal / (1024 * 1024);
          }

          const timestamp = dp.timeUnixNano 
            ? new Date(Number(BigInt(dp.timeUnixNano) / BigInt(1000000))).toISOString()
            : new Date().toISOString();

          resultBatch.push({
            timestamp,
            component: appIdAttr.toLowerCase(),
            metricName: normalizedName,
            value: typeof rawVal === 'number' ? parseFloat(rawVal.toFixed(2)) : rawVal
          });
        });
      });
    });
  });

  return resultBatch;
}

module.exports = {
  normalizeOtlpPayload,
  OTEL_METRIC_MAP
};
