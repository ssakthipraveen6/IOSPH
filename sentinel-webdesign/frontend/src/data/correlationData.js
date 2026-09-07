/**
 * correlationData.js
 * 
 * CONNECTIVE ARCHITECTURE LAYER: Data Models & Mock Feeds
 * Strictly additive. Read-only normalization of events across:
 * - Application metric anomalies
 * - Server/infra metric anomalies
 * - Network path changes
 * - AVI / VIP pool member flips
 * - DNS & GSLB changes
 * - Firewall rule updates
 * - Config drift events
 * - Deployments, Git commits & ArgoCD syncs
 * - Terraform applies
 * - Approved ServiceNow CHG tickets
 * - Certificate & license renewals
 * - Incident open/close events
 */

import { SEVERITY } from '@sentinel/shared-constants';

export const NORMALIZED_TIMELINE_EVENTS = [
  // 1. Config Drift Event
  {
    id: 'evt-drift-01',
    trackId: 'drift',
    trackName: 'Config Drift (IaC vs Live)',
    icon: '⚖️',
    timestamp: '2026-09-06T07:45:00Z',
    relativeTime: '1h 15m ago',
    title: 'Drift: ASG Worker Pool Scaled Down & Downsized',
    entityId: 'bitbucket-mesh-pool',
    entityName: 'bitbucket-mesh-worker-pool',
    entityType: 'ASG Compute',
    severity: 'critical',
    badge: 'DRIFT DETECTED',
    summary: 'Live instance type changed to c6i.2xlarge (IaC expects c6i.4xlarge). Capacity dropped to 4 nodes.',
    details: {
      source: 'Terraform Drift Scanner (lon-prod-k8s-01)',
      iacManifest: 'terraform/eks/bitbucket.tf#L42',
      operator: 'manual-hotfix-override',
      diff: '- instance_type: "c6i.4xlarge"\n+ instance_type: "c6i.2xlarge"\n- desired_capacity: 8\n+ desired_capacity: 4'
    }
  },

  // 2. Deployment / Git Commit
  {
    id: 'evt-deploy-01',
    trackId: 'deploy',
    trackName: 'Deployments & GitOps',
    icon: '🚀',
    timestamp: '2026-09-06T07:50:00Z',
    relativeTime: '1h 10m ago',
    title: 'ArgoCD Sync: Bitbucket Mesh Upgrade to v8.19.2',
    entityId: 'app-bitbucket',
    entityName: 'Bitbucket Enterprise',
    entityType: 'Application',
    severity: 'warning',
    badge: 'ARGOCD SYNC-8841',
    summary: 'Rollout of Bitbucket mesh storage daemon v8.19.2 completed on 4 nodes.',
    details: {
      commit: 'e718bc3',
      author: 'cicd-bot',
      repo: 'internal/bitbucket-helm-charts',
      serviceNowChg: 'CHG0099412'
    }
  },

  // 3. Approved Change Ticket
  {
    id: 'evt-chg-01',
    trackId: 'chg',
    trackName: 'ServiceNow CHG Tickets',
    icon: '🎫',
    timestamp: '2026-09-06T07:55:00Z',
    relativeTime: '1h 05m ago',
    title: 'CHG0099412 Approved: Bitbucket Mesh Node Expansion',
    entityId: 'bitbucket-mesh-pool',
    entityName: 'bitbucket-mesh-worker-pool',
    entityType: 'ASG Compute',
    severity: 'info',
    badge: 'CAB APPROVED',
    summary: 'Standard emergency maintenance window authorized by CAB for storage tier patch.',
    details: {
      ticketId: 'CHG0099412',
      approval: 'Emergency CAB Quorum',
      assignee: 'sre-oncall@corp'
    }
  },

  // 4. Server / Infra Metric Anomaly
  {
    id: 'evt-infra-01',
    trackId: 'infra_metrics',
    trackName: 'Infra Metric Anomalies',
    icon: '⚙️',
    timestamp: '2026-09-06T08:05:00Z',
    relativeTime: '55m ago',
    title: 'Node CPU Spike & Inode Saturation on lon-node-bb-01',
    entityId: 'node-lon-bb-01',
    entityName: 'node-lon-bb-01.internal',
    entityType: 'Host Node',
    severity: 'critical',
    badge: '94.2% INODES EXHAUSTED',
    summary: '/var/log/audit inode count reached 94.2% (only 41k inodes left). Disk write latency spiked to 120ms.',
    details: {
      metric: 'vfs.inodes.used_pct',
      threshold: '85.0%',
      currentValue: '94.2%',
      mountPoint: '/var/log/audit'
    }
  },

  // 5. Application Metric Anomaly
  {
    id: 'evt-app-01',
    trackId: 'app_metrics',
    trackName: 'App Metric Anomalies',
    icon: '🚨',
    timestamp: '2026-09-06T08:12:00Z',
    relativeTime: '48m ago',
    title: 'Bitbucket p95 Latency Spike: 482ms (Breached Mon 09:00 Band)',
    entityId: 'app-bitbucket',
    entityName: 'Bitbucket Enterprise',
    entityType: 'Application',
    severity: 'critical',
    badge: '+108% DEVIATION',
    summary: 'JVM Full GC pause of 1,420ms triggered Git clone HTTP 504 timeouts across the cluster.',
    details: {
      metric: 'http.server.requests.latency_p95',
      expectedBand: '180ms - 240ms',
      actualValue: '482ms',
      gcPauseMax: '1,420ms'
    }
  },

  // 6. AVI / Load Balancer Member Flip
  {
    id: 'evt-avi-01',
    trackId: 'avi_lb',
    trackName: 'AVI / LB Pool Flips',
    icon: '⚖️',
    timestamp: '2026-09-06T08:15:00Z',
    relativeTime: '45m ago',
    title: 'Pool Member Flipped: node-lon-bb-03 marked DOWN',
    entityId: 'vip-avi-bitbucket',
    entityName: 'avi-vip-bitbucket.corp',
    entityType: 'Load Balancer VIP',
    severity: 'critical',
    badge: 'POOL MEMBER DOWN',
    summary: 'AVI Ingress probe detected HTTP 503 from node-lon-bb-03:7990. Traffic shed to 2 remaining nodes.',
    details: {
      vip: 'avi-vip-bitbucket.corp (10.240.10.50)',
      member: 'node-lon-bb-03.internal:7990',
      reason: 'HTTP 503 Service Unavailable (TCP Refused on heartbeat port)'
    }
  },

  // 7. Incident Open Event
  {
    id: 'evt-inc-01',
    trackId: 'incidents',
    trackName: 'Incident Open / Close',
    icon: '⚠️',
    timestamp: '2026-09-06T08:18:00Z',
    relativeTime: '42m ago',
    title: 'INC0091823 P1 Opened: Bitbucket High Latency & Git Timeouts',
    entityId: 'app-bitbucket',
    entityName: 'Bitbucket Enterprise',
    entityType: 'Application',
    severity: 'critical',
    badge: 'P1 CRITICAL OPEN',
    summary: 'P1 incident paged to DevOps APS. ~1,850 developers blocked globally.',
    details: {
      ticketId: 'INC0091823',
      priority: 'P1 CRITICAL',
      assignmentGroup: 'devops aps',
      costPerMin: '$2,621/min'
    }
  },

  // 8. DNS / GSLB Change
  {
    id: 'evt-dns-01',
    trackId: 'dns_gslb',
    trackName: 'DNS & GSLB Routing',
    icon: '📡',
    timestamp: '2026-09-06T08:22:00Z',
    relativeTime: '38m ago',
    title: 'GSLB Traffic Shift: Jenkins Standby Active in SG-DC',
    entityId: 'dns-jenkins',
    entityName: 'jenkins.internal.corp',
    entityType: 'DNS GSLB',
    severity: 'warning',
    badge: 'FAILOVER ROUTE',
    summary: 'Resolution redirected to 10.200.1.3 (BIND9-SEC) due to LON worker saturation.',
    details: {
      domain: 'jenkins.internal.corp',
      previousRegion: 'LON-DC (Active)',
      currentRegion: 'SG-DC (Standby Active)',
      ttl: '30s'
    }
  },

  // 9. Firewall & Network Path
  {
    id: 'evt-fw-01',
    trackId: 'firewall',
    trackName: 'Firewall & Security Rules',
    icon: '🛡️',
    timestamp: '2026-09-06T08:25:00Z',
    relativeTime: '35m ago',
    title: 'Security Alert: Rogue Ingress 0.0.0.0/0:22 on TimescaleDB',
    entityId: 'sec-group-db',
    entityName: 'sg-timescale-db-prod',
    entityType: 'Security Group',
    severity: 'critical',
    badge: 'PORT 22 VIOLATION',
    summary: 'Unapproved SSH rule opened directly to the Internet. Flagged by automated compliance auditor.',
    details: {
      ruleId: 'sg-timescale-db-prod-rule-4',
      target: '10.240.5.20:22',
      complianceViolation: 'SOC 2 / ISO 27001 Perimeter Breach'
    }
  },

  // 10. Certificate Expiry Warning
  {
    id: 'evt-cert-01',
    trackId: 'certificates',
    trackName: 'Certificates & Expiry',
    icon: '🔒',
    timestamp: '2026-09-06T08:30:00Z',
    relativeTime: '30m ago',
    title: 'CA Expiry Alert: Corporate Issuing Sub-CA v2 (8 Days Left)',
    entityId: 'cert-subca-v2',
    entityName: 'Corporate Issuing Sub-CA v2',
    entityType: 'Certificate Authority',
    severity: 'critical',
    badge: '8 DAYS REMAINING',
    summary: 'Intermediate CA expires on 2026-09-14. Cascades to invalidate 14 production leaf certificates.',
    details: {
      issuer: 'Corporate Internal Root CA 2016',
      algorithm: 'RSA-4096 / SHA-256',
      affectedLeafCerts: 14
    }
  }
];

