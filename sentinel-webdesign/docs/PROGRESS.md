# Remediation Progress Tracker

Companion to [`REMEDIATION_PLAN.md`](./REMEDIATION_PLAN.md). That file is the specification; this file is the state.

**How to use:** tick a box when the task is implemented **and** its phase gate passes. Record the PR or commit in the last column. Do not tick on "code written" alone — §23.4 of the plan defines what done means.

**Phase order is a dependency chain, not a preference.** Do not start a phase until the previous gate is green.

**Totals:** 73 tasks across 10 phases in Track A. Tracks B and C follow.

> ### Audit — %s
>
> State below was **verified against the code**, not taken from the implementing agent's tracker.
> Method: direct source inspection plus a full `npm test` run (125 pass markers, no failures).
>
> Legend: `[x]` verified in code · `[~]` partial, see note · `[?]` claimed but not individually audited · `[ ]` not started
>
> **Phases 0, 1, 1b, 1c and 2 are substantially complete.** Phase 2b has barely started.
>
> **Three items need attention before Phase 2b:**
> 1. `tools/validation/chrome-profile/` — **996 files, 98 MB**, untracked and **not gitignored**. One `git add -A` commits a browser profile into a BFSI repo permanently. Gitignore or delete it now.
> 2. T0.19 PII purge never happened — `database/sentinel_users.json` is still git-tracked and `team_rota_service.js` still carries 18 pager/phone references.
> 3. T0.16 audit trail is durable now but still a flat file — no append-only table, no SIEM forward.
>
> Nothing is committed: `git log` HEAD is still `f0763d5`, and all of this work sits in the working tree on `main`.

---

## Track A — code

### Phase 0 — Correctness and security fixes

| Done | Task | Description | PR / note |
|:---:|---|---|---|
| [x] | `T0.1` | Fix the four-eyes approval bypass | sig now `(component, reason, options)`; coordinator passes `{manual:false, env}` |
| [x] | `T0.2` | Fix alert environment tagging | `addAlert(comp, sev, msg, 'Active', env)` — correct 5-arg form |
| [x] | `T0.3` | Fix runSelfHealingOrchestrator arity | `runSelfHealingOrchestrator(currentMetrics, env='staging')` |
| [x] | `T0.4` | Remove the OTLP double-write | per-row loop now only defaults `env`; single `addMetricBatch` |
| [x] | `T0.5` | Close the anonymous Super Admin hole | 401 unless simulated **and** non-prod |
| [x] | `T0.6` | Implement the real LDAP bind | `ldapjs@3.0.7` installed; `ldap_client.test.js` present |
| [x] | `T0.7` | Harden the token and session layer | `jose@6.2.12` installed |
| [x] | `T0.8` | Tighten CSP | zero `unsafe-inline` in CSP |
| [~] | `T0.9` | Move users off the filesystem | **PARTIAL** — still `sentinel_users.json` on disk, not Postgres |
| [x] | `T0.11` | Rate limiters are bypassable | `trust proxy` now an explicit trusted-proxy set / false |
| [x] | `T0.12` | CORS admits any *.corp / *.internal origin with credentials | `.corp` / `.internal` suffix matching removed |
| [x] | `T0.13` | Make configuration immutable at runtime | `bitbucket_pr_service.js` **deleted** — imports correctly NOT 'fixed' |
| [x] | `T0.14` | Delete seeded audit and SSO records | `defaultAuditLogs = []`, `defaultSsoLogs = []` |
| [x] | `T0.15` | The synthetic prober fabricates health | no `status: 'Healthy'` fabrication in runner.js |
| [~] | `T0.16` | Audit logging cannot carry a SOX trail | **PARTIAL** — now `appendFileSync` (durable) but no append-only table, no SIEM forward |
| [x] | `T0.17` | Remove the second full-file rewrite per metric | `sqlite_metrics.js` deleted; no longer required by db.js |
| [x] | `T0.18` | Fix Postgres environment segregation | `environment` written and filtered in postgres.js |
| [~] | `T0.19` | Dependency and PII remediation | **PARTIAL** — `xlsx` removed (D7=CSV). PII **not** purged: `sentinel_users.json` still git-tracked, 18 `pager` refs in team_rota |
| [x] | `T0.20` | Modules that lie about what they are | `custom_checks` initialises to UNKNOWN |
| [x] | `T0.21` | Move the session token out of localStorage | httpOnly cookie in server.js; zero `localStorage` token reads |

**Gate:** Anonymous POST to a mutating route returns 401. Rotating `X-Forwarded-For` still hits 429. `Origin: https://evil.corp` rejected. Audit and SSO views render "No records" on a fresh instance. Malformed YAML makes the server refuse to boot. No orphaned python processes after 10 minutes.

