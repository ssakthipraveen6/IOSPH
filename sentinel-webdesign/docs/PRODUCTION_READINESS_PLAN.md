# Sentinel production readiness plan

What must change before Sentinel serves production, in order, with the file and line to edit and a sample value.
Line numbers are for the repository as shipped; if a file has moved on, search for the quoted key.
Every task has an ID (PR-nn) that matches the Jira import file `docs/jira_production_readiness.csv`.

**Reading the priority column.** Blocker = production cannot start or is unsafe without it. High = needed before the full fleet. Medium/Low = improves coverage or removes a known gap.

## Order of work

1. E1 to E3 are configuration and can start the same day. Do E2 PR-09 and E1 PR-01 first; they close the sign-in and read gates.
2. E4 and E5 need infrastructure (database, IIS, AVI) and take the longest to arrange. Ask for them early.
3. E6 follows once the ingest keys (PR-05) and the gateway (PR-30) exist. Start with a pilot group.
4. E7 is the evidence that the work is done. E8 is code work that can run in parallel.

## Checklist

| ID | Priority | Epic | Task | Done |
|---|---|---|---|---|
| PR-01 | Blocker | E1 Environment and process settings | Run the service with NODE_ENV=production | [ ] |
| PR-02 | Blocker | E1 Environment and process settings | Set SENTINEL_JWT_SECRET (identical on both servers) | [ ] |
| PR-03 | Blocker | E1 Environment and process settings | Set ALLOWED_ORIGIN to the real Sentinel URL | [ ] |
| PR-04 | High | E1 Environment and process settings | Set environment: production on the production host | [ ] |
| PR-05 | Blocker | E1 Environment and process settings | Create one ingest key per environment | [ ] |
| PR-06 | Blocker | E2 Sign-in and access | Point sign-in at the real LDAP / eLDAP | [ ] |
| PR-07 | Blocker | E2 Sign-in and access | Provide the LDAP bind password through CyberArk | [ ] |
| PR-08 | High | E2 Sign-in and access | Map directory groups to Sentinel roles | [ ] |
| PR-09 | Blocker | E2 Sign-in and access | Make sure simulated login is off in production | [ ] |
| PR-10 | Medium | E2 Sign-in and access | Restrict which environments each role can read | [ ] |
| PR-11 | Blocker | E3 Production endpoints and credentials | Replace the production endpoint in each of the 17 application manifests | [ ] |
| PR-12 | High | E3 Production endpoints and credentials | Replace the global production URLs | [ ] |
| PR-13 | Blocker | E3 Production endpoints and credentials | Configure the real CyberArk CCP call (the stand-in script now refuses in production) | [ ] |
| PR-14 | High | E3 Production endpoints and credentials | Add CyberArk entries for applications that have none | [ ] |
| PR-15 | High | E3 Production endpoints and credentials | Declare the real Jenkins operations centres and controllers | [ ] |
| PR-16 | Medium | E3 Production endpoints and credentials | Declare TLS certificate probes per application | [ ] |
| PR-17 | Medium | E3 Production endpoints and credentials | Replace infrastructure endpoints and host lists | [ ] |
| PR-18 | Low | E3 Production endpoints and credentials | Optional: turn on the Dynatrace read | [ ] |
| PR-19 | High | E3 Production endpoints and credentials | Validate all configuration and reachability | [ ] |
| PR-20 | High | E4 Data stores | Connect PostgreSQL / TimescaleDB and run migrations | [ ] |
| PR-21 | Medium | E4 Data stores | Optional: enable ClickHouse for long metric history | [ ] |
| PR-22 | Medium | E4 Data stores | Log archive to S3 | [ ] |
| PR-23 | High | E4 Data stores | Back up and rehearse a restore | [ ] |
| PR-24 | Blocker | E5 Hosting and high availability | Create the IIS site and application pool (choose this or PR-49 per server) | [ ] |
| PR-49 | Medium | E5 Hosting and high availability | Alternative to IIS: run Sentinel as a Windows scheduled-task service | [ ] |
| PR-25 | High | E5 Hosting and high availability | Install the TLS certificate and track its expiry | [ ] |
| PR-26 | High | E5 Hosting and high availability | Configure the AVI virtual service and health monitor | [ ] |
| PR-27 | High | E5 Hosting and high availability | Run two nodes with one leader | [ ] |
| PR-28 | High | E5 Hosting and high availability | Send the audit stream to the SIEM | [ ] |
| PR-29 | High | E6 Agent rollout | Build, sign and publish the agent packages | [ ] |
| PR-30 | High | E6 Agent rollout | Install the OpenTelemetry gateway | [ ] |
| PR-31 | High | E6 Agent rollout | Roll out to Linux with Ansible (pilot first) | [ ] |
| PR-32 | High | E6 Agent rollout | Roll out to Windows | [ ] |
| PR-33 | High | E6 Agent rollout | Roll out to Kubernetes | [ ] |
| PR-34 | Medium | E6 Agent rollout | Widen the rollout in waves and set the expected fleet size | [ ] |
| PR-35 | Blocker | E7 Verification and acceptance | Build the front end and verify the bundle | [ ] |
| PR-36 | Blocker | E7 Verification and acceptance | Run the readiness check on the production server | [ ] |
| PR-37 | High | E7 Verification and acceptance | Run the full tests including the browser smoke test in CI | [ ] |
| PR-38 | High | E7 Verification and acceptance | Walk every view in a browser on staging | [ ] |
| PR-39 | High | E7 Verification and acceptance | Load test at 2,000 hosts on staging | [ ] |
| PR-40 | High | E7 Verification and acceptance | Accept each collector against the real system | [ ] |
| PR-41 | High | E7 Verification and acceptance | Security review and penetration test | [ ] |
| PR-42 | High | E7 Verification and acceptance | Rehearse failover and rollback | [ ] |
| PR-43 | Medium | E7 Verification and acceptance | Management demonstration on staging | [ ] |
| PR-44 | Medium | E8 Open code work | Remove the fabricated default MTTR and MTTD | [ ] |
| PR-45 | Medium | E8 Open code work | One inventory entry per host per environment | [ ] |
| PR-46 | Medium | E8 Open code work | Build the collectors behind the three "Data not available" console screens | [ ] |
| PR-47 | Low | E8 Open code work | Fill the unmeasured Jenkins and compliance panels | [ ] |
| PR-48 | Low | E8 Open code work | Remove unused code | [ ] |