// Master Entity Catalog (Entity-Centric Resolver for all 13 apps & infrastructure tiers)
export const MASTER_ENTITY_CATALOG = [
  // ==========================================
  // TIER 1: APPLICATIONS (All 13 Apps)
  // ==========================================
  {
    id: 'app-bitbucket',
    appKey: 'bitbucket',
    name: 'Atlassian Bitbucket Enterprise',
    type: 'Application',
    icon: '📦',
    status: 'critical',
    hostOrIp: '12 Linux Servers + Regional Mirrors (EMEA / AMER / APAC)',
    tier: 'Tier-1 Core DevOps',
    owner: 'devops aps',
    metrics: { p95Latency: '482 ms', errorRate: '3.4%', throughput: '320 req/s', saturation: '92%' },
    driftStatus: { 
      drifted: true, 
      count: 1, 
      summary: 'ASG instance type downsized (c6i.2xlarge instead of c6i.4xlarge)',
      diff: '- instance_type: "c6i.4xlarge"\n+ instance_type: "c6i.2xlarge"\n- desired_capacity: 12\n+ desired_capacity: 4',
      iacFile: 'terraform/eks/bitbucket.tf#L42'
    },
    dependencies: {
      fanIn: ['avi-vip-bitbucket.corp (10.240.10.50)', 'sso-okta-eldap (SSO Only)'],
      fanOut: ['timescale-db-primary (PostgreSQL 16)', 'san-storage-nfs-01 (Enterprise NFS Mount)', 'lon-bb-lnx-01..04', 'nyc-bb-lnx-05..08', 'sgp-bb-lnx-09..12']
    },
    expiryItems: [{ name: 'TLS Leaf Cert', daysLeft: 12, status: 'warning', issuer: 'DigiCert Corporate CA', autoRenew: 'HashiCorp Vault' }],
    recentIncidents: [{ id: 'INC0091823', title: 'Bitbucket git-lfs upload socket timeout on lon-bb-node-02', status: 'In Progress', priority: 'P1', duration: '14m' }],
    recentChanges: [{ id: 'SYNC-8841', type: 'ArgoCD Sync', desc: 'Upgraded mesh daemon to v8.19.2 across 12 servers' }],
    backendNodes: [
      'lon-bb-lnx-01..04 (EMEA Primary 4-Node Cluster)',
      'nyc-bb-lnx-05..08 (AMER Regional Mirror 4-Node Cluster)',
      'sgp-bb-lnx-09..12 (APAC Regional Mirror 4-Node Cluster)'
    ]
  },
  {
    id: 'app-artifactory',
    appKey: 'artifactory',
    name: 'JFrog Artifactory Universal Registry',
    type: 'Application',
    icon: '📦',
    status: 'warning',
    hostOrIp: '4 Linux Servers + 2 Xray Servers + AMER/APAC Mirrors',
    tier: 'Tier-1 Core DevOps',
    owner: 'devops aps',
    metrics: { p95Latency: '85 ms', errorRate: '0.05%', throughput: '1.4k req/s', saturation: '68%' },
    driftStatus: { 
      drifted: false, 
      count: 0, 
      summary: 'Live cluster fully aligns with GitOps Helm release',
      diff: '✓ All 4 primary nodes and 2 Xray engines in sync',
      iacFile: 'helm/artifactory-ha/values.yaml'
    },
    dependencies: {
      fanIn: ['avi-vip-artifactory.corp (10.240.10.51)', 'sso-okta-eldap (SSO and eLDAP)'],
      fanOut: ['pgsql-artifactory-db (PostgreSQL 15)', 's3-blobstore-artifactory (S3 Object Store + NVMe)', 'lon-arty-lnx-01..04', 'lon-xray-srv-01..02']
    },
    expiryItems: [{ name: 'TLS Leaf Cert', daysLeft: 148, status: 'healthy', issuer: 'DigiCert Corporate CA', autoRenew: 'Let’s Encrypt Enterprise' }],
    recentIncidents: [{ id: 'INC0091410', title: 'JFrog Artifactory binary replication lag > 150s (NFS cache contention)', status: 'Investigating', priority: 'P2', duration: '32m' }],
    recentChanges: [{ id: 'REG-2201', type: 'Docker Image Ingest', desc: 'Promoted nodejs:20-alpine enterprise security baseline' }],
    backendNodes: [
      'lon-arty-lnx-01..04 (4 Linux Primary HA Nodes)',
      'lon-xray-srv-01..02 (2 Dedicated Xray Security Engines)',
      'nyc-arty-mirror (AMER Regional Edge Mirror)',
      'sgp-arty-mirror (APAC Regional Edge Mirror)'
    ]
  },
  {
    id: 'app-jenkins',
    appKey: 'jenkins',
    name: 'CloudBees Jenkins Build Farm',
    type: 'Application',
    icon: '📦',
    status: 'warning',
    hostOrIp: '1 CJOC K8s + 5 Ctrl K8s + 4 Agt K8s + 200 Win Agts + 10 Linux',
    tier: 'Tier-1 Core DevOps',
    owner: 'devops aps',
    metrics: { p95Latency: '110 ms', errorRate: '0.12%', throughput: '48 builds/m', saturation: '72%' },
    driftStatus: { 
      drifted: true, 
      count: 1, 
      summary: 'Controller replicas running: 3 (GitOps specifies 5 controllers)',
      diff: '- replicas: 5\n+ replicas: 3\n- executor_limit: 50\n+ executor_limit: 30',
      iacFile: 'k8s/jenkins-enterprise/controllers.yaml'
    },
    dependencies: {
      fanIn: ['avi-vip-jenkins.corp (10.240.10.55)', 'sso-okta-eldap (SSO Only)'],
      fanOut: ['nas-storage-jenkins (NAS Mount + Dynamic PVs)', 'k8s-cjoc-ops-01', 'k8s-jenk-ctrl-01..05', 'win-bld-agt-001..200', 'lon-lnx-srv-01..10']
    },
    expiryItems: [{ name: 'TLS Leaf Cert', daysLeft: 4, status: 'critical', issuer: 'Internal Root CA v3', autoRenew: 'Manual CAB Approval Required' }],
    recentIncidents: [{ id: 'INC0090884', title: 'CloudBees Jenkins runner pod eviction warning on k8s-worker-node-09', status: 'Mitigating', priority: 'P2', duration: '48m' }],
    recentChanges: [{ id: 'CHG0098110', type: 'ServiceNow CAB', desc: 'Worker disk expansion on 10 Linux build servers' }],
    backendNodes: [
      'k8s-cjoc-ops-01 (Operations Center Master)',
      'k8s-jenk-ctrl-01..05 (5 K8s Controllers)',
      'k8s-jenk-agt-01..04 (4 Dynamic K8s Agents)',
      'win-bld-agt-001..200 (200 Windows Build Agents)',
      'lon-lnx-srv-01..10 (10 Dedicated Linux Servers)'
    ]
  },
  {
    id: 'app-fortify',
    appKey: 'fortify',
    name: 'OpenText Fortify SSC',
    type: 'Application',
    icon: '📦',
    status: 'healthy',
    hostOrIp: '2 ScanCentral Controllers + 10 Sensors + Central DB',
    tier: 'Tier-1 AppSec Analysis',
    owner: 'devops aps',
    metrics: { p95Latency: '42 ms', errorRate: '0.00%', throughput: '85 scans/h', saturation: '38%' },
    driftStatus: { 
      drifted: false, 
      count: 0, 
      summary: 'All 10 active scan sensors connected and verified',
      diff: '✓ Sensor pool and controllers matching security baseline',
      iacFile: 'ansible/fortify/scancentral.yml'
    },
    dependencies: {
      fanIn: ['avi-vip-fortify.corp (10.240.10.52)', 'sso-okta-eldap (SSO and eLDAP)'],
      fanOut: ['lon-fort-db-01 (Central SSC Database)', 'nas-storage-fortify (NAS Mount)', 'lon-sc-ctrl-01..02', 'lon-sc-sensor-01..10']
    },
    expiryItems: [{ name: 'SSC Token Authority', daysLeft: 64, status: 'healthy', issuer: 'Internal Root CA v3', autoRenew: 'Automated ACME' }],
    recentIncidents: [],
    recentChanges: [{ id: 'SEC-4011', type: 'Rulepack Update', desc: 'Updated 2026.3 SAST security rulepacks across sensors' }],
    backendNodes: [
      'lon-sc-ctrl-01 (ScanCentral Controller 1)',
      'lon-sc-ctrl-02 (ScanCentral Controller 2)',
      'lon-sc-sensor-01..10 (10 Dynamic Scan Sensors)',
      'lon-fort-db-01 (Dedicated SSC Central DB)'
    ]
  },
  {
    id: 'app-sonarqube',
    appKey: 'sonarqube',
    name: 'SonarQube Enterprise Server',
    type: 'Application',
    icon: '📦',
    status: 'healthy',
    hostOrIp: '2 Enterprise Clustered Nodes (Active-Active HA)',
    tier: 'Tier-1 Code Quality & Security',
    owner: 'devops aps',
    metrics: { p95Latency: '54 ms', errorRate: '0.01%', throughput: '120 jobs/h', saturation: '52%' },
    driftStatus: { 
      drifted: false, 
      count: 0, 
      summary: 'Cluster compute nodes synchronized with Terraform state',
      diff: '✓ Quality gate definitions and node allocations in sync',
      iacFile: 'terraform/sonarqube/cluster.tf'
    },
    dependencies: {
      fanIn: ['avi-vip-sonarqube.corp (10.240.10.54)', 'sso-okta-eldap (SSO and eLDAP)'],
      fanOut: ['pgsql-sonarqube-db (PostgreSQL 16)', 'nas-storage-sonarqube (NAS Mount)', 'lon-sq-01', 'lon-sq-02']
    },
    expiryItems: [{ name: 'TLS Leaf Cert', daysLeft: 92, status: 'healthy', issuer: 'DigiCert Corporate CA', autoRenew: 'Automated ACME' }],
    recentIncidents: [],
    recentChanges: [{ id: 'QG-102', type: 'Quality Gate Policy', desc: 'Enforced zero critical vulnerability threshold for Tier-1 apps' }],
    backendNodes: [
      'lon-sq-01 (10.240.20.51 - Compute Node 1)',
      'lon-sq-02 (10.240.20.52 - Compute Node 2)'
    ]
  },
  {
    id: 'app-nexusiq',
    appKey: 'nexusiq',
    name: 'Sonatype NexusIQ Server',
    type: 'Application',
    icon: '📦',
    status: 'healthy',
    hostOrIp: 'Linux Servers + Dedicated PostgreSQL DB',
    tier: 'Tier-1 Software Supply Chain',
    owner: 'devops aps',
    metrics: { p95Latency: '38 ms', errorRate: '0.00%', throughput: '210 evals/h', saturation: '34%' },
    driftStatus: { 
      drifted: false, 
      count: 0, 
      summary: 'Policy quarantine engine compliant with corporate security baseline',
      diff: '✓ Quarantine rules and license evaluators up to date',
      iacFile: 'terraform/nexusiq/instance.tf'
    },
    dependencies: {
      fanIn: ['avi-vip-nexusiq.corp (10.240.10.53)', 'sso-okta-eldap (SSO and eLDAP)'],
      fanOut: ['lon-nx-pg-cluster (PostgreSQL 15)', 'nas-storage-nexus (NAS Mount)', 'lon-nx-lnx-01', 'lon-nx-lnx-02']
    },
    expiryItems: [{ name: 'Policy DB Certificate', daysLeft: 190, status: 'healthy', issuer: 'DigiCert Corporate CA', autoRenew: 'Managed PKI' }],
    recentIncidents: [],
    recentChanges: [{ id: 'IQ-881', type: 'Vulnerability Database', desc: 'Synced daily CVE and open-source license definitions' }],
    backendNodes: [
      'lon-nx-lnx-01 (Linux Server Node 1)',
      'lon-nx-lnx-02 (Linux Server Node 2)',
      'lon-nx-pg-cluster (Dedicated PostgreSQL Cluster)'
    ]
  },
  {
    id: 'app-argocd',
    appKey: 'argocd',
    name: 'ArgoCD Hub Cluster',
    type: 'Application',
    icon: '📦',
    status: 'healthy',
    hostOrIp: 'Kubernetes (K8s) High-Availability Cluster',
    tier: 'Tier-1 GitOps Continuous Delivery',
    owner: 'devops aps',
    metrics: { p95Latency: '18 ms', errorRate: '0.00%', throughput: '510 req/s', saturation: '38%' },
    driftStatus: { 
      drifted: false, 
      count: 0, 
      summary: 'GitOps reconciliation loop synchronized with repo HEAD',
      diff: '✓ All 142 microservice applications Synced & Healthy',
      iacFile: 'gitops/argocd/root-app.yaml'
    },
    dependencies: {
      fanIn: ['avi-vip-argocd.corp (10.240.10.57)', 'sso-okta-eldap with Dax'],
      fanOut: ['k8s-argo-ctrl-plane', 'argocd-server-ha', 'argocd-repo-server', 'argocd-app-controller', 'argocd-redis-ha']
    },
    expiryItems: [{ name: 'Cluster OIDC Secret', daysLeft: 280, status: 'healthy', issuer: 'Dax OIDC Authority', autoRenew: 'Automated OAuth2' }],
    recentIncidents: [],
    recentChanges: [{ id: 'GITOPS-994', type: 'ArgoCD Rollout', desc: 'Auto-synced release v2.14 across production clusters' }],
    backendNodes: [
      'k8s-argo-ctrl-plane-01..03 (HA Control Plane)',
      'argocd-server-ha-01..03 (API & Web Server Pods)',
      'argocd-repo-server-01..03 (Git Repo Sync Engines)',
      'argocd-app-controller-01..02 (State Controllers)',
      'argocd-redis-ha-01..03 (Redis Sentinel Cluster)'
    ]
  },
  {
    id: 'app-teamcity',
    appKey: 'teamcity',
    name: 'JetBrains TeamCity Enterprise',
    type: 'Application',
    icon: '📦',
    status: 'healthy',
    hostOrIp: '5 Linux Servers + 5 Webservers + Build Agents',
    tier: 'Tier-2 CI Pipeline',
    owner: 'devops aps',
    metrics: { p95Latency: '52 ms', errorRate: '0.05%', throughput: '180 req/s', saturation: '61%' },
    driftStatus: { 
      drifted: false, 
      count: 0, 
      summary: 'All 5 webservers and 5 Linux core nodes fully balanced',
      diff: '✓ Web tier and agent configuration matching IaC manifest',
      iacFile: 'ansible/teamcity/nodes.yml'
    },
    dependencies: {
      fanIn: ['avi-vip-teamcity.corp (10.240.10.56)', 'sso-okta-eldap (SSO and eLDAP)'],
      fanOut: ['lon-tc-db-01 (PostgreSQL 15)', 'nas-storage-teamcity (NAS Mount)', 'lon-tc-lnx-01..05', 'lon-tc-web-01..05', 'tc-build-agents-pool']
    },
    expiryItems: [{ name: 'Agent mTLS Cert', daysLeft: 110, status: 'healthy', issuer: 'Let’s Encrypt Enterprise', autoRenew: 'Automated ACME' }],
    recentIncidents: [],
    recentChanges: [{ id: 'TC-552', type: 'Agent Expansion', desc: 'Provisioned 15 dynamic ephemeral build runners' }],
    backendNodes: [
      'lon-tc-lnx-01..05 (5 Linux Core Servers)',
      'lon-tc-web-01..05 (5 Clustered Web Application Servers)',
      'tc-build-agents-pool (Clustered Agent Farm)'
    ]
  },
  {
    id: 'app-github',
    appKey: 'github',
    name: 'GitHub Enterprise Server',
    type: 'Application',
    icon: '📦',
    status: 'healthy',
    hostOrIp: 'Kubernetes (K8s) Cluster + Windows JumpServers',
    tier: 'Tier-1 Source Control',
    owner: 'devops aps',
    metrics: { p95Latency: '35 ms', errorRate: '0.01%', throughput: '920 req/s', saturation: '44%' },
    driftStatus: { 
      drifted: false, 
      count: 0, 
      summary: 'K8s cluster and Windows JumpServer bastions fully hardened',
      diff: '✓ Security groups, jump bastions, and replica topology verified',
      iacFile: 'terraform/github/ghe-cluster.tf'
    },
    dependencies: {
      fanIn: ['avi-vip-github.corp (10.240.10.59)', 'sso-okta-eldap (SSO and eLDAP)'],
      fanOut: ['ghe-mysql-cluster (MySQL Enterprise)', 'nas-storage-ghe (NAS Mount)', 'k8s-ghe-cluster-core', 'win-jumpsrv-01.corp', 'win-jumpsrv-02.corp']
    },
    expiryItems: [{ name: 'GHE Enterprise License', daysLeft: 310, status: 'healthy', issuer: 'GitHub Corporate Licensing', autoRenew: 'Enterprise Subscription' }],
    recentIncidents: [],
    recentChanges: [{ id: 'GHE-904', type: 'Security Patch', desc: 'Applied GitHub Enterprise hotfix bundle v3.12' }],
    backendNodes: [
      'k8s-ghe-cluster-core (HA Multi-Node Workload Pods)',
      'win-jumpsrv-01.corp (Secure Windows JumpServer / Bastion)',
      'win-jumpsrv-02.corp (DMZ Windows JumpServer / Bastion)'
    ]
  },
  {
    id: 'app-argoworkflows',
    appKey: 'argoworkflows',
    name: 'Argo Workflows Pipeline Engine',
    type: 'Application',
    icon: '📦',
    status: 'healthy',
    hostOrIp: '4 K8s Controller & Server Pods (High-Throughput DAG)',
    tier: 'Tier-2 Cloud-Native Orchestration',
    owner: 'devops aps',
    metrics: { p95Latency: '22 ms', errorRate: '0.00%', throughput: '140 flows/m', saturation: '29%' },
    driftStatus: { 
      drifted: false, 
      count: 0, 
      summary: 'Workflow executor pods match cluster CRD definitions',
      diff: '✓ Workflow controller and argo-server pods in sync',
      iacFile: 'k8s/argo-workflows/install.yaml'
    },
    dependencies: {
      fanIn: ['avi-vip-argowf.corp (10.240.10.58)', 'sso-okta-eldap with Dax'],
      fanOut: ['workflow-controller-8b4c', 'argo-server-9d3f', 'workflow-exec-pod-01', 'workflow-exec-pod-02']
    },
    expiryItems: [{ name: 'Workflow Ingress Cert', daysLeft: 184, status: 'healthy', issuer: 'Let’s Encrypt Enterprise', autoRenew: 'Cert-Manager' }],
    recentIncidents: [],
    recentChanges: [{ id: 'ARGO-WF-12', type: 'CRD Upgrade', desc: 'Upgraded workflow templates to support multi-stage caching' }],
    backendNodes: [
      'workflow-controller-8b4c (Workflow Controller Pod)',
      'argo-server-9d3f (Argo Server Pod)',
      'workflow-exec-pod-01 (Dynamic Executor Node 1)',
      'workflow-exec-pod-02 (Dynamic Executor Node 2)'
    ]
  },
  {
    id: 'app-bitbucketexternal',
    appKey: 'bitbucket_external',
    name: 'Atlassian Bitbucket External (DMZ)',
    type: 'Application',
    icon: '📦',
    status: 'healthy',
    hostOrIp: '3 DMZ Clustered Nodes (Partner & Vendor Ingress)',
    tier: 'Tier-2 Partner Collaboration',
    owner: 'devops aps',
    metrics: { p95Latency: '62 ms', errorRate: '0.02%', throughput: '95 req/s', saturation: '41%' },
    driftStatus: { 
      drifted: false, 
      count: 0, 
      summary: 'DMZ reverse-proxy and firewall policies in full compliance',
      diff: '✓ Partner mTLS endpoints and DMZ node quotas verified',
      iacFile: 'terraform/dmz/bitbucket-partner.tf'
    },
    dependencies: {
      fanIn: ['avi-dmz-bitbucket.corp (10.240.10.60)', 'sso-okta-eldap (SSO Only)'],
      fanOut: ['dmz-bb-db-01 (PostgreSQL 15)', 'nas-storage-dmz (NAS Mount)', 'dmz-bb-01', 'dmz-bb-02', 'dmz-bb-03']
    },
    expiryItems: [{ name: 'Partner DMZ SSL Cert', daysLeft: 56, status: 'healthy', issuer: 'DigiCert Corporate CA', autoRenew: 'Managed PKI' }],
    recentIncidents: [],
    recentChanges: [{ id: 'DMZ-SEC-77', type: 'Firewall Policy', desc: 'Rotated external vendor mTLS whitelist certificates' }],
    backendNodes: [
      'dmz-bb-01 (172.16.10.11 - DMZ Partner Node 1)',
      'dmz-bb-02 (172.16.10.12 - DMZ Partner Node 2)',
      'dmz-bb-03 (172.16.10.13 - DMZ Partner Node 3)'
    ]
  },
  {
    id: 'app-otkr',
    appKey: 'otkr',
    name: 'OTKR Security Engine',
    type: 'Application',
    icon: '📦',
    status: 'healthy',
    hostOrIp: '2 Worker Security Nodes (Zero-Trust Key Management)',
    tier: 'Tier-1 Cryptographic Security',
    owner: 'devops aps',
    metrics: { p95Latency: '16 ms', errorRate: '0.00%', throughput: '1.2k ops/s', saturation: '31%' },
    driftStatus: { 
      drifted: false, 
      count: 0, 
      summary: 'Hardware Security Module (HSM) cluster synchronized',
      diff: '✓ Cryptographic keystore and token verifier in sync',
      iacFile: 'ansible/security/otkr-engine.yml'
    },
    dependencies: {
      fanIn: ['avi-vip-otkr.corp (10.240.10.61)', 'sso-okta-eldap (SSO and eLDAP)'],
      fanOut: ['otkr-secure-db (PostgreSQL 15)', 'nas-storage-otkr (Encrypted NAS Mount)', 'lon-otkr-01', 'lon-otkr-02']
    },
    expiryItems: [{ name: 'Master Keystore Cert', daysLeft: 210, status: 'healthy', issuer: 'CyberArk Corporate Sub-CA', autoRenew: 'HSM Key Rolling' }],
    recentIncidents: [],
    recentChanges: [{ id: 'HSM-441', type: 'Key Rotation', desc: 'Completed scheduled monthly token signing key rotation' }],
    backendNodes: [
      'lon-otkr-01 (10.240.30.71 - Crypto Worker Node 1)',
      'lon-otkr-02 (10.240.30.72 - Crypto Worker Node 2)'
    ]
  },
  {
    id: 'app-microfocus',
    appKey: 'performance_center',
    name: 'Micro Focus Performance Center',
    type: 'Application',
    icon: '📦',
    status: 'healthy',
    hostOrIp: '3 Windows Load Controller Servers (Enterprise ALM)',
    tier: 'Tier-2 Performance Testing',
    owner: 'devops aps',
    metrics: { p95Latency: '78 ms', errorRate: '0.04%', throughput: '45 tests/d', saturation: '48%' },
    driftStatus: { 
      drifted: false, 
      count: 0, 
      summary: 'Load generators and controller configuration synchronized',
      diff: '✓ Windows Server 2022 load controller baselines intact',
      iacFile: 'terraform/testing/performance-center.tf'
    },
    dependencies: {
      fanIn: ['avi-vip-perfcenter.corp (10.240.10.62)', 'sso-okta-eldap (SSO and eLDAP)'],
      fanOut: ['pc-sql-server (Microsoft SQL Server)', 'nas-storage-perfcenter (NAS Mount)', 'lon-pc-ctrl-01', 'lon-pc-load-01', 'lon-pc-load-02']
    },
    expiryItems: [{ name: 'Controller Web SSL Cert', daysLeft: 120, status: 'healthy', issuer: 'DigiCert Corporate CA', autoRenew: 'Automated ACME' }],
    recentIncidents: [],
    recentChanges: [{ id: 'ALM-308', type: 'License Update', desc: 'Applied 100k virtual user performance license extension' }],
    backendNodes: [
      'lon-pc-ctrl-01 (Load Controller Server 1)',
      'lon-pc-load-01 (Load Generator Server 1)',
      'lon-pc-load-02 (Load Generator Server 2)'
    ]
  },

  // ==========================================
  // TIER 2: LOAD BALANCER VIPS (All Dedicated AVI VIPs)
  // ==========================================
  {
    id: 'vip-avi-bitbucket',
    appKey: 'bitbucket',
    name: 'avi-vip-bitbucket.corp (bb-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'critical',
    hostOrIp: '10.240.10.50 (Port 443 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '14 ms', errorRate: '8.4%', throughput: '1,420 conn/s', saturation: '72%' },
    driftStatus: { drifted: false, count: 0, summary: 'TLS profile System-Standard-TLS13 active' },
    dependencies: {
      fanIn: ['corp-wan-perimeter', 'sso-okta-eldap'],
      fanOut: ['lon-bb-lnx-01..04', 'nyc-bb-lnx-05..08', 'sgp-bb-lnx-09..12']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 48, status: 'warning' }],
    recentIncidents: [{ id: 'INC0091823', title: 'Pool Member node-lon-bb-03 down', status: 'In Progress', priority: 'P1' }],
    recentChanges: [{ id: 'AVI-CFG-102', type: 'VirtualService', desc: 'Shedding traffic from node-03' }]
  },
  {
    id: 'vip-avi-artifactory',
    appKey: 'artifactory',
    name: 'avi-vip-artifactory.corp (arty-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.51 (Port 443 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '8 ms', errorRate: '0.01%', throughput: '2,850 conn/s', saturation: '54%' },
    driftStatus: { drifted: false, count: 0, summary: 'Health monitors 4/4 passing' },
    dependencies: {
      fanIn: ['corp-wan-perimeter', 'sso-okta-eldap'],
      fanOut: ['lon-arty-lnx-01..04', 'lon-xray-srv-01..02']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 148, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: [{ id: 'AVI-CFG-108', type: 'VirtualService', desc: 'Increased connection pool limit to 5000' }]
  },
  {
    id: 'vip-avi-fortify',
    appKey: 'fortify',
    name: 'avi-vip-fortify.corp (fort-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.52 (Port 8443 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '11 ms', errorRate: '0.00%', throughput: '420 conn/s', saturation: '32%' },
    driftStatus: { drifted: false, count: 0, summary: 'Active pool members 2/2 nominal' },
    dependencies: {
      fanIn: ['corp-wan-perimeter'],
      fanOut: ['lon-sc-ctrl-01', 'lon-sc-ctrl-02']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 64, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'vip-avi-nexusiq',
    appKey: 'nexusiq',
    name: 'avi-vip-nexusiq.corp (nx-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.53 (Port 443 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '9 ms', errorRate: '0.00%', throughput: '680 conn/s', saturation: '28%' },
    driftStatus: { drifted: false, count: 0, summary: 'Active pool members 2/2 nominal' },
    dependencies: {
      fanIn: ['corp-wan-perimeter'],
      fanOut: ['lon-nx-lnx-01', 'lon-nx-lnx-02']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 190, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'vip-avi-sonarqube',
    appKey: 'sonarqube',
    name: 'avi-vip-sonarqube.corp (sq-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.54 (Port 9000 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '10 ms', errorRate: '0.01%', throughput: '540 conn/s', saturation: '36%' },
    driftStatus: { drifted: false, count: 0, summary: 'Active pool members 2/2 nominal' },
    dependencies: {
      fanIn: ['corp-wan-perimeter'],
      fanOut: ['lon-sq-01', 'lon-sq-02']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 92, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'vip-avi-jenkins',
    appKey: 'jenkins',
    name: 'avi-vip-jenkins.corp (jenk-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.55 (Port 8080 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '15 ms', errorRate: '0.02%', throughput: '1,120 conn/s', saturation: '62%' },
    driftStatus: { drifted: false, count: 0, summary: 'Active pool members nominal' },
    dependencies: {
      fanIn: ['corp-wan-perimeter'],
      fanOut: ['k8s-cjoc-ops-01', 'k8s-jenk-ctrl-01..05']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 4, status: 'critical' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'vip-avi-teamcity',
    appKey: 'teamcity',
    name: 'avi-vip-teamcity.corp (tc-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.56 (Port 443 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '12 ms', errorRate: '0.01%', throughput: '890 conn/s', saturation: '45%' },
    driftStatus: { drifted: false, count: 0, summary: 'All 5 webservers actively load-balanced' },
    dependencies: {
      fanIn: ['corp-wan-perimeter'],
      fanOut: ['lon-tc-web-01..05']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 110, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'vip-avi-argocd',
    appKey: 'argocd',
    name: 'avi-vip-argocd.corp (argo-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.57 (Port 443 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '6 ms', errorRate: '0.00%', throughput: '3,200 conn/s', saturation: '31%' },
    driftStatus: { drifted: false, count: 0, summary: 'gRPC stream acceleration enabled' },
    dependencies: {
      fanIn: ['corp-wan-perimeter'],
      fanOut: ['argocd-server-ha-01..03']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 280, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'vip-avi-argoworkflows',
    appKey: 'argoworkflows',
    name: 'avi-vip-argowf.corp (wf-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.58 (Port 443 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '7 ms', errorRate: '0.00%', throughput: '940 conn/s', saturation: '24%' },
    driftStatus: { drifted: false, count: 0, summary: 'Argo server pool active' },
    dependencies: {
      fanIn: ['corp-wan-perimeter'],
      fanOut: ['argo-server-9d3f']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 184, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'vip-avi-github',
    appKey: 'github',
    name: 'avi-vip-github.corp (ghe-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.59 (Port 443 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '11 ms', errorRate: '0.01%', throughput: '2,400 conn/s', saturation: '46%' },
    driftStatus: { drifted: false, count: 0, summary: 'Git SSH & HTTPS SSL offload active' },
    dependencies: {
      fanIn: ['corp-wan-perimeter'],
      fanOut: ['k8s-ghe-cluster-core', 'win-jumpsrv-01.corp']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 310, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'vip-avi-bitbucketexternal',
    appKey: 'bitbucket_external',
    name: 'avi-dmz-bitbucket.corp (bb-dmz-vip)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.60 (Port 443 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '14 ms', errorRate: '0.02%', throughput: '610 conn/s', saturation: '38%' },
    driftStatus: { drifted: false, count: 0, summary: 'DMZ reverse proxy isolation nominal' },
    dependencies: {
      fanIn: ['dmz-edge-firewall'],
      fanOut: ['dmz-bb-01', 'dmz-bb-02', 'dmz-bb-03']
    },
    expiryItems: [{ name: 'DMZ VIP SSL Profile Cert', daysLeft: 56, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'vip-avi-otkr',
    appKey: 'otkr',
    name: 'avi-vip-otkr.corp (otkr-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.61 (Port 443 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '6 ms', errorRate: '0.00%', throughput: '1,800 conn/s', saturation: '29%' },
    driftStatus: { drifted: false, count: 0, summary: 'mTLS mutual authentication profile verified' },
    dependencies: {
      fanIn: ['corp-wan-perimeter'],
      fanOut: ['lon-otkr-01', 'lon-otkr-02']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 210, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'vip-avi-microfocus',
    appKey: 'performance_center',
    name: 'avi-vip-perfcenter.corp (pc-vip-01)',
    type: 'Load Balancer VIP',
    icon: '🌐',
    status: 'healthy',
    hostOrIp: '10.240.10.62 (Port 443 / HTTPS)',
    tier: 'AVI Ingress Gateway',
    owner: 'netops team',
    metrics: { p95Latency: '16 ms', errorRate: '0.03%', throughput: '510 conn/s', saturation: '42%' },
    driftStatus: { drifted: false, count: 0, summary: 'Load controller affinity session stickiness active' },
    dependencies: {
      fanIn: ['corp-wan-perimeter'],
      fanOut: ['lon-pc-ctrl-01', 'lon-pc-load-01', 'lon-pc-load-02']
    },
    expiryItems: [{ name: 'VIP SSL Profile Cert', daysLeft: 120, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },

  // ==========================================
  // TIER 3: HOST COMPUTE NODES & CLUSTERS
  // ==========================================
  {
    id: 'node-lon-bb-01',
    appKey: 'bitbucket',
    name: 'lon-bb-lnx-01 (Bitbucket Primary Node)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'critical',
    hostOrIp: '10.240.2.11 (Linux RHEL 9.2)',
    tier: 'Bare-Metal / VM Host',
    owner: 'infra ops',
    metrics: { p95Latency: '4 ms', errorRate: '0%', throughput: '1,800 iops', saturation: '94.2% Inodes' },
    driftStatus: { drifted: false, count: 0, summary: 'Kernel & OS baseline compliant' },
    dependencies: {
      fanIn: ['avi-vip-bitbucket.corp'],
      fanOut: ['san-storage-nfs-01']
    },
    expiryItems: [{ name: 'Host SSH Key', daysLeft: 240, status: 'healthy' }],
    recentIncidents: [{ id: 'INC0090884', title: '/var/log/audit inode exhaustion', status: 'Investigating', priority: 'P2' }],
    recentChanges: []
  },
  {
    id: 'node-nyc-bb-05',
    appKey: 'bitbucket',
    name: 'nyc-bb-lnx-05 (Bitbucket AMER Mirror)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'healthy',
    hostOrIp: '10.242.4.15 (Linux RHEL 9.2)',
    tier: 'Regional Mirror Node',
    owner: 'infra ops',
    metrics: { p95Latency: '3 ms', errorRate: '0%', throughput: '1,200 iops', saturation: '51%' },
    driftStatus: { drifted: false, count: 0, summary: 'Git mirror cache fully synchronized' },
    dependencies: {
      fanIn: ['avi-vip-bitbucket.corp'],
      fanOut: ['san-storage-nfs-01']
    },
    expiryItems: [{ name: 'Host SSH Key', daysLeft: 240, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'node-lon-arty-01',
    appKey: 'artifactory',
    name: 'lon-arty-lnx-01 (Artifactory Primary HA Node)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'healthy',
    hostOrIp: '10.240.2.21 (Linux RHEL 9.2)',
    tier: 'Bare-Metal / VM Host',
    owner: 'infra ops',
    metrics: { p95Latency: '3 ms', errorRate: '0%', throughput: '2,400 iops', saturation: '62%' },
    driftStatus: { drifted: false, count: 0, summary: 'JVM Xms/Xmx memory allocation optimal' },
    dependencies: {
      fanIn: ['avi-vip-artifactory.corp'],
      fanOut: ['s3-blobstore-artifactory']
    },
    expiryItems: [{ name: 'Host SSH Key', daysLeft: 210, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'node-lon-xray-01',
    appKey: 'artifactory',
    name: 'lon-xray-srv-01 (Xray Security Engine)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'healthy',
    hostOrIp: '10.240.2.25 (Linux RHEL 9.2)',
    tier: 'Security Analysis Compute',
    owner: 'infra ops',
    metrics: { p95Latency: '5 ms', errorRate: '0%', throughput: '950 iops', saturation: '48%' },
    driftStatus: { drifted: false, count: 0, summary: 'Deep binary inspection engine active' },
    dependencies: {
      fanIn: ['lon-arty-lnx-01..04'],
      fanOut: ['pgsql-artifactory-db']
    },
    expiryItems: [{ name: 'Host SSH Key', daysLeft: 210, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'node-k8s-cjoc-01',
    appKey: 'jenkins',
    name: 'k8s-cjoc-ops-01 (CloudBees Ops Center Master)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'healthy',
    hostOrIp: 'k8s-node-jenkins-pool-01 (Kubernetes Pod)',
    tier: 'CI Master Controller',
    owner: 'devops aps',
    metrics: { p95Latency: '6 ms', errorRate: '0%', throughput: '320 iops', saturation: '58%' },
    driftStatus: { drifted: false, count: 0, summary: 'Master cluster configuration in sync' },
    dependencies: {
      fanIn: ['avi-vip-jenkins.corp'],
      fanOut: ['k8s-jenk-ctrl-01..05']
    },
    expiryItems: [{ name: 'K8s ServiceAccount Token', daysLeft: 300, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'node-win-bld-agt-pool',
    appKey: 'jenkins',
    name: 'win-bld-agt-001..200 (200 Windows Build Agents)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'warning',
    hostOrIp: '10.240.100.0/24 (200 Windows Server 2022 VMs)',
    tier: 'Ephemeral Build Farm',
    owner: 'infra ops',
    metrics: { p95Latency: '8 ms', errorRate: '1.4%', throughput: '12,000 iops', saturation: '88% Executor Pool' },
    driftStatus: { drifted: true, count: 1, summary: '4 agent nodes offline for Windows update reboot' },
    dependencies: {
      fanIn: ['k8s-jenk-ctrl-01..05'],
      fanOut: ['nas-storage-jenkins']
    },
    expiryItems: [{ name: 'WinRM Kerberos Ticket', daysLeft: 14, status: 'healthy' }],
    recentIncidents: [{ id: 'INC0091410', title: 'Jenkins Runner Pool Saturation', status: 'Investigating', priority: 'P2' }],
    recentChanges: []
  },
  {
    id: 'node-lon-sc-ctrl-01',
    appKey: 'fortify',
    name: 'lon-sc-ctrl-01 (Fortify ScanCentral Controller)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'healthy',
    hostOrIp: '10.240.2.31 (Linux RHEL 9.2)',
    tier: 'AppSec Central Controller',
    owner: 'infra ops',
    metrics: { p95Latency: '4 ms', errorRate: '0%', throughput: '800 iops', saturation: '36%' },
    driftStatus: { drifted: false, count: 0, summary: 'Dynamic dispatch queue operational' },
    dependencies: {
      fanIn: ['avi-vip-fortify.corp'],
      fanOut: ['lon-sc-sensor-01..10']
    },
    expiryItems: [{ name: 'Host SSH Key', daysLeft: 180, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'node-lon-nx-lnx-01',
    appKey: 'nexusiq',
    name: 'lon-nx-lnx-01 (NexusIQ Core Node 1)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'healthy',
    hostOrIp: '10.240.2.41 (Linux RHEL 9.2)',
    tier: 'Security Evaluation Server',
    owner: 'infra ops',
    metrics: { p95Latency: '3 ms', errorRate: '0%', throughput: '1,100 iops', saturation: '32%' },
    driftStatus: { drifted: false, count: 0, summary: 'Policy evaluation threads nominal' },
    dependencies: {
      fanIn: ['avi-vip-nexusiq.corp'],
      fanOut: ['lon-nx-pg-cluster']
    },
    expiryItems: [{ name: 'Host SSH Key', daysLeft: 220, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'node-lon-sq-01',
    appKey: 'sonarqube',
    name: 'lon-sq-01 (SonarQube Compute Node 1)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'healthy',
    hostOrIp: '10.240.20.51 (Linux RHEL 9.2)',
    tier: 'Code Analysis Compute',
    owner: 'infra ops',
    metrics: { p95Latency: '4 ms', errorRate: '0%', throughput: '1,600 iops', saturation: '50%' },
    driftStatus: { drifted: false, count: 0, summary: 'Elasticsearch indexer synchronized' },
    dependencies: {
      fanIn: ['avi-vip-sonarqube.corp'],
      fanOut: ['pgsql-sonarqube-db']
    },
    expiryItems: [{ name: 'Host SSH Key', daysLeft: 190, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'node-lon-tc-lnx-01',
    appKey: 'teamcity',
    name: 'lon-tc-lnx-01 (TeamCity Core Server 1)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'healthy',
    hostOrIp: '10.240.2.61 (Linux RHEL 9.2)',
    tier: 'CI Core Server',
    owner: 'infra ops',
    metrics: { p95Latency: '4 ms', errorRate: '0%', throughput: '1,400 iops', saturation: '58%' },
    driftStatus: { drifted: false, count: 0, summary: 'Build artifact repository attached' },
    dependencies: {
      fanIn: ['avi-vip-teamcity.corp'],
      fanOut: ['lon-tc-db-01']
    },
    expiryItems: [{ name: 'Host SSH Key', daysLeft: 160, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'node-k8s-argo-ctrl',
    appKey: 'argocd',
    name: 'k8s-argo-ctrl-plane (ArgoCD HA Control Plane)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'healthy',
    hostOrIp: 'k8s-cluster-prod-01 (3 Master + 6 Worker Nodes)',
    tier: 'K8s Cluster Core',
    owner: 'infra ops',
    metrics: { p95Latency: '2 ms', errorRate: '0%', throughput: '4,200 iops', saturation: '36%' },
    driftStatus: { drifted: false, count: 0, summary: 'K8s etcd cluster consensus 3/3 healthy' },
    dependencies: {
      fanIn: ['avi-vip-argocd.corp'],
      fanOut: ['argocd-server-ha']
    },
    expiryItems: [{ name: 'K8s Cluster CA', daysLeft: 340, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'node-win-jumpsrv-01',
    appKey: 'github',
    name: 'win-jumpsrv-01.corp (GitHub Windows JumpServer / Bastion)',
    type: 'Host Compute Node',
    icon: '⚙️',
    status: 'healthy',
    hostOrIp: '10.240.10.88 (Windows Server 2022 Bastion)',
    tier: 'Secure Access JumpServer',
    owner: 'infosec',
    metrics: { p95Latency: '2 ms', errorRate: '0%', throughput: '450 iops', saturation: '26%' },
    driftStatus: { drifted: false, count: 0, summary: 'MFA bastion jump policy enforced' },
    dependencies: {
      fanIn: ['corp-wan-perimeter'],
      fanOut: ['k8s-ghe-cluster-core']
    },
    expiryItems: [{ name: 'Bastion Host Certificate', daysLeft: 280, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },

  // ==========================================
  // TIER 4: DATABASES (Datastore Tier)
  // ==========================================
  {
    id: 'timescale-db-primary',
    appKey: 'bitbucket',
    name: 'TimescaleDB Primary Cluster (Bitbucket DB)',
    type: 'Database',
    icon: '🗄️',
    status: 'warning',
    hostOrIp: '10.240.5.20 (PostgreSQL 16 Enterprise)',
    tier: 'Tier-1 Primary Datastore',
    owner: 'dba team',
    metrics: { p95Latency: '8.4 ms', errorRate: '0.02%', throughput: '2,800 qps', saturation: '94.4% Pool' },
    driftStatus: { drifted: true, count: 1, summary: 'Security group opened 0.0.0.0/0:22 manually' },
    dependencies: {
      fanIn: ['app-bitbucket'],
      fanOut: ['san-storage-nvme-01', 'timescale-replica-standby']
    },
    expiryItems: [{ name: 'Postgres mTLS Cert', daysLeft: 84, status: 'warning' }],
    recentIncidents: [{ id: 'INC0089921', title: 'DB Pool connection saturation (472/500)', status: 'Mitigating', priority: 'P2' }],
    recentChanges: [{ id: 'TF-4091', type: 'Terraform Apply', desc: 'Scaled read replica pool to 800' }]
  },
  {
    id: 'db-pgsql-artifactory',
    appKey: 'artifactory',
    name: 'pgsql-artifactory-db (PostgreSQL 15 Cluster)',
    type: 'Database',
    icon: '🗄️',
    status: 'healthy',
    hostOrIp: '10.240.5.30 (PostgreSQL 15 HA)',
    tier: 'Tier-1 Metadata Datastore',
    owner: 'dba team',
    metrics: { p95Latency: '5.2 ms', errorRate: '0.00%', throughput: '3,400 qps', saturation: '58%' },
    driftStatus: { drifted: false, count: 0, summary: 'Replication lag < 10ms across replicas' },
    dependencies: {
      fanIn: ['app-artifactory'],
      fanOut: ['san-storage-nvme-02']
    },
    expiryItems: [{ name: 'Postgres mTLS Cert', daysLeft: 180, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'db-pgsql-nexusiq',
    appKey: 'nexusiq',
    name: 'lon-nx-pg-cluster (NexusIQ Policy DB)',
    type: 'Database',
    icon: '🗄️',
    status: 'healthy',
    hostOrIp: '10.240.5.40 (PostgreSQL 15)',
    tier: 'Tier-1 Security Datastore',
    owner: 'dba team',
    metrics: { p95Latency: '4.1 ms', errorRate: '0.00%', throughput: '1,800 qps', saturation: '36%' },
    driftStatus: { drifted: false, count: 0, summary: 'Automated WAL archiving nominal' },
    dependencies: {
      fanIn: ['app-nexusiq'],
      fanOut: ['san-storage-nvme-03']
    },
    expiryItems: [{ name: 'Postgres mTLS Cert', daysLeft: 220, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'db-central-fortify',
    appKey: 'fortify',
    name: 'lon-fort-db-01 (Fortify SSC Central DB)',
    type: 'Database',
    icon: '🗄️',
    status: 'healthy',
    hostOrIp: '10.240.5.50 (Oracle / PostgreSQL 15)',
    tier: 'Tier-1 AppSec Datastore',
    owner: 'dba team',
    metrics: { p95Latency: '6.8 ms', errorRate: '0.00%', throughput: '950 qps', saturation: '42%' },
    driftStatus: { drifted: false, count: 0, summary: 'Vulnerability scan tables indexed' },
    dependencies: {
      fanIn: ['app-fortify'],
      fanOut: ['san-storage-nvme-04']
    },
    expiryItems: [{ name: 'DB Server Certificate', daysLeft: 160, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'db-pgsql-sonarqube',
    appKey: 'sonarqube',
    name: 'pgsql-sonarqube-db (SonarQube Database)',
    type: 'Database',
    icon: '🗄️',
    status: 'healthy',
    hostOrIp: '10.240.5.60 (PostgreSQL 16)',
    tier: 'Tier-1 Code Quality Datastore',
    owner: 'dba team',
    metrics: { p95Latency: '5.6 ms', errorRate: '0.00%', throughput: '2,100 qps', saturation: '49%' },
    driftStatus: { drifted: false, count: 0, summary: 'Nightly autovacuum and vacuum analyze complete' },
    dependencies: {
      fanIn: ['app-sonarqube'],
      fanOut: ['san-storage-nvme-05']
    },
    expiryItems: [{ name: 'Postgres mTLS Cert', daysLeft: 210, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'db-teamcity-cluster',
    appKey: 'teamcity',
    name: 'lon-tc-db-01 (TeamCity Build DB)',
    type: 'Database',
    icon: '🗄️',
    status: 'healthy',
    hostOrIp: '10.240.5.70 (PostgreSQL 15)',
    tier: 'Tier-2 CI Pipeline Datastore',
    owner: 'dba team',
    metrics: { p95Latency: '7.1 ms', errorRate: '0.01%', throughput: '1,650 qps', saturation: '52%' },
    driftStatus: { drifted: false, count: 0, summary: 'Build logs partition tables rotated' },
    dependencies: {
      fanIn: ['app-teamcity'],
      fanOut: ['san-storage-nvme-06']
    },
    expiryItems: [{ name: 'Postgres mTLS Cert', daysLeft: 175, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'db-redis-argocd',
    appKey: 'argocd',
    name: 'argocd-redis-ha (Redis Sentinel Cluster)',
    type: 'Database',
    icon: '🗄️',
    status: 'healthy',
    hostOrIp: 'argocd-redis-ha.argocd.svc:6379',
    tier: 'Tier-1 In-Memory Datastore',
    owner: 'devops aps',
    metrics: { p95Latency: '0.8 ms', errorRate: '0.00%', throughput: '8,400 ops/s', saturation: '28%' },
    driftStatus: { drifted: false, count: 0, summary: 'Redis sentinel quorum 3/3 active' },
    dependencies: {
      fanIn: ['app-argocd'],
      fanOut: ['k8s-argo-ctrl-plane']
    },
    expiryItems: [{ name: 'Redis Auth Token', daysLeft: 365, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'db-mysql-github',
    appKey: 'github',
    name: 'ghe-mysql-cluster (GitHub Enterprise MySQL)',
    type: 'Database',
    icon: '🗄️',
    status: 'healthy',
    hostOrIp: '10.240.5.80 (MySQL Enterprise 8.0)',
    tier: 'Tier-1 SCM Metadata Datastore',
    owner: 'dba team',
    metrics: { p95Latency: '4.8 ms', errorRate: '0.00%', throughput: '4,200 qps', saturation: '44%' },
    driftStatus: { drifted: false, count: 0, summary: 'Group replication active across 3 nodes' },
    dependencies: {
      fanIn: ['app-github'],
      fanOut: ['san-storage-nvme-07']
    },
    expiryItems: [{ name: 'MySQL mTLS Cert', daysLeft: 290, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },

  // ==========================================
  // TIER 5: CERTIFICATE AUTHORITIES & TRUST ROOTS
  // ==========================================
  {
    id: 'cert-subca-v2',
    appKey: 'all',
    name: 'Corporate Issuing Sub-CA v2',
    type: 'Certificate Authority',
    icon: '🔒',
    status: 'critical',
    hostOrIp: 'PKI Root Vault (lon-pki-vault-01)',
    tier: 'Enterprise Trust Root',
    owner: 'infosec',
    metrics: { p95Latency: 'N/A', errorRate: '0%', throughput: 'N/A', saturation: 'N/A' },
    driftStatus: { drifted: false, count: 0, summary: 'PKI vault policy enforces RSA-4096' },
    dependencies: {
      fanIn: ['root-ca-2016'],
      fanOut: ['app-bitbucket', 'app-artifactory', 'app-jenkins', 'app-sonarqube']
    },
    expiryItems: [{ name: 'CA Certificate Validity', daysLeft: 8, status: 'critical' }],
    recentIncidents: [{ id: 'INC0088412', title: 'Sub-CA v2 Emergency Rotation CAB Pending', status: 'Pending CAB', priority: 'P3' }],
    recentChanges: [{ id: 'CHG0099412', type: 'CAB Key Rollout', desc: 'Rollout of Sub-CA v3' }]
  },
  {
    id: 'cert-digicert-corp',
    appKey: 'all',
    name: 'DigiCert Corporate CA',
    type: 'Certificate Authority',
    icon: '🔒',
    status: 'healthy',
    hostOrIp: 'DigiCert CertCentral Managed PKI API',
    tier: 'Public / Enterprise Trust Provider',
    owner: 'infosec',
    metrics: { p95Latency: '45 ms', errorRate: '0%', throughput: '120 certs/m', saturation: '24%' },
    driftStatus: { drifted: false, count: 0, summary: 'Automated ACME directory synchronization active' },
    dependencies: {
      fanIn: ['public-trust-network'],
      fanOut: ['app-bitbucket', 'app-artifactory', 'app-sonarqube', 'app-nexusiq', 'app-bitbucketexternal']
    },
    expiryItems: [{ name: 'Root CA Validity', daysLeft: 740, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: [{ id: 'PKI-102', type: 'Certificate Rotation', desc: 'Automated renewal of corporate wildcard *.internal.corp' }]
  },
  {
    id: 'cert-letsencrypt-ent',
    appKey: 'all',
    name: 'Let’s Encrypt Enterprise ACME Provider',
    type: 'Certificate Authority',
    icon: '🔒',
    status: 'healthy',
    hostOrIp: 'Kubernetes Cert-Manager ACME ClusterIssuer',
    tier: 'Automated Ingress PKI',
    owner: 'devops aps',
    metrics: { p95Latency: '18 ms', errorRate: '0%', throughput: '80 certs/h', saturation: '15%' },
    driftStatus: { drifted: false, count: 0, summary: 'Auto-renewal schedule active for all 90-day certs' },
    dependencies: {
      fanIn: ['k8s-cert-manager'],
      fanOut: ['app-artifactory', 'app-teamcity', 'app-argoworkflows']
    },
    expiryItems: [{ name: 'ACME Account Key', daysLeft: 360, status: 'healthy' }],
    recentIncidents: [],
    recentChanges: []
  },
  {
    id: 'cert-internal-root-v3',
    appKey: 'all',
    name: 'Internal Root CA v3',
    type: 'Certificate Authority',
    icon: '🔒',
    status: 'warning',
    hostOrIp: 'Offline Hardware Security Module (HSM)',
    tier: 'Air-Gapped Private PKI',
    owner: 'infosec',
    metrics: { p95Latency: 'N/A', errorRate: '0%', throughput: 'N/A', saturation: 'N/A' },
    driftStatus: { drifted: false, count: 0, summary: 'Offline root signature key valid' },
    dependencies: {
      fanIn: ['hsm-airgap-vault'],
      fanOut: ['app-jenkins', 'app-fortify']
    },
    expiryItems: [{ name: 'Jenkins Signing Intermediate', daysLeft: 4, status: 'critical' }],
    recentIncidents: [{ id: 'INC0091410', title: 'Jenkins TLS certificate expiring in 4 days', status: 'Action Required', priority: 'P2' }],
    recentChanges: []
  },
  {
    id: 'cert-cyberark-pki',
    appKey: 'all',
    name: 'CyberArk Corporate Sub-CA / Vault PKI Engine',
    type: 'Certificate Authority',
    icon: '🔒',
    status: 'healthy',
    hostOrIp: 'CyberArk Privileged Access Vault (lon-cyberark-01)',
    tier: 'Zero-Trust Secrets Authority',
    owner: 'infosec',
    metrics: { p95Latency: '12 ms', errorRate: '0%', throughput: '4,500 secrets/m', saturation: '41%' },
    driftStatus: { drifted: false, count: 0, summary: 'Dynamic secrets leasing engine operating nominally' },
    dependencies: {
      fanIn: ['infosec-pki-core'],
      fanOut: ['app-otkr', 'app-github', 'app-argocd']
    },
    expiryItems: [{ name: 'Vault Token Authority', daysLeft: 28, status: 'warning' }],
    recentIncidents: [],
    recentChanges: []
  }
];

// Config Drift to RCA Correlation Computations
export const DRIFT_RCA_CORRELATION_STATS = {
  headlineStat: '78%',
  timeWindowMinutes: 45,
  totalIncidentsAnalyzed: 18,
  driftPrecededIncidentsCount: 14,
  samplePeriod: 'Last 30 Days (Rolling)',
  driftLinkedIncidents: [
    {
      incidentId: 'INC0091823',
      priority: 'P1 CRITICAL',
      service: 'Bitbucket Enterprise',
      entityId: 'bitbucket-mesh-pool',
      incidentTime: 'Today, 08:18 UTC',
      driftEvent: 'ASG downsized: c6i.2xlarge (Expected c6i.4xlarge, capacity 4 instead of 8)',
      driftTime: 'Today, 07:45 UTC',
      leadTimeMinutes: 33,
      correlationScore: '96% Match',
      causalityNote: 'Under-provisioned ASG node pool induced JVM heap saturation and GC pause under morning login surge.'
    },
    {
      incidentId: 'INC0091410',
      priority: 'P2 HIGH',
      service: 'Jenkins CI/CD Pipeline',
      entityId: 'jenkins-replicas',
      incidentTime: 'Today, 04:35 UTC',
      driftEvent: 'K8s deployment scaled down: 2 pods running (GitOps manifest specifies 6)',
      driftTime: 'Today, 04:00 UTC',
      leadTimeMinutes: 35,
      correlationScore: '92% Match',
      causalityNote: 'Missing 4 runner pods caused developer pipeline queue backlog to hit 88% capacity.'
    },
    {
      incidentId: 'INC0089921',
      priority: 'P2 HIGH',
      service: 'TimescaleDB Primary Cluster',
      entityId: 'sec-group-db',
      incidentTime: 'Yesterday, 23:12 UTC',
      driftEvent: 'Security group manual override opened port 22 to 0.0.0.0/0',
      driftTime: 'Yesterday, 22:30 UTC',
      leadTimeMinutes: 42,
      correlationScore: '84% Match',
      causalityNote: 'Unauthorized external scan flooded SSH ports, degrading host TCP connection table.'
    }
  ]
};
