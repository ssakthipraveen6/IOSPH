/**
 * Validation tool: sends a sample OTLP metric payload to Sentinel.
 */
const http = require('http');

// Builds the OTLP payload.
function buildOtlpPayload({
  serviceName = 'cloudbees_jenkins',
  hostName = 'build-agent-win-01.corp',
  environment = 'staging',
  metrics = [
    { name: 'system.cpu.utilization', value: 34.5 },
    { name: 'system.memory.utilization', value: 68.2 },
    { name: 'system.disk.io', value: 412 }
  ]
} = {}) {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
            { key: 'host.name', value: { stringValue: hostName } },
            { key: 'environment', value: { stringValue: environment } }
          ]
        },
        scopeMetrics: [
          {
            metrics: metrics.map(m => ({
              name: m.name,
              gauge: {
                dataPoints: [
                  {
                    timeUnixNano: String(Date.now() * 1000000),
                    asDouble: m.value
                  }
                ]
              }
            }))
          }
        ]
      }
    ]
  };
}

// Posts the payload.
function pushMetrics({
  targetUrl = 'http://localhost:3001/v1/metrics',
  payload = null,
  options = {}
} = {}) {
  const data = JSON.stringify(payload || buildOtlpPayload(options));
  const url = new URL(targetUrl);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 3001,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
        } catch (_) {
          resolve({ statusCode: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

if (require.main === module) {
  const host = process.argv[2] || 'test-host-01.corp';
  const env = process.argv[3] || 'staging';
  console.log(`[FIXTURE OTLP AGENT] Pushing metric payload for host: ${host} (${env})...`);
  pushMetrics({ options: { hostName: host, environment: env } })
    .then(res => console.log(`[FIXTURE OTLP AGENT] Response (${res.statusCode}):`, res.data))
    .catch(err => console.error(`[FIXTURE OTLP AGENT] Failed:`, err.message));
}

module.exports = {
  buildOtlpPayload,
  pushMetrics
};
