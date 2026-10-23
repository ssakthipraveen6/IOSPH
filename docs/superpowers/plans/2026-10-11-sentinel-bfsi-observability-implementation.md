# Project Sentinel: BFSI Tier-0 Observability & UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved BFSI MNC-grade observability architecture and UI/UX redesign (featuring all 5 reference views: NOC APM with deployment history and Apdex, Kubernetes cluster mesh with container restart spikes, Cloudflare-style perimeter logs with donut charts, distributed flamegraphs, and Four-Eyes SoD governance) into `sentinel-webdesign` while preserving 100% backward compatibility and zero regressions.

**Architecture:** Maintain Sentinel's native glassmorphic design system (`Outfit`, `Plus Jakarta Sans`, `Fira Code`, aurora mesh orbs, blurred frosted glass) while consolidating the 16 flat navigation tabs into streamlined persona workspaces. On the backend, modularize the monolithic `backend/server.js` (1,937 lines) into dedicated domain routers (`/api/apm`, `/api/k8s`, `/api/perimeter`, `/api/governance`) with simulated/OTLP live data fallbacks.

**Tech Stack:** React 18, Vite, Node.js / Express, WebSockets (`ws`), HTML5 Canvas (high-performance zero-dependency charts), OpenTelemetry (OTLP), CSS3 Glassmorphism tokens.

**Spec:** [sentinel_bfsi_enterprise_app.html](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel_bfsi_enterprise_app.html) and [sentinel_redesign_mockup.html](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel_redesign_mockup.html).

---

## Global Constraints

- **Zero Breaking Changes:** All 16 legacy endpoints in `backend/server.js` (`/api/health`, `/api/metrics`, `/api/alerts`, `/api/recovery`, `/api/settings`, `/api/itsm/tickets`, etc.) must continue to respond identically.
- **Strict Scope Boundary:** Strictly pure Infrastructure, Storage, Network Perimeter, Application Middleware, and CI/CD. Do NOT introduce Layer 5 banking/business transaction tracking.
- **Style Continuity:** Use only Sentinel's native theme tokens (`--bg-dark: #070b14`, `--primary: #14b8a6`, `--healthy: #10b981`, `--warning: #f59e0b`, `--critical: #ef4444`) with `.dark-mode` and `.light-mode` support.
- **Performance:** Chart rendering must use Canvas / SVG with zero CPU thrashing, maintaining 60 FPS on 4K NOC wallboards.
- **Security:** Maintain CSRF token validation (`sentinel_csrf`), sanitization of inputs, and RBAC / SoD dual-signature guardrails for any remediation executions.

---

## Review Focus

1. **Monolithic Route Regression:** Refactoring `server.js` into sub-routers must not change existing route paths or drop WebSocket broadcast events (`metrics_tick`, `init`, `state`, `log`).
2. **Chart Canvas Resize Artifacts:** High-DPI screens (`devicePixelRatio > 1`) and window resize events must scale canvas charts crisply without pixelation or memory leaks.
3. **Sidebar Collapse Alignment:** When the sidebar is toggled between 280px drawer and 76px mini dock, the main frame margin must transition smoothly without horizontal scrollbars.
4. **Theme Toggling Visual Contrast:** Every new widget, table, and canvas chart must be tested in both `.dark-mode` (Obsidian) and `.light-mode` (Executive Daylight) for WCAG AA compliance.
5. **SoD Approval Guardrails:** High-impact remediation actions (e.g., database session kills) must remain locked until dual signatures are simulated or verified.

---

## Task Decomposition

### Task 1: Backend Router Modularization & Domain Scaffolding

**Files:**
- Create: `sentinel-webdesign/backend/routes/apmRoutes.js`
- Create: `sentinel-webdesign/backend/routes/k8sRoutes.js`
- Create: `sentinel-webdesign/backend/routes/perimeterRoutes.js`
- Create: `sentinel-webdesign/backend/routes/governanceRoutes.js`
- Modify: `sentinel-webdesign/backend/server.js`
- Test: `sentinel-webdesign/backend/tests/routes.test.js`

**Interfaces:**
- Produces:
  - `GET /api/apm/overview`: Returns Apdex score, violation counts, synthetic failures, and recent deployments history.
  - `GET /api/k8s/mesh`: Returns active compute cores (3,842), memory allocation (73.8 TB), object counts, and node honeycomb statuses.
  - `GET /api/perimeter/telemetry`: Returns edge bandwidth (112 GB), log volume (9.39M), failures by host/status, and live request stream.
  - `GET /api/governance/sod-audit`: Returns pending SoD actions, ServiceNow sync tickets, and append-only WAL logs.

