// =========================================================================
// ROOT CAUSE ANALYSIS (RCA) AND CORRELATION SERVICE
// =========================================================================

const simulations = require('../simulations');

const baselineCorrelations = [
  { source: "PostgreSQL DB Latency", target: "Bitbucket API Response Time", coefficient: 0.89, status: "High" },
  { source: "NAS Disk IOPS", target: "Artifactory Upload Latency", coefficient: 0.94, status: "Critical" },
  { source: "AVI Ingress Network Saturation", target: "ArgoCD Cluster Sync Latency", coefficient: 0.76, status: "High" },
  { source: "Windows Server CPU Load", target: "Fortify SSC Thread Allocation", coefficient: 0.62, status: "Moderate" },
  { source: "Linux Host Heap Saturation", target: "Jenkins Pod Spawning Latency", coefficient: 0.81, status: "High" }
];

const timelineData = [
  { time: "00:00", expected: 45, actual: 48, dbLoad: 12, nasIops: 220 },
  { time: "02:00", expected: 45, actual: 47, dbLoad: 10, nasIops: 210 },
  { time: "04:00", expected: 45, actual: 46, dbLoad: 15, nasIops: 230 },
  { time: "06:00", expected: 50, actual: 52, dbLoad: 25, nasIops: 280 },
  { time: "08:00", expected: 60, actual: 65, dbLoad: 48, nasIops: 410 },
  { time: "10:00", expected: 75, actual: 195, dbLoad: 92, nasIops: 1250, note: "Postgres Pool Saturated" },
  { time: "12:00", expected: 80, actual: 280, dbLoad: 98, nasIops: 2450, note: "Artifactory Heap OOM Spike" },
  { time: "14:00", expected: 75, actual: 95, dbLoad: 55, nasIops: 820, note: "Remediation Executed" },
  { time: "16:00", expected: 65, actual: 68, dbLoad: 42, nasIops: 380 },
  { time: "18:00", expected: 55, actual: 58, dbLoad: 30, nasIops: 310 },
  { time: "20:00", expected: 45, actual: 49, dbLoad: 22, nasIops: 260 },
  { time: "22:00", expected: 45, actual: 47, dbLoad: 18, nasIops: 240 }
];

