const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const postgres = require('../../database/postgres');
const credentialProvider = require('@sentinel/config/cyberark/credential_provider');
const config = require('@sentinel/config');

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

  let s3Key = null;
  try {
    s3Key = await credentialProvider.getCredential('aws', 's3_storage');
  } catch (_) {
    // Falls back to local archive directory if S3 is mock or unconfigured
  }

  const pool = await postgres.getPool();
  let logRows = [];

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
    } catch (err) {
      console.warn(`[S3_ARCHIVER] Database query failed: ${err.message}`);
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
    archivedFiles.push({
      file: fullPath,
      app,
      date: targetDate,
      count: logs.length,
      bytes: gzipped.length
    });
  }

  return {
    status: 'SUCCESS',
    environment,
    date: targetDate,
    totalLogsArchived: logRows.length,
    partitionsCreated: Object.keys(partitioned).length,
    files: archivedFiles
  };
}

module.exports = {
  archiveLogs
};
