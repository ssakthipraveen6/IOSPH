const fs = require('fs');
const path = require('path');
const postgres = require('./postgres');

// [T0.9] Identity lives in Postgres. The JSON file below is a DEV-ONLY fallback used
// when no database pool is configured; it is never the system of record in production.
const USERS_FILE = path.join(__dirname, 'sentinel_users.json');
const IS_PROD = process.env.NODE_ENV === 'production';

const defaultUsers = [
  { id: 1, name: 'Sentinel Administrator', email: 'admin@sentinel.local', role: 'Super Admin', status: 'Active', dept: 'Platform Operations', lastLogin: 'Just Now', mfa: true, permissions: ['read', 'remediate', 'thresholds', 'export', 'users', 'tokens'] },
  { id: 2, name: 'Reliability Lead', email: 'sre.lead@sentinel.local', role: 'SRE Lead', status: 'Active', dept: 'Site Reliability', lastLogin: '10 mins ago', mfa: true, permissions: ['read', 'remediate', 'thresholds', 'export'] },
  { id: 3, name: 'NOC Operations Specialist', email: 'noc.operator@sentinel.local', role: 'NOC Operator', status: 'Active', dept: 'Operations Center', lastLogin: '1 hour ago', mfa: true, permissions: ['read', 'remediate'] },
  { id: 4, name: 'Compliance Auditor', email: 'auditor@sentinel.local', role: 'Security Auditor', status: 'Active', dept: 'Compliance & Security', lastLogin: '3 hours ago', mfa: true, permissions: ['read', 'export'] },
  { id: 5, name: 'Automation Service Bot', email: 'svc-sentinel@sentinel.local', role: 'Service Account', status: 'Active', dept: 'CI/CD Automation', lastLogin: 'Continuous', mfa: false, permissions: ['read', 'remediate'] }
];

let fallbackState = { users: defaultUsers, auditLogs: [], ssoLogs: [] };

function loadFallback() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      fallbackState.users = parsed.users || defaultUsers;
      fallbackState.auditLogs = parsed.auditLogs || [];
      fallbackState.ssoLogs = parsed.ssoLogs || [];
    }
  } catch (e) {
    console.error('[USERS_DB] Could not read dev fallback file:', e.message);
  }
}

function saveFallback() {
  if (IS_PROD) return;
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(fallbackState, null, 2), 'utf8');
  } catch (e) {
    console.error('[USERS_DB] Could not write dev fallback file:', e.message);
  }
}

loadFallback();

let warnedNoPool = false;
async function db(sql, params) {
  const res = await postgres.query(sql, params);
  if (res === null) {
    if (IS_PROD) {
      throw new Error('[USERS_DB] No database pool available. Identity store is unavailable.');
    }
    if (!warnedNoPool) {
      console.warn('[USERS_DB] No database pool — using dev-only JSON fallback for identity.');
      warnedNoPool = true;
    }
  }
  return res;
}

function rowToUser(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    status: r.status,
    dept: r.dept,
    mfa: r.mfa,
    permissions: r.permissions || [],
    lastLogin: r.last_login ? new Date(r.last_login).toISOString() : null
  };
}

function permissionsFor(role, explicit) {
  if (explicit) return explicit;
  if (role === 'Super Admin') return ['read', 'remediate', 'thresholds', 'export', 'users', 'tokens'];
  if (role === 'SRE Lead') return ['read', 'remediate', 'thresholds', 'export'];
  if (role === 'NOC Operator') return ['read', 'remediate'];
  return ['read'];
}

