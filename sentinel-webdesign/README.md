# SENTINEL

A monitoring and root-cause portal for an on-premises DevSecOps toolchain (CloudBees Jenkins, TeamCity, Bitbucket, Artifactory, Argo CD, SonarQube, Fortify and the rest). It collects telemetry from hosts, Kubernetes, load balancers, storage and the tools themselves, keeps it in its own stores, and points an operator at the layer that is failing. It does not depend on Dynatrace; Dynatrace is read when available.

Node.js / Express backend, React single-page front end, hosted on Windows Server behind an AVI virtual service and IIS.

**Rule that runs through the whole product:** nothing is invented. A source with no data shows "Data not available" or "unknown"; a refused credential shows AUTH_FAILED. Only the Demo area shows sample data, and it is labelled.

The plan to go live is [`docs/PRODUCTION_READINESS_PLAN.md`](./docs/PRODUCTION_READINESS_PLAN.md); the Jira import is [`docs/jira_production_readiness.csv`](./docs/jira_production_readiness.csv). Every folder and file is summarised in [`docs/CODEBASE_MAP.md`](./docs/CODEBASE_MAP.md).

## Architecture

```
 Managed hosts (~2,000)                                  Other teams' systems (read-only)
 ┌──────────────────────────────────────────┐            ┌──────────────────────────────────────┐
 │ Linux / Windows / Kubernetes nodes       │            │ Dynatrace API v2 (optional)          │
 │  OTel collector · sentinel-probe · osquery            │ AVI controllers · NAS / Trident / S3 │
 └───────┬───────────────────────┬──────────┘            │ Jenkins / Bitbucket / Artifactory ... │
         │ OTLP (Bearer token)   │ heartbeat, config      └───────────────────┬──────────────────┘
         ▼                       │ (X-Sentinel-Api-Key)                       │ pull, tokens from CyberArk
 ┌───────────────┐               │                                            │
 │ OTel gateway  │               │                                            │
 └───────┬───────┘               │                                            │
         ▼                       ▼                                            ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────────┐
 │ SENTINEL  (Windows Server · IIS · AVI VIP · two nodes, one leader)                           │
 │                                                                                              │
 │  Ingest API ──► Normaliser ──► Metric store ◄── Collectors (per-app, per-infra)              │
 │  /v1/metrics    (OTLP→Sentinel)   │                 ▲                                        │
 │  /api/v2/shipper/heartbeat        ▼                 │ Source arbiter (Dynatrace › OTel › probe) │
 │                            Inventory graph ──► Detection & alerts ──► Correlation / RCA      │
 │                            (hosts, apps, pods,    (rules, SLOs,        (topology + changes)  │
 │                             PVC→PV→NFS, AVI pools) forecasts)               │                │
 │                                   ▲                                         ▼                │
 │  Background jobs (leader only) ───┘          Remediation (four-eyes) · Evidence packs        │
 │  expiry · VIP probes · fleet health · log archive                                            │
 │                                                                                              │
 │  REST + WebSocket API  ──►  React single-page app (frontend/dist)                            │
 └───────────────┬─────────────────────────┬───────────────────────────┬───────────────────────┘
                 ▼                         ▼                           ▼
        PostgreSQL / Timescale     ClickHouse (optional)         S3 bucket
        state, alerts, audit,      metrics, logs, events         archived logs
        users, ingest keys         (13-month history)
```