## Task details

### E1. Environment and process settings

#### PR-01 Run the service with NODE_ENV=production

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `web.config` | 21 | sets NODE_ENV under IIS (already correct) |
| `backend/server.js` | 79 | isDev is false only when NODE_ENV=production; reads then need a session |

**Steps**

1. Confirm the IIS site uses web.config unchanged; for a scheduled-task install set NODE_ENV as a machine variable.
2. Never set SENTINEL_REQUIRE_AUTH_READS=false or SENTINEL_INGEST_AUTH_MODE=warn/off in production.

**Sample**

```
<environmentVariable name="NODE_ENV" value="production" />
```

**Done when:** npm run readiness shows PASS for NODE_ENV and no FAIL in the login/ingest rows.

#### PR-02 Set SENTINEL_JWT_SECRET (identical on both servers)

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `scripts/bootstrap.js` | 13 | secret is never generated in production |
| `scripts/bootstrap.js` | 66 | startup stops with an error when it is missing |

**Steps**

1. Generate once (64 hex characters) and store it in CyberArk.
2. Set it as a Machine environment variable on both servers; restart the service.

**Sample**

```
[Environment]::SetEnvironmentVariable('SENTINEL_JWT_SECRET', $secret, 'Machine')
```

**Done when:** A user who signs in on node 1 stays signed in after being routed to node 2.

#### PR-03 Set ALLOWED_ORIGIN to the real Sentinel URL

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/server.js` | 123 | ALLOWED_ORIGINS (comma list) |
| `backend/server.js` | 125 | ALLOWED_ORIGIN; the built-in fallback is a placeholder |

**Steps**

1. Put the value in config/.env or a machine variable.

**Sample**

```
ALLOWED_ORIGIN=https://sentinel.<your-domain>
```

**Done when:** Browser calls and the WebSocket (/ws) work from the production URL with no CORS error.

#### PR-04 Set environment: production on the production host

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/global.yaml` | 14 | environment (shipped as staging) |

**Steps**

1. Edit only on the production host. PRD and STG remain selectable in the UI; this sets the default.

**Sample**

```
environment: "production"
```

**Done when:** Header shows PRODUCTION after sign-in without switching.

#### PR-05 Create one ingest key per environment

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `scripts/ingest_key.js` | 4 | usage: create <name> <prod|staging> |
| `backend/auth/ingest_keys.js` | 56 | SENTINEL_INGEST_API_KEYS parsing (no database needed) |
| `backend/server.js` | 682 | POST /v1/metrics needs scope metrics |
| `backend/server.js` | 1594 | POST /api/v2/shipper/heartbeat needs scope heartbeat |

**Steps**

1. Run the command twice (prod, staging). The raw key is shown once; store it in CyberArk and in the Ansible vault.
2. Without PostgreSQL, add the printed entry to SENTINEL_INGEST_API_KEYS and restart.

**Sample**

```
npm run ingest-key -- create fleet-prod prod --scopes agent,heartbeat,metrics
```

**Done when:** curl with the prod key returns 200 from /api/v2/shipper/heartbeat; without it, 401.

### E2. Sign-in and access

#### PR-06 Point sign-in at the real LDAP / eLDAP

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/global.yaml` | 56 | ldap_url |
| `config/global.yaml` | 58 | group_base_dn |
| `config/global.yaml` | 59 | bind_dn |
| `backend/auth/ldap_client.js` | 235 | URL actually used in production |

**Steps**

1. Replace the three placeholder values (enterprise.corp).
2. Open the firewall from the Sentinel servers to the LDAPS port.

**Sample**

```
ldap_url: "ldaps://ldap.<your-domain>:636"
bind_dn: "cn=svc-sentinel-sso,ou=ServiceAccounts,dc=<your>,dc=<domain>"
```

**Done when:** A real directory user can sign in; a wrong password is refused.

#### PR-07 Provide the LDAP bind password through CyberArk

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/cyberark.yaml` | 81 | sso_eldap entry (safe and object names) |
| `backend/auth/ldap_client.js` | 226 | reads credential sso_eldap/bind |

