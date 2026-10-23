# `config/` — everything you edit lives here

This folder is the single place to change how Sentinel behaves. You should not
need to open a `.js` file to add, change or remove a monitored application.

After any change:

```bash
npm run config:check     # validates and shows what each app will do
```

---

## Add an application

1. Copy the template:

   ```bash
   cp config/apps/_TEMPLATE.yaml config/apps/my-tool.yaml
   ```

2. Fill in the five required fields — `id`, `kind`, `display_name`, `enabled`, `endpoints`.
3. `npm run config:check`
4. Restart.

That's it. **One file.** The filename doesn't have to match the `id`, and you
don't need to register the app anywhere else.

A collector is only needed if the tool's API returns a shape Sentinel doesn't
already understand. Without one it still reports reachability, TLS validity and
latency.

## Change an application

Edit its file and restart. To find the right file when the id and filename
differ, `npm run config:check` prints the id for every manifest.

## Remove an application

Either delete the file, or set `enabled: false` in it. Disabling keeps the
history and lets you turn it back on later; deleting is permanent.

## Turn everything off at once

`applications_enabled` in `global.yaml` overrides every manifest. Use it for a
demo deployment or to stop all collection in a hurry:

```yaml
applications_enabled:
  bitbucket: false
  jenkins: false
```

**Precedence, most specific first:**

1. `applications_enabled.<id>` in `global.yaml` — operator override
2. `enabled:` in the app's own manifest
3. `true` — the default

---

## What each file does

| File | Purpose |
|---|---|
| **`global.yaml`** | Active environment, prod/staging URLs, SSO settings, master toggles. **The main file for a deployment.** |
| **`apps/*.yaml`** | One per monitored application. Start from `_TEMPLATE.yaml`. |
| **`infra/*.yaml`** | Shared infrastructure: AVI, Kubernetes, NFS, Windows, Linux, Docker, SSO. |
| **`ui.yaml`** | Banner and maintenance-badge text. Applies on browser refresh — no rebuild, no restart. |
| **`cyberark.yaml`** | Maps a credential *purpose* to a vault Safe and Object. Never contains a secret. |
| **`telemetry.yaml`** | Which telemetry profile is active: OpenTelemetry, Dynatrace or Prometheus. |
| **`correlation.yaml`** | Root-cause scoring weights. Tunable without a deploy. |
| **`dynatrace_metric_aliases.yaml`** | Candidate metric names, so a Dynatrace rename doesn't silently zero a chart. |
| **`custom_checks.yaml`** | Operator-defined synthetic checks. |
| **`.env`** | Environment variables and `SENTINEL_JWT_SECRET`. Gitignored. Created automatically on first run. |
| **`.env.example`** | Template for the above. |

Files beginning with `_` are ignored by the loader, so templates and notes can
live alongside real manifests.

---

## Two rules worth knowing

**If an endpoint isn't configured, nothing can reach it.** To make a deployment
inert, blank the URLs rather than disabling the features that use them. The
`enabled` toggles gate *collectors*; they do not gate the database, CyberArk or
Snowflake clients, which are built from their URL alone.

**Production and staging never show invented data.** A tool that can't be
reached reports `DATA_UNAVAILABLE`, not a plausible-looking number. Only the
`demo` environment synthesizes values. An empty tile is a correct answer.

---

## Secrets

Never put a password, token or key in these files. `cyberark.yaml` maps a
purpose to a vault object; the value is fetched at runtime.

Resolution order: in-memory cache → CyberArk CCP → a strictly namespaced
environment variable (`<APPID>_<PURPOSE>`, e.g. `BITBUCKET_API_TOKEN`).

---

## Golden Journeys (`journeys:`)

