# Deployment Guide — Windows Servers, IIS, AVI

How to place the code on your two Windows servers, run it as a service, and expose it on your domain URL through AVI.

Target topology, which matches the infrastructure you already have:

```
                       https://<your-domain-url>
                                  │
                      ┌───────────▼───────────┐
                      │   AVI Virtual Service │   SSL termination or re-encrypt
                      │   VIP  ·  :443        │   Health monitor: GET /healthz
                      └─────┬───────────┬─────┘
                            │           │
                   ┌────────▼───┐   ┌───▼────────┐
                   │ SENTINEL-1 │   │ SENTINEL-2 │
                   │ IIS + Node │   │ IIS + Node │
                   │   :443     │   │   :443     │
                   └────────────┘   └────────────┘
                     ACTIVE            PASSIVE (or active)
```

**Run active-passive for Stage 1.** Active-active works, but the WebSocket carries per-session state and there is no shared session store yet — without sticky sessions a user re-authenticates whenever AVI moves them. Active-passive avoids that entirely and is simpler to reason about during a pilot.

---

## 1. Per-server prerequisites

Do this on **both** servers.

| # | Step | Verify |
|---|---|---|
| 1 | Install Node.js 24.x LTS (matches `.nvmrc`) | `node -v` → `v24.x` |
| 2 | Enable IIS with **WebSocket Protocol** | Server Manager → Web Server (IIS) |
| 3 | Install **HttpPlatformHandler v1.2** | appears in IIS → Modules |
| 4 | Create deployment folder `D:\Apps\Sentinel` | |
| 5 | Create a service account, e.g. `CORP\svc-sentinel` | |
| 6 | Grant it Modify on `D:\Apps\Sentinel`, `.runtime\`, `logs\` | |
| 7 | Open outbound 443 to your Artifactory npm remote | `npm ping` |

> HttpPlatformHandler, not iisnode. It starts `node.exe`, assigns it a private port, and proxies to it — which is what `web.config` is written for.

---

## 2. Place the code

```powershell
cd D:\Apps\Sentinel
git clone <your-repo-url> .
git checkout <release-tag>

copy config\.env.example config\.env    # then edit, see step 3
copy .npmrc.example .npmrc              # set your Artifactory host

