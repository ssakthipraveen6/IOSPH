const fs = require('fs');
const path = require('path');
const config = require('@sentinel/config');
const logParser = require('../../parser/log_parser');
const logStore = require('../../../database/log_store');

const RUNTIME_DIR = path.resolve(__dirname, '../../../.runtime');
const OFFSETS_FILE = path.join(RUNTIME_DIR, 'log_offsets.json');

/**
 * Loads checkpoint offsets from disk.
 */
function loadOffsets() {
  try {
    if (fs.existsSync(OFFSETS_FILE)) {
      const data = fs.readFileSync(OFFSETS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (_) {}
  return {};
}

/**
 * Saves checkpoint offsets to disk atomically.
 */
function saveOffsets(offsets) {
  try {
    if (!fs.existsSync(RUNTIME_DIR)) {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    }
    const tmpFile = `${OFFSETS_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(offsets, null, 2), 'utf8');
    fs.renameSync(tmpFile, OFFSETS_FILE);
  } catch (err) {
    console.warn(`[FLUENTD_TAILER] Could not persist log offsets: ${err.message}`);
  }
}

/**
 * Discovers log files to tail based on environment configuration and target logs.
 */
function discoverLogFiles(targetEnv) {
  const envKey = (targetEnv || 'staging').toLowerCase();
  const filePaths = new Set();

  const cfgUrls = envKey === 'prod' ? config.PROD_URLS : config.STG_URLS;
  if (cfgUrls && cfgUrls.fluentd_log_path) {
    filePaths.add(path.resolve(cfgUrls.fluentd_log_path));
  }

  // Check nas_logs directory in runtime
  const nasDir = path.join(RUNTIME_DIR, 'nas_logs');
  if (fs.existsSync(nasDir)) {
    try {
      const files = fs.readdirSync(nasDir);
      files.forEach(f => {
        if (f.endsWith('.log')) {
          filePaths.add(path.join(nasDir, f));
        }
      });
    } catch (_) {}
  }

  return Array.from(filePaths);
}

/**
 * Reads newly appended lines from a single log file using persistent byte-offset tracking
 * and inode change detection for rotation.
 */
function tailFile(filePath, offsets, targetEnv) {
  if (!fs.existsSync(filePath)) {
    return { lines: [], records: [] };
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    return { lines: [], records: [] };
  }

  const currentInode = stat.ino || 0;
  const currentSize = stat.size;
  const fileKey = path.normalize(filePath);

  const isFirstDiscovery = !offsets[fileKey];
  let checkpoint = offsets[fileKey] || { offset: 0, inode: currentInode };

  // For large existing files discovered on first run, seek to recent end (last 32KB)
  if (isFirstDiscovery && currentSize > 64 * 1024) {
    checkpoint.offset = Math.max(0, currentSize - 32 * 1024);
  }

  // Detect file rotation or truncation:
  // 1. Inode changed -> logrotate created a new file
  // 2. File size smaller than last recorded offset -> file was truncated (copytruncate)
  if ((checkpoint.inode && checkpoint.inode !== currentInode) || currentSize < checkpoint.offset) {
    checkpoint = {
      offset: 0,
      inode: currentInode
    };
  }

  // If no new bytes
  if (currentSize <= checkpoint.offset) {
    offsets[fileKey] = checkpoint;
    return { lines: [], records: [] };
  }

  // Read in bounded chunks (max 256KB per cycle per file)
  const maxChunk = 256 * 1024;
  const bytesToRead = Math.min(currentSize - checkpoint.offset, maxChunk);
  const buffer = Buffer.alloc(bytesToRead);

  let fd = null;
  let bytesRead = 0;
  try {
    fd = fs.openSync(filePath, 'r');
    bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, checkpoint.offset);
  } catch (err) {
    console.warn(`[FLUENTD_TAILER] Read error on ${filePath}: ${err.message}`);
    return { lines: [], records: [] };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }

  if (bytesRead === 0) {
    return { lines: [], records: [] };
  }

  const chunkStr = buffer.toString('utf8', 0, bytesRead);
  
  // Find last newline to avoid partial trailing lines
  const lastNewlineIdx = chunkStr.lastIndexOf('\n');
  let validChunk = chunkStr;
  let consumedBytes = bytesRead;

  if (lastNewlineIdx !== -1 && lastNewlineIdx < chunkStr.length - 1) {
    // There is an incomplete line at the end, roll back offset to last complete newline
    validChunk = chunkStr.substring(0, lastNewlineIdx + 1);
    const unreadLength = Buffer.byteLength(chunkStr.substring(lastNewlineIdx + 1));
    consumedBytes = bytesRead - unreadLength;
  }

  checkpoint.offset += consumedBytes;
  checkpoint.inode = currentInode;
  checkpoint.lastRead = new Date().toISOString();
  offsets[fileKey] = checkpoint;

  const rawLines = validChunk.split('\n').map(l => l.trim()).filter(Boolean);
  const records = [];

  // Deduce app_id from filename or path
  const baseName = path.basename(filePath, path.extname(filePath)).replace(/_log$|\.log$/, '');

  rawLines.forEach(line => {
    const record = logParser.parseLog(line, {
      environment: targetEnv,
      app_id: baseName,
      entity_id: `host:${baseName}`
    });
    if (record) {
      records.push(record);
    }
  });

  return { lines: rawLines, records };
}

/**
 * Main collector method invoked by collector_coordinator.
 * Returns array of raw string lines for backwards compatibility with aiAnalyzer,
 * while piping all structured parsed records to logStore.
 */
async function collectFluentdLogs(simulations, db, writeNasLog, targetEnv = null) {
  const currentEnv = (targetEnv || global.runtimeEnvironment || config.ENVIRONMENT || 'staging').toLowerCase();
  const startTime = Date.now();
  const offsets = loadOffsets();
  const filesToTail = discoverLogFiles(currentEnv);

  const linesGenerated = [];
  const parsedRecords = [];

  for (const filePath of filesToTail) {
    const result = tailFile(filePath, offsets, currentEnv);
    if (result.lines.length > 0) {
      for (let i = 0; i < result.lines.length; i++) {
        linesGenerated.push(result.lines[i]);
      }
      for (let i = 0; i < result.records.length; i++) {
        parsedRecords.push(result.records[i]);
      }
    }
  }

  // Persist updated offsets
  saveOffsets(offsets);

  // Ingest parsed records into central log store
  if (parsedRecords.length > 0) {
    try {
      await logStore.appendLogs(parsedRecords);
    } catch (storeErr) {
      console.warn(`[FLUENTD_TAILER] Failed to append to logStore: ${storeErr.message}`);
    }
  }

  if (linesGenerated.length > 0 && typeof writeNasLog === 'function') {
    // Only echo non-nas lines and sample up to 20 to avoid feedback loops and log explosion
    const nonNasLines = linesGenerated.filter(line => !line.includes('LOG_AGENT') && !line.includes('DATABASE_POSTGRES'));
    nonNasLines.slice(0, 20).forEach(line => {
      writeNasLog('INFO', 'LOG_AGENT_REAL', line);
    });
  }

  return linesGenerated;
}

module.exports = {
  collectFluentdLogs,
  tailFile,
  loadOffsets,
  saveOffsets,
  discoverLogFiles
};
