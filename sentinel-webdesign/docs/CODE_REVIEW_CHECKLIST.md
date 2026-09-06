# Project Sentinel — Code Review & Quality Checklist

## 1. Severity & Status Consistency (BFSI Standard)
- [ ] **No Inline Severity Literals**: Never hardcode `'Critical'`, `'Warning'`, `'Healthy'`, or `'DATA_UNAVAILABLE'` in string comparisons or object keys.
- [ ] **Import `@sentinel/shared-constants`**: Always import and use `{ SEVERITY, SEVERITY_COLORS, SEVERITY_WEIGHTS, INCIDENT_PRIORITY, normalizeSeverity, getStatusColor }`.
- [ ] **Automated Verification**: Run `npm run lint:constants` before creating or merging pull requests.

## 2. Telemetry & Collector Hygiene
- [ ] **Single Canonical Location**: All collector implementations must reside exclusively in `apps/collector/src/metrics_collection/`.
- [ ] **Symmetric Modes**: Every collector must have a paired `real/` (live network/API scrape with CyberArk / env tokens) and `simulation/` (deterministic seed) variant.
- [ ] **Fail-Open Graceful Degradation**: Real collectors must return `value: "Data Not Available"` or null on network timeout, never throw unhandled exceptions or crash the Node process.

## 3. Data Integrity & Persistence
- [ ] **Audit Logs**: All administrative actions and incident state changes must write exclusively to `apps/api/logs/sentinel_audit.log` via `@sentinel/logger`.
- [ ] **Database Reliability**: Postgres writes must use `executeWithRetry()` (3 attempts with exponential backoff) and never silent `.catch(() => {})`.
- [ ] **Degradation Transparency**: Database outages must surface `persistenceState.degraded = true` on the `/api/health` probe.

## 4. Multi-Tenant Segregation
- [ ] **Environment Isolation**: Always pass `targetEnv` (`prod`, `staging`, `demo`) explicitly into DB lookups, metric scrapers, and AI correlation flows.
- [ ] **Never Cross-Contaminate**: Production telemetry must never display simulated non-prod outages, and staging test injections must never alter production health scoring.
