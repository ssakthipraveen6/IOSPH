# 📚 Project Sentinel — REST & WebSocket API Reference
**Version**: 2.4.0 (Enterprise Hardened)  
**Standard**: OpenAPI 3.0 / W3C Trace Context  
**Classification**: Internal / Restricted (BFSI)

---

## 1. Authentication & Security

All REST endpoints under `/api` and `/v1` require authentication in production environments:

### Authentication Schemes
1. **Bearer Token (JWT)**:
   ```http
   Authorization: Bearer <jwt_token>
   ```
2. **Session Cookie**:
   ```http
   Cookie: sentinel_session=<jwt_token>
   ```
3. **CyberArk AppID / Service Header (for headless agents)**:
   ```http
   X-Sentinel-Agent-Token: <agent_token>
   ```

### Rate Limiting
- **Telemetry Ingest (`/v1/metrics`)**: Max 5,000 requests per minute per source IP.
- **Management & SRE Endpoints (`/api/*`)**: Max 300 requests per minute per user.

### W3C Distributed Tracing Headers
Requests can include standard W3C trace headers:
```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```
If omitted, Sentinel will generate a new W3C-compliant trace context and return it in the response header.

---

## 2. Telemetry Ingestion Endpoints

### `POST /v1/metrics`
Accepts standard OpenTelemetry OTLP/HTTP metric payloads (`ExportMetricsServiceRequest`).

* **Headers**: `Content-Type: application/json` or `application/x-protobuf`
* **Response `200 OK`**:
```json
{
  "status": "ACCEPTED",
  "datapoints_processed": 142
}
```

---

## 3. Observability & Health Endpoints

### `GET /api/healthz`
Lightweight health probe endpoint designed for AVI Load Balancer, RefWeb, and Kubernetes liveness probes.

* **Response `200 OK`**:
```json
{
  "status": "UP",
  "version": "2.4.0",
  "timestamp": "2026-10-06T00:15:00.000Z"
}
```

### `GET /api/health`
Detailed multi-tier health evaluation across infrastructure and applications.

* **Query Parameters**:
  - `env` (optional): `prod` | `staging` | `demo` (default: `prod`)
* **Response `200 OK`**:
```json
{
  "overall": "HEALTHY",
  "score": 98.4,
  "environment": "prod",
  "components": {
    "kubernetes": { "status": "UP", "latency_ms": 12 },
    "database": { "status": "UP", "pool_usage": 32.5 },
    "avi_load_balancer": { "status": "UP", "active_conns": 1240 }
  }
}
```

---

## 4. SRE & Anomaly Endpoints

### `GET /api/slo/status`
Returns current Service Level Indicators (SLIs), Error Budget consumption, and Burn Rates evaluated against `config/slos.yaml`.

* **Query Parameters**:
  - `env` (optional): Target environment (default: `staging`)
* **Response `200 OK`**:
```json
{
  "evaluated_at": "2026-10-06T00:15:00.000Z",
  "environment": "prod",
  "window_days": 30,
  "slos": [
    {
      "id": "sentinel_api_availability",
      "name": "Sentinel Framework API Availability",
      "target_percentage": 99.9,
      "current_sli": 99.95,
      "error_budget_remaining_percent": 92.5,
      "burn_rate": 0.1,
      "status": "HEALTHY"
    },
    {
      "id": "alert_detection_latency",
      "name": "Alert Detection Latency",
      "target_percentage": 95.0,
      "current_sli": 98.4,
      "error_budget_remaining_percent": 85.0,
      "burn_rate": 0.4,
      "status": "HEALTHY"
    },
    {
      "id": "autonomous_recovery_success_rate",
      "name": "Autonomous Remediation Success Rate",
      "target_percentage": 95.0,
      "current_sli": 96.2,
      "error_budget_remaining_percent": 68.0,
      "burn_rate": 0.8,
      "status": "HEALTHY"
    }
  ]
}
```

### `GET /api/anomalies`
Returns recent statistical anomalies detected by the $Z$-Score model ($|Z| \ge 3.0\sigma$).

* **Query Parameters**:
  - `env`: `prod` | `staging`
  - `limit`: number of results (max 200, default: 50)
