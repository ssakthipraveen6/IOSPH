/**
 * backend/demo/fixtures/expiry.js
 *
 * Isolated sample certificates and licenses used strictly for the Demo view.
 * Phase O0 / O0.2: Extracted from legacy expiryEngine so no sample items
 * can ever be served in prod or staging environments.
 */

const CANONICAL_EXPIRY_RECORDS = [
  {
    id: 'cert-bb-tls',
    target: 'bitbucket.internal.corp',
    name: 'Bitbucket Ingress TLS Leaf Cert',
    type: 'TLS Leaf Certificate',
    issuer: 'DigiCert Corporate CA',
    daysLeft: 12,
    autoRenew: 'HashiCorp Vault Cert Manager',
    criticalThreshold: 7,
    warningThreshold: 30
  },
  {
    id: 'cert-arty-tls',
    target: 'artifactory.internal.corp',
    name: 'Artifactory VIP TLS Certificate',
    type: 'TLS Leaf Certificate',
    issuer: 'DigiCert Corporate CA',
    daysLeft: 148,
    autoRenew: 'Let’s Encrypt Enterprise',
    criticalThreshold: 7,
    warningThreshold: 30
  },
  {
    id: 'cert-jenk-tls',
    target: 'jenkins.internal.corp',
    name: 'Jenkins Ingress Controller TLS',
    type: 'TLS Leaf Certificate',
    issuer: 'Internal Root CA v3',
    daysLeft: 4,
    autoRenew: 'Manual CAB Approval Required',
    criticalThreshold: 7,
    warningThreshold: 30
  },
  {
    id: 'cert-sonar-tls',
    target: 'sonarqube.internal.corp',
    name: 'SonarQube Enterprise SSL',
    type: 'TLS Leaf Certificate',
    issuer: 'DigiCert Corporate CA',
    daysLeft: 92,
    autoRenew: 'Automated ACME',
    criticalThreshold: 7,
    warningThreshold: 30
  },
  {
    id: 'cert-vault-pki',
    target: 'vault.internal.corp',
    name: 'CyberArk / Vault Master Keystore',
    type: 'Internal CA Certificate',
    issuer: 'CyberArk Corporate Sub-CA',
    daysLeft: 28,
    autoRenew: 'Managed PKI Engine',
    criticalThreshold: 7,
    warningThreshold: 30
  },
  {
    id: 'lic-ghe',
    target: 'github.enterprise.corp',
    name: 'GitHub Enterprise License',
    type: 'Enterprise Software License',
    issuer: 'GitHub Corporate Licensing',
    daysLeft: 310,
    autoRenew: 'Enterprise Subscription',
    criticalThreshold: 14,
    warningThreshold: 45
  },
  {
    id: 'token-k8s-sa',
    target: 'k8s-prod-cluster-01',
    name: 'Cluster ServiceAccount Token',
    type: 'OIDC / ServiceAccount Token',
    issuer: 'Kubernetes Internal CA',
    daysLeft: 300,
    autoRenew: 'Automated Kubelet Rotation',
    criticalThreshold: 14,
    warningThreshold: 30
  },
  {
    id: 'ticket-winrm-kerb',
    target: 'win-bld-agt-001..200',
    name: 'WinRM Kerberos Ticket Granting Service',
    type: 'Active Directory Kerberos Ticket',
    issuer: 'Corporate Active Directory KDC',
    daysLeft: 14,
    autoRenew: 'Automatic TGT Refresh',
    criticalThreshold: 3,
    warningThreshold: 7
  }
];

// critical / warning / ok from days left.
function getExpiryStatus(item) {
  if (item.daysLeft <= (item.criticalThreshold || 7)) return 'critical';
  if (item.daysLeft <= (item.warningThreshold || 30)) return 'warning';
  return 'healthy';
}

// Every sample expiry item with its status.
function getAllExpiryItems() {
  return CANONICAL_EXPIRY_RECORDS.map(item => ({
    ...item,
    status: getExpiryStatus(item)
  }));
}

// Same as getAllExpiryItems, async.
async function getAllExpiryItemsAsync() {
  return getAllExpiryItems();
}

// Counts of critical and warning sample items.
function getExpirySummary() {
  const all = getAllExpiryItems();
  const critical = all.filter(i => i.status === 'critical').length;
  const warning = all.filter(i => i.status === 'warning').length;
  const healthy = all.filter(i => i.status === 'healthy').length;
  return { total: all.length, critical, warning, healthy, items: all };
}

module.exports = {
  CANONICAL_EXPIRY_RECORDS,
  getExpiryStatus,
  getAllExpiryItems,
  getAllExpiryItemsAsync,
  getExpirySummary
};
