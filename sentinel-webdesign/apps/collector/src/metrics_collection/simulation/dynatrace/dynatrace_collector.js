function collectDynatraceAlerts(db, writeNasLog) {
  const activeAlerts = db.getAlerts().filter(a => a.status === 'Active' && a.severity === 'Critical');
  const alertCount = activeAlerts.length;
  
  const data = {
    alertCount,
    events: 5 + Math.floor(Math.random() * 5)
  };
  
  Object.keys(data).forEach(mName => {
    db.addMetric('dynatrace', mName, data[mName]);
  });
  
  writeNasLog('INFO', 'DYNATRACE_SIMULATOR', `Dynatrace Telemetry Sync - Alerts: ${alertCount} | Events: ${data.events} eps`);
  
  return {
    status: alertCount > 0 ? 'Critical' : 'Healthy',
    metrics: data
  };
}

module.exports = {
  collectDynatraceAlerts
};