- [ ] **Step 1: Write test for new API endpoints**
- [ ] **Step 2: Run test to verify failure** (`npm test` in backend)
- [ ] **Step 3: Implement modular sub-routers and mount in `server.js`**
- [ ] **Step 4: Verify all new and legacy endpoints return 200 OK**
- [ ] **Step 5: Git commit backend modularization**

---

### Task 2: High-Performance Canvas Chart Utility Component

**Files:**
- Create: `sentinel-webdesign/frontend/src/components/shared/ReactiveCanvasChart.jsx`
- Create: `sentinel-webdesign/frontend/src/components/shared/DonutChart.jsx`
- Test: `sentinel-webdesign/frontend/src/components/shared/__tests__/charts.test.jsx`

**Interfaces:**
- Produces:
  - `<ReactiveCanvasChart type="line"|"area"|"spikes" data={series} options={config} />`
  - `<DonutChart segments={items} size={140} innerRadius={36} />`
- Consumes: Theme variables from CSS root (`--chart-grid`, `--primary`, `--healthy`, `--critical`).

- [ ] **Step 1: Write unit tests for ReactiveCanvasChart rendering and DPR scaling**
- [ ] **Step 2: Implement ReactiveCanvasChart using Canvas 2D context** (dual lines, multi-tier stacked areas, vertical spike bars)
- [ ] **Step 3: Implement DonutChart with arc rendering and hover legend**
- [ ] **Step 4: Verify smooth rendering and theme switching responsiveness**
- [ ] **Step 5: Git commit shared chart components**

---

### Task 3: NOC APM & Transactions View (Reference Images 1 & 4)

**Files:**
- Create: `sentinel-webdesign/frontend/src/components/apm/NocApmView.jsx`
- Create: `sentinel-webdesign/frontend/src/components/apm/RecentDeploymentsTable.jsx`
- Modify: `sentinel-webdesign/frontend/src/App.css` (add APM specific card layout styles)
- Test: `sentinel-webdesign/frontend/src/components/apm/__tests__/NocApmView.test.jsx`

**Interfaces:**
- Produces: `<NocApmView apmData={state} onInspectDeploy={fn} />`
- Consumes: `/api/apm/overview` and WebSocket `metrics_tick`.
- Replicates:
  - Top stat cards: `13 All Violations` and `13 Synthetic Failures`
  - `Recent deployments` history table (v1.5, deployer, description, time)
  - `Apdex score` gauge and line curve (T = 100ms)
  - `WebTransactions` dual-line chart (Average response time + Standard deviation)
  - `Errors per minute` area spikes & `Datastore/all` throughput
  - Layered stacked transaction time breakdown (Database, Cache, App Engine, Transit)

- [ ] **Step 1: Write component test verifying render of all 6 metric widgets**
- [ ] **Step 2: Implement RecentDeploymentsTable and NocApmView**
- [ ] **Step 3: Connect live data stream from `useMetrics` hook**
- [ ] **Step 4: Verify visual alignment and zero console warnings**
- [ ] **Step 5: Git commit NocApmView**

---

### Task 4: Kubernetes & Compute Cluster Mesh View (Reference Image 2)

**Files:**
- Create: `sentinel-webdesign/frontend/src/components/k8s/KubernetesMeshView.jsx`
- Create: `sentinel-webdesign/frontend/src/components/k8s/NodeHoneycombMesh.jsx`
- Test: `sentinel-webdesign/frontend/src/components/k8s/__tests__/KubernetesMeshView.test.jsx`

**Interfaces:**
- Produces: `<KubernetesMeshView k8sData={state} onSelectNode={fn} />`
- Consumes: `/api/k8s/mesh`.
- Replicates:
  - Top compute cards: `3,842 Cores` (Allocated) and `73.8 TB` (Committed RAM)
  - `# of K8s Objects` matrix (Namespaces, StatefulSets, Deployments, 3,854 Pods)
  - `Container Restarts` vertical bar spikes chart
  - `CPU Utilization by Namespace` (% Used vs Limit) progress bars
  - `Pods by Namespace` replica distribution bars
  - `48-Node Worker Cluster Honeycomb Mesh` with interactive hover states

- [ ] **Step 1: Write test verifying object counts and node mesh rendering**
- [ ] **Step 2: Implement NodeHoneycombMesh and KubernetesMeshView**
- [ ] **Step 3: Connect dynamic restart spikes and threshold bar animations**
- [ ] **Step 4: Verify responsiveness across 1080p and 4K displays**
- [ ] **Step 5: Git commit KubernetesMeshView**

---

### Task 5: Perimeter & Edge Logs View (Reference Images 3 & 5)

**Files:**
- Create: `sentinel-webdesign/frontend/src/components/perimeter/EdgePerimeterView.jsx`
- Create: `sentinel-webdesign/frontend/src/components/perimeter/LiveLogsStreamTable.jsx`
- Test: `sentinel-webdesign/frontend/src/components/perimeter/__tests__/EdgePerimeterView.test.jsx`