const userStore = {
  async getUsers() {
    const res = await db('SELECT * FROM app_user ORDER BY created_at ASC');
    if (!res) return fallbackState.users;
    return res.rows.map(rowToUser);
  },

  async addUser(userData) {
    const id = String(userData.id || Date.now());
    const permissions = permissionsFor(userData.role, userData.permissions);
    const user = {
      id,
      name: userData.name,
      email: userData.email,
      role: userData.role || 'Viewer',
      status: userData.status || 'Active',
      dept: userData.dept || null,
      mfa: userData.mfa !== undefined ? userData.mfa : true,
      permissions
    };
    const res = await db(
      `INSERT INTO app_user (id, name, email, role, status, dept, mfa, permissions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [user.id, user.name, user.email, user.role, user.status, user.dept, user.mfa, JSON.stringify(permissions)]
    );
    if (!res) {
      fallbackState.users.push(user);
      saveFallback();
      return user;
    }
    return rowToUser(res.rows[0]);
  },

  async updateUser(id, updates) {
    const res = await db(
      `UPDATE app_user SET
         name        = COALESCE($2, name),
         email       = COALESCE($3, email),
         role        = COALESCE($4, role),
         status      = COALESCE($5, status),
         dept        = COALESCE($6, dept),
         mfa         = COALESCE($7, mfa),
         permissions = COALESCE($8, permissions),
         updated_at  = now()
       WHERE id = $1 RETURNING *`,
      [String(id), updates.name || null, updates.email || null, updates.role || null,
       updates.status || null, updates.dept || null,
       updates.mfa === undefined ? null : updates.mfa,
       updates.permissions ? JSON.stringify(updates.permissions) : null]
    );
    if (!res) {
      const u = fallbackState.users.find(x => String(x.id) === String(id));
      if (!u) return null;
      Object.assign(u, updates);
      saveFallback();
      return u;
    }
    return res.rows[0] ? rowToUser(res.rows[0]) : null;
  },

  async deleteUser(id) {
    const res = await db('DELETE FROM app_user WHERE id = $1', [String(id)]);
    if (!res) {
      const before = fallbackState.users.length;
      fallbackState.users = fallbackState.users.filter(x => String(x.id) !== String(id));
      saveFallback();
      return fallbackState.users.length < before;
    }
    return res.rowCount > 0;
  },

  // Audit and SSO reads come from the append-only tables written by audit_logger (T0.16).
  async getAuditLogs(limit = 100) {
    const res = await db(
      'SELECT ts, actor, action, detail, ip FROM audit_event ORDER BY ts DESC LIMIT $1', [limit]);
    if (!res) return fallbackState.auditLogs.slice(-limit).reverse();
    return res.rows.map(r => ({
      timestamp: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
      user: r.actor,
      action: r.action,
      details: (r.detail && r.detail.details) || JSON.stringify(r.detail || {}),
      ip: r.ip
    }));
  },

  async addAuditLog(entry) {
    const res = await db(
      `INSERT INTO audit_event (actor, actor_role, action, detail, ip)
       VALUES ($1,$2,$3,$4,$5) RETURNING event_id`,
      [entry.user || 'system', entry.role || null, entry.action || 'UNKNOWN',
       JSON.stringify({ details: entry.details || '' }), entry.ip || null]
    );
    if (!res) {
      fallbackState.auditLogs.push({ ...entry, timestamp: new Date().toISOString() });
      saveFallback();
    }
    return entry;
  },

  async getSsoLogs(limit = 100) {
    const res = await db(
      `SELECT ts, username, email, role, provider, ldap_dn, ip, status
         FROM sso_login_event ORDER BY ts DESC LIMIT $1`, [limit]);
    if (!res) return fallbackState.ssoLogs.slice(-limit).reverse();
    return res.rows.map(r => ({
      timestamp: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
      user: r.username,
      email: r.email,
      role: r.role,
      provider: r.provider,
      ldapDn: r.ldap_dn,
      ip: r.ip,
      status: r.status
    }));
  },

  async addSsoLog(entry) {
    const res = await db(
      `INSERT INTO sso_login_event (username, email, role, provider, ldap_dn, ip, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entry.user || entry.username || 'unknown', entry.email || null, entry.role || null,
       entry.provider || 'eLDAP / Active Directory', entry.ldapDn || null,
       entry.ip || null, entry.status || 'SUCCESS']
    );
    if (!res) {
      fallbackState.ssoLogs.push({ ...entry, timestamp: new Date().toISOString() });
      saveFallback();
    }
    return entry;
  }
};

module.exports = userStore;
