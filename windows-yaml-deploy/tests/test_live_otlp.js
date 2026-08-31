async function sendTestOtlp() {
  const payload = {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'host.name', value: { stringValue: 'bitbucket-node-1' } },
            { key: 'application.id', value: { stringValue: 'bitbucket' } }
          ]
        },
        scopeMetrics: [
          {
            scope: { name: 'otelcol' },
            metrics: [
              {
                name: 'system.cpu.utilization',
                gauge: { dataPoints: [{ asDouble: 0.315 }] }
              },
              {
                name: 'jvm.memory.heap.used',
                gauge: { dataPoints: [{ asInt: 1887436800 }] }
              }
            ]
          }
        ]
      }
    ]
  };

  const res = await fetch('http://localhost:3001/v1/metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log('LIVE OTLP INGESTION RESULT:', data);
}

sendTestOtlp().catch(console.error);
