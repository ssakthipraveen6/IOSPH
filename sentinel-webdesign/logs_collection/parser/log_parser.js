/**
 * Log parsing: normalises levels, extracts fields and builds message fingerprints for grouping.
 */
const crypto = require('crypto');

/**
 * Normalizes log level string into standard canonical level.
 */
function normalizeLogLevel(rawLevel) {
  if (!rawLevel) return 'INFO';
  const upper = String(rawLevel).toUpperCase().trim();
  if (upper === 'WARN' || upper === 'WARNING') return 'WARN';
  if (upper === 'ERR' || upper === 'ERROR') return 'ERROR';
  if (upper === 'FATAL' || upper === 'CRITICAL' || upper === 'EMERG') return 'FATAL';
  if (upper === 'DEBUG' || upper === 'TRACE' || upper === 'VERBOSE') return 'DEBUG';
  return 'INFO';
}

/**
 * Generates a normalized template by replacing dynamic parameters (numbers, UUIDs, IPs, paths)
 * with canonical placeholder tokens.
 */
function generateFingerprintTemplate(message) {
  if (!message || typeof message !== 'string') return '';

  return message
    // Mask ISO/RFC Timestamps
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, '<TIMESTAMP>')
    // Mask IPv4 / IPv6 addresses
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<IP>')
    // Mask UUIDs
    .replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, '<UUID>')
    // Mask Unix & Windows file/directory paths
    .replace(/(?:[a-zA-Z]:\\[a-zA-Z0-9_\.\-\\]+|\/(?:[a-zA-Z0-9_\.\-]+\/)+[a-zA-Z0-9_\.\-]*)/g, '<PATH>')
    // Mask Hex hashes (git hashes, checksums, tokens)
    .replace(/\b[0-9a-fA-F]{7,64}\b/g, '<HASH>')
    // Mask numbers (durations, memory, ports, counts)
    .replace(/\b\d+(?:\.\d+)?(?:ms|s|MB\/s|KB\/s|GB\/s|MB|GB|KB|B|%)?\b/g, '<NUM>')
    // Normalize excess whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic hash calculation for the fingerprint template.
 */
function computeFingerprint(template) {
  if (!template) return 'fp_empty';
  const hash = crypto.createHash('sha256').update(template).digest('hex').substring(0, 16);
  return `fp_${hash}`;
}

/**
 * Common regex matchers for common log formats (JSON, Log4j, Syslog, Apache/Nginx, bracketed)
 */
const BRACKET_PREFIX_REGEX = /^\[([^\]]+)\]\s*(.*)$/;
const LOG4J_REGEX = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^ ]*)\s+\[([^\]]+)\]\s+([A-Z]+)\s+([a-zA-Z0-9_.$]+)\s*[-:]\s*(.*)$/;
const SYSLOG_REGEX = /^([A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+([a-zA-Z0-9_.-]+)\s+([a-zA-Z0-9_.-]+)(?:\[(\d+)\])?:\s*(.*)$/;
const LEVEL_IN_MESSAGE_REGEX = /\b(FATAL|CRITICAL|ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\b/i;

/**
 * Parses raw text or structured object into a normalized log_event record.
 * 
 * @param {string|object} raw - Raw log line or object
 * @param {object} defaultMeta - Default metadata { environment, app_id, entity_id }
 * @returns {object} Normalized log record
 */
function parseLog(raw, defaultMeta = {}) {
  const now = new Date().toISOString();
  let ts = now;
  let level = 'INFO';
  let logger = 'default';
  let message = '';
  let fields = {};
  let appId = defaultMeta.app_id || 'system';
  let entityId = defaultMeta.entity_id || null;
  const environment = (defaultMeta.environment || 'staging').toLowerCase();

  // 1. Structured JSON parsing
  if (typeof raw === 'object' && raw !== null) {
    ts = raw.ts || raw.timestamp || raw['@timestamp'] || raw.time || now;
    level = normalizeLogLevel(raw.level || raw.severity || raw.logLevel || raw.severityText);
    logger = raw.logger || raw.logger_name || raw.component || raw.service || defaultMeta.app_id || 'default';
    message = raw.message || raw.msg || raw.log || raw.body || '';
    if (typeof message === 'object') {
      message = JSON.stringify(message);
    }
    appId = raw.app_id || raw.appId || raw.service || raw.app || appId;
    entityId = raw.entity_id || raw.entityId || raw.host || entityId;
    fields = { ...raw };
    delete fields.ts;
    delete fields.timestamp;
    delete fields['@timestamp'];
    delete fields.level;
    delete fields.message;
    delete fields.msg;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }

    // Try parsing as JSON string first
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          return parseLog(parsed, defaultMeta);
        }
      } catch (_) {
        // Not valid JSON, proceed to pattern matching
      }
    }

    // Pattern 1: Log4j / Spring Boot: 2026-09-20 12:00:00.123 [thread] INFO com.foo - message
    const log4jMatch = trimmed.match(LOG4J_REGEX);
    if (log4jMatch) {
      ts = new Date(log4jMatch[1]).toISOString() || now;
      fields.thread = log4jMatch[2];
      level = normalizeLogLevel(log4jMatch[3]);
      logger = log4jMatch[4];
      message = log4jMatch[5];
    }
    // Pattern 2: Bracketed prefix: [APP-NAME] message or [LEVEL] message
    else if (BRACKET_PREFIX_REGEX.test(trimmed)) {
      const match = trimmed.match(BRACKET_PREFIX_REGEX);
      const tag = match[1].trim();
      message = match[2].trim();

      // Check if tag contains level or app
      if (/^(INFO|WARN|ERROR|DEBUG|FATAL|CRITICAL)$/i.test(tag)) {
        level = normalizeLogLevel(tag);
      } else {
        logger = tag;
        // App name hints: [BB-NET], [JENKINS-FATAL], [ART-REPO]
        if (tag.includes('-')) {
          const parts = tag.split('-');
          if (/^(FATAL|CRITICAL|ERROR|WARN|INFO|DEBUG)$/i.test(parts[1])) {
            level = normalizeLogLevel(parts[1]);
          }
        }
      }

      // Check for inline level if not yet set to non-INFO
      if (level === 'INFO') {
        const lvlMatch = message.match(LEVEL_IN_MESSAGE_REGEX);
        if (lvlMatch) {
          level = normalizeLogLevel(lvlMatch[1]);
        }
      }
    } else {
      message = trimmed;
      const lvlMatch = message.match(LEVEL_IN_MESSAGE_REGEX);
      if (lvlMatch) {
        level = normalizeLogLevel(lvlMatch[1]);
      }
    }
  }

  // Ensure ts is valid ISO string
  let parsedTs = new Date(ts);
  if (isNaN(parsedTs.getTime())) {
    parsedTs = new Date();
  }

  const template = generateFingerprintTemplate(message);
  const fingerprint = computeFingerprint(template);

  return {
    ts: parsedTs.toISOString(),
    entity_id: entityId || (appId ? `app:${appId}` : 'system'),
    app_id: appId,
    environment,
    level,
    logger: String(logger),
    message: String(message),
    fields,
    fingerprint,
    template
  };
}

module.exports = {
  parseLog,
  normalizeLogLevel,
  generateFingerprintTemplate,
  computeFingerprint
};