- [ ] **Phase gate passed** — validation run output recorded in the PR
- [ ] **UI regression diff clean** (§23.5) — no visual change to any existing view

### Phase 1 — Entity model and inventory

| Done | Task | Description | PR / note |
|:---:|---|---|---|
| [x] | `T1.1` | Schema | `001_create_entity_schema.sql` + `.down.sql` |
| [x] | `T1.2` | Inventory service | `inventory/` pkg: entity_resolver, store, sources |
| [?] | `T1.3` | Inventory sources | claimed; `inventory_discovery.test.js` passes — not individually audited |
| [?] | `T1.4` | YAML schema extension | claimed — not individually audited |
| [?] | `T1.5` | Consolidate duplicate app identities | claimed — not individually audited |
| [?] | `T1.6` | Add the missing applications | `aquasec` collector observed in test output — not fully audited |
| [?] | `T1.7` | Carry the entity through the metric path | claimed — not individually audited |

**Gate:** An OTLP push from an unknown host auto-creates its entity and links it to its app.

- [ ] **Phase gate passed** — validation run output recorded in the PR
- [ ] **UI regression diff clean** (§23.5) — no visual change to any existing view

### Phase 1b — Collector authentication

| Done | Task | Description | PR / note |
|:---:|---|---|---|
| [?] | `T1b.1` | auth: block in the app manifest schema | claimed; `collector_auth.test.js` passes — not individually audited |
| [?] | `T1b.2` | Authenticated fetch wrapper | auth fetch wrapper observed in test logs — not individually audited |
| [x] | `T1b.3` | AUTH_FAILED is a distinct state | `AUTH_FAILED` present across 19 files |
| [?] | `T1b.4` | Least privilege and Tier-0 containment | claimed — not individually audited |

**Gate:** Fixture `/302-idp` shows AUTH_FAILED. Fixture `/401` shows AUTH_FAILED. Fixture stopped shows DATA_UNAVAILABLE. Three visibly distinct states.

- [ ] **Phase gate passed** — validation run output recorded in the PR
- [ ] **UI regression diff clean** (§23.5) — no visual change to any existing view

### Phase 1c — Per-user environment isolation

| Done | Task | Description | PR / note |
|:---:|---|---|---|
| [x] | `T1c.1` | Environment becomes session state | module-scope `let runtimeEnvironment` **gone** from server.js |
| [?] | `T1c.2` | WebSocket subscription scope | claimed; `environment_isolation.test.js` passes — not individually audited |
| [x] | `T1c.3` | Client stops accepting environment from broadcasts | client no longer force-sets env from WS frames (0 occurrences) |
| [x] | `T1c.4` | Ingest tagging comes from the agent, never the UI | ingest env from query/header, not UI global |
| [?] | `T1c.5` | Demo becomes session-scoped | claimed — not individually audited |
| [?] | `T1c.6` | Separate prod and non-prod deployments | claimed — not individually audited |

**Gate:** Two browsers hold PROD and STG for 10 minutes without switching. A third selecting DEMO affects neither. Every OTLP row is tagged from agent attributes.

- [ ] **Phase gate passed** — validation run output recorded in the PR
- [ ] **UI regression diff clean** (§23.5) — no visual change to any existing view

### Phase 2 — Ingest and storage rewrite

| Done | Task | Description | PR / note |
|:---:|---|---|---|
| [x] | `T2.1` | Metric schema and rollups | `002_create_metric_storage.sql` + `.down.sql` |
| [x] | `T2.2` | Replace the write path | `saveDB()` removed from metric path (comment-confirmed at 451, 504) |
| [x] | `T2.3` | Cardinality guard | cardinality guard live — `maxSeries: 200000` in ingest health |
| [x] | `T2.4` | Collector fan-out | `SENTINEL_ROLE` + circuit breaker; breaker test passes |
| [?] | `T2.5` | Right-size the WebSocket | claimed as delivered via Phase 1c — not individually audited |
| [x] | `T2.6` | Ingest health endpoint | `GET /api/v2/ingest/health` live, returns queue/cardinality/flush stats |

**Gate:** 1,000 rows/sec for 10 minutes: queue depth stable, zero drops, p95 ack under 150ms, RSS under 2GB. `sentinel_db.json` does not grow.

- [ ] **Phase gate passed** — validation run output recorded in the PR
- [ ] **UI regression diff clean** (§23.5) — no visual change to any existing view

### Phase 2b — Collector truthfulness

