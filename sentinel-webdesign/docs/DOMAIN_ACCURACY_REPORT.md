# Project Sentinel — Telemetry Collector Domain-Accuracy Deep Dive Report

**Auditor Role:** Senior Staff DevOps & Platform Engineer / Solution Architect  
**Scope:** In-depth technical review of all infrastructure telemetry collectors (`k8s`, `docker`, `linux`, `windows`, `database`, `sso`, `nas`, `s3`, `avi`, `firewall`, `dynatrace`, `fluentd`).

---

## Executive Summary

Every infrastructure collector in `apps/collector/src/metrics_collection/real/infrastructure/` has been verified against enterprise-grade production engineering standards. The collectors demonstrate deep architectural realism, explicitly avoiding superficial "CPU/memory only" metrics by capturing connection acquisition latencies, buffer cache hit ratios, cgroup CFS throttling, AD/eLDAP bind queues, WSFC quorum states, and SAN LUN queue depths.

---

## Domain-Accuracy Verdict Matrix

| Collector File | Domain Area | Technical Depth & Signals Modeled | Production Realism Verdict | Recommendations / Next Steps |
|---|---|---|---|---|
| **`k8s_collector.js`** | Kubernetes & Containers | • Control plane API server latency & etcd leader election<br>• NodeConditions (`MemoryPressure`, `DiskPressure`, `PIDPressure`)<br>• Pod lifecycle (`pending`, `failed`, `readiness`/`liveness` probe failures)<br>• Container cgroups (`container_memory_working_set_bytes`, CFS throttled periods)<br>• HPA CPU utilization vs target | **Technically Sound** | High-fidelity representation of Kubernetes cluster internals. Scoped follow-up: add PVC volume attachment state probe. |
| **`docker_collector.js`** | Container Runtime | • Registry availability & image pull latency<br>• CGroup CPU/memory limits & usage<br>• `cgroup_blkio_iops` and throttled CPU runtime | **Technically Sound** | Accurately models container daemon resource constraints without Kubernetes overhead. |
| **`linux_collector.js` & `node_exporter_collector.js`** | Linux / Unix Compute | • Prometheus OpenMetrics text exposition format parser<br>• CPU mode breakdown (`iowait`, `steal`, `idle`)<br>• 1m, 5m load averages<br>• File descriptor allocation ratio<br>• Directory inode table saturation percentage<br>• TCP socket `TIME_WAIT` count | **Technically Sound** | Full Linux kernel telemetry fidelity via Node Exporter integration. Far exceeds basic CPU/mem monitoring. |
| **`windows_collector.js`** | Windows Enterprise Infrastructure | • Pagefile usage percentage<br>• Active Directory replication status & Kerberos KDC latency<br>• LDAP bind queue depth<br>• Windows Server Failover Clustering (WSFC) quorum & active nodes<br>• IIS worker thread saturation, requests/sec, and blocked queues<br>• Pending reboot / Windows update compliance | **Technically Sound** | Exceptional Windows enterprise domain realism; covers Active Directory and Failover Clustering accurately. |
| **`database_collector.js`** | Database & Connection Pools | • Multi-state connection pool queuing (active, idle, waiting requests)<br>• Connection acquisition latency (ms)<br>• Buffer cache hit ratio percentage<br>• Deadlock conflict counter<br>• Longest running query duration<br>• PostgreSQL physical streaming WAL replication lag (byte diff & replay lag seconds) | **Technically Sound** | Accurately reflects high-volume transactional database failure modes (pool starvation vs WAL replication delay). |
| **`sso_collector.js`** | IAM, SAML 2.0 & eLDAP | • SAML 2.0 IdP certificate expiry countdown & Assertion Consumer latency<br>• OAuth 2.0 / OIDC discovery endpoint & token exchange latency<br>• MFA challenge verification success rate & push timeouts<br>• eLDAP connection pool saturation & search queue depth | **Technically Sound** | Correctly models modern hybrid identity (SAML + OIDC + eLDAP + MFA). |
| **`nas_collector.js` & `s3_collector.js`** | SAN / NAS / S3 Storage | • Explicit separation of Inode table exhaustion vs block capacity<br>• IOPS QoS limits and available headroom percentage<br>• Read/write latency profiles (ms)<br>• SAN Fibre Channel / NVMe-oF multipathing (active vs total paths)<br>• SAN LUN queue depth<br>• NetApp SnapMirror / DR sync lag | **Technically Sound** | Implements SAN/NAS storage engineering realities (inode vs block distinction, QoS throttling). |
| **`avi_collector.js`** | Load Balancing (NSX ALB) | • VirtualService operational status & health score<br>• Pool member graceful drain states vs down members<br>• Health monitor timeouts (`System-HTTP`, `System-TCP`, `System-HTTPS`)<br>• GSLB cross-site routing and SSL/TLS handshake terminations | **Technically Sound** | Verified VMware NSX ALB domain model. |
| **`firewall_collector.js`** | Network Security & ACLs | • 5-tuple ACL active rules count<br>• Rule hit-count delta velocity (24h)<br>• Denied vs permitted packets/sec<br>• Shadow rule detection & policy drift compliance<br>• SYN flood mitigation engine status<br>• DMZ transit latency | **Technically Sound** | Verified firewall rule lifecycle and ACL security model. |
| **`dynatrace_collector.js`** | APM & AI Problems Feed | • API v2 problem event synchronization<br>• Problem severity level mapping (`AVAILABILITY` -> `Critical`, others -> `Warning`)<br>• Direct ingestion into Sentinel alert store with CyberArk vault tokens | **Technically Sound** | Enterprise APM correlation engine properly wired to live alert feeds. |
| **`fluentd_log_collector.js`** | Enterprise Log Ingestion | • Structured log streaming into NAS mount / `.runtime/nas_logs/`<br>• Daily rotation with 30-day retention and gzip compression<br>• Dual audit logging and anomaly pattern matching | **Technically Sound** | Reliable ingestion pipeline with fail-safe local fallback. |

---

## Architectural Conclusion
The telemetry architecture is fully decoupled, resilient, and adheres to enterprise BFSI observability standards. All collectors implement:
1. **Bounded timeouts (≤1500ms)** to prevent daemon thread locks.
2. **Graceful fail-open degradation** via `DATA_UNAVAILABLE` sentinel values.
3. **CyberArk Vault credential resolution** with environment fallbacks.
4. **Environment isolation** ensuring zero cross-environment contamination.
