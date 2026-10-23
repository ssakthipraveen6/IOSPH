/**
 * Source arbiter (M1.12, L3).
 *
 * The same metric can arrive from several sources while Dynatrace is still in
 * use: Dynatrace API, SENTINEL's own OTel agents, and SENTINEL probes. For each
 * series (env + entity + metric) the arbiter keeps the highest-priority source
 * that has reported within `stale_after_seconds`, and drops lower-priority
 * duplicates.
 *
 * Hysteresis: A higher-priority source must be fresh for N consecutive points
 * (default 3) before it takes back priority from an established incumbent,
 * preventing flapping when Dynatrace intermittently fails.
 *
 * A collector reporting AUTH_FAILED is treated as immediately stale via markAuthFailed().
 *
 * Config: `source_arbitration` in config/telemetry.yaml. Active when
 * telemetry profile 4 is selected or `source_arbitration.enabled: true`.
 */
const DEFAULT_STALE_SECONDS = 180;
const DEFAULT_PRIORITY = ['dynatrace', 'otel', 'probe'];
const DEFAULT_HYSTERESIS = 3;
const MAX_TRACKED_SERIES = 200000;
const CONFIG_TTL_MS = 30 * 1000;

const lastSeen = new Map(); // seriesKey -> Map(source -> epochMs)
const consecutiveCounts = new Map(); // seriesKey -> Map(source -> count)
const incumbents = new Map(); // seriesKey -> source
const counters = { accepted: 0, dropped: 0, bySourceDropped: {} };
let cachedConfig = null;
let cachedAt = 0;

// Arbiter settings (cached).
function loadConfig() {
  if (cachedConfig && Date.now() - cachedAt < CONFIG_TTL_MS) return cachedConfig;
  let yamlCfg = {};
  let profileArbitrated = false;
  try {
    const selector = require('./telemetry_provider_selector');
    yamlCfg = (selector.loadProfilesYaml() || {}).source_arbitration || {};
    profileArbitrated = !!selector.getActiveStrategy().arbitrated;
  } catch (_) { /* selector unavailable: arbitration stays off */ }

  cachedConfig = {
    enabled: profileArbitrated || yamlCfg.enabled === true,
    staleMs: (Number(yamlCfg.stale_after_seconds) || DEFAULT_STALE_SECONDS) * 1000,
    hysteresisPoints: Number(yamlCfg.hysteresis_points) || DEFAULT_HYSTERESIS,
    defaultPriority: Array.isArray(yamlCfg.default_priority) ? yamlCfg.default_priority : DEFAULT_PRIORITY,
    metricPriority: yamlCfg.metric_priority || {}
  };
  cachedAt = Date.now();
  return cachedConfig;
}

// Source priority for a metric.
function priorityFor(metricName, cfg) {
  const overrides = cfg.metricPriority || {};
  if (Array.isArray(overrides[metricName])) return overrides[metricName];
  for (const pattern of Object.keys(overrides)) {
    if (pattern.endsWith('*') && metricName && metricName.startsWith(pattern.slice(0, -1)) && Array.isArray(overrides[pattern])) {
      return overrides[pattern];
    }
  }
  return cfg.defaultPriority;
}

// Per-series tracking maps.
function getSeriesMaps(key) {
  let seen = lastSeen.get(key);
  if (!seen) {
    if (lastSeen.size >= MAX_TRACKED_SERIES) {
      lastSeen.clear();
      consecutiveCounts.clear();
      incumbents.clear();
    }
    seen = new Map();
    lastSeen.set(key, seen);
  }
  let counts = consecutiveCounts.get(key);
  if (!counts) {
    counts = new Map();
    consecutiveCounts.set(key, counts);
  }
  return { seen, counts };
}

// Drops a source whose credentials failed.
function markAuthFailed(source) {
  for (const seen of lastSeen.values()) {
    seen.delete(source);
  }
  for (const counts of consecutiveCounts.values()) {
    counts.delete(source);
  }
  for (const [key, inc] of incumbents.entries()) {
    if (inc === source) incumbents.delete(key);
  }
}

/**
 * Decide whether a point is stored. Always records that the source was seen.
 * @param {{ env, entity_id, component, metricName, source, timestamp }} point
 * @param {number} [now]
 * @returns {boolean}
 */