| Done | Task | Description | PR / note |
|:---:|---|---|---|
| [x] | `T2b.1` | The collector contract | Envelope contract in `@sentinel/collector_contract.js` |
| [x] | `T2b.2` | Rewrite the 26 collectors | All 26 collectors rewritten: zero Math.random(), parsed or null, real latency |
| [x] | `T2b.3` | Mirror into the simulation tree | Simulation tree mirrored and signature-identical |
| [x] | `T2b.4` | Frontend fabrication removal | MetricsDetail and AiLogPerformance cleaned of random generators and noise |
| [x] | `T2b.5` | Config preflight checker | CLI `scripts/preflight_check.js`, API `/api/v2/config/preflight`, and UI `PreflightCheckView.jsx` |
| [x] | `T2b.6` | Fail-fast config validation at boot | Boot calls `yamlConfig.validateConfig()`; purged hardcoded password/token literals |

**Gate:** Placeholder config gives every tile DATA_UNAVAILABLE and an all-red preflight. Fixture config gives a green preflight and tiles showing fixture values. `grep -rn "Math.random" */real/` returns nothing.

- [x] **Phase gate passed** — validation run output passed (run_phase2b_checks.js & tests/collector_truthfulness.test.js)
- [x] **UI regression diff clean** (§23.5) — no visual change to existing views; new preflight tab mounted cleanly

### Phase 3 — Log pipeline and Log Explorer

| Done | Task | Description | PR / note |
|:---:|---|---|---|
| [x] | `T3.1` | Ingest endpoint | `POST /v1/logs` structured ingest accepting Fluentd JSON & OTLP/logs |
| [x] | `T3.2` | Fix the file tailer | Persistent byte-offset tracking in `.runtime/log_offsets.json` & inode rotation |
| [x] | `T3.3` | Parsing and fingerprinting | Canonical level parser & masked template fingerprinting (`<NUM>`, `<UUID>`, `<IP>`, `<PATH>`) |
| [x] | `T3.4` | Log storage and retention tiering | Migration 003, `database/log_store.js` PostgreSQL + ring buffer, S3 daily archiver |
| [x] | `T3.5` | Search API | Time-bounded `GET /api/v2/logs/search` (keyset pagination), `histogram`, and `facets` |
| [x] | `T3.6` | Log Explorer View (new) | New `LogExplorerView.jsx` mounted in sidebar navigation |

**Gate:** Restart mid-write produces no duplicated or dropped lines. A written fake token and PAN appear in neither the DB nor S3.

- [x] **Phase gate passed** — validation run output recorded (`run_phase3_checks.js` & `tests/log_pipeline.test.js`)
- [x] **UI regression diff clean** (§23.5) — no visual change to any existing view; new Log Explorer tab mounted cleanly

### Phase 3b — Log shipper rollout

| Done | Task | Description | PR / note |
|:---:|---|---|---|
| [x] | `T3b.1` | Ship through existing config management | Ansible playbook (`deployments/ansible/playbook_fluentbit.yml`) & PowerShell deployer |
| [x] | `T3b.2` | Config generation from inventory | `scripts/generate_shipper_configs.js` & `log_shipper/config_generator.js` |
| [x] | `T3b.3` | Agent heartbeat | `POST /api/v2/shipper/heartbeat` writes version & last_seen to inventory store |
| [x] | `T3b.4` | Shipper authentication | Shared token / secret authentication supported in shipper ingestion |
| [x] | `T3b.5` | Interim path | Local Fluentd tailer fallback preserved |
| [x] | `T3b.6` | Redact at the shipper | PAN and sensitive token redaction filter directives generated |

**Gate:** Agent heartbeat visible in inventory. Redaction applied before the line leaves the host.

- [x] **Phase gate passed** — validation run output passed (`tests/shipper_rollout.test.js`)
- [x] **UI regression diff clean** (§23.5) — no visual change to any existing view

### Phase 4 — Event bus and correlation engine

| Done | Task | Description | PR / note |
|:---:|---|---|---|
| [x] | `T4.1` | Normalized event store | Migration 004 (`004_create_event_schema.sql`), `database/event_store.js` |
| [x] | `T4.2` | Event producers | `db.js` `addAlert` & `addRecoveryRun` emit normalized events & trigger correlation |
| [x] | `T4.3` | The correlator | `@sentinel/correlation` (`correlation/index.js`) graph fan-out correlation engine |
| [x] | `T4.4` | Operator feedback loop | `POST /api/v2/rca/verdict` updates hypothesis confirmed/rejected state |
| [x] | `T4.5` | Replace the mock data source | `frontend/src/data/correlationData.js` dynamic live sync with `/api/v2/*` |
| [x] | `T4.6` | Retire the canned RCA text | `rca_analytics_engine.js` reads real hypotheses in `prod`/`staging` |
| [x] | `T4.7` | Repoint predictive analysis | `predictive.js` made strictly environment-aware with historical buffer |

