const express = require('express');
const app = express();
const PORT = process.env.FIXTURE_PORT || 9099;

app.use(express.json());

// Failure mode toggles
const failures = {
  slow: false,
  unauthorized: false,
  samlRedirect: false,
  serverError: false
};

// Toggle endpoints
app.post('/mock/failure-mode', (req, res) => {
  const { mode, active } = req.body;
  if (failures.hasOwnProperty(mode)) {
    failures[mode] = !!active;
    return res.json({ success: true, mode, active: failures[mode] });
  }
  res.status(400).json({ error: `Unknown failure mode: ${mode}` });
});

// Middleware to inject failure modes if active or requested via query param / path
app.use((req, res, next) => {
  if (req.path.includes('/slow') || req.query.mode === 'slow' || failures.slow) {
    return setTimeout(next, 5000);
  }
  if (req.path.includes('/401') || req.query.mode === '401' || failures.unauthorized) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired API token.' });
  }
  if (req.path.includes('/302-idp') || req.query.mode === '302-idp' || failures.samlRedirect) {
    return res.redirect(302, 'https://idp.enterprise.corp/saml/login');
  }
  if (req.path.includes('/500') || req.query.mode === '500' || failures.serverError) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
  next();
});

// 1. Jenkins Mock
app.get(['/jenkins/api/json', '/job/api/json'], (req, res) => {
  res.json({
    _class: 'hudson.model.Hudson',
    nodeDescription: 'Jenkins Controller Cluster',
    executors: Array(8).fill({ currentExecutable: { url: 'https://jenkins/job/build-1' } }),
    queue: {
      items: Array(12).fill({ task: { name: 'core-pipeline' } })
    }
  });
});

// 2. SonarQube Mock
app.get(['/sonarqube/api/system/status', '/api/system/status'], (req, res) => {
  res.json({ status: 'UP', version: '10.2.1.78527' });
});

// 3. Artifactory Mock
app.get(['/artifactory/api/system/ping', '/api/system/ping'], (req, res) => {
  res.type('text/plain').send('OK');
});
app.get(['/artifactory/api/system/storage', '/api/system/storage'], (req, res) => {
  res.json({
    binariesSummary: {
      binariesCount: '154002',
      binariesSize: '4.8 TB'
    }
  });
});

// 4. AVI Load Balancer Mock
app.get(['/avi/api/v1/telemetry', '/api/v1/telemetry'], (req, res) => {
  res.json({
    metrics: {
      connections: 1337,
      throughput_mbps: 450.5,
      virtual_service_health_score: 99,
      total_pools: 14,
      total_pool_members: 52,
      pool_members_up: 52
    }
  });
});

// 5. Bitbucket Server Mock
app.get(['/bitbucket/rest/api/1.0/status', '/rest/api/1.0/status'], (req, res) => {
  res.json({ state: 'RUNNING' });
});

// 6. TeamCity Mock
app.get(['/teamcity/app/rest/agents', '/app/rest/agents'], (req, res) => {
  res.json({
    count: 100,
    agent: Array(100).fill({ id: 1, name: 'tc-agent', connected: true, authorized: true })
  });
});
app.get(['/teamcity/app/rest/buildQueue', '/app/rest/buildQueue'], (req, res) => {
  res.json({
    count: 5,
    build: Array(5).fill({ id: 1, state: 'queued' })
  });
});

// 7. NexusIQ Mock
app.get(['/nexusiq/api/v2/reports', '/api/v2/reports'], (req, res) => {
  res.json({
    reports: [
      { applicationId: 'app-01', evaluationDate: new Date().toISOString(), policyAlerts: 0 }
    ]
  });
});

// 8. Fortify SSC Mock
app.get(['/fortify/ssc/api/v1/projectVersions', '/ssc/api/v1/projectVersions'], (req, res) => {
  res.json({
    data: [
      { id: 101, currentState: { issuesCount: 14 } }
    ]
  });
});

// 9. Generic Health Probe for all other targets
app.get('*', (req, res) => {
  res.json({ status: 'UP', message: 'Fixture Upstream Mock Target', timestamp: new Date().toISOString() });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[FIXTURE UPSTREAM] Mock server running on port ${PORT}`);
  });
}

module.exports = app;
