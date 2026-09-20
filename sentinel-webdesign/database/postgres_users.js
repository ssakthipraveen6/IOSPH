const fs = require('fs');
const path = require('path');
const postgres = require('./postgres');

const USERS_FILE = path.join(__dirname, 'sentinel_users.json');

// Synthetic default personas — no real corporate employee PII (T0.19)
const defaultUsers = [
  { id: 1, name: 'Sentinel Administrator', email: 'admin@sentinel.local', role: 'Super Admin', status: 'Active', dept: 'Platform Operations', lastLogin: 'Just Now', mfa: true, permissions: ['read', 'remediate', 'thresholds', 'export', 'users', 'tokens'] },
  { id: 2, name: 'Reliability Lead', email: 'sre.lead@sentinel.local', role: 'SRE Lead', status: 'Active', dept: 'Site Reliability', lastLogin: '10 mins ago', mfa: true, permissions: ['read', 'remediate', 'thresholds', 'export'] },
  { id: 3, name: 'NOC Operations Specialist', email: 'noc.operator@sentinel.local', role: 'NOC Operator', status: 'Active', dept: 'Operations Center', lastLogin: '1 hour ago', mfa: true, permissions: ['read', 'remediate'] },
  { id: 4, name: 'Compliance Auditor', email: 'auditor@sentinel.local', role: 'Security Auditor', status: 'Active', dept: 'Compliance & Security', lastLogin: '3 hours ago', mfa: true, permissions: ['read', 'export'] },
  { id: 5, name: 'Automation Service Bot', email: 'svc-sentinel@sentinel.local', role: 'Service Account', status: 'Active', dept: 'CI/CD Automation', lastLogin: 'Continuous', mfa: false, permissions: ['read', 'remediate'] }
];

// Seeded audit and SSO logs are strictly purged — zero fabricated compliance evidence (T0.14)
const defaultAuditLogs = [];
const defaultSsoLogs = [];

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
      state.users = Array.isArray(parsed.users) && parsed.users.length > 0 ? parsed.users : defaultUsers;
      state.auditLogs = Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [];
      state.ssoLogs = Array.isArray(parsed.ssoLogs) ? parsed.ssoLogs : [];
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
      email: userData.email || `user${id}@sentinel.local`,
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

  // Audit logs — empty on clean instance, never fabricated (T0.14)
  getAuditLogs(limit = 100) {
    return state.auditLogs.slice(-limit);
  },

  addAuditLog(entry) {
    const log = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      user: entry.user || 'admin@sentinel.local',
      action: entry.action || 'System Action',
      details: entry.details || '',
      ip: entry.ip || '127.0.0.1'
    };
    state.auditLogs.push(log);
    if (state.auditLogs.length > 500) {
      state.auditLogs = state.auditLogs.slice(-500);
    }
    saveUsersData();
    return log;
  },

  // SSO logs — empty on clean instance, never fabricated (T0.14)
  getSsoLogs(limit = 100) {
    return state.ssoLogs.slice(-limit);
  },

  addSsoLog(entry) {
    const log = {
      id: 'SSO-LOG-' + Date.now(),
      timestamp: new Date().toISOString(),
      user: entry.user || 'admin@sentinel.local',
      email: entry.email || `${entry.user}@sentinel.local`,
      role: entry.role || 'Operator',
      dept: entry.dept || 'Operations',
      provider: entry.provider || 'eLDAP / Active Directory Gateway',
      ldapDn: entry.ldapDn || `cn=${entry.user},ou=Users,dc=enterprise,dc=corp`,
      ip: entry.ip || '127.0.0.1',
      sessionId: 'sso-sess-' + Date.now(),
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