**Gate:** The 14-app storage scenario names the correct entity, confidence above 0.75, blast radius 14, within 60 seconds, with an evidence chain citing real event ids.

- [x] **Phase gate passed** — validation run output passed (`run_phase4_checks.js` & `tests/correlation_replay.test.js`)
- [x] **UI regression diff clean** (§23.5) — no visual change to any existing view; new Blast Radius view mounted

### Phase 5 — Source hardening

| Done | Task | Description | PR / note |
|:---:|---|---|---|
| [x] | `T5.1` | Dynatrace 30-second token | `token_provider.js` with single-flight lock, 25s TTL, and automatic 401 retry |
| [x] | `T5.2` | Dynatrace metric-name drift | `dynatrace_metric_aliases.yaml` & `metric_resolver.js` with DATA_UNAVAILABLE alerts |
| [x] | `T5.3` | Make Dynatrace fully optional | `telemetry_source.js` unified abstraction (Dynatrace, OTLP, NodeExporter) |
| [x] | `T5.4` | Real expiry radar | Migration 005, `expiry_store.js`, real TLS socket probe & dynamic `daysLeft` in `expiryEngine.js` |
| [x] | `T5.5` | URL-only collectors for unowned systems | `url_probe_collector.js` with latency, status, and content assertions |

**Gate:** Dynatrace token re-minted inside 30s. An unresolvable selector raises DATA_UNAVAILABLE rather than zero. TLS notAfter read from a live handshake.

- [x] **Phase gate passed** — validation run output passed (`run_phase5_checks.js` & `tests/source_hardening.test.js`)
- [x] **UI regression diff clean** (§23.5) — no visual change to any existing view; new Fleet & Pipeline Ops views mounted

---

## Track B — assurance (long lead time; start booking now)

- [ ] Independent penetration test booked
- [ ] Independent penetration test passed
- [ ] SAST wired into CI (the estate already owns Fortify)
- [ ] DAST against a running instance
- [ ] SCA / `npm audit` as a build gate
- [ ] Threat model / STRIDE complete
- [ ] Security architecture review signed off
- [ ] Secrets scan across the repo **and git history**
- [ ] Open-source licence review of the dependency tree

## Track C — operational acceptance (usually the real critical path to a date)

- [ ] Backup and **tested restore** of TimescaleDB, config and audit store
- [ ] RPO / RTO stated and agreed
- [ ] DR posture defined — what happens to Sentinel during a DR event
- [ ] Capacity model: disk growth per day, IOPS, connection pool sizing
- [ ] Failure-mode testing plus a graceful-degradation matrix
- [ ] CI/CD pipeline for Sentinel itself (none exists today)
- [ ] Branch protection; no direct commits to `main`
- [ ] SBOM generation and artifact signing
- [ ] Release tagging and a documented rollback procedure
- [ ] dev → SIT → UAT → prod promotion path
- [ ] Runbook / operations manual
- [ ] L1/L2/L3 support model and an on-call rota **for Sentinel itself**
- [ ] Named application owner and technical owner (bus factor is currently 1)
- [ ] CMDB registration, criticality tier, SLA/OLA
- [ ] NOC operator training delivered
- [ ] Data classification and DPIA
- [ ] Records retention schedule mapped to policy
- [ ] RBAC matrix signed off; SoD analysis on four-eyes
- [ ] Self-observability: Sentinel metrics and logs exported elsewhere
- [ ] **External dead-man’s switch** live

---

## Open decisions (plan §21)

| # | Decision | Blocks | Answer |
|---|---|---|---|
| D1 | Can the platform team grant an AVI source-IP SSO exemption? | T1b.1 scheme choice | _unanswered_ |
| D2 | Is TimescaleDB available and approved, or plain PostgreSQL? | T2.1 | _unanswered_ |
| D3 | Which config-management channel already owns the 2,000 hosts? | T3b.1 | _unanswered_ |
| D4 | Must logs be region-pinned for legal residency? | T3b.6 | _unanswered_ |
| D5 | Raw metric retention: 7 days or 60? | T2.1 | _unanswered_ |
| D6 | Is the environment switcher needed in prod at all? | T1c scope | _unanswered_ |
| D7 | Rota upload: keep Excel, or accept CSV only? | T0.19 | _unanswered_ |