Every toolchain product is measured end-to-end as a normal user through Golden Journeys defined in its manifest:
- **`interval_seconds`**: probe execution interval in seconds (minimum 30, default 60).
- **`credentials_purpose`**: maps to an entry in `credentials.objects` / CyberArk. Never plaintext tokens.
- **`steps`**: list of sequential steps. Required fields:
  - `id`: step identifier.
  - `type`: `http`, `browser`, `git`, or `upload_download`.
  - `layer`: `network`, `app`, `db`, or `storage`.
  - `assert`: assertions such as `status`, `body_contains`, and `max_ms`.
- **`cleanup`**: optional list of cleanup steps executed regardless of run outcome.
- **Execution & Storage**: runs execute strictly on the leader node with bounded concurrency (max 4). Each run produces a W3C distributed trace; spans are stored in ClickHouse (`spans`), and step metrics are emitted to `metrics`.
- **Prerequisite P3**: keep `enabled: false` on real manifests until product canary service accounts are provisioned.


## What each product team must create

SENTINEL measures each product the way a user would, using objects and accounts the product team owns. Nothing here needs admin rights on the product; a normal user account with the rights below is enough. Until these exist, the product's journeys report `DATA_UNAVAILABLE` (or `AUTH_FAILED` if the account exists but is rejected); nothing is faked.

For every product:

1. **A service account per environment** (prod and staging), non-interactive, password or token not tied to a person, no admin rights.
2. **The credential in CyberArk**, in the safe and under the object name listed below (`config/cyberark.yaml`). The manifest's `auth.credential_purpose` (and `credentials_purpose` on a journey) names the object key, normally `api_token`.
3. **The canary objects** in the table: test-only items SENTINEL may read, and where stated write to and clean up. Name them with a `canary` / `sentinel-canary` prefix so nobody mistakes them for real work.
4. **Firewall/AVI access** from the two SENTINEL servers to the product VIP (UI traffic always goes through AVI).

