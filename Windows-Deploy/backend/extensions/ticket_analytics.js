// =========================================================================
// CHANGE & INCIDENT CORRELATION ANALYTICS (2-WEEKS BEFORE & AFTER)
// =========================================================================

const infraChanges = [
  {
    id: "CHG-00892",
    date: "2026-07-20",
    title: "PostgreSQL Database Parameter Tuning & TCP Cache Buffer Flush",
    component: "database",
    risk: "Medium",
    engineer: "S. Prasad",
    status: "Completed",
    description: "Modified postgresql.conf shared_buffers from 4GB to 8GB and flushed active TCP connections.",
    
    // Tickets raised 1 week BEFORE change (July 13 to July 19)
    beforeTickets: [
      { id: "INC-8820", type: "Incident", title: "DB connection pool saturation error", date: "2026-07-14", source: "Dynatrace Alerts" },
      { id: "PRB-0145", type: "Problem", title: "Bitbucket JDBC timeouts on checkout threads", date: "2026-07-17", source: "ServiceNow" }
    ],
    
    // Tickets raised 1 week AFTER change (July 21 to July 27)
    afterTickets: [
      { id: "INC-9104", type: "Incident", title: "Latency return to baseline (resolved)", date: "2026-07-22", source: "Dynatrace Alerts" }
    ]
  },
  {
    id: "CHG-00904",
    date: "2026-07-15",
    title: "Artifactory Heap Compact and JVM GC Option Upgrade",
    component: "artifactory",
    risk: "High",
    engineer: "J. Doe",
    status: "Completed",
    description: "Added -XX:+UseG1GC parameter to avoid heap lock loops.",
    
    beforeTickets: [
      { id: "INC-8104", type: "Incident", title: "JVM OutOfMemory heap memory leak alert", date: "2026-07-09", source: "Dynatrace Alerts" },
      { id: "INC-8321", type: "Incident", title: "Maven package uploads returning 500 server error", date: "2026-07-12", source: "ServiceNow" }
    ],
    
    afterTickets: [
      { id: "INC-8542", type: "Incident", title: "Minor pod restart during config rollout", date: "2026-07-16", source: "Kubernetes Events" }
    ]
  },
  {
    id: "CHG-00912",
    date: "2026-07-22",
    title: "NAS Volume Compaction and Temp Log Folders Purging",
    component: "nas_performance",
    risk: "Low",
    engineer: "A. Silva",
    status: "Completed",
    description: "Cleared redundant test directory workspace caches to recover storage capacity.",
    
    beforeTickets: [
      { id: "INC-9002", type: "Incident", title: "NAS disk capacity alert reached 98%", date: "2026-07-19", source: "Dynatrace Alerts" },
      { id: "PRB-0199", type: "Problem", title: "TeamCity workspace logs write failure", date: "2026-07-21", source: "ServiceNow" }
    ],
    
    afterTickets: [
      { id: "INC-9221", type: "Incident", title: "Storage compact verification successful", date: "2026-07-23", source: "NOC Audits" }
    ]
  },
  {
    id: "CHG-00925",
    date: "2026-07-25",
    title: "AVI Virtual Service Ingress Network Bandwidth Scale-up",
    component: "avi_load_balancer",
    risk: "Medium",
    engineer: "M. Fernandes",
    status: "Completed",
    description: "Scaled ingress queue threshold from 2000 to 5000 requests.",
    
    beforeTickets: [
      { id: "INC-9340", type: "Incident", title: "Ingress bottleneck network threshold warning", date: "2026-07-24", source: "Dynatrace Alerts" }
    ],
    
    afterTickets: []
  }
];

function getTicketImpactData() {
  return infraChanges;
}

module.exports = {
  getTicketImpactData
};
