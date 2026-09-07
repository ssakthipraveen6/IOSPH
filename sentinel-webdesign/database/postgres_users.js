const fs = require('fs');
const path = require('path');
const postgres = require('./postgres');

const USERS_FILE = path.join(__dirname, 'sentinel_users.json');

const defaultUsers = [
  { id: 1, name: 'DevSecops Admin', email: 'devsecops-admin@enterprise.corp', role: 'Super Admin', status: 'Active', dept: 'DevSecOps & NOC', lastLogin: 'Just Now', mfa: true, permissions: ['read', 'remediate', 'thresholds', 'export', 'users', 'tokens'] },
  { id: 2, name: 'Sarah Jenkins', email: 'sarah.j@enterprise.corp', role: 'SRE Lead', status: 'Active', dept: 'Site Reliability', lastLogin: '10 mins ago', mfa: true, permissions: ['read', 'remediate', 'thresholds', 'export'] },
  { id: 3, name: 'Marcus Vance', email: 'm.vance@enterprise.corp', role: 'NOC Operator', status: 'Active', dept: 'Operations Center', lastLogin: '1 hour ago', mfa: true, permissions: ['read', 'remediate'] },
  { id: 4, name: 'Elena Rostova', email: 'e.rostova@enterprise.corp', role: 'Security Auditor', status: 'Active', dept: 'Compliance & Cyber', lastLogin: '3 hours ago', mfa: true, permissions: ['read', 'export'] },
  { id: 5, name: 'Automation Service Bot', email: 'svc-sentinel@enterprise.corp', role: 'Service Account', status: 'Active', dept: 'CI/CD Pipeline', lastLogin: 'Continuous', mfa: false, permissions: ['read', 'remediate'] }
];

const defaultAuditLogs = [
  { id: 101, timestamp: new Date().toLocaleTimeString(), user: 'DevSecops Admin', action: 'Modified Threshold', details: 'Updated Bitbucket CPU warning threshold to 85%', ip: '10.240.12.89' },
  { id: 102, timestamp: new Date(Date.now() - 600000).toLocaleTimeString(), user: 'DevSecops Admin', action: 'Auto-Remediation Trigger', details: 'Executed Service Restart on Jenkins_k8s container', ip: '10.240.12.89' },
  { id: 103, timestamp: new Date(Date.now() - 3600000).toLocaleTimeString(), user: 'Sarah Jenkins', action: 'Exported Telemetry', details: 'Downloaded 24h Metrics CSV report for Postgres Database', ip: '10.240.14.102' }
];

const defaultSsoLogs = [
  { id: 'SSO-LOG-1001', timestamp: new Date().toLocaleString('en-GB'), user: 'DevSecops Admin', email: 'devsecops-admin@enterprise.corp', role: 'Super Admin', dept: 'DevSecOps & NOC', provider: 'eLDAP / Active Directory (ldaps://ldap.enterprise.corp:636)', ldapDn: 'cn=DevSecops Admin,ou=Users,dc=enterprise,dc=corp', ip: '10.240.12.89', sessionId: 'sso-sess-908423', status: 'SUCCESS' },
  { id: 'SSO-LOG-1002', timestamp: new Date(Date.now() - 1800000).toLocaleString('en-GB'), user: 'Sarah Jenkins', email: 'sarah.j@enterprise.corp', role: 'SRE Lead', dept: 'Site Reliability', provider: 'eLDAP / Active Directory (ldaps://ldap.enterprise.corp:636)', ldapDn: 'cn=Sarah Jenkins,ou=Users,dc=enterprise,dc=corp', ip: '10.240.14.102', sessionId: 'sso-sess-817234', status: 'SUCCESS' },
  { id: 'SSO-LOG-1003', timestamp: new Date(Date.now() - 7200000).toLocaleString('en-GB'), user: 'Marcus Vance', email: 'm.vance@enterprise.corp', role: 'NOC Operator', dept: 'Operations Center', provider: 'eLDAP / Active Directory (ldaps://ldap.enterprise.corp:636)', ldapDn: 'cn=Marcus Vance,ou=Users,dc=enterprise,dc=corp', ip: '10.240.12.44', sessionId: 'sso-sess-712390', status: 'SUCCESS' }
];