| Product (manifest id) | Canary objects & Service account rights | CyberArk safe / objects | JMX local port (optional) | Licence read rights | Executor / queue read rights | ServiceNow read-only user |
|---|---|---|---|---|---|---|
| Bitbucket (`bitbucket`) | Repo `canary-repo` with branch `sentinel-canary`. Read on canary project; write on `canary-repo` (`sentinel-canary` branch only); read on application properties | `SF-BITBUCKET-PROD` / `api_token` | `3333` (optional JMX) | `/rest/api/1.0/admin/license` read | N/A (SCM service) | `itil_read` (CI: `ci_bitbucket_prod`) |
| Bitbucket external (`bitbucket_external`) | Read-only canary repository. Read on that repository and its project | `SF-BITBUCKET-EXT-PROD` / `api_token` | None | None (external mirror) | N/A | `itil_read` (CI: `ci_bitbucket_ext`) |
| GitHub (`github`) | Repository `canary-repo` in the organisation. Read on canary repo (fine-grained token, contents: read) | `SF-GITHUB-PROD` / `api_token` | N/A (SaaS) | `org:read` / Enterprise seat billing API | Actions runner queue & status (`actions:read`) | `itil_read` (CI: `ci_github_org`) |
| CloudBees Jenkins (`cloudbees_jenkins`) | Job `canary-noop` (no-op pipeline). Build & read on `canary-noop`; overall read (queue, computers) | `SF-JENKINS-PROD` / `api_token` (must be added; only `db` and `remediation_token` exist today) | `5000` (optional JMX RMI) | CloudBees Operations Center licensing read | Overall/Read on build queue, computer/agent status & busy executors | `itil_read` (CI: `ci_jenkins_prod`) |
| TeamCity (`jetbrains_teamcity`) | Build configuration for canary (no-op) build. View project, run build on canary config; view agents and queue | `SF-TEAMCITY-PROD` / `api_token` | `9010` (optional) | Administration read on licence keys & active agent counts | View build queue (`/app/rest/buildQueue`) and agent pool status | `itil_read` (CI: `ci_teamcity_prod`) |
| JFrog Artifactory (`jfrog_artifactory`) | Repository `canary-repo` holding `canary-artifact.bin` and `canary.jar`; SENTINEL uploads/deletes `canary-temp.bin`. Read on instance; deploy/delete on `canary-repo` only | `SF-ARTIFACTORY-PROD` / `api_token` | `9015` (optional) | Read on `/artifactory/api/system/licenses` | N/A (Package registry) | `itil_read` (CI: `ci_artifactory_prod`) |
| SonarQube (`sonarqube`) | Project `canary-project` with at least one analysis. Browse on `canary-project`; system health read | `SF-SONARQUBE-PROD` / `api_token` | `9005` (optional) | Read on `/api/editions/show_license` | Read Compute Engine queue (`/api/ce/activity`, pending, inProgress) | `itil_read` (CI: `ci_sonarqube_prod`) |
| Fortify SSC (`fortify`) | One canary application version. View on canary version; read cloudpools and artifacts | `SF-FORTIFY-PROD` / `api_token` | Optional (Tomcat JMX) | Read on SSC server licence status | Read CloudScan pool activity & Controller job queue | `itil_read` (CI: `ci_fortify_prod`) |
| Nexus IQ (`nexusiq`) | One canary application. View on canary app; read reports and firewall summary | `SF-NEXUSIQ-PROD` / `api_token` | Optional | Read licence expiration & product edition | N/A (Policy evaluator) | `itil_read` (CI: `ci_nexusiq_prod`) |
| Argo CD (`argocd`) | One canary application in canary project. Read-only role on canary project (applications, clusters, repos: get) | `SF-ARGOCD-PROD` / `api_token` | N/A (Go binary) | N/A (Open source) | Read app sync & health status queue | `itil_read` (CI: `ci_argocd_prod`) |
| Argo Workflows (`argoworkflows`) | Namespace access to `argo-workflows` with canary workflow template. Read workflows and templates in namespace | `SF-ARGOWORKFLOWS-PROD` / `api_token` | N/A (Go binary) | N/A (Open source) | Read workflow controller execution queue | `itil_read` (CI: `ci_argoworkflows_prod`) |
| OTKR (`otkr`) | One canary keystore and key policy. Read status, keystores, policies, audit summary | `SF-OTKR-PROD` / `api_token` | Optional | Read licence validity & key quota | N/A | `itil_read` (CI: `ci_otkr_prod`) |
| Performance Center (`performance_center`) | One canary project with short test run history. Read projects and runs | `SF-PERFCENTER-PROD` / `api_token` | Optional (IIS/Java) | Read VUD / licence concurrency limits | Read active performance runs & load generator host allocations | `itil_read` (CI: `ci_perfcenter_prod`) |
| Aqua Security (`aquasec`) | None (read-only endpoints). Read-only (auditor) role | `SF-AQUASEC-PROD` / `api_token` | N/A (Go binary) | Read scanner licence expiration and node caps | Read image scanning task queue | `itil_read` (CI: `ci_aquasec_prod`) |
| MCP server on K8s (`mcp_server_k8s`) | None (read-only endpoints). Read tools, prompts, resources | `SF-MCPSERVER-PROD` / `api_token` | N/A (Containerized) | N/A | Read MCP worker queue / RPC pool | `itil_read` (CI: `ci_mcpserver_prod`) |
| Auto-remediation service (`auto_remediation_service`) | None (no journeys configured). Read status | `SF-AUTOREMED-PROD` / `api_token` | N/A (Node.js) | N/A | Read pending remediation playbook queue | `itil_read` (CI: `ci_autoremediation_prod`) |
| AI code review (`code_review_service`) | None (no journeys configured). Read status | `SF-CODEREVIEW-PROD` / `api_token` | N/A (Python/FastAPI) | N/A | Read LLM review inference request queue | `itil_read` (CI: `ci_codereview_prod`) |

The paths in each manifest's `journeys:` are the exact calls SENTINEL makes; give them to the product team with this table. Database read-only accounts for the `layers.databases` receivers are separate: the agent reads them from `SENTINEL_DB_*` environment variables on the host (see `agent/README.md`).