**Steps**

1. Confirm safe and object names with the security team.
2. Fallback only if CyberArk is unavailable: machine variable SSO_ELDAP_BIND.

**Sample**

```
sso_eldap:
  safe: "SF-INFRA-SSO"
  objects: { bind: "SSO-ELDAP-BIND" }
```

**Done when:** Sign-in succeeds with no "Authentication service unavailable" message in the log.

#### PR-08 Map directory groups to Sentinel roles

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/global.yaml` | 62 | super_admin_group |
| `config/global.yaml` | 63 | sre_lead_group |
| `config/global.yaml` | 64 | noc_operator_group |
| `config/global.yaml` | 65 | security_auditor_group |
| `backend/auth/ldap_client.js` | 54 | resolveRoleFromGroups |

**Steps**

1. Replace each group DN with the real one.
2. Sign in with one user per role and check the sidebar and actions.

**Sample**

```
sre_lead_group: "cn=SRE-Leads,ou=Groups,dc=<your>,dc=<domain>"
```

**Done when:** Each role sees only what it should (Access view lists the role matrix).

#### PR-09 Make sure simulated login is off in production

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/auth/ldap_client.js` | 221 | production uses LDAP unless SENTINEL_ALLOW_SIMULATED_LOGIN=true |
| `tests/prod_login_lockdown.test.js` | 1 | regression test |

**Steps**

1. Never set SENTINEL_ALLOW_SIMULATED_LOGIN on a production server; it exists only for a staging server run with NODE_ENV=production.
2. After go-live try admin_sentinel with any password: it must be refused.

**Sample**

```
(variable must be absent)
```

**Done when:** Login with a made-up user and any password returns 401.

#### PR-10 Restrict which environments each role can read

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/global.yaml` | 210 | environment_entitlements (empty = everyone sees both) |
| `backend/auth/access_policy.js` | 63 | allowedEnvironments |

**Steps**

1. Decide per role; Super Admin always sees both.

**Sample**

```
environment_entitlements:
  Viewer: ["staging"]
```

**Done when:** A Viewer cannot open PRD data (403).

### E3. Production endpoints and credentials

#### PR-11 Replace the production endpoint in each of the 17 application manifests

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/apps/aquasec.yaml` | 10 | endpoints.prod (api: on the next line) |
| `config/apps/argocd.yaml` | 10 |  |
| `config/apps/argoworkflows.yaml` | 10 |  |
| `config/apps/auto-remediation-service.yaml` | 10 |  |
| `config/apps/bitbucket-external.yaml` | 8 |  |
| `config/apps/bitbucket.yaml` | 12 |  |
| `config/apps/cloudbees-jenkins.yaml` | 15 |  |
| `config/apps/code-review-service.yaml` | 10 |  |
| `config/apps/fortify.yaml` | 10 |  |
| `config/apps/github.yaml` | 8 | already api.github.com; change for GitHub Enterprise |
| `config/apps/jetbrains-teamcity.yaml` | 12 |  |
| `config/apps/jfrog-artifactory.yaml` | 14 |  |
| `config/apps/mcp-server-k8s.yaml` | 10 |  |
| `config/apps/nexusiq.yaml` | 8 |  |
| `config/apps/otkr.yaml` | 8 |  |
| `config/apps/performance-center.yaml` | 8 |  |
| `config/apps/sonarqube.yaml` | 8 |  |

**Steps**

1. In each file change api: and vip: under endpoints.prod to the real addresses (all are *-prod.internal.corp placeholders today).
2. Keep endpoints.stg as the staging address; the two must differ.
3. Run npm run config:check.

**Sample**

```
prod:
  api: https://sonarqube.<your-domain>/api
  vip: https://sonarqube.<your-domain>
```

**Done when:** npm run readiness shows no warning about shipped *-prod.internal.corp addresses.

#### PR-12 Replace the global production URLs

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/global.yaml` | 21 | prod_urls block (app_url, avi_*, bitbucket_api, artifactory_api, jenkins_master_url, teamcity_api, sonarqube_api ...) |
| `config/global.yaml` | 36 | nas_mount |
| `config/global.yaml` | 39 | db_jdbc (see PR-20) |
| `config/global.yaml` | 40 | k8s_api |

**Steps**

1. Edit every value that still says internal.corp; delete keys for tools you do not run.

**Sample**

```
app_url: "https://sentinel.<your-domain>"
```

**Done when:** npm run preflight reports REACHABLE or AUTH_FAILED for each URL, never "fetch failed" for a live tool.

#### PR-13 Configure the real CyberArk CCP call (the stand-in script now refuses in production)

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `scripts/cyberark_fetch.py` | 35 | fetch_from_ccp: real CCP REST call |
| `scripts/cyberark_fetch.py` | 57 | main: refuses the fake secret when NODE_ENV=production |
| `backend/config/cyberark/cyberark_client.js` | 23 | how Node starts the script |
| `tests/cyberark_fetch_script.test.js` | 1 | test against a stand-in CCP |

**Steps**

1. Ask the security team for: CCP URL, an AppID for Sentinel, and the client certificate if used.
2. Set on each server: CYBERARK_CCP_URL, CYBERARK_APP_ID, and if needed CYBERARK_CLIENT_CERT, CYBERARK_CLIENT_KEY, CYBERARK_CA_FILE. Python 3 must be on PATH.
3. Test one credential by hand.

**Sample**

```
$env:CYBERARK_CCP_URL="https://ccp.<your-domain>/AIMWebService/api/Accounts"; $env:CYBERARK_APP_ID="SENTINEL"
python scripts/cyberark_fetch.py --safe SF-SONARQUBE-PROD --object SONARQUBE-API-TOKEN
```

**Done when:** The command prints a JSON value; the log has no "[CRED] No credential resolved" for configured apps.

#### PR-14 Add CyberArk entries for applications that have none

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/cyberark.yaml` | 5 | applications: registry (safe + object names, no secrets) |
| `config/cyberark.yaml` | 19 | cloudbees_jenkins has db and remediation_token but no api_token |
| `config/apps/sonarqube.yaml` | 16 | auth.credential_purpose names the object each app needs |

