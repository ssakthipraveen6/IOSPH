/**
 * metrics_collection/sources/telemetry_source.js
 *
 * Unified TelemetrySource interface (T5.3 / C8).
 * Abstracts telemetry sources (Dynatrace, OTLP, node_exporter) so any source
 * (including Dynatrace) can be decommissioned or swapped via configuration alone.
 */

const config = require('@sentinel/config');
const dynatraceCollector = require('../real/dynatrace/dynatrace_collector');

class TelemetrySource {
  constructor(id, name) {
    this.id = id;
    this.name = name;
  }

  isEnabled(env = 'staging') {
    if (typeof config.isCollectorEnabled === 'function') {
      return config.isCollectorEnabled(this.id);
    }
    return true;
  }

  async collect(db, writeNasLog, env = 'staging') {
    throw new Error(`collect() not implemented on ${this.name}`);
  }
}

class DynatraceTelemetrySource extends TelemetrySource {
  constructor() {
    super('dynatrace', 'Dynatrace API v2 Telemetry Source');
  }

  isEnabled(env = 'staging') {
    // Check global collector toggle and profile
    const providerSelector = require('../telemetry_provider_selector');
    return providerSelector.isCollectorAllowed('dynatrace') && super.isEnabled(env);
  }

  async collect(db, writeNasLog, env = 'staging') {
    if (!this.isEnabled(env)) {
      return { status: 'DISABLED', source: 'dynatrace', metrics: {} };
    }
    return dynatraceCollector.collectDynatraceAlerts(db, writeNasLog, env);
  }
}

class OtlpTelemetrySource extends TelemetrySource {
  constructor() {
    super('otlp', 'OpenTelemetry OTLP Push Ingestion Source');
  }

  isEnabled(env = 'staging') {
    const providerSelector = require('../telemetry_provider_selector');
    return providerSelector.isCollectorAllowed('app_collector');
  }

  async collect(db, writeNasLog, env = 'staging') {
    return { status: 'HEALTHY', source: 'otlp', mode: 'push_receiver' };
  }
}

class NodeExporterTelemetrySource extends TelemetrySource {
  constructor() {
    super('node_exporter', 'Prometheus Node Exporter Scrape Source');
  }

  isEnabled(env = 'staging') {
    const providerSelector = require('../telemetry_provider_selector');
    return providerSelector.isCollectorAllowed('node_exporter');
  }

  async collect(db, writeNasLog, env = 'staging') {
    if (!this.isEnabled(env)) {
      return { status: 'DISABLED', source: 'node_exporter', metrics: {} };
    }
    const nodeCollector = require('../real/infrastructure/node_exporter_collector');
    return nodeCollector.collectNodeExporterMetrics(db, writeNasLog, env);
  }
}

const registry = {
  dynatrace: new DynatraceTelemetrySource(),
  otlp: new OtlpTelemetrySource(),
  node_exporter: new NodeExporterTelemetrySource()
};

function getTelemetrySource(id) {
  return registry[id] || null;
}

function getAllTelemetrySources() {
  return Object.values(registry);
}

module.exports = {
  TelemetrySource,
  DynatraceTelemetrySource,
  OtlpTelemetrySource,
  NodeExporterTelemetrySource,
  getTelemetrySource,
  getAllTelemetrySources
};
