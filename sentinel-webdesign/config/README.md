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