**Steps**

1. Missing today: aquasec, auto_remediation_service, code_review_service, mcp_server_k8s, and the cloudbees_jenkins api_token; check the rest against their manifests (npm run readiness lists them).
2. Use read-only tokens only.

**Sample**

```
cloudbees_jenkins:
  safe: "SF-JENKINS-PROD"
  objects:
    api_token: "JENKINS-API-TOKEN"
```

**Done when:** npm run readiness shows PASS for credentials.

#### PR-15 Declare the real Jenkins operations centres and controllers

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/apps/cloudbees-jenkins.yaml` | 29 | topology.operations_centers (sample oc-01, oc-02 today) |
| `metrics_collection/real/applications/jenkins_topology.js` | 1 | polls /queue/api/json and /computer/api/json per controller |

**Steps**

1. List every operations centre and controller with URL and region (5 OC, 10 controllers expected).
2. Give the API token read access to queue and computers on every controller.

**Sample**

```
- id: oc-01-aps
  flavour: APS
  url: https://<controller-host>
```

**Done when:** Console, Jenkins shows every controller answering; a refused token shows as Degraded.

#### PR-16 Declare TLS certificate probes per application

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/apps/sonarqube.yaml` | 28 | lifecycle.certificates (probe host:443) |
| `config/apps/bitbucket.yaml` | 44 |  |
| `config/apps/jfrog-artifactory.yaml` | 47 |  |
| `backend/jobs/expiry_sync.js` | 151 | probeTlsEndpoint |

**Steps**

1. Replace each probe with the real VIP host:port; add licence and refweb expiry dates when the owning team supplies them (null = not tracked).

**Sample**

```
- { name: vip-tls, probe: "sonarqube.<your-domain>:443" }
```

**Done when:** Certificates and Licences lists each certificate with real days left.

#### PR-17 Replace infrastructure endpoints and host lists

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/infra/avi.yaml` | 10 | AVI telemetry endpoint |
| `config/infra/sso-eldap.yaml` | 10 | SSO token endpoint |
| `config/infra/nfs.yaml` | 10 | NFS mount |
| `config/infra/k8s.yaml` | 1 | cluster names and API |
| `config/infra/windows.yaml` | 1 | Windows host list |
| `config/infra/unix.yaml` | 1 | Linux host list |

**Steps**

1. Replace placeholders; the log_path lines point at d:\production_shares and need the real share.

**Sample**

```
endpoint: "https://avi.<your-domain>/api/v1/telemetry"
```

**Done when:** AVI, Storage and Kubernetes views leave the empty state or show AUTH_FAILED with a reason.

#### PR-18 Optional: turn on the Dynatrace read

*Priority: Low*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/global.yaml` | 111 | collectors.dynatrace.enabled |
| `config/global.yaml` | 22 | prod_urls.dynatrace_api_endpoint (or PROD_DYNATRACE_API_ENDPOINT) |
| `config/cyberark.yaml` | 109 | dynatrace / api_token |
| `metrics_collection/real/dynatrace/dynatrace_collector.js` | 213 | calls /api/v2/managementZones: confirm it exists on your tenant (the Config API path is /api/config/v1/managementZones) |

**Steps**

1. Ask the Dynatrace team for the environment URL and a read-only token (scopes metrics.read, problems.read, entities.read). The token lives about 30 seconds; Sentinel re-reads it every 25 s.
2. Test from the Sentinel server with the commands below, then enable.

**Sample**

```
curl -s -G -H "Authorization: Api-Token $T" "https://<env-id>.live.dynatrace.com/api/v2/problems" --data-urlencode 'problemSelector=status("OPEN")' --data-urlencode 'from=now-2h'
curl -s -G -H "Authorization: Api-Token $T" "https://<env-id>.live.dynatrace.com/api/v2/metrics/query" --data-urlencode 'metricSelector=builtin:host.cpu.usage:avg' --data-urlencode 'resolution=1m' --data-urlencode 'from=now-30m'
curl -s -G -H "Authorization: Api-Token $T" "https://<env-id>.live.dynatrace.com/api/v2/entities" --data-urlencode 'entitySelector=type("HOST")' --data-urlencode 'pageSize=50'
```

**Done when:** With Dynatrace off Sentinel keeps working; with it on, open problems show in the problems view.