let state = {
  users: defaultUsers,
  auditLogs: defaultAuditLogs,
  ssoLogs: defaultSsoLogs
};

function loadUsersData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      state.users = parsed.users || defaultUsers;
      state.auditLogs = parsed.auditLogs || defaultAuditLogs;
      state.ssoLogs = parsed.ssoLogs || defaultSsoLogs;
    } else {
      saveUsersData();
    }
  } catch (e) {
    console.error('[USERS_DB] Error loading users data:', e.message);
  }
}

function saveUsersData() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('[USERS_DB] Error saving users data:', e.message);
  }
}

loadUsersData();

const userStore = {
  getUsers() {
    return state.users;
  },

  addUser(userData) {
    const id = state.users.length > 0 ? Math.max(...state.users.map(u => u.id)) + 1 : 1;
    const permissions = userData.permissions || (
      userData.role === 'Super Admin' ? ['read', 'remediate', 'thresholds', 'export', 'users', 'tokens'] :
      userData.role === 'SRE Lead' ? ['read', 'remediate', 'thresholds', 'export'] :
      userData.role === 'NOC Operator' ? ['read', 'remediate'] : ['read']
    );

    const newUser = {
      id,
      name: userData.name || 'New Operator',
      email: userData.email || `user${id}@enterprise.corp`,
      role: userData.role || 'NOC Operator',
      status: userData.status || 'Active',
      dept: userData.dept || 'Engineering',
      lastLogin: 'Never',
      mfa: userData.mfa !== undefined ? userData.mfa : true,
      permissions
    };

    state.users.push(newUser);
    saveUsersData();
    return newUser;
  },

  updateUser(id, updates) {
    const idx = state.users.findIndex(u => u.id === parseInt(id));
    if (idx !== -1) {
      state.users[idx] = { ...state.users[idx], ...updates };
      saveUsersData();
      return state.users[idx];
    }
    return null;
  },

  deleteUser(id) {
    const initialLen = state.users.length;
    state.users = state.users.filter(u => u.id !== parseInt(id));
    saveUsersData();
    return state.users.length < initialLen;
  },

  getAuditLogs(limit = 100) {
    return state.auditLogs.slice(-limit);
  },

  addAuditLog(entry) {
    const log = {
      id: Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      user: entry.user || 'DevSecops Admin',
      action: entry.action || 'System Action',
      details: entry.details || '',
      ip: entry.ip || '10.240.12.89'
    };
    state.auditLogs.push(log);
    if (state.auditLogs.length > 500) {
      state.auditLogs = state.auditLogs.slice(-500);
    }
    saveUsersData();
    return log;
  },

  getSsoLogs(limit = 100) {
    return state.ssoLogs.slice(-limit);
  },

  addSsoLog(entry) {
    const log = {
      id: 'SSO-LOG-' + Math.floor(1000 + Math.random() * 9000),
      timestamp: new Date().toLocaleString('en-GB'),
      user: entry.user || 'DevSecops Admin',
      email: entry.email || `${entry.user}@enterprise.corp`,
      role: entry.role || 'Operator',
      dept: entry.dept || 'Operations',
      provider: entry.provider || 'eLDAP / Active Directory (ldaps://ldap.enterprise.corp:636)',
      ldapDn: entry.ldapDn || `cn=${entry.user},ou=Users,dc=enterprise,dc=corp`,
      ip: entry.ip || '10.240.12.89',
      sessionId: 'sso-sess-' + Math.floor(100000 + Math.random() * 900000),
      status: entry.status || 'SUCCESS'
    };
    state.ssoLogs.push(log);
    if (state.ssoLogs.length > 500) {
      state.ssoLogs = state.ssoLogs.slice(-500);
    }
    saveUsersData();
    return log;
  }
};

module.exports = userStore;