function getRcaData() {
  const activeSims = simulations.getSimulations();
  
  // Calculate dynamic statuses based on active simulations
  const dbStatus = activeSims['database'] ? 'Critical' : 'Healthy';
  const nasStatus = activeSims['nas_performance'] ? 'Critical' : 'Healthy';
  const jenkinsStatus = activeSims['jenkins_k8s'] ? 'Critical' : 'Healthy';
  const aviStatus = activeSims['avi_load_balancer'] ? 'Warning' : 'Healthy';
  const bitbucketStatus = activeSims['bitbucket'] ? 'Critical' : 'Healthy';
  const artifactoryStatus = activeSims['artifactory'] ? 'Critical' : 'Healthy';
  const TCStatus = activeSims['teamcity'] ? 'Critical' : 'Healthy';
  const fortifyStatus = activeSims['fortify'] ? 'Critical' : 'Healthy';
  const nexusStatus = activeSims['nexusiq'] ? 'Critical' : 'Healthy';
  const argoStatus = activeSims['argocd_k8s'] ? 'Critical' : 'Healthy';
  const mcpStatus = activeSims['mcp_server_k8s'] ? 'Critical' : 'Healthy';

  // Flows configurations
  const flows = {
    jenkins: [
      { name: "SSO Gateway", value: "98ms latency", status: "Healthy" },
      { name: "AVI Load Balancer", value: aviStatus === 'Warning' ? "188.2 MB/s ingress" : "45.2 MB/s ingress", status: aviStatus },
      { name: "Jenkins Ingress", value: jenkinsStatus === 'Critical' ? "504 Gateway Timeout" : "110ms latency", status: jenkinsStatus },
      { name: "K8s Pod components", value: jenkinsStatus === 'Critical' ? "0/5 Online (OOM)" : "5/5 Pods Online", status: jenkinsStatus },
      { name: "NAS Performance (PVC)", value: nasStatus === 'Critical' ? "98.4% space (Locked)" : "54.2% space used", status: nasStatus },
      { name: "Job Agents pool", value: jenkinsStatus === 'Critical' ? "0 agents active" : "12 agents running", status: jenkinsStatus },
      { name: "CloudBees CJOC pool", value: "Connected (25ms)", status: "Healthy" }
    ],
    bitbucket: [
      { name: "SSO Gateway", value: "98ms latency", status: "Healthy" },
      { name: "AVI Load Balancer", value: aviStatus === 'Warning' ? "188.2 MB/s ingress" : "45.2 MB/s ingress", status: aviStatus },
      { name: "Bitbucket Nodes", value: bitbucketStatus === 'Critical' ? "Outage (HTTP 500)" : "3 active nodes (85ms)", status: bitbucketStatus },
      { name: "NAS Performance", value: nasStatus === 'Critical' ? "Volume full (Locked)" : "54.2% space used", status: nasStatus },
      { name: "Mirror Regions checks", value: bitbucketStatus === 'Critical' ? "2/3 Mirrors Online" : "3/3 Mirrors Sync OK", status: bitbucketStatus }
    ],
    artifactory: [
      { name: "SSO Portal", value: "98ms latency", status: "Healthy" },
      { name: "eLDAP Directory", value: "Ready (15ms)", status: "Healthy" },
      { name: "AVI Load Balancer", value: aviStatus === 'Warning' ? "188.2 MB/s" : "45.2 MB/s", status: aviStatus },
      { name: "PostgreSQL DB Layer", value: dbStatus === 'Critical' ? "5000ms (Saturated)" : "15.2ms latency", status: dbStatus },
      { name: "AWS S3 storage", value: "S3 latency 15.4ms", status: "Healthy" },
      { name: "NAS storage", value: nasStatus === 'Critical' ? "Volume full (Locked)" : "54.2% space", status: nasStatus }
    ],
    argocd: [
      { name: "SSO Gateway", value: "98ms latency", status: "Healthy" },
      { name: "AVI Load Balancer", value: aviStatus === 'Warning' ? "188.2 MB/s" : "45.2 MB/s", status: aviStatus },
      { name: "ArgoCD API Server", value: argoStatus === 'Critical' ? "Failed" : "45ms response", status: argoStatus },
      { name: "Cluster K8s Connections", value: argoStatus === 'Critical' ? "0/4 connected" : "4/4 clusters online", status: argoStatus },
      { name: "Git Repo Sync checks", value: argoStatus === 'Critical' ? "Failed" : "Synced (rev: b492ac)", status: argoStatus }
    ],
    teamcity: [
      { name: "SSO Gateway", value: "98ms latency", status: "Healthy" },
      { name: "AVI Load Balancer", value: aviStatus === 'Warning' ? "188.2 MB/s" : "45.2 MB/s", status: aviStatus },
      { name: "TeamCity Server Nodes", value: TCStatus === 'Critical' ? "Load 100%" : "Load 24.5%", status: TCStatus },
      { name: "Build Agent pools", value: TCStatus === 'Critical' ? "0 agents active" : "10 agents online", status: TCStatus },
      { name: "NAS storage", value: nasStatus === 'Critical' ? "Volume full (Locked)" : "54.2% space", status: nasStatus }
    ],
    fortify: [
      { name: "SSO Gateway", value: "98ms latency", status: "Healthy" },
      { name: "AVI Load Balancer", value: aviStatus === 'Warning' ? "188.2 MB/s" : "45.2 MB/s", status: aviStatus },
      { name: "Fortify Web Engine", value: fortifyStatus === 'Critical' ? "Threads saturated" : "250 active threads", status: fortifyStatus },
      { name: "SQL DB Backend", value: dbStatus === 'Critical' ? "Saturated (Locked)" : "15.2ms latency", status: dbStatus },
      { name: "S3 scan reports storage", value: "85GB used", status: "Healthy" }
    ],
    nexusiq: [
      { name: "SSO Gateway", value: "98ms latency", status: "Healthy" },
      { name: "AVI Load Balancer", value: aviStatus === 'Warning' ? "188.2 MB/s" : "45.2 MB/s", status: aviStatus },
      { name: "NexusIQ Core Engine", value: nexusStatus === 'Critical' ? "10000ms latency" : "180ms latency", status: nexusStatus },
      { name: "License & Policy DB", value: dbStatus === 'Critical' ? "DB lock" : "Healthy", status: dbStatus },
      { name: "Scan build queues", value: nexusStatus === 'Critical' ? "100 scans queued" : "1 scan active", status: nexusStatus }
    ],
    mcp: [
      { name: "SSO Gateway", value: "98ms latency", status: "Healthy" },
      { name: "AVI Load Balancer", value: aviStatus === 'Warning' ? "188.2 MB/s" : "45.2 MB/s", status: aviStatus },
      { name: "MCP Gateway Replicas", value: mcpStatus === 'Critical' ? "0/3 replicas active" : "3/3 replicas active", status: mcpStatus },
      { name: "Internal Microservices", value: mcpStatus === 'Critical' ? "Refused" : "Healthy", status: mcpStatus }
    ]
  };

  return {
    correlations: baselineCorrelations,
    timeline: timelineData,
    flows
  };
}

module.exports = {
  getRcaData
};