#### PR-19 Validate all configuration and reachability

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `package.json` | 44 | config:check and preflight scripts |
| `scripts/preflight_check.js` | 1 | probes every endpoint |

**Steps**

1. Run both on the production server after PR-11 to PR-18.
2. Fix anything UNREACHABLE (firewall/DNS) or AUTH_FAILED (token) with the owning team.

**Sample**

```
npm run config:check && npm run preflight
```

**Done when:** No UNREACHABLE for tools that exist; every AUTH_FAILED has a ticket to the owning team.

### E4. Data stores

#### PR-20 Connect PostgreSQL / TimescaleDB and run migrations

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/global.yaml` | 39 | prod_urls.db_jdbc (blank today) |
| `config/global.yaml` | 73 | stg_urls.db_jdbc |
| `database/postgres.js` | 31 | pool is created only when db_jdbc is set |
| `database/postgres.js` | 46 | user from PGUSER (default pg_telemetry_writer); password from PGPASSWORD or CyberArk database/db |
| `package.json` | 25 | npm run migrate |

**Steps**

1. Create the database and a writer account; enable the TimescaleDB extension.
2. Set db_jdbc, PGUSER and the password source; run npm run migrate on one node.
3. Without this, state is one JSON file (.runtime/sentinel_db.json) on one server: no shared state between nodes.

**Sample**

```
db_jdbc: "jdbc:postgresql://pg-sentinel.<your-domain>:5432/sentinel"
```

**Done when:** Platform health shows the database connected; alerts survive a restart and appear on the other node.

#### PR-21 Optional: enable ClickHouse for long metric history

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/global.yaml` | 244 | clickhouse block |
| `package.json` | 27 | npm run clickhouse:migrate |
| `database/clickhouse.js` | 68 | isConfigured |

**Steps**

1. Size metrics_1m for about 2,000 hosts; choose retention (raw 30 days, 400-day rollup).
2. Run migrate with --dry-run first.

**Sample**

```
npm run clickhouse:migrate:dry-run && npm run clickhouse:migrate
```

**Done when:** 13-month charts and capacity runway fill from ClickHouse.

#### PR-22 Log archive to S3

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/global.yaml` | 268 | log_archive.s3_bucket (blank = upload off) |
| `logs_collection/archival/s3_client.js` | 1 | signed upload |

**Steps**

1. Agree bucket, region and retention with the storage team; credentials come from CyberArk.
2. Start with delete_local_after_upload: false; switch to true after a week of clean uploads.

**Sample**

```
s3_bucket: "sentinel-logs-prod"
s3_region: "eu-west-1"
```

**Done when:** Archive job result shows uploaded > 0 and failed = 0.

#### PR-23 Back up and rehearse a restore

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `database/db.js` | 1 | .runtime/sentinel_db.json when no PostgreSQL |

**Steps**

1. PostgreSQL: scheduled base backup + WAL archiving; test restoring to a scratch server.
2. Keep config/ (without secrets) in source control; ingest keys can be re-created.

**Sample**

```
(process task)
```

**Done when:** A restore from last night's backup is shown working, with the time it took written down.

### E5. Hosting and high availability

#### PR-24 Create the IIS site and application pool (choose this or PR-49 per server)

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `web.config` | 13 | node.exe backend\server.js via HttpPlatformHandler |
| `web.config` | 20 | PORT=%HTTP_PLATFORM_PORT% |
| `web.config` | 39 | WebSocket must stay enabled for /ws |

**Steps**

1. App pool: specific service account, idle timeout 0, no periodic restart (Node manages itself).
2. Site on 443 with the certificate from PR-25; physical path = the deployed folder.

**Sample**

```
New-Website -Name "Sentinel" -PhysicalPath "D:\Apps\Sentinel" -ApplicationPool "SentinelPool" -Port 443 -Ssl
```

**Done when:** https://<sentinel-url>/api/healthz returns 200 through IIS.

#### PR-49 Alternative to IIS: run Sentinel as a Windows scheduled-task service

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `install_service.ps1` | 27 | registers task ProjectSentinelDaemon, runs at startup |
| `install_service.ps1` | 9 | -ServiceAccount parameter (default NT AUTHORITY\NetworkService) |
| `install_service.ps1` | 56 | task runs start.bat --daemon |
| `start.bat` | 67 | npm run start = node backend/server.js (start.bat also runs npm install and a front-end build when files are missing) |
| `stop_service.bat` | 3 | stops the task and frees port 3001 |
| `backend/server.js` | 2356 | PORT (default 3001) and HOST (default 0.0.0.0) |
| `backend/server.js` | 641 | /api/health used by the installer check |

**Steps**

1. Use this OR PR-24 on a server, never both (two Node processes would fight over the port and the leader lock).
2. Before installing: npm run build and node scripts/verify_dist.js --write on the release machine so start.bat does not install or build at boot.
3. Set the Machine environment variables from PR-01 to PR-05 and PORT=3001; the service account needs read access to the folder and write access to .runtime and logs.
4. Run install_service.ps1 from an elevated PowerShell; pass -ServiceAccount for a managed service account.
5. Put TLS in front: AVI terminates TLS and forwards to port 3001, or use IIS only as a reverse proxy.
6. The task is restarted at most 3 times and its time limit is 365 days; for a stricter service use a wrapper (NSSM or WinSW) that runs node.exe backend\server.js directly.

**Sample**

```
powershell -ExecutionPolicy Bypass -File .\install_service.ps1 -ServiceAccount "CORP\svc-sentinel$"
Get-ScheduledTask ProjectSentinelDaemon
curl http://localhost:3001/api/healthz
```

**Done when:** After a reboot the site answers on /api/healthz within two minutes with nobody signed in; stopping the process (stop_service.bat) and starting the task works.

#### PR-25 Install the TLS certificate and track its expiry

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `config/apps/sonarqube.yaml` | 28 | example lifecycle.certificates block; add the same for Sentinel itself |

**Steps**

1. Bind the certificate in IIS; add its expiry so Sentinel warns about its own certificate.

**Sample**

```
New-Item IIS:\SslBindings\0.0.0.0!443 -Value $cert
```

**Done when:** Certificates and Licences lists the Sentinel certificate.

#### PR-26 Configure the AVI virtual service and health monitor

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/server.js` | 484 | GET /api/healthz (also /health, /api/ping, /status) returns 200 |

