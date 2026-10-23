/**
 * Custom metrics line protocol parser (M1.11).
 *
 * Compatible with the Dynatrace metrics ingest format so existing scripts can be
 * pointed at SENTINEL with a URL change:
 *
 *   <metric.key>[,<dim>=<value>...] [gauge,]<number>|gauge,min=..,max=..,sum=..,count=..|count,delta=<n> [<timestamp ms>]
 *
 *   nas.share.latency_ms,component=nas_performance,share=\\filer01\builds gauge,42.7 1760000000000
 *   jenkins.queue.length,component=jenkins 17
 *
 * Reserved dimensions: `component` (else `app`/`service`, else the first segment
 * of the metric key), `entity` or `host` (entity id; host becomes `host:<name>`).
 * Lines starting with `#` are comments.
 */
const MAX_LINES = 5000;
const MAX_KEY_LENGTH = 250;
const MAX_DIMENSIONS = 50;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.:-]*$/;
const DIM_KEY_RE = /^[A-Za-z][A-Za-z0-9_.:-]*$/;
const MAX_AGE_MS = 60 * 60 * 1000;
const MAX_FUTURE_MS = 10 * 60 * 1000;

// Split on `sep` outside double quotes, honouring backslash escapes.
function splitOutsideQuotes(text, sep) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      current += ch + text[i + 1];
      i++;
      continue;
    }
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (sep !== ' ' || current.length > 0) parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (inQuotes) throw new Error('unterminated quote');
  if (sep !== ' ' || current.length > 0) parts.push(current);
  return parts;
}

// Removes surrounding quotes.
function unquote(v) {
  let out = v;
  if (out.length >= 2 && out.startsWith('"') && out.endsWith('"')) out = out.slice(1, -1);
  return out.replace(/\\(.)/g, '$1');
}

// Parses a number or throws.
function parseNumber(s, label) {
  const n = Number(s);
  if (s === '' || !Number.isFinite(n)) throw new Error(`invalid ${label} "${s}"`);
  return n;
}

// Parses the value part (gauge, count, ...).
function parsePayload(payload) {
  const tokens = payload.split(',');
  const kind = tokens[0].toLowerCase();
  if (kind === 'gauge') {
    if (tokens.length === 2) return { value: parseNumber(tokens[1], 'gauge value'), stats: null };
    const stats = {};
    tokens.slice(1).forEach(t => {
      const [k, v] = t.split('=');
      if (!['min', 'max', 'sum', 'count'].includes(k)) throw new Error(`unknown gauge field "${k}"`);
      stats[k] = parseNumber(v, `gauge ${k}`);
    });
    if (stats.count === undefined || stats.sum === undefined) throw new Error('gauge summary needs sum and count');
    if (stats.count <= 0) throw new Error('gauge count must be positive');
    return { value: stats.sum / stats.count, stats };
  }
  if (kind === 'count') {
    const delta = /^delta=(.+)$/.exec(tokens[1] || '');
    if (!delta) throw new Error('count needs delta=<n>');
    return { value: parseNumber(delta[1], 'count delta'), stats: null };
  }
  if (tokens.length !== 1) throw new Error(`unknown payload "${payload}"`);
  return { value: parseNumber(payload, 'value'), stats: null };
}

// Parses one line-protocol line into a metric point.
function parseLine(line, now = Date.now()) {
  const parts = splitOutsideQuotes(line.trim(), ' ');
  if (parts.length < 2 || parts.length > 3) throw new Error('expected "<key>[,dims] <payload> [timestamp]"');

  const head = splitOutsideQuotes(parts[0], ',');
  const metricKey = head[0];
  if (!KEY_RE.test(metricKey) || metricKey.length > MAX_KEY_LENGTH) throw new Error(`invalid metric key "${metricKey}"`);
  if (head.length - 1 > MAX_DIMENSIONS) throw new Error(`more than ${MAX_DIMENSIONS} dimensions`);

  const dims = {};
  head.slice(1).forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx <= 0) throw new Error(`invalid dimension "${pair}"`);
    const k = pair.slice(0, idx).toLowerCase();
    if (!DIM_KEY_RE.test(k)) throw new Error(`invalid dimension key "${k}"`);
    dims[k] = unquote(pair.slice(idx + 1));
  });

  const { value, stats } = parsePayload(parts[1]);

  let ts = now;
  if (parts[2] !== undefined) {
    ts = parseNumber(parts[2], 'timestamp');
    if (ts < 1e12) ts *= 1000; // seconds -> ms
    if (ts < now - MAX_AGE_MS || ts > now + MAX_FUTURE_MS) throw new Error('timestamp outside the accepted window (-1h, +10m)');
  }

  const component = dims.component || dims.app || dims.service || metricKey.split('.')[0];
  const entityId = dims.entity || (dims.host ? `host:${dims.host}` : `app:${component}`);
  const attributes = { ...dims };
  delete attributes.component;
  delete attributes.entity;
  if (stats) {
    Object.entries(stats).forEach(([k, v]) => { attributes[`gauge.${k}`] = String(v); });
  }

  return {
    timestamp: new Date(ts).toISOString(),
    component,
    entity_id: entityId,
    metricName: metricKey,
    value,
    source: 'custom',
    attributes
  };
}

// Parses a request body; returns points and per-line errors.
function parseBody(body, now = Date.now()) {
  const lines = String(body || '').split(/\r?\n/);
  const points = [];
  const invalidLines = [];
  let considered = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;
    considered++;
    if (considered > MAX_LINES) {
      invalidLines.push({ line: i + 1, error: `more than ${MAX_LINES} lines in one request` });
      break;
    }
    try {
      points.push(parseLine(raw, now));
    } catch (err) {
      invalidLines.push({ line: i + 1, error: err.message });
    }
  }
  return { points, invalidLines };
}

module.exports = { parseLine, parseBody, MAX_LINES };