* **Response `200 OK`**:
```json
{
  "success": true,
  "anomalies": [
    {
      "decision_id": "DEC-9f8e-4a1b",
      "timestamp": "2026-10-06T00:12:00.000Z",
      "component": "artifactory",
      "metric_name": "jvm_heap_usage",
      "value": 94.2,
      "mean": 48.1,
      "stddev": 9.5,
      "z_score": 4.85,
      "threshold": 3.0,
      "decision": "ANOMALY_DETECTED",
      "environment": "prod"
    }
  ]
}
```

---

## 5. Operations & Remediation Endpoints

### `GET /api/itsm/tickets`
Retrieves auto-dispatched ServiceNow incident records synced from recovery executions.

* **Response `200 OK`**:
```json
{
  "success": true,
  "tickets": [
    {
      "incident_id": "INC-839210",
      "recovery_id": "REC-839210",
      "component": "nas_performance",
      "title": "[SENTINEL AUTO-REMEDIATION] Purge temp workspaces on NAS",
      "state": "Resolved",
      "priority": "1 - High",
      "assigned_to": "sre-oncall-primary",
      "created_at": "2026-10-06T00:05:00.000Z",
      "resolution_notes": "Autonomous self-healing completed successfully in 4 seconds.",
      "deep_link": "https://servicenow.corp.internal/nav_to.do?uri=incident.do?sys_id=INC-839210"
    }
  ]
}
```

### `GET /api/circuit-breaker/status`
Returns live state of the Jenkins automation circuit breaker.

* **Response `200 OK`**:
```json
{
  "state": "CLOSED",
  "consecutiveFailures": 0,
  "maxFailures": 3,
  "cooldownMs": 1800000,
  "lastTripped": null
}
```

### `POST /api/circuit-breaker/reset`
Resets the Jenkins circuit breaker back to `CLOSED`. Requires `Super Admin` or `SRE Lead` role.

* **Headers**: `Authorization: Bearer <token>`
* **Response `200 OK`**:
```json
{
  "success": true,
  "message": "Circuit breaker reset to CLOSED state."
}
```

### `POST /api/recovery/approve`
Approves a pending autonomous remediation workflow enforcing Segregation of Duties (Four-Eyes dual approval).

* **Body**:
```json
{
  "runId": "REC-91823"
}
```
* **Response `200 OK`**:
```json
{
  "success": true
}
```
* **Response `403 Forbidden` (SOD Violation)**:
```json
{
  "success": false,
  "error": "SOD Violation: Initiator cannot approve their own recovery action",
  "code": "ERR_SOD_SELF_APPROVAL"
}
```

---

## 6. Tracing & Audit Endpoints

### `GET /api/traces/:traceId`
Retrieves end-to-end span timeline for an alert, RCA, or recovery execution.

* **Response `200 OK`**:
```json
{
  "trace_id": "00-4bf92f3577b34da6a3ce929d0e0e4736",
  "environment": "prod",
  "spans": [
    { "span_id": "span-01", "name": "metric_spike_ingest", "duration_ms": 24, "status": "OK" },
    { "span_id": "span-02", "name": "zscore_anomaly_eval", "duration_ms": 12, "status": "OK" },
    { "span_id": "span-03", "name": "rca_correlation", "duration_ms": 45, "status": "OK" },
    { "span_id": "span-04", "name": "remediation_dispatch", "duration_ms": 110, "status": "OK" },
    { "span_id": "span-05", "name": "servicenow_incident_sync", "duration_ms": 85, "status": "OK" }
  ]
}
```

---

## 7. WebSocket Streaming API

Connect to `/ws` with an optional session cookie or JWT bearer token.

### Connection Handshake
```
ws://localhost:3001/ws?environment=prod
```

### Client Messages (Subscriptions)
```json
{
  "type": "subscribe",
  "environment": "prod",
  "view": "overview"
}
```

### Server Push Payloads
```json
{
  "type": "state",
  "data": {
    "health": { ... },
    "alerts": [ ... ],
    "recovery": [ ... ],
    "customChecks": [ ... ]
  }
}
```
The server sends a ping frame every 30 seconds to keep proxy tunnels alive through RefWeb and enterprise firewalls.