**Steps**

1. Pool: both Sentinel nodes on 443; HTTPS health monitor on /api/healthz expecting 200; session persistence not required (shared JWT secret).
2. WebSocket upgrade must pass through the VIP.

**Sample**

```
GET https://<node>/api/healthz  ->  200
```

**Done when:** Stopping one node keeps the VIP green and users stay signed in.

#### PR-27 Run two nodes with one leader

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `database/leader_lock.js` | 40 | leader election log line |
| `config/global.yaml` | 252 | every job runs on the leader only, except vip_probes |

**Steps**

1. Both nodes need the same JWT secret, the same config and the shared PostgreSQL (PR-20).
2. Stop the leader and confirm the other becomes LEADER within the lease time.

**Sample**

```
[LEADER] This node is now LEADER (postgres).
```

**Done when:** Jobs continue after the leader is stopped; no duplicate alerts.

#### PR-28 Send the audit stream to the SIEM

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `web.config` | 15 | stdoutLogEnabled="true" (keep true: this is the audit stream) |

**Steps**

1. Point the SIEM collector at the stdout log folder; check a sign-in event appears.

**Sample**

```
(process task)
```

**Done when:** A test sign-in and a test acknowledge appear in the SIEM.

### E6. Agent rollout

#### PR-29 Build, sign and publish the agent packages

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `agent/packaging/scripts/build-packages.sh` | 1 | RPM and DEB (nfpm) |
| `agent/packaging/scripts/sign-packages.sh` | 1 | signing |
| `agent/packaging/wix/sentinel-agent.wxs` | 1 | Windows MSI |
| `agent/packaging/systemd/sentinel-agent.service` | 1 | Linux unit: 5% CPU, 300 MB limit |

**Steps**

1. Build on a build host, sign, push to the internal package repository (Linux) and file share (Windows MSI).

**Sample**

```
./agent/packaging/scripts/build-packages.sh 2.4.0
```

**Done when:** dnf install sentinel-agent works on a test host.

#### PR-30 Install the OpenTelemetry gateway

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `deployments/otel-gateway/install_otel_gateway.ps1` | 1 | Windows service for the gateway |
| `deployments/otel-gateway/otel-gateway.yaml` | 1 | gateway configuration |

**Steps**

1. Two gateways behind a VIP; create the bearer token agents use (sentinel_gateway_token).

**Sample**

```
powershell -File deployments/otel-gateway/install_otel_gateway.ps1
```

**Done when:** An agent on a test host reaches the gateway and its metrics arrive in Sentinel.

#### PR-31 Roll out to Linux with Ansible (pilot first)

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `deployments/ansible/playbooks/install_sentinel_agent.yml` | 1 | single playbook for Linux and Windows |
| `deployments/ansible/group_vars/all.yml.example` | 1 | variables (vault them) |
| `deployments/ansible/inventory.ini.example` | 1 | groups linux_servers, windows_servers, pilot |
| `deployments/ansible/roles/sentinel_agent_linux/tasks/main.yml` | 28 | package install |

**Steps**

1. Copy the examples, fill them, ansible-vault encrypt group_vars/all.yml; use separate inventories for prod and staging.
2. Dry run, then --limit pilot, then all.

**Sample**

```
ansible-playbook -i inventory.prod.ini playbooks/install_sentinel_agent.yml --ask-vault-pass --check --diff
ansible-playbook -i inventory.prod.ini playbooks/install_sentinel_agent.yml --ask-vault-pass --limit pilot
```

**Done when:** Pilot hosts appear in Govern, Agents and Observe, Linux with CPU, memory and disk within two minutes.

#### PR-32 Roll out to Windows

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `deployments/ansible/roles/sentinel_agent_windows/tasks/main.yml` | 30 | MSI install (sentinel_msi_package_path) |
| `deployments/ansible/group_vars/windows_servers.yml.example` | 1 | WinRM settings |

**Steps**

1. Install the ansible.windows and community.windows collections; WinRM over 5986 with Kerberos.
2. Same playbook; the Windows play runs for the windows_servers group.

**Sample**

```
ansible-galaxy collection install ansible.windows community.windows
```

**Done when:** Windows pilot hosts appear in Observe, Windows; service SentinelAgent is running.