function accept(point, now = Date.now()) {
  const cfg = loadConfig();
  if (!cfg.enabled) return true;

  const source = point.source || 'collector';
  const priority = priorityFor(point.metricName, cfg);
  const rank = priority.indexOf(source);
  if (rank === -1) {
    counters.accepted++;
    return true;
  }

  const key = `${point.env}|${point.entity_id || point.component}|${point.metricName}`;
  const { seen, counts } = getSeriesMaps(key);

  const prevSeen = seen.get(source);
  seen.set(source, now);

  const c = (prevSeen !== undefined && now - prevSeen <= cfg.staleMs) ? (counts.get(source) || 0) + 1 : 1;
  counts.set(source, c);

  let currentIncumbent = incumbents.get(key);
  if (currentIncumbent) {
    const incSeen = seen.get(currentIncumbent);
    if (incSeen === undefined || now - incSeen > cfg.staleMs) {
      currentIncumbent = null;
      incumbents.delete(key);
    }
  }

  const hysteresisReq = cfg.hysteresisPoints !== undefined ? cfg.hysteresisPoints : DEFAULT_HYSTERESIS;

  if (!currentIncumbent) {
    incumbents.set(key, source);
    currentIncumbent = source;
  } else if (source === currentIncumbent) {
    // Current incumbent reporting, keep it
  } else {
    const incRank = priority.indexOf(currentIncumbent);
    if (incRank !== -1 && rank < incRank) {
      // Higher priority source wants to take back priority
      if (c >= hysteresisReq) {
        incumbents.set(key, source);
        currentIncumbent = source;
      }
    }
  }

  // If a higher priority source holds the active priority, drop lower-priority point
  for (let i = 0; i < rank; i++) {
    const higherSrc = priority[i];
    const t = seen.get(higherSrc);
    if (t !== undefined && now - t <= cfg.staleMs) {
      if (higherSrc === currentIncumbent || (counts.get(higherSrc) || 0) >= hysteresisReq) {
        counters.dropped++;
        counters.bySourceDropped[source] = (counters.bySourceDropped[source] || 0) + 1;
        return false;
      }
    }
  }

  counters.accepted++;
  return true;
}

/** Which source currently wins for a series, or null when none is fresh. */
function activeSource(env, entityOrComponent, metricName, now = Date.now()) {
  const cfg = loadConfig();
  const key = `${env}|${entityOrComponent}|${metricName}`;
  const seen = lastSeen.get(key);
  if (!seen) return null;

  const currentIncumbent = incumbents.get(key);
  if (currentIncumbent) {
    const t = seen.get(currentIncumbent);
    if (t !== undefined && now - t <= cfg.staleMs) return currentIncumbent;
  }

  for (const src of priorityFor(metricName, cfg)) {
    const t = seen.get(src);
    if (t !== undefined && now - t <= cfg.staleMs) return src;
  }
  return null;
}

/** Expose active source for each tracked series matching environment */
function getActiveSources(environment, now = Date.now()) {
  const cfg = loadConfig();
  const results = [];
  const targetEnv = environment ? String(environment).toLowerCase() : null;
  for (const [key, seen] of lastSeen.entries()) {
    const [env, entity, metricName] = key.split('|');
    if (targetEnv && env.toLowerCase() !== targetEnv) continue;
    const active = activeSource(env, entity, metricName, now);
    if (active) {
      results.push({
        env,
        entity,
        metricName,
        activeSource: active
      });
    }
  }
  return results;
}

// Arbiter counters.
function getStats() {
  const cfg = loadConfig();
  return { enabled: cfg.enabled, trackedSeries: lastSeen.size, ...counters, bySourceDropped: { ...counters.bySourceDropped } };
}

// Resets the arbiter.
function reset(overrideConfig = null) {
  lastSeen.clear();
  consecutiveCounts.clear();
  incumbents.clear();
  counters.accepted = 0;
  counters.dropped = 0;
  counters.bySourceDropped = {};
  cachedConfig = overrideConfig;
  cachedAt = overrideConfig ? Date.now() + 365 * 24 * 3600 * 1000 : 0;
}

module.exports = { accept, activeSource, getActiveSources, markAuthFailed, getStats, reset, priorityFor };
