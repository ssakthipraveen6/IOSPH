# 📈 Project Sentinel — External Grafana & Prometheus Export Specification
**Version**: 1.0.0  
**Target Platform**: Enterprise Central Telemetry (Grafana Cloud / Self-Hosted Prometheus)  
**Classification**: Internal / Operational

---

## 1. Overview
While Sentinel provides a self-hosted React portal, central NOCs frequently aggregate telemetry into unified Grafana dashboards. This specification details how to scrape Sentinel metrics and provides reference dashboard panels.

---

## 2. Prometheus Scrape Configuration

Add the following job to your Prometheus server `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'project-sentinel-core'
    scrape_interval: 15s
    scrape_timeout: 10s
    metrics_path: '/api/metrics/prometheus'
    scheme: 'https'
    bearer_token: '${SENTINEL_PROMETHEUS_TOKEN}'
    static_configs:
      - targets: ['sentinel-prod.internal.corp:3001']
        labels:
          environment: 'production'
          tier: 'observability-core'
```

---

## 3. Core Exported Metrics

| Metric Name | Type | Labels | Description |
|:---|:---|:---|:---|
| `sentinel_slo_sli_percentage` | Gauge | `slo_id`, `environment` | Current SLI compliance percentage |
| `sentinel_slo_error_budget_remaining` | Gauge | `slo_id`, `environment` | Remaining error budget percentage (0-100) |
| `sentinel_slo_burn_rate` | Gauge | `slo_id`, `window` | Current error budget burn rate multiple |
| `sentinel_anomaly_total` | Counter | `component`, `severity` | Total anomalies detected by $Z$-score engine |
| `sentinel_recovery_total` | Counter | `component`, `status` | Total automated recovery executions |
| `sentinel_circuit_breaker_state` | Gauge | `target` (0=CLOSED, 1=HALF-OPEN, 2=OPEN) | Jenkins Circuit Breaker status |

---

## 4. Grafana Alert Rules (Alertmanager)

```yaml
groups:
  - name: SentinelSloAlerts
    rules:
      - alert: SentinelSloBurnRateCritical
        expr: sentinel_slo_burn_rate > 5.0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Sentinel SLO {{ $labels.slo_id }} critical error budget burn"
          description: "Burn rate is {{ $value }}x baseline. 30-day budget will exhaust in < 24 hours."

      - alert: SentinelCircuitBreakerTripped
        expr: sentinel_circuit_breaker_state == 2
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Jenkins Automation Circuit Breaker is OPEN"
          description: "Downstream Jenkins runners failed 3 times. Automated remediation is paused."
```