#### PR-33 Roll out to Kubernetes

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `deployments/k8s/sentinel-agent-plain.yaml` | 1 | plain manifests; edit the lines marked EDIT |
| `deployments/k8s/sentinel-agent/values.yaml` | 1 | Helm values (same settings) |

**Steps**

1. Create the namespace and the secret (ingest-key, gateway-token) once per cluster, using the key of that cluster's environment.
2. Apply; check one pod per node plus one cluster pod.

**Sample**

```
kubectl -n sentinel-agent create secret generic sentinel-agent --from-literal=ingest-key=<snk_...> --from-literal=gateway-token=<token>
kubectl apply -f deployments/k8s/sentinel-agent-plain.yaml
```

**Done when:** Kubernetes view lists the cluster, nodes and pods from real data.

#### PR-34 Widen the rollout in waves and set the expected fleet size

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `deployments/ansible/playbooks/deploy_sentinel_agent.yml` | 5 | waves: pilot, toolchain, databases, rest |
| `deployments/ansible/playbooks/rollback_sentinel_agent.yml` | 1 | rollback |
| `config/global.yaml` | 238 | fleet.expected_hosts (coverage = reporting / expected) |

**Steps**

1. One wave per week; watch silent and drifted agents in Govern, Agents before the next wave.

**Sample**

```
expected_hosts: 2000
```

**Done when:** Coverage reaches the target; silent agents are under 2%.

### E7. Verification and acceptance

#### PR-35 Build the front end and verify the bundle

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `package.json` | 35 | build script (also records the fingerprint) |
| `scripts/verify_dist.js` | 1 | compares frontend/dist with frontend/src |

**Steps**

1. npm run build on the release machine; package frontend/dist.
2. The Console view and per-application pages exist only after this build.

**Sample**

```
npm run build && node scripts/verify_dist.js --write
```

**Done when:** verify_dist passes.

#### PR-36 Run the readiness check on the production server

*Priority: Blocker*

**Where**

| File | Line | What is there |
|---|---|---|
| `scripts/prod_readiness_check.js` | 1 | settings only; sends nothing |
| `package.json` | 45 | npm run readiness |

**Steps**

1. Run after PR-01 to PR-35; fix every FAIL; read every WARN.

**Sample**

```
npm run readiness
```

**Done when:** Output ends with "Ready" and exit code 0.

#### PR-37 Run the full tests including the browser smoke test in CI

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `package.json` | 37 | test:all (90 files) |
| `tests/ui_smoke.test.js` | 13 | needs Playwright |
| `tests/ui_smoke.test.js` | 33 | chromium.launch |

**Steps**

1. Install Chromium on the CI agent and run npm test.
2. Every file passes except ui_smoke where Chromium is missing.

**Sample**

```
npx playwright install chromium && npm test
```

**Done when:** All test files pass in CI.

#### PR-38 Walk every view in a browser on staging

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `frontend/src/App.jsx` | 69 | NAV_GROUPS: every item to be opened |

**Steps**

1. Open each sidebar item in PRD and STG; no console errors; each shows data, an honest empty state, or a reason.
2. Still to do: Health Checks, Dashboards, Topology, Databases, Kubernetes, AVI, Admin views.

**Sample**

```
https://sentinel-stg.<your-domain>/?tab=databases&env=staging
```

**Done when:** A signed checklist of views with no console errors.

#### PR-39 Load test at 2,000 hosts on staging

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `scripts/simulate_demo_injection.js` | 1 | --hosts 2000 sends a round for 2,000 simulated hosts |
| `tests/load_ingest.test.js` | 1 | in-repo ingest load test |

**Steps**

1. Run the simulator with 2,000 hosts at the production interval for an hour; watch CPU, memory, ingest queue and drops in Platform Health.
2. 200 hosts per environment are verified; 2,000 are not.

**Sample**

```
npm run demo:inject -- --url https://sentinel-stg.<your-domain> --key <stg key> --hosts 2000 --interval 60
```

**Done when:** No dropped metrics, API responses under 2 s, node CPU under 60%.

#### PR-40 Accept each collector against the real system

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `metrics_collection/real/applications/` | 1 | one collector per tool (bitbucket, artifactory, teamcity, fortify, nexusiq, sonarqube, argocd ...) |
| `metrics_collection/real/infrastructure/` | 1 | avi, k8s, database collectors |

**Steps**

1. For each tool: open its screen, compare two numbers with the tool's own UI, record pass/fail.
2. Endpoints are version-specific; expect small fixes on first contact. A failure shows AUTH_FAILED or Data not available, never a guess.

**Sample**

```
GET /api/v2/console/app/sonarqube?environment=prod
```

**Done when:** Each of the 17 applications has a pass/fail row signed by its owning team.