**Interfaces:**
- Produces: `<EdgePerimeterView telemetryData={state} />`
- Consumes: `/api/perimeter/telemetry` and WebSocket live logs buffer.
- Replicates:
  - Data transfer counter (`112 GB`) & real-time log rate (`9.39 M Logs/hr`)
  - Failures by Ingress Host donut chart (`api.bank.com`, `auth.bank.com`, etc.)
  - HTTP Response Code donut chart ($200, 304, 404, 500/502$)
  - Live security and request stream table with W3C Trace IDs (`traceparent`) and TLS VIPs

- [ ] **Step 1: Write test for log filtering and donut calculations**
- [ ] **Step 2: Implement LiveLogsStreamTable and EdgePerimeterView**
- [ ] **Step 3: Link live OTLP trace context drill-down to Trace Explorer**
- [ ] **Step 4: Verify zero DOM thrashing with 400-line virtualized tail**
- [ ] **Step 5: Git commit EdgePerimeterView**

---

### Task 6: Distributed Flamegraph & Autonomous Governance Integration

**Files:**
- Create: `sentinel-webdesign/frontend/src/components/diagnostics/FlamegraphProfiler.jsx`
- Create: `sentinel-webdesign/frontend/src/components/governance/SodGovernanceBanner.jsx`
- Modify: `sentinel-webdesign/frontend/src/components/ops/ServiceNowPanel.jsx`
- Test: `sentinel-webdesign/frontend/src/components/diagnostics/__tests__/FlamegraphProfiler.test.jsx`

**Interfaces:**
- Produces:
  - `<FlamegraphProfiler traceId="c92841ab7f004911" />`: Interactive span waterfall showing Oracle row lock contention (`enq: TX on PK_LEDGER_TX`) and HikariCP saturation.
  - `<SodGovernanceBanner onCoSign={fn} />`: Segregation of Duties dual-signature banner for high-impact runbook triggers.
- Consumes: `/api/governance/sod-audit`.

- [ ] **Step 1: Write test for span selection and dual-approval co-sign click**
- [ ] **Step 2: Implement FlamegraphProfiler and SodGovernanceBanner**
- [ ] **Step 3: Connect ServiceNow CMDB bidirectional incident sync**
- [ ] **Step 4: Verify append-only WAL cryptographic logging in audit stream**
- [ ] **Step 5: Git commit Flamegraph and Governance components**

---

### Task 7: Main Navigation & Persona Workspaces Consolidation

**Files:**
- Modify: `sentinel-webdesign/frontend/src/App.jsx`
- Modify: `sentinel-webdesign/frontend/src/App.css`
- Test: `sentinel-webdesign/frontend/src/__tests__/App.navigation.test.jsx`

**Interfaces:**
- Consumes: All views built in Tasks 3–6.
- Updates:
  - Sidebar links configured with canonical BFSI persona workspaces:
    1. 📊 `NOC APM & Transactions`
    2. 🛰️ `Kubernetes & Clusters`
    3. 📋 `Perimeter & Live Logs`
    4. 🧬 `Traces & Flamegraph`
    5. ⚡ `Autonomous SRE & ITSM`
    6. 🎯 `SLO & Error Budget`
  - Legacy view drawer accessible via "Advanced Ops / All Tools" dropdown without breaking existing deep links (`?tab=matrix`, `?tab=fleet`, etc.).
  - 4 Global Timezone Clocks (`SG`, `IST`, `EST`, `GMT`) in sticky header.
  - Quick Search (`⌘K`) palette trigger.
  - Instant toggle between `.dark-mode` and `.light-mode`.

- [ ] **Step 1: Write test for tab switching, URL hash/query persistence, and theme toggle**
- [ ] **Step 2: Update `App.jsx` with new workspace views while preserving maintenance config checks**
- [ ] **Step 3: Verify collapsible sidebar animation (280px drawer vs 76px mini dock)**
- [ ] **Step 4: Validate all 4 timezone clocks update live every second**
- [ ] **Step 5: Git commit App navigation and layout updates**

---

### Task 8: End-to-End Verification & Zero Regression Test Suite

**Files:**
- Create: `sentinel-webdesign/tests/e2e_bfsi_observability.spec.js`
- Test: Run complete backend and frontend test suites

- [ ] **Step 1: Run backend tests:** `npm test` inside `sentinel-webdesign/backend`
- [ ] **Step 2: Run frontend build:** `npm run build` inside `sentinel-webdesign/frontend` to verify clean bundle compilation with zero syntax or lint errors
- [ ] **Step 3: Verify all 16 legacy API endpoints continue to respond properly**
- [ ] **Step 4: Verify WebSocket telemetry stream connects and delivers real-time frames**
- [ ] **Step 5: Final Git commit and verification sign-off**
