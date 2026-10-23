/**
 * Admin view: users and roles, maintenance switches, and the preflight check, for Super Admins.
 */
import React, { useState, useEffect } from 'react';
import { MAINTENANCE_CONFIG } from '../../maintenanceConfig';
import { MaintenanceBadge, MaintenanceBanner } from '../shared/MaintenanceNotice';
import PreflightCheckView from './PreflightCheckView';
import { apiFetch } from '../../api';
import './AdminManagement.css';

// [F6] No seeded accounts: the directory shows only what /api/admin/users returns.
const initialUsers = [];

const initialAuditLogs = [];
const initialSsoAccessLogs = [];

// Admin page component; tabs for users, maintenance and preflight.
export default function AdminManagement({ environment = 'staging' }) {
  const currentEnv = environment || 'staging';
  
  const [users, setUsers] = useState(initialUsers);
  const [auditLogs, setAuditLogs] = useState(initialAuditLogs);
  const [ssoAccessLogs, setSsoAccessLogs] = useState(initialSsoAccessLogs);
  const [selectedUser, setSelectedUser] = useState(null);
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  
  // Forms
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'NOC Operator', dept: 'Engineering' });
  const [editFormData, setEditFormData] = useState(null);
  
  // Independent Search Filters for Tab 1 and Tab 2
  const [userSearchFilter, setUserSearchFilter] = useState('');
  const [rbacSearchFilter, setRbacSearchFilter] = useState('');
  const [ssoSearchFilter, setSsoSearchFilter] = useState('');

  const [activeTab, setActiveTab] = useState('users'); // users, rbac, audit, policies
  const [notification, setNotification] = useState(null);
  const [ingestKeys, setIngestKeys] = useState([]);
  const [sessionUser, setSessionUser] = useState(null);
  const [ssoStatus, setSsoStatus] = useState(null);

  const getCsrfToken = () => {
    const match = document.cookie.match(/(^|;\s*)sentinel_csrf=([^;]*)/);
    return match ? decodeURIComponent(match[2]) : '';
  };

  const getAuthHeaders = () => {
    return {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken()
    };
  };

  // Fetch real data from backend API
  const fetchAdminData = async () => {
    try {
      const headers = getAuthHeaders();
      const [uRes, aRes, sRes, kRes] = await Promise.all([
        fetch('/api/admin/users', { headers }),
        fetch('/api/admin/audit-logs', { headers }),
        fetch('/api/admin/sso-logs', { headers }),
        fetch('/api/admin/ingest-keys', { headers })
      ]);

      if (uRes.ok) {
        const uData = await uRes.json();
        if (Array.isArray(uData)) {
          setUsers(uData);
          if (!selectedUser || !uData.some(u => u.id === selectedUser.id)) {
            setSelectedUser(uData[0]);
          }
        }
      }
      if (aRes.ok) {
        const aData = await aRes.json();
        if (Array.isArray(aData)) setAuditLogs(aData);
      }
      if (sRes.ok) {
        const sData = await sRes.json();
        if (Array.isArray(sData)) setSsoAccessLogs(sData);
      }
      if (kRes && kRes.ok) {
        const kData = await kRes.json();
        if (kData && Array.isArray(kData.keys)) setIngestKeys(kData.keys);
      }
    } catch (e) {
      console.error('[ADMIN] Failed loading data from backend:', e);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, [environment]);

  // Signed-in user and identity provider come from the server, never from literals.
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(setSessionUser)
      .catch(() => setSessionUser(null));
    fetch('/api/auth/sso/status', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(setSsoStatus)
      .catch(() => setSsoStatus(null));
  }, []);

  const triggerToast = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  // Toggle RBAC permissions
  const handleTogglePermission = async (userId, permKey) => {
    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) return;
    const curPerms = Array.isArray(targetUser.permissions) ? targetUser.permissions : [];
    const hasPerm = curPerms.includes(permKey);
    const updatedPerms = hasPerm
      ? curPerms.filter(p => p !== permKey)
      : [...curPerms, permKey];

    const updatedUser = { ...targetUser, permissions: updatedPerms };
    setUsers(prev => prev.map(u => u.id === userId ? updatedUser : u));

    try {
      await apiFetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(updatedUser)
      });
      fetchAdminData();
    } catch (e) {
      console.error('Failed to update user permission:', e);
    }
  };

  // Provision New User Form Submit
  const handleAddUserSubmit = async (e) => {
    e.preventDefault();
    if (!newUser.name.trim() || !newUser.email.trim()) return;

    let defaultPerms = ['read'];
    if (newUser.role === 'Super Admin') defaultPerms = ['read', 'remediate', 'thresholds', 'export', 'users', 'tokens'];
    if (newUser.role === 'SRE Lead') defaultPerms = ['read', 'remediate', 'thresholds', 'export'];
    if (newUser.role === 'NOC Operator') defaultPerms = ['read', 'remediate'];
    if (newUser.role === 'Security Auditor') defaultPerms = ['read', 'export'];

    const userPayload = {
      name: newUser.name.trim(),
      email: newUser.email.trim(),
      role: newUser.role || 'NOC Operator',
      dept: newUser.dept.trim() || 'Engineering',
      permissions: defaultPerms
    };

    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(userPayload)
      });
      if (res.ok) {
        const created = await res.json();
        setUsers(prev => [...prev, created]);
        setSelectedUser(created);
        setShowAddModal(false);
        setNewUser({ name: '', email: '', role: 'NOC Operator', dept: 'Engineering' });
        triggerToast(`✅ User "${created.name}" provisioned and synchronized to backend.`);
        fetchAdminData();
      }
    } catch (err) {
      console.error('Failed adding user:', err);
    }
  };

  // Open Edit Modal for a user
  const handleOpenEditModal = (user) => {
    setEditFormData({ 
      ...user,
      permissions: Array.isArray(user.permissions) ? [...user.permissions] : ['read']
    });
    setShowEditModal(true);
  };

  // Save Edited User Profile
  const handleSaveEditUser = async (e) => {
    e.preventDefault();
    if (!editFormData || !editFormData.name.trim() || !editFormData.email.trim()) return;

    const sanitized = {
      ...editFormData,
      name: editFormData.name.trim(),
      email: editFormData.email.trim(),
      dept: editFormData.dept?.trim() || 'Engineering',
      permissions: Array.isArray(editFormData.permissions) ? editFormData.permissions : ['read']
    };

    try {
      const res = await apiFetch(`/api/admin/users/${sanitized.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(sanitized)
      });
      if (res.ok) {
        const updated = await res.json();
        setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
        setSelectedUser(updated);
        setShowEditModal(false);
        triggerToast(`✏️ User profile for "${updated.name}" updated on server.`);
        fetchAdminData();
      }
    } catch (err) {
      console.error('Failed saving user edit:', err);
    }
  };

  // Delete/Revoke user
  const handleDeleteUser = async (userId) => {
    const target = users.find(u => u.id === userId);
    if (!target) return;
    if (target.role === 'Super Admin' && users.filter(u => u.role === 'Super Admin').length <= 1) {
      alert('Cannot delete the primary Super Admin account.');
      return;
    }

    if (window.confirm(`Are you sure you want to revoke access and delete account for "${target.name}"?`)) {
      try {
        const res = await apiFetch(`/api/admin/users/${userId}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const remaining = users.filter(u => u.id !== userId);
          setUsers(remaining);
          if (selectedUser?.id === userId) {
            setSelectedUser(remaining[0] || null);
          }
          triggerToast(`🔒 User ${target.name} account access revoked.`);
          fetchAdminData();
        }
      } catch (err) {
        console.error('Failed deleting user:', err);
      }
    }
  };

  // Reload the directory from the server (no local seed data)
  const handleResetDefaults = () => {
    setUserSearchFilter('');
    setRbacSearchFilter('');
    localStorage.removeItem('sentinel_admin_users');
    fetchAdminData();
    triggerToast('🔄 Directory reloaded from the server.');
  };

  // Filtered users for Tab 1 (User Directory)
  const directoryUsers = users.filter(u => 
    (u.name || '').toLowerCase().includes(userSearchFilter.toLowerCase()) || 
    (u.email || '').toLowerCase().includes(userSearchFilter.toLowerCase()) ||
    (u.role || '').toLowerCase().includes(userSearchFilter.toLowerCase()) ||
    (u.dept || '').toLowerCase().includes(userSearchFilter.toLowerCase())
  );

  // Filtered users for Tab 2 (Permission Matrix)
  const rbacUsers = users.filter(u => 
    (u.name || '').toLowerCase().includes(rbacSearchFilter.toLowerCase()) || 
    (u.email || '').toLowerCase().includes(rbacSearchFilter.toLowerCase()) ||
    (u.role || '').toLowerCase().includes(rbacSearchFilter.toLowerCase()) ||
    (u.dept || '').toLowerCase().includes(rbacSearchFilter.toLowerCase())
  );

  // Filtered logs for Tab 3 (SSO Access Logs)
  const filteredSsoLogs = ssoAccessLogs.filter(l =>
    (l.user || '').toLowerCase().includes(ssoSearchFilter.toLowerCase()) ||
    (l.email || '').toLowerCase().includes(ssoSearchFilter.toLowerCase()) ||
    (l.ip || '').toLowerCase().includes(ssoSearchFilter.toLowerCase()) ||
    (l.role || '').toLowerCase().includes(ssoSearchFilter.toLowerCase()) ||
    (l.ldapDn || '').toLowerCase().includes(ssoSearchFilter.toLowerCase())
  );

  return (
    <div className="adm-root">
      
      {/* Toast Notification Banner */}
      {notification && (
        <div className="adm-toast">
          <span>{notification}</span>
          <button onClick={() => setNotification(null)} className="adm-toast__close">✕</button>
        </div>
      )}

      {/* Header Banner */}
      <div className="console-panel adm-hero">
        <div className="adm-hero__row">
          <div>
            <h2 className="adm-hero__title">
              🛡️ DevSecOps Admin Control & User Access Center
              {MAINTENANCE_CONFIG.pages.adminManagement && <MaintenanceBadge />}
            </h2>
            <p className="adm-hero__desc">
              Manage enterprise user roles, RBAC access levels, authentication policies, and security audit trails.
            </p>
          </div>
          <div className="adm-hero__actions">
            <button 
              className="ignore-trigger-btn adm-reload-btn"
              onClick={handleResetDefaults}
              title="Reload the user directory from the server"
            >
              🔄 Reload
            </button>
            <button 
              className="remediate-trigger-btn adm-provision-btn"
              onClick={() => setShowAddModal(true)}
            >
              ➕ Provision New User
            </button>
          </div>
        </div>

        {/* View Navigation Tabs */}
        <div className="adm-tabs">
          <button 
            className={`nav-tab-btn adm-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 User Directory ({users.length})
          </button>
          <button 
            className={`nav-tab-btn adm-tab ${activeTab === 'rbac' ? 'active' : ''}`}
            onClick={() => setActiveTab('rbac')}
          >
            🔑 Permission Matrix ({users.length})
          </button>
          <button 
            className={`nav-tab-btn adm-tab ${activeTab === 'sso_logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('sso_logs')}
          >
            🔐 SSO Access Logs ({ssoAccessLogs.length})
          </button>
          <button 
            className={`nav-tab-btn adm-tab ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            📜 Admin Audit Logs ({auditLogs.length})
          </button>
          <button 
            className={`nav-tab-btn adm-tab ${activeTab === 'policies' ? 'active' : ''}`}
            onClick={() => setActiveTab('policies')}
          >
            ⚙️ Security & SSO Policies
          </button>
          <button 
            className={`nav-tab-btn adm-tab ${activeTab === 'preflight' ? 'active' : ''}`}
            onClick={() => setActiveTab('preflight')}
          >
            🔍 Endpoint Preflight
          </button>
        </div>
      </div>

      {activeTab === 'users' && (
        <div className="adm-grid-users">
          
          {/* Left Table Panel */}
          <div className="console-panel">
            <div className="panel-header">
              <h3>👥 Registered Accounts & Details ({directoryUsers.length} of {users.length})</h3>
              <div className="adm-search-group">
                <input 
                  type="text"
                  placeholder="Search user, email, role..."
                  value={userSearchFilter}
                  onChange={(e) => setUserSearchFilter(e.target.value)}
                  className="adm-search"
                />
                {userSearchFilter && (
                  <button 
                    onClick={() => setUserSearchFilter('')}
                    className="adm-clear-btn"
                  >
                    ✕ Clear
                  </button>
                )}
              </div>
            </div>

            <div className="table-wrapper adm-table-wrap">
              <table className="telemetry-table">
                <thead>
                  <tr>
                    <th>User / Name</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>MFA Status</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {directoryUsers.length === 0 ? (
                    <tr><td colSpan="6" className="adm-empty">No user accounts matching search filter.</td></tr>
                  ) : (
                    directoryUsers.map(u => (
                      <tr 
                        key={u.id}
                        onClick={() => setSelectedUser(u)}
                        className={`adm-row--clickable${selectedUser?.id === u.id ? ' adm-row--selected' : ''}`}
                      >
                        <td className="adm-strong">
                          <div className="adm-user">
                            <span className="adm-user__icon">{u.role === 'Super Admin' ? '🛡️' : '👤'}</span>
                            <div>
                              <div>{u.name}</div>
                              <div className="adm-sub">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="status-badge-inline moderate">{u.role}</span>
                        </td>
                        <td className="adm-cell-sm">{u.dept}</td>
                        <td>
                          {u.mfa ? (
                            <span className="adm-mfa adm-mfa--on">🔒 ENFORCED</span>
                          ) : (
                            <span className="adm-mfa adm-mfa--off">⚠️ OPTIONAL</span>
                          )}
                        </td>
                        <td>
                          <span className={`status-badge-inline ${u.status === 'Active' ? 'healthy' : 'critical'}`}>
                            {u.status}
                          </span>
                        </td>
                        <td>
                          <div className="adm-row-actions">
                            <button 
                              className="remediate-trigger-btn adm-btn-xs" 
                              onClick={(e) => { e.stopPropagation(); handleOpenEditModal(u); }}
                              title="Edit User Profile"
                            >
                              ✏️ Edit
                            </button>
                            <button 
                              className="ignore-trigger-btn adm-btn-xs adm-btn-danger" 
                              onClick={(e) => { e.stopPropagation(); handleDeleteUser(u.id); }}
                              title="Revoke User Access"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Selected User Details Inspector */}
          {selectedUser && (
            <div className="console-panel adm-inspector">
              <div className="panel-header adm-inspector__head">
                <h3>👤 Account Security Profile</h3>
                <span className="status-badge-inline healthy">ID: #{selectedUser.id}</span>
              </div>

              <div className="adm-profile">
                <span className="adm-profile__icon">{selectedUser.role === 'Super Admin' ? '🛡️' : '👤'}</span>
                <h4 className="adm-profile__name">{selectedUser.name}</h4>
                <span className="adm-profile__email">{selectedUser.email}</span>
                <div className="adm-profile__status">
                  <span className={`status-badge-inline ${selectedUser.status === 'Active' ? 'healthy' : 'critical'}`}>
                    ● {selectedUser.status}
                  </span>
                </div>
              </div>

              <div className="adm-facts">
                <div><strong>Assigned Role:</strong> {selectedUser.role}</div>
                <div><strong>Department:</strong> {selectedUser.dept}</div>
                <div><strong>Last Session Activity:</strong> {selectedUser.lastLogin}</div>
                <div><strong>Multi-Factor Auth (MFA):</strong> {selectedUser.mfa ? 'Enabled (Authenticator App)' : 'Disabled'}</div>
              </div>

              <div className="adm-perms">
                <h4 className="adm-perms__title">PERMISSIONS GRANTED ({Array.isArray(selectedUser.permissions) ? selectedUser.permissions.length : 0}):</h4>
                <div className="adm-perms__list">
                  {(Array.isArray(selectedUser.permissions) ? selectedUser.permissions : []).map(p => (
                    <span key={p} className="adm-perm-chip">
                      ✓ {p.toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>

              <div className="adm-inspector__actions">
                <button 
                  className="remediate-trigger-btn adm-btn-block" 
                  onClick={() => handleOpenEditModal(selectedUser)}
                >
                  ✏️ Edit Profile
                </button>
                <button 
                  className="ignore-trigger-btn adm-btn-block adm-btn-danger" 
                  onClick={() => handleDeleteUser(selectedUser.id)}
                >
                  🔒 Revoke Access
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {/* TAB 2: RBAC PERMISSIONS MATRIX */}
      {activeTab === 'rbac' && (
        <div className="console-panel">
          <div className="panel-header">
            <h3>🔑 Role-Based Access Control (RBAC) Permissions Matrix ({rbacUsers.length} of {users.length} Users)</h3>
            <div className="adm-search-group">
              <input 
                type="text"
                placeholder="Search user or role..."
                value={rbacSearchFilter}
                onChange={(e) => setRbacSearchFilter(e.target.value)}
                className="adm-search"
              />
              {rbacSearchFilter && (
                <button 
                  onClick={() => setRbacSearchFilter('')}
                  className="adm-clear-btn"
                >
                  ✕ Clear Filter
                </button>
              )}
            </div>
          </div>
          <p className="adm-intro">
            Click checkmarks to dynamically toggle read, remediation, threshold modification, export, and admin privileges for each user. Changes update and persist automatically across all tiles.
          </p>

          <div className="table-wrapper">
            <table className="telemetry-table">
              <thead>
                <tr>
                  <th>User / Email</th>
                  <th>Role</th>
                  <th className="adm-center">Read Telemetry</th>
                  <th className="adm-center">Trigger Remediation</th>
                  <th className="adm-center">Modify Thresholds</th>
                  <th className="adm-center">Export Reports</th>
                  <th className="adm-center">Manage Users</th>
                  <th className="adm-center">API Key Token</th>
                </tr>
              </thead>
              <tbody>
                {rbacUsers.length === 0 ? (
                  <tr><td colSpan="8" className="adm-empty">No user accounts matching filter.</td></tr>
                ) : (
                  rbacUsers.map(u => {
                    const uPerms = Array.isArray(u.permissions) ? u.permissions : [];
                    return (
                      <tr key={u.id} className={selectedUser?.id === u.id ? 'adm-row--selected' : undefined}>
                        <td className="adm-strong">
                          <div className="adm-user adm-user--tight">
                            <span>{u.role === 'Super Admin' ? '🛡️' : '👤'}</span>
                            <div>
                              <div>{u.name}</div>
                              <div className="adm-sub">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td><span className="status-badge-inline moderate">{u.role}</span></td>
                        
                        {['read', 'remediate', 'thresholds', 'export', 'users', 'tokens'].map(perm => {
                          const active = uPerms.includes(perm);
                          return (
                            <td key={perm} className="adm-center">
                              <input 
                                type="checkbox"
                                checked={active}
                                onChange={() => handleTogglePermission(u.id, perm)}
                                className="adm-checkbox adm-checkbox--clickable"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: SSO ACCESS & AUTHENTICATION AUDIT LOGS */}
      {activeTab === 'sso_logs' && (
        <div className="adm-stack">
          
          {/* Top KPI Cards */}
          <div className="adm-kpis">
            <div className="console-panel adm-kpi">
              <div className="adm-kpi__label">SSO ACCESS EVENTS</div>
              <div className="adm-kpi__value">{ssoAccessLogs.length}</div>
              <div className="adm-kpi__hint">Recorded sign-in events</div>
            </div>
            <div className="console-panel adm-kpi">
              <div className="adm-kpi__label">IDENTITY PROVIDER</div>
              <div className="adm-kpi__value--text adm-kpi__value--ellipsis">{ssoStatus?.provider || 'Not available'}</div>
              <div className="adm-kpi__hint adm-kpi__hint--link">{ssoStatus?.ldapUrl || '—'}</div>
            </div>
            <div className="console-panel adm-kpi">
              <div className="adm-kpi__label">AUTH PROTOCOL</div>
              <div className="adm-kpi__value--text">OAuth2 / SAML 2.0</div>
              <div className="adm-kpi__hint">Direct Bind & TOTP MFA</div>
            </div>
            <div className="console-panel adm-kpi">
              <div className="adm-kpi__label">ACTIVE SESSION USER</div>
              <div className="adm-kpi__value--session">{sessionUser?.displayName || sessionUser?.username || 'Not signed in'}</div>
              <div className="adm-kpi__hint">{sessionUser?.role || '—'}</div>
            </div>
          </div>

          {/* Main SSO Logs Table Panel */}
          <div className="console-panel">
            <div className="panel-header">
              <div>
                <h3>🔐 SSO Access & User Session Audit Logs ({filteredSsoLogs.length} of {ssoAccessLogs.length})</h3>
                <p className="adm-ph-desc">
                  Logs exact timestamp, user identity, eLDAP Distinguished Name (DN), IP address, and session ID whenever the application is accessed.
                </p>
              </div>
              <div className="adm-search-group adm-search-group--wide">
                <input 
                  type="text"
                  placeholder="Filter by user, email, IP, DN..."
                  value={ssoSearchFilter}
                  onChange={(e) => setSsoSearchFilter(e.target.value)}
                  className="adm-search adm-search--wide"
                />
              </div>
            </div>

            <div className="table-wrapper adm-table-wrap adm-table-wrap--tall">
              <table className="telemetry-table">
                <thead>
                  <tr>
                    <th>Timestamp (When)</th>
                    <th>User Identity (Who)</th>
                    <th>eLDAP Provider / DN</th>
                    <th>Assigned Role & Dept</th>
                    <th>IP Address & Session ID</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSsoLogs.length === 0 ? (
                    <tr><td colSpan="6" className="adm-empty adm-empty--muted">No records</td></tr>
                  ) : (
                    filteredSsoLogs.map(log => (
                      <tr key={log.id}>
                        <td className="adm-cell-mono adm-cell-ts">
                          {log.timestamp}
                        </td>
                        <td>
                          <div className="adm-strong">{log.user}</div>
                          <div className="adm-sub">{log.email}</div>
                        </td>
                        <td className="adm-cell-xs">
                          <div className="adm-provider">{log.provider}</div>
                          <div className="adm-dn">{log.ldapDn}</div>
                        </td>
                        <td className="adm-cell-sm">
                          <span className="status-badge-inline moderate">{log.role}</span>
                          <div className="adm-sub adm-sub--spaced">{log.dept}</div>
                        </td>
                        <td className="adm-cell-mono adm-cell-mono--xs">
                          <div>IP: {log.ip}</div>
                          <div className="adm-muted">{log.sessionId}</div>
                        </td>
                        <td>
                          <span className="status-badge-inline healthy">
                            🟢 {log.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ADMIN AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div className="console-panel">
          <div className="panel-header">
            <h3>📜 Administrative Security & Compliance Audit Log</h3>
          </div>
          <p className="adm-intro">
            Immutable audit record of all user creations, profile edits, permission changes, and administrative actions.
          </p>

          <div className="table-wrapper">
            <table className="telemetry-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Admin / User</th>
                  <th>Action Type</th>
                  <th>Details & Scope</th>
                  <th>IP Address</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr><td colSpan="5" className="adm-empty adm-empty--muted">No records</td></tr>
                ) : (
                  auditLogs.map(log => (
                  <tr key={log.id}>
                    <td className="adm-cell-mono">{log.timestamp}</td>
                    <td className="adm-cell-user">{log.user}</td>
                    <td><span className="status-badge-inline healthy">{log.action}</span></td>
                    <td className="adm-cell-details">{log.details}</td>
                    <td className="adm-cell-mono adm-cell-mono--xs adm-muted">{log.ip}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: SECURITY & SSO POLICIES */}
      {activeTab === 'policies' && (
        <div className="adm-grid-2">
          <div className="console-panel">
            <div className="panel-header">
              <h3>🔒 Authentication & SSO Integration</h3>
            </div>
            <div className="adm-policy-list">
              <div className="adm-policy">
                <div>
                  <strong>Enterprise eLDAP / Active Directory Sync</strong>
                  <div className="adm-hint">Primary auth provider for corp domain</div>
                </div>
                <span className="status-badge-inline healthy">🟢 CONNECTED</span>
              </div>
              <div className="adm-policy">
                <div>
                  <strong>Mandatory MFA Enforcement</strong>
                  <div className="adm-hint">Require TOTP / YubiKey for admin roles</div>
                </div>
                <span className="status-badge-inline healthy">ENABLED</span>
              </div>
              <div className="adm-policy">
                <div>
                  <strong>Session Expiry Timeout</strong>
                  <div className="adm-hint">Auto logout idle administrative sessions</div>
                </div>
                <select className="adm-policy-select" defaultValue="30">
                  <option value="15">15 Minutes</option>
                  <option value="30">30 Minutes</option>
                  <option value="60">60 Minutes</option>
                </select>
              </div>
            </div>
          </div>

          <div className="console-panel">
            <div className="panel-header">
              <h3>🔑 Ingest API Keys &amp; Telemetry Gateway Credentials</h3>
              <span className="adm-hint">Super Admin Restricted</span>
            </div>
            <div className="adm-policy-list adm-policy-list--tight">
              {ingestKeys.length === 0 ? (
                <div className="adm-key-empty">
                  No active ingest keys found in the database. Use <code>node scripts/ingest_key.js create --name &lt;name&gt; --env &lt;env&gt;</code> to provision keys securely.
                </div>
              ) : (
                ingestKeys.map((k, idx) => (
                  <div key={idx} className="adm-key">
                    <div className="adm-key__head">
                      <div className="adm-key__name">{k.name}</div>
                      <span className="status-badge-inline healthy">ACTIVE</span>
                    </div>
                    <div className="adm-key__grid">
                      <div>Env: <strong className="adm-key__val">{k.environment}</strong></div>
                      <div>Scopes: <strong className="adm-key__val">{(k.scopes || []).join(', ') || 'ingest'}</strong></div>
                      {k.allowed_environments && k.allowed_environments.length > 0 && (
                        <div>Allowed Envs: <strong className="adm-key__val">{k.allowed_environments.join(', ')}</strong></div>
                      )}
                      <div>Created: <span className="adm-key__val">{new Date(k.created_at).toLocaleDateString()} by {k.created_by || 'system'}</span></div>
                      <div>Last Used: <span className="adm-key__val">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}</span></div>
                    </div>
                  </div>
                ))
              )}
              <div className="adm-hint adm-hint--spaced">
                🔒 Raw API tokens are hashed (SHA-256) at creation time and never stored in plain text or returned over the wire.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD NEW USER */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card adm-modal" onClick={e => e.stopPropagation()}>
            <div className="panel-header adm-modal__head">
              <h3>➕ Provision New User Account</h3>
              <button onClick={() => setShowAddModal(false)} className="adm-modal__close">✕</button>
            </div>

            <form onSubmit={handleAddUserSubmit} className="adm-form">
              <div>
                <label className="adm-label">Full Name *</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Alex Morgan"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  className="adm-input"
                />
              </div>

              <div>
                <label className="adm-label">Corporate Email *</label>
                <input 
                  type="email"
                  required
                  placeholder="user@corp.local"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="adm-input"
                />
              </div>

              <div>
                <label className="adm-label">Role Assignment</label>
                <select 
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="adm-input"
                >
                  <option value="Super Admin">Super Admin</option>
                  <option value="SRE Lead">SRE Lead</option>
                  <option value="NOC Operator">NOC Operator</option>
                  <option value="Security Auditor">Security Auditor</option>
                  <option value="Service Account">Service Account</option>
                </select>
              </div>

              <div>
                <label className="adm-label">Department</label>
                <input 
                  type="text"
                  placeholder="e.g. Operations / Cloud SRE"
                  value={newUser.dept}
                  onChange={(e) => setNewUser({ ...newUser, dept: e.target.value })}
                  className="adm-input"
                />
              </div>

              <div className="adm-form__actions">
                <button type="button" className="ignore-trigger-btn" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="remediate-trigger-btn">Provision & Save User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT USER PROFILE */}
      {showEditModal && editFormData && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-card adm-modal adm-modal--wide" onClick={e => e.stopPropagation()}>
            <div className="panel-header adm-modal__head">
              <h3>✏️ Edit User Profile: {editFormData.name}</h3>
              <button onClick={() => setShowEditModal(false)} className="adm-modal__close">✕</button>
            </div>

            <form onSubmit={handleSaveEditUser} className="adm-form">
              <div>
                <label className="adm-label">Full Name</label>
                <input 
                  type="text"
                  required
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  className="adm-input"
                />
              </div>

              <div>
                <label className="adm-label">Corporate Email</label>
                <input 
                  type="email"
                  required
                  value={editFormData.email}
                  onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                  className="adm-input"
                />
              </div>

              <div className="adm-form__grid">
                <div>
                  <label className="adm-label">Assigned Role</label>
                  <select 
                    value={editFormData.role}
                    onChange={(e) => setEditFormData({ ...editFormData, role: e.target.value })}
                    className="adm-input"
                  >
                    <option value="Super Admin">Super Admin</option>
                    <option value="SRE Lead">SRE Lead</option>
                    <option value="NOC Operator">NOC Operator</option>
                    <option value="Security Auditor">Security Auditor</option>
                    <option value="Service Account">Service Account</option>
                  </select>
                </div>

                <div>
                  <label className="adm-label">Account Status</label>
                  <select 
                    value={editFormData.status}
                    onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                    className="adm-input"
                  >
                    <option value="Active">Active</option>
                    <option value="Suspended">Suspended</option>
                    <option value="Pending 2FA">Pending 2FA</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="adm-label">Department</label>
                <input 
                  type="text"
                  value={editFormData.dept}
                  onChange={(e) => setEditFormData({ ...editFormData, dept: e.target.value })}
                  className="adm-input"
                />
              </div>

              <div className="adm-mfa-row">
                <input 
                  type="checkbox"
                  id="mfaToggle"
                  checked={editFormData.mfa}
                  onChange={(e) => setEditFormData({ ...editFormData, mfa: e.target.checked })}
                  className="adm-checkbox"
                />
                <label htmlFor="mfaToggle" className="adm-mfa-label">
                  Enforce Multi-Factor Authentication (MFA)
                </label>
              </div>

              <div className="adm-form__actions">
                <button type="button" className="ignore-trigger-btn" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="remediate-trigger-btn">Save Profile Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'preflight' && (
        <PreflightCheckView environment={currentEnv} />
      )}

    </div>
  );
}