#### PR-41 Security review and penetration test

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/auth/access_policy.js` | 1 | read/ingest policy |
| `backend/auth/ldap_client.js` | 221 | sign-in path |
| `backend/server.js` | 682 | public ingest endpoint |

**Steps**

1. Scope: sign-in, ingest key handling, CORS, rate limits, audit trail, secret masking in the Configuration view.
2. Fix findings before widening the prod pilot.

**Sample**

```
(process task)
```

**Done when:** Report received; no open high findings.

#### PR-42 Rehearse failover and rollback

*Priority: High*

**Where**

| File | Line | What is there |
|---|---|---|
| `database/leader_lock.js` | 40 | leader election |
| `deployments/ansible/playbooks/rollback_sentinel_agent.yml` | 1 | agent rollback |

**Steps**

1. Stop node 1 on staging, then on the prod pilot; confirm sign-in, ingest and jobs continue.
2. Rehearse the agent rollback on the pilot group.

**Sample**

```
(process task)
```

**Done when:** Written timings for failover and rollback.

#### PR-43 Management demonstration on staging

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `scripts/simulate_demo_injection.js` | 1 | story: steady, incident, recovery, repeating every 10 minutes |

**Steps**

1. Create a staging-only key; start the simulator before the meeting and stop it after (hosts named sim-*.demo.local).
2. Walk: Console Overview, Artifactory detail during the incident, Linux hot hosts, recovery.

**Sample**

```
npm run ingest-key -- create demo-sim staging --scopes heartbeat,metrics
npm run demo:inject -- --url https://sentinel-stg.<your-domain> --key <key> --hosts 60
```

**Done when:** Demo runs clean twice in rehearsal.

### E8. Open code work

#### PR-44 Remove the fabricated default MTTR and MTTD

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/routes/reportRoutes.js` | 59 | mttr falls back to 18 when no problem is resolved |
| `backend/routes/reportRoutes.js` | 60 | mttd falls back to 2.5 |

**Steps**

1. Return null when there are no resolved problems; show a dash in the reliability report.
2. The current default breaks the rule that nothing is invented.

**Sample**

```
const mttr = resolved.length > 0 ? Math.round(total / resolved.length) : null;
```

**Done when:** Report shows a dash on a fresh install; test added.

#### PR-45 One inventory entry per host per environment

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `inventory/entity_resolver.js` | 17 | host:<name> is global: the same name in prod and staging collides |

**Steps**

1. Either require distinct host names per environment (a rule in the rollout) or include the environment in the entity id and migrate existing rows.

**Sample**

```
host:<env>:<fqdn>
```

**Done when:** The same host name reporting to both environments shows in both views.

#### PR-46 Build the collectors behind the three "Data not available" console screens

*Priority: Medium*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/routes/consoleRoutes.js` | 34 | UNAVAILABLE: geo, dependencies, reports |
| `frontend/src/components/console/GeoScreen.jsx` | 1 | screen is ready |
| `frontend/src/components/console/DependenciesScreen.jsx` | 1 |  |
| `frontend/src/components/console/ReportsScreen.jsx` | 1 |  |

**Steps**

1. Geo: replication lag from Artifactory and mirror sync from Bitbucket per region. Dependencies: probes in each region. Reports: DORA and availability from stored history.
2. Each needs its builder in consoleRoutes.js and a test like tests/console_live.test.js.

**Sample**

```
GET /api/v2/console/geo?environment=prod
```

**Done when:** The screens fill from real data.

#### PR-47 Fill the unmeasured Jenkins and compliance panels

*Priority: Low*

**Where**

| File | Line | What is there |
|---|---|---|
| `backend/routes/consoleRoutes.js` | 127 | buildJenkins: heap_pct and success_pct are null |
| `backend/routes/consoleRoutes.js` | 147 | build_clusters, ubuntu_agents, windows_pools, jump_servers empty |
| `backend/routes/consoleRoutes.js` | 176 | buildCompliance: versions, drift, disaster recovery empty |

**Steps**

1. Heap from the controller metrics endpoint; build clusters from kube-state-metrics; versions from version_tracker.

**Sample**

```
(code task)
```

**Done when:** Panels show measured values.

#### PR-48 Remove unused code

*Priority: Low*

**Where**

| File | Line | What is there |
|---|---|---|
| `package.json` | 63 | jose dependency (no code uses it); the unused Sparkline component was removed on 2026-10-23 |

**Steps**

1. Run npm uninstall jose on a machine with registry access so package-lock.json is updated too, then npm test and npm run lint.

**Sample**

```
(code task)
```

**Done when:** Smaller bundle; lint clean.

## Reference

### What was verified and what was not

Verified with automated tests (90 test files): ingest of both environments, environment kept separate by ingest key, 200 simulated hosts per environment, live Console screens and per-application pages, production sign-in lock-down, the demo simulator, the CyberArk script against a stand-in service.

Not verified, because it needs your systems: every collector against the real tool, a 2,000-host load, a browser walk of every view, failover, backup restore, the security review. These are PR-38 to PR-42.

### Where the secrets go

Nothing secret is stored in the repository. API tokens and passwords are read through CyberArk (`config/cyberark.yaml` names safe and object only). The JWT secret and ingest keys are machine environment variables.

### Demo for senior management

PR-43 describes it. The simulator only sends data to the environment its key belongs to, refuses production unless `--allow-prod` is given, and names every host sim-*.demo.local so it can be told apart.

### Agent install, quick reference

- Linux and Windows: `deployments/ansible/playbooks/install_sentinel_agent.yml` (PR-31, PR-32).
- Kubernetes: `deployments/k8s/sentinel-agent-plain.yaml` or the Helm chart in `deployments/k8s/sentinel-agent` (PR-33).
