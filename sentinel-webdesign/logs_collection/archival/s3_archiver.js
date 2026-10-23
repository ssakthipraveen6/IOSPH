/**
 * Daily log archive: compresses old logs and uploads them to S3 (log_archive in
 * config/global.yaml).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const postgres = require('../../database/postgres');
const clickhouse = require('../../database/clickhouse');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');
const config = require('@sentinel/config');
const yamlConfig = require('@sentinel/config/yaml_config');
const s3Client = require('./s3_client');

const ARCHIVE_DIR = path.resolve(__dirname, '../../.runtime/archived_logs');

/**
 * Archives logs older than retentionDays or for a specific date partition
 * into gzipped NDJSON partitioned by env/app/date/.
 *
 * @param {object} options
 * @param {string} options.environment - Target environment (prod, staging)
 * @param {string} options.date - Target date string (YYYY-MM-DD)
 * @param {number} options.retentionDays - Retention days threshold (default: 14)
 * @returns {Promise<object>} Archival result summary
 */
async function archiveLogs(options = {}) {
  const environment = (options.environment || 'staging').toLowerCase();
  const retentionDays = options.retentionDays || 14;
  const targetDate = options.date || new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Upload target. A blank bucket means "not configured": the archive stays local and the
  // result says so. Credentials come from the credential provider (aws / s3_storage) as
  // "ACCESS_KEY_ID:SECRET" or JSON.
  const bucket = String(options.s3Bucket || '').trim();
  const region = options.s3Region || 'us-east-1';
  const prefix = String(options.s3Prefix === undefined ? 'sentinel/logs' : options.s3Prefix).replace(/^\/+|\/+$/g, '');
  const put = options.putObject || s3Client.putObject;
  let s3 = { status: 'NOT_CONFIGURED', reason: 'jobs.log_archive.s3_bucket is blank' };
  let s3Creds = null;
  let s3Endpoint = options.s3Endpoint || null;
  if (bucket) {
    try {
      s3Creds = s3Client.parseS3Credential(await credentialProvider.getCredential('aws', 's3_storage'));
    } catch (_) { s3Creds = null; }
    if (!s3Endpoint) {
      try {
        const g = yamlConfig.loadGlobalConfig() || {};
        const urls = (environment === 'prod' || environment === 'production') ? g.prod_urls : g.stg_urls;
        s3Endpoint = urls && urls.s3_endpoint;
      } catch (_) { s3Endpoint = null; }
    }
    if (!s3Creds) s3 = { status: 'AUTH_FAILED', reason: 'no usable credential for aws/s3_storage' };
    else if (!s3Endpoint) s3 = { status: 'NOT_CONFIGURED', reason: 'no s3_endpoint for this environment' };
    else s3 = { status: 'READY' };
  }

  // Logs live in ClickHouse when it is configured (the primary log store), otherwise in Postgres.
  let logRows = [];
  let source = 'none';

  if (clickhouse.isConfigured()) {
    try {
      const rows = await clickhouse.query(
        `SELECT ts, entity_id, app_id, env, level, message, fields
         FROM logs
         WHERE env = {env:String} AND toDate(ts) = toDate({date:String})
         ORDER BY ts ASC`,
        { env: environment, date: targetDate }
      );
      logRows = rows.map(r => ({
        ts: r.ts, entity_id: r.entity_id, app_id: r.app_id, environment: r.env, level: r.level,
        logger: (r.fields && r.fields.logger) || null, message: r.message, fields: r.fields || {},
        fingerprint: (r.fields && r.fields.fingerprint) || null
      }));
      source = 'clickhouse';
    } catch (err) {
      console.warn(`[S3_ARCHIVER] ClickHouse query failed: ${err.message}`);
    }
  }

  if (source === 'none') {
    const pool = await postgres.getPool();
    if (pool) {
      try {
        const query = `
          SELECT ts, entity_id, app_id, environment, level, logger, message, fields, fingerprint
          FROM log_event
          WHERE environment = $1 AND ts::date = $2::date
          ORDER BY ts ASC
        `;
        const res = await pool.query(query, [environment, targetDate]);
        logRows = res.rows || [];
        source = 'postgres';
      } catch (err) {
        console.warn(`[S3_ARCHIVER] Database query failed: ${err.message}`);
      }
    }
  }

  // Partition by app_id
  const partitioned = {};
  logRows.forEach(row => {
    const app = row.app_id || 'system';
    if (!partitioned[app]) partitioned[app] = [];
    partitioned[app].push(row);
  });

  const archivedFiles = [];

  for (const [app, logs] of Object.entries(partitioned)) {
    const partitionPath = path.join(ARCHIVE_DIR, environment, app, targetDate);
    if (!fs.existsSync(partitionPath)) {
      fs.mkdirSync(partitionPath, { recursive: true });
    }

    const ndjsonContent = logs.map(l => JSON.stringify(l)).join('\n');
    const gzipped = zlib.gzipSync(Buffer.from(ndjsonContent, 'utf8'));
    const fileName = `logs_${targetDate}_${app}.ndjson.gz`;
    const fullPath = path.join(partitionPath, fileName);

    fs.writeFileSync(fullPath, gzipped);
    const entry = {
      file: fullPath,
      app,
      date: targetDate,
      count: logs.length,
      bytes: gzipped.length,
      uploaded: false
    };
    if (s3.status === 'READY') {
      const key = [prefix, environment, app, targetDate, fileName].filter(Boolean).join('/');
      try {
        const r = await put({ endpoint: s3Endpoint, region, bucket, key, body: gzipped, ...s3Creds });
        entry.uploaded = !!r.confirmed;
        entry.s3_key = key;
        entry.s3_http_status = r.status;
        // The local copy is only ever removed after S3 has confirmed the object.
        if (entry.uploaded && options.deleteLocalAfterUpload) {
          try { fs.unlinkSync(fullPath); entry.local_removed = true; } catch (_) { /* keep it */ }
        }
      } catch (err) {
        entry.upload_error = err.message;
      }
    }
    archivedFiles.push(entry);
  }

  return {
    status: source === 'none' ? 'DATA_UNAVAILABLE' : 'SUCCESS',
    source,
    environment,
    date: targetDate,
    totalLogsArchived: logRows.length,
    partitionsCreated: Object.keys(partitioned).length,
    s3: { ...s3, uploaded: archivedFiles.filter(f => f.uploaded).length, failed: archivedFiles.filter(f => s3.status === 'READY' && !f.uploaded).length },
    files: archivedFiles
  };
}

module.exports = {
  archiveLogs
};