Two ways data arrives: **push** (agents → gateway or ingest API) and **pull** (collectors read each tool's own API with a read-only token). The environment (prod or staging) is decided by the ingest key or the selected environment, never by the payload.

## What each part does

| Area (sidebar) | What it gives you |
|---|---|
| **Scorecard** | Weekly product scorecards: availability, p95, change points, open CVEs, top cause |
| **Problems** | Related alerts grouped into one incident with the layer most likely at fault |
| **Alerts** | Alert rules lifecycle: acknowledge, snooze, resolve; environment-tagged |
| **SLOs** | Journey objectives, error budget and burn rate; unknown values shown as a dash |
| **Evidence Packs** | Automatic evidence reports for an incident, ServiceNow-ready |
| **Remediation** | Playbooks with four-eyes approval and run history |
| **On-Call** | Shift schedule and escalation rota |
| **Applications** | End-to-end map per application: users → DNS → AVI VIP → SSO → servers → storage → database |
| **Products** | Toolchain products and their golden journeys (synthetic checks) |
| **Hosts / Linux / Windows** | Agent health, drift, CPU, memory and worst filesystem per host, from what agents actually send |
| **Health Checks** | Synthetic endpoint availability |
| **Certificates & Licences** | TLS, SAML and licence expiry with days left |
| **Capacity & Runway** | Saturation and linear runway forecasts |
| **Storage, AVI, Databases, Kubernetes** | NAS shares and S3, VIP probes and pools, Oracle / SQL Server / PostgreSQL instances, clusters, nodes and pods |
| **Logs** | Structured logs with keyset pagination |
| **Topology, Traces, Dashboards** | Multi-layer graph and blast radius, W3C trace waterfall, metric explorer |
| **Console** | Estate overview of all 17 applications, a detail page for each, Jenkins controllers, compliance and lifecycle; Geo replication, Dependencies and SLO reports say "Data not available" until their collectors exist |
| **Access, Audit, Agents, Platform Health, Configuration, Change Windows, Security** | Roles and environment entitlements, tamper-evident audit trail, agent fleet and config drift, ingest pipeline health, YAML viewer with secret masking, approved change windows, CVE and end-of-life findings |
| **Demo** | 18 tabs of clearly labelled sample data for presentations. `npm run demo:inject` additionally sends simulated agents into staging so the real screens fill |

## Repository layout

```
backend/            Express server (backend/server.js), auth, routes, background jobs, YAML config loader
frontend/           React 19 + Vite app (built to frontend/dist)
config/             global.yaml, apps/*.yaml (one manifest per tool), infra/*.yaml, cyberark.yaml, slos, alerts
metrics_collection/ Collectors (real/) and the coordinator
logs_collection/    Log shipping, parsing, S3 archiving
inventory/          Entity graph (apps, hosts, pods, PVC → PV → NFS, AVI pools)
correlation/        Root-cause engine
synthetics/         Synthetic probes and journeys
remediation/        Four-eyes recovery runbooks
database/           PostgreSQL / Timescale and ClickHouse access, migrations
agent/              Collection agent: OTel build, osquery packs, probe, packaging (RPM, DEB, MSI, systemd)
deployments/        Ansible roles and playbooks, Helm chart, plain Kubernetes manifests, PowerShell
scripts/            Bootstrap, lint, migration, ingest keys, readiness check, demo simulator
tests/              Plain Node test files (88)
```

## Run it

```
npm install          # installs workspaces and links the @sentinel/* packages
npm run bootstrap    # creates .env and prepares .runtime/
npm run build        # builds the front end and records the build fingerprint
npm start            # http://localhost:3001 (PORT overrides)
```

`npm run dev` runs the back end and Vite with hot reload. Database setup: `npm run migrate`, `npm run clickhouse:migrate`.
Node.js 24. Windows Server for hosting; development works anywhere.

## Useful commands

| Command | Purpose |
|---|---|
| `npm test` | Whole test suite in a throwaway runtime folder (the browser smoke test needs Chromium) |
| `npm run lint` | Severity constants, no random numbers, no sample data, no demo leaks, no orphan components |
| `npm run config:check` | Validates every YAML file |
| `npm run readiness` | Lists what is still missing before production (settings only, sends nothing) |
| `npm run preflight` | Probes every configured endpoint: reachable, auth failed, unreachable |
| `npm run ingest-key -- create <name> <prod\|staging> --scopes agent,heartbeat,metrics` | Creates an ingest key (shown once) |
| `npm run demo:inject -- --url <staging url> --key <key>` | Simulated agents and a scripted incident for demonstrations |
| `npm run verify:dist` | Confirms `frontend/dist` matches the sources |

## Configuration in one paragraph

`config/global.yaml` ships safe (`environment: staging`, URLs blank or placeholder). Each tool has a manifest in `config/apps/` (endpoints per environment, hosts, shares, certificates, credentials by purpose; the column reference is `config/README.md`). Secrets never live in YAML: they come from CyberArk, with `<APPID>_<PURPOSE>` environment variables as the fallback. Production settings and the full go-live steps are in the readiness plan above.