npm ci --omit=dev                       # 13 packages, ~11 MB, no build toolchain
npm run config:check                    # validates config, prints per-app status
npm run verify:dist                     # confirms the committed bundle is current
```

`frontend/dist` is committed, so **no build step runs on the server** and no dev dependency is installed.

### Exclude what should not ship

These four folders belong in the repository but not on a production host:

```powershell
Remove-Item -Recurse -Force tests, tools, docs, deployments
```

That removes **12 MB and 72 files**, including test fixtures and a Docker compose file. Do it after `npm run config:check` — that script lives in `scripts\`, which stays.

---

## 3. Secrets and environment

**`SENTINEL_JWT_SECRET` must be a machine environment variable, not a file.** Both servers must use the **same** value, or a session issued by SENTINEL-1 is rejected by SENTINEL-2 after failover.

```powershell
# Generate ONCE, then set the identical value on both servers
$secret = -join ((1..64) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
[Environment]::SetEnvironmentVariable('SENTINEL_JWT_SECRET', $secret, 'Machine')
```

Store it in CyberArk and treat rotation as a coordinated change across both servers.

The bootstrap script **refuses to generate a secret when `NODE_ENV=production`** — deliberately. A generated secret would invalidate every session on restart and hide the misconfiguration.

Everything else lives in `config\.env`:

```ini
PORT=8080
ALLOWED_ORIGIN=https://<your-domain-url>
NODE_ENV=production
```

---

## 4. IIS site

```powershell
Import-Module WebAdministration

New-WebAppPool -Name "SentinelPool"
Set-ItemProperty IIS:\AppPools\SentinelPool -Name processModel.identityType -Value SpecificUser
Set-ItemProperty IIS:\AppPools\SentinelPool -Name processModel.userName -Value "CORP\svc-sentinel"
Set-ItemProperty IIS:\AppPools\SentinelPool -Name processModel.password -Value "<from CyberArk>"

# Node manages its own lifecycle - do not let IIS recycle or idle it out
Set-ItemProperty IIS:\AppPools\SentinelPool -Name processModel.idleTimeout -Value "00:00:00"
Set-ItemProperty IIS:\AppPools\SentinelPool -Name recycling.periodicRestart.time -Value "00:00:00"

New-Website -Name "Sentinel" -PhysicalPath "D:\Apps\Sentinel" `
            -ApplicationPool "SentinelPool" -Port 443 -Ssl
```

`web.config` is already correct and needs no edit. For reference:

| Line | Setting | Why |
|---|---|---|
| 13–14 | `processPath="node.exe"` `arguments="backend\server.js"` | what HttpPlatformHandler starts |
| 15–16 | `stdoutLogEnabled="true"` | **keep true** — this is the audit stream SIEM ingests |
| 20 | `PORT=%HTTP_PLATFORM_PORT%` | IIS assigns the private port |
| 21 | `NODE_ENV=production` | enables the real LDAP bind |
| 39 | `<webSocket enabled="true">` | required for `/ws` |

### Certificate

```powershell
$cert = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -like "*<your-domain-url>*" }
New-Item IIS:\SslBindings\0.0.0.0!443 -Value $cert
```

Record the expiry now and add it to `config/apps/*.yaml` under `lifecycle.certificates` so Sentinel tracks its own certificate.

---

## 5. Run it as a service

`install_service.ps1` registers a **Scheduled Task** named `ProjectSentinelDaemon` that runs `start.bat` at boot. That is the right choice when running Node standalone on a port.

**With IIS + HttpPlatformHandler you do not need it.** IIS owns the process lifecycle: it starts `node.exe` on first request and restarts it on failure. Running both means two Node processes fighting for the same port.

**Pick one:**

| Model | Use when | How |
|---|---|---|
| **IIS-managed (recommended)** | You want the domain URL, TLS and WebSocket proxying handled by IIS | Nothing extra. IIS starts Node. Set the app pool to **AlwaysRunning** and the site to **preload** so it starts without waiting for a first request. |
| **Standalone service** | Node binds a port directly and AVI talks to it, no IIS | `.\install_service.ps1` then confirm `ProjectSentinelDaemon` in Task Scheduler |

For IIS-managed, add warm-up so a failover target is already running:

```powershell
Set-ItemProperty IIS:\AppPools\SentinelPool -Name startMode -Value AlwaysRunning
Set-ItemProperty "IIS:\Sites\Sentinel" -Name applicationDefaults.preloadEnabled -Value True
```

### Verify locally on each server

```powershell
curl.exe -k https://localhost/healthz          # 200
curl.exe -k https://localhost/api/ui-config    # JSON
```

---

## 6. AVI virtual service

| Setting | Value | Notes |
|---|---|---|
| Virtual Service | `sentinel-vs` | |
| VIP / Port | your VIP, `443` | |
| Application profile | **System-Secure-HTTP** | must allow WebSocket upgrade |
| SSL | terminate at AVI, or re-encrypt to the pool | either is fine |
| Pool members | `SENTINEL-1:443`, `SENTINEL-2:443` | |
| **Persistence** | **Client IP or HTTP cookie** | the WebSocket carries per-session state |
| Health monitor | `GET /healthz` | |
| Expected code | `200` | |
| Expected body | `"status":"ok"` | |
| Interval / timeout | 15s / 5s | |
| Mark down after | 2 consecutive failures | |
| Headers injected | `X-Forwarded-For`, `X-Forwarded-Proto` | the app sets `trust proxy` for these |

For active-passive, set SENTINEL-2's pool member **priority lower** than SENTINEL-1 so it only takes traffic on failover.

### WebSocket

`/ws` must survive the AVI hop. Verify from a client:

```bash
curl -i -k -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
     https://<your-domain-url>/ws
```

**Expect `101 Switching Protocols`.** A `200` means AVI or IIS swallowed the upgrade and the dashboard will fall back to REST polling — it will look like it works, just without live updates. This is the single easiest thing to get wrong.

### Rate limiting behind a proxy

`backend/server.js:51` configures `trust proxy` against a set of known proxy addresses. **Add your AVI SNAT addresses there**, or every request appears to come from one IP and the shared rate limit throttles all users at once.

---

## 7. Go-live verification

Run against the domain URL, not localhost.

- [ ] `https://<your-domain-url>/healthz` → 200
- [ ] SPA loads, browser console clean
- [ ] `/ws` returns **101**
- [ ] Live tiles update without a refresh (proves WebSocket, not polling)
- [ ] Login succeeds with a real directory account
- [ ] Login **fails** with a bad password — the auth-bypass regression test
- [ ] Stop the Node process on SENTINEL-1 → AVI marks it down within 30s, session continues on SENTINEL-2
- [ ] Reboot SENTINEL-1 → it returns to the pool automatically
- [ ] `logs\` is being written and rotating
- [ ] `.runtime\` is writable
- [ ] Demo banner visible if this is the Stage 1 shell

---

## 8. Updating a deployed server

```powershell
cd D:\Apps\Sentinel
git fetch --all
git checkout <new-tag>
npm ci --omit=dev
npm run config:check
npm run verify:dist          # fails if the committed bundle is stale
iisreset /restart            # or: Restart-WebAppPool SentinelPool
```

**Update the passive server first**, verify it, then fail over and update the other. That gives you a tested rollback target at every moment.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 502.5 from IIS | Node crashed at startup | `.runtime\nas_logs\iis_node.log` — usually a missing `SENTINEL_JWT_SECRET` |
| Blank page, console shows a module error | Stale `frontend/dist` | `npm run verify:dist` |
| `/ws` returns 200 not 101 | AVI profile or IIS WebSocket disabled | System-Secure-HTTP profile; `<webSocket enabled="true">` |
| Users logged out on failover | Servers have different JWT secrets | Set the **same** machine variable on both |
| All users rate-limited together | AVI SNAT IP not trusted | Add it at `backend/server.js:51` |
| Login accepts any password | `NODE_ENV` is not `production` | Set it; `config.ENVIRONMENT` must resolve to `prod` |
| App reaching hosts you did not expect | An endpoint is still configured | Blank the URL — see the Stage 1 gates |
