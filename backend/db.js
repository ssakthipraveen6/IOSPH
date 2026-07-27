const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'sentinel_db.json');

// Default database state
let db = {
  metrics: [],      // array of { timestamp, component, metricName, value }
  alerts: [],       // array of { id, timestamp, component, severity, message, status, resolvedAt }
  recovery: [],     // array of { id, timestamp, component, action, triggerReason, status, steps, duration }
  settings: {
    autonomousMode: true
  }
};

let isSaving = false;
let saveScheduled = false;

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(data);
      
      // Ensure arrays exist
      db.metrics = db.metrics || [];
      db.alerts = db.alerts || [];
      db.recovery = db.recovery || [];
      db.settings = db.settings || { autonomousMode: true };
      
      console.log(`[DB] Database loaded successfully. Metrics count: ${db.metrics.length}, Alerts: ${db.alerts.length}`);
    } else {
      saveDBSync();
      console.log(`[DB] Database file not found. Created a new database at ${DB_FILE}`);
    }
  } catch (error) {
    console.error('[DB] Failed to load database, using clean memory state:', error);
  }
}

function saveDBSync() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (error) {
    console.error('[DB] Synchronous save failed:', error);
  }
}

// Throttled asynchronous saving to prevent disk hammering during rapid inserts
function saveDB() {
  if (isSaving) {
    saveScheduled = true;
    return;
  }
  
  isSaving = true;
  fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8', (err) => {
    isSaving = false;
    if (err) {
      console.error('[DB] Asynchronous save failed:', err);
    }
    
    if (saveScheduled) {
      saveScheduled = false;
      saveDB();
    }
  });
}

// Auto load DB on require
loadDB();

const dbManager = {
  // --- Settings Methods ---
  getSettings() {
    return db.settings;
  },
  
  updateSettings(newSettings) {
    db.settings = { ...db.settings, ...newSettings };
    saveDB();
    return db.settings;
  },

  // --- Metrics Methods ---
  getMetrics(component, limit = 100) {
    let filtered = db.metrics;
    if (component) {
      filtered = filtered.filter(m => m.component === component);
    }
    // Return sorted by timestamp and sliced to limit
    return filtered.slice(-limit);
  },

  addMetric(component, metricName, value) {
    const entry = {
      timestamp: new Date().toISOString(),
      component,
      metricName,
      value: typeof value === 'number' ? parseFloat(value.toFixed(2)) : value
    };
    
    db.metrics.push(entry);
    
    // Auto-prune metrics: Keep at most 200 metric points per unique component/metricName combination
    // This maintains historical context (approx 33 minutes at 10s intervals) while preventing disk leak
    const componentMetrics = db.metrics.filter(m => m.component === component && m.metricName === metricName);
    if (componentMetrics.length > 200) {
      // Find the count to delete
      const excess = componentMetrics.length - 200;
      let deleted = 0;
      db.metrics = db.metrics.filter(m => {
        if (m.component === component && m.metricName === metricName && deleted < excess) {
          deleted++;
          return false;
        }
        return true;
      });
    }

    saveDB();
    return entry;
  },

  clearMetrics() {
    db.metrics = [];
    saveDB();
  },

  // --- Alerts / Incidents Methods ---
  getAlerts() {
    return db.alerts;
  },

  addAlert(component, severity, message, status = 'Active') {
    const alert = {
      id: 'ALT-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
      timestamp: new Date().toISOString(),
      component,
      severity, // 'Warning', 'Critical', 'Predictive-Warning'
      message,
      status, // 'Active', 'Resolved'
      resolvedAt: null
    };
    
    db.alerts.push(alert);
    
    // Prune resolved alerts older than 100 entries to save space
    if (db.alerts.length > 200) {
      db.alerts = db.alerts.slice(-200);
    }
    
    saveDB();
    return alert;
  },

  resolveAlertsForComponent(component) {
    let resolvedCount = 0;
    db.alerts.forEach(alert => {
      if (alert.component === component && alert.status === 'Active') {
        alert.status = 'Resolved';
        alert.resolvedAt = new Date().toISOString();
        resolvedCount++;
      }
    });
    if (resolvedCount > 0) {
      saveDB();
    }
    return resolvedCount;
  },

  // --- Recovery Orchestrator Logs ---
  getRecoveryLogs() {
    return db.recovery;
  },

  addRecoveryRun(component, action, triggerReason) {
    const run = {
      id: 'REC-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
      timestamp: new Date().toISOString(),
      component,
      action,
      triggerReason,
      status: 'In-Progress', // 'In-Progress', 'Success', 'Failed', 'Awaiting-Approval'
      steps: [`[${new Date().toLocaleTimeString()}] Triggered recovery action: ${action}`],
      duration: 0
    };
    db.recovery.push(run);
    saveDB();
    return run;
  },

  updateRecoveryRun(id, updates) {
    const run = db.recovery.find(r => r.id === id);
    if (run) {
      if (updates.step) {
        run.steps.push(`[${new Date().toLocaleTimeString()}] ${updates.step}`);
      }
      if (updates.status) {
        run.status = updates.status;
      }
      if (updates.duration) {
        run.duration = updates.duration;
      }
      saveDB();
      return run;
    }
    return null;
  }
};

module.exports = dbManager;
