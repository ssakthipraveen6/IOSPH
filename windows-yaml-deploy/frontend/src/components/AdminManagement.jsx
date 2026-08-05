import React, { useState, useEffect } from 'react';
import { MAINTENANCE_CONFIG } from '../maintenanceConfig';
import { MaintenanceBadge, MaintenanceBanner } from './MaintenanceNotice';

const initialUsers = [
  { id: 1, name: 'DevSecops Admin', email: 'devsecops-admin@enterprise.corp', role: 'Super Admin', status: 'Active', dept: 'DevSecOps & NOC', lastLogin: 'Just Now', mfa: true, permissions: ['read', 'remediate', 'thresholds', 'export', 'users', 'tokens'] },
  { id: 2, name: 'Sarah Jenkins', email: 'sarah.j@enterprise.corp', role: 'SRE Lead', status: 'Active', dept: 'Site Reliability', lastLogin: '10 mins ago', mfa: true, permissions: ['read', 'remediate', 'thresholds', 'export'] },
  { id: 3, name: 'Marcus Vance', email: 'm.vance@enterprise.corp', role: 'NOC Operator', status: 'Active', dept: 'Operations Center', lastLogin: '1 hour ago', mfa: true, permissions: ['read', 'remediate'] },
  { id: 4, name: 'Elena Rostova', email: 'e.rostova@enterprise.corp', role: 'Security Auditor', status: 'Active', dept: 'Compliance & Cyber', lastLogin: '3 hours ago', mfa: true, permissions: ['read', 'export'] },
  { id: 5, name: 'Automation Service Bot', email: 'svc-sentinel@enterprise.corp', role: 'Service Account', status: 'Active', dept: 'CI/CD Pipeline', lastLogin: 'Continuous', mfa: false, permissions: ['read', 'remediate'] },
];

const initialAuditLogs = [
  { id: 101, timestamp: new Date().toLocaleTimeString(), user: 'DevSecops Admin', action: 'Modified Threshold', details: 'Updated Bitbucket CPU warning threshold to 85%', ip: '10.240.12.89' },
  { id: 102, timestamp: new Date(Date.now() - 600000).toLocaleTimeString(), user: 'DevSecops Admin', action: 'Auto-Remediation Trigger', details: 'Executed Service Restart on Jenkins_k8s container', ip: '10.240.12.89' },
  { id: 103, timestamp: new Date(Date.now() - 3600000).toLocaleTimeString(), user: 'Sarah Jenkins', action: 'Exported Telemetry', details: 'Downloaded 24h Metrics CSV report for Postgres Database', ip: '10.240.14.102' },
];

const initialSsoAccessLogs = [
  { id: 'SSO-LOG-1001', timestamp: new Date().toLocaleString('en-GB'), user: 'DevSecops Admin', email: 'devsecops-admin@enterprise.corp', role: 'Super Admin', dept: 'DevSecOps & NOC', provider: 'eLDAP / Active Directory (ldaps://ldap.enterprise.corp:636)', ldapDn: 'cn=DevSecops Admin,ou=Users,dc=enterprise,dc=corp', ip: '10.240.12.89', sessionId: 'sso-sess-908423', status: 'SUCCESS' },
  { id: 'SSO-LOG-1002', timestamp: new Date(Date.now() - 1800000).toLocaleString('en-GB'), user: 'Sarah Jenkins', email: 'sarah.j@enterprise.corp', role: 'SRE Lead', dept: 'Site Reliability', provider: 'eLDAP / Active Directory (ldaps://ldap.enterprise.corp:636)', ldapDn: 'cn=Sarah Jenkins,ou=Users,dc=enterprise,dc=corp', ip: '10.240.14.102', sessionId: 'sso-sess-817234', status: 'SUCCESS' },
  { id: 'SSO-LOG-1003', timestamp: new Date(Date.now() - 7200000).toLocaleString('en-GB'), user: 'Marcus Vance', email: 'm.vance@enterprise.corp', role: 'NOC Operator', dept: 'Operations Center', provider: 'eLDAP / Active Directory (ldaps://ldap.enterprise.corp:636)', ldapDn: 'cn=Marcus Vance,ou=Users,dc=enterprise,dc=corp', ip: '10.240.12.44', sessionId: 'sso-sess-712390', status: 'SUCCESS' }
];

export default function AdminManagement() {
  // Load users from localStorage or fallback to default
  const [users, setUsers] = useState(() => {
    const saved = localStorage.getItem('sentinel_admin_users');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) { 
        console.error('Failed to parse saved users:', e); 
      }
    }
    return initialUsers;
  });

  const [auditLogs, setAuditLogs] = useState(() => {
    const saved = localStorage.getItem('sentinel_admin_audit_logs');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
    }
    return initialAuditLogs;
  });

  const [ssoAccessLogs, setSsoAccessLogs] = useState(() => {
    const saved = localStorage.getItem('sentinel_sso_access_logs');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return initialSsoAccessLogs;
  });

  const [selectedUser, setSelectedUser] = useState(() => users[0] || initialUsers[0]);
  
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

  // Sync to localStorage on state changes and dispatch global sync event
  useEffect(() => {
    localStorage.setItem('sentinel_admin_users', JSON.stringify(users));
    window.dispatchEvent(new Event('sentinel_users_updated'));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('sentinel_admin_audit_logs', JSON.stringify(auditLogs));
  }, [auditLogs]);

  useEffect(() => {
    localStorage.setItem('sentinel_sso_access_logs', JSON.stringify(ssoAccessLogs));
  }, [ssoAccessLogs]);

  // Automatically log current application access session via SSO eLDAP
  useEffect(() => {
    const sessionKey = 'sentinel_sso_session_logged';
    if (!sessionStorage.getItem(sessionKey)) {
      sessionStorage.setItem(sessionKey, 'true');
      const accessLog = {
        id: 'SSO-LOG-' + Date.now(),
        timestamp: new Date().toLocaleString('en-GB'),
        user: 'DevSecops Admin',
        email: 'devsecops-admin@enterprise.corp',
        role: 'Super Admin',
        dept: 'DevSecOps & NOC',
        provider: 'eLDAP / Active Directory (ldaps://ldap.enterprise.corp:636)',
        ldapDn: 'cn=DevSecops Admin,ou=Users,dc=enterprise,dc=corp',
        ip: '10.240.12.89',
        sessionId: 'sso-sess-' + Math.floor(100000 + Math.random() * 900000),
        status: 'SUCCESS'
      };
      setSsoAccessLogs(prev => [accessLog, ...prev]);
    }
  }, []);

  const handleSimulateSsoLogin = (userName = 'Elena Rostova', userEmail = 'e.rostova@enterprise.corp', userRole = 'Security Auditor') => {
    const newLog = {
      id: 'SSO-LOG-' + Date.now(),
      timestamp: new Date().toLocaleString('en-GB'),
      user: userName,
      email: userEmail,
      role: userRole,
      dept: 'Compliance & Cyber',
      provider: 'eLDAP / Active Directory (ldaps://ldap.enterprise.corp:636)',
      ldapDn: `cn=${userName},ou=Users,dc=enterprise,dc=corp`,
      ip: '10.240.18.' + Math.floor(10 + Math.random() * 90),
      sessionId: 'sso-sess-' + Math.floor(100000 + Math.random() * 900000),
      status: 'SUCCESS'
    };
    setSsoAccessLogs(prev => [newLog, ...prev]);
    triggerToast(`🔐 SSO eLDAP login access event logged for ${userName} (${userEmail})`);
  };

  // Keep selectedUser in sync if updated in array
  useEffect(() => {
    if (selectedUser) {
      const match = users.find(u => u.id === selectedUser.id);
      if (match) setSelectedUser(match);
    }
  }, [users]);

  const triggerToast = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  const addAuditLog = (action, details) => {
    const log = {
      id: Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      user: 'DevSecops Admin',
      action,
      details,
      ip: '10.240.12.89'
    };
    setAuditLogs(prev => [log, ...prev]);
  };

  // Toggle RBAC permissions
  const handleTogglePermission = (userId, permKey) => {
    setUsers(prev => prev.map(u => {
      if (u.id === userId) {
        const curPerms = Array.isArray(u.permissions) ? u.permissions : [];
        const hasPerm = curPerms.includes(permKey);
        const updatedPerms = hasPerm
          ? curPerms.filter(p => p !== permKey)
          : [...curPerms, permKey];
        return { ...u, permissions: updatedPerms };
      }
      return u;
    }));
    addAuditLog('Permission Update', `Toggled ${permKey} permission for user ID #${userId}`);
  };

  // Provision New User Form Submit
  const handleAddUserSubmit = (e) => {
    e.preventDefault();
    if (!newUser.name.trim() || !newUser.email.trim()) return;

    let defaultPerms = ['read'];
    if (newUser.role === 'Super Admin') defaultPerms = ['read', 'remediate', 'thresholds', 'export', 'users', 'tokens'];
    if (newUser.role === 'SRE Lead') defaultPerms = ['read', 'remediate', 'thresholds', 'export'];
    if (newUser.role === 'NOC Operator') defaultPerms = ['read', 'remediate'];
    if (newUser.role === 'Security Auditor') defaultPerms = ['read', 'export'];

    const added = {
      id: Date.now(),
      name: newUser.name.trim(),
      email: newUser.email.trim(),
      role: newUser.role || 'NOC Operator',
      dept: newUser.dept.trim() || 'Engineering',
      status: 'Active',
      lastLogin: 'Just Now',
      mfa: true,
      permissions: defaultPerms
    };

    const updatedList = [...users, added];
    setUsers(updatedList);
    setSelectedUser(added);
    
    // Clear search filters so the new user is immediately visible everywhere
    setUserSearchFilter('');
    setRbacSearchFilter('');
    setShowAddModal(false);
    setNewUser({ name: '', email: '', role: 'NOC Operator', dept: 'Engineering' });

    addAuditLog('Provision User', `Created new ${added.role} account for ${added.name} (${added.email})`);
    triggerToast(`✅ User "${added.name}" provisioned and instantly synchronized to Permission Matrix.`);
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
  const handleSaveEditUser = (e) => {
    e.preventDefault();
    if (!editFormData || !editFormData.name.trim() || !editFormData.email.trim()) return;

    const sanitized = {
      ...editFormData,
      name: editFormData.name.trim(),
      email: editFormData.email.trim(),
      dept: editFormData.dept?.trim() || 'Engineering',
      permissions: Array.isArray(editFormData.permissions) ? editFormData.permissions : ['read']
    };

    setUsers(prev => prev.map(u => u.id === sanitized.id ? sanitized : u));
    setSelectedUser(sanitized);
    setShowEditModal(false);

    addAuditLog('Edit User Profile', `Updated profile details for ${sanitized.name} (${sanitized.role})`);
    triggerToast(`✏️ User profile for "${sanitized.name}" updated across all views.`);
  };

  // Delete/Revoke user
  const handleDeleteUser = (userId) => {
    const target = users.find(u => u.id === userId);
    if (!target) return;
    if (target.role === 'Super Admin' && users.filter(u => u.role === 'Super Admin').length <= 1) {
      alert('Cannot delete the primary Super Admin account.');
      return;
    }

    if (window.confirm(`Are you sure you want to revoke access and delete account for "${target.name}"?`)) {
      const remaining = users.filter(u => u.id !== userId);
      setUsers(remaining);
      if (selectedUser?.id === userId) {
        setSelectedUser(remaining[0] || null);
      }
      addAuditLog('Revoke User Access', `Deleted user account ${target.name} (${target.email})`);
      triggerToast(`🔒 User ${target.name} account access revoked.`);
    }
  };

  // Reset to default
  const handleResetDefaults = () => {
    if (window.confirm('Reset user directory back to original default seed data?')) {
      setUsers(initialUsers);
      setSelectedUser(initialUsers[0]);
      setUserSearchFilter('');
      setRbacSearchFilter('');
      localStorage.removeItem('sentinel_admin_users');
      triggerToast('🔄 Directory reset to initial default accounts.');
    }
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Toast Notification Banner */}
      {notification && (
        <div style={{ background: 'var(--primary)', color: '#fff', padding: '10px 16px', borderRadius: '6px', fontWeight: 700, fontSize: '0.85rem', boxShadow: '0 4px 12px var(--primary-glow)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{notification}</span>
          <button onClick={() => setNotification(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
        </div>
      )}

      {/* Header Banner */}
      <div className="console-panel" style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.98))', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '10px' }}>
              🛡️ DevSecOps Admin Control & User Access Center
              {MAINTENANCE_CONFIG.pages.adminManagement && <MaintenanceBadge />}
            </h2>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
              Manage enterprise user roles, RBAC access levels, authentication policies, and security audit trails.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button 
              className="ignore-trigger-btn"
              onClick={handleResetDefaults}
              style={{ padding: '8px 12px', fontSize: '0.8rem', color: '#94a3b8' }}
              title="Reset user directory to initial default data"
            >
              🔄 Reset Defaults
            </button>
            <button 
              className="remediate-trigger-btn"
              onClick={() => setShowAddModal(true)}
              style={{ padding: '8px 16px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              ➕ Provision New User
            </button>
          </div>
        </div>

        {/* View Navigation Tabs */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '1.25rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.75rem' }}>
          <button 
            className={`nav-tab-btn ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
            style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem' }}
          >
            👥 User Directory ({users.length})
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'rbac' ? 'active' : ''}`}
            onClick={() => setActiveTab('rbac')}
            style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem' }}
          >
            🔑 Permission Matrix ({users.length})
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'sso_logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('sso_logs')}
            style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem' }}
          >
            🔐 SSO Access Logs ({ssoAccessLogs.length})
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
            style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem' }}
          >
            📜 Admin Audit Logs ({auditLogs.length})
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'policies' ? 'active' : ''}`}
            onClick={() => setActiveTab('policies')}
            style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem' }}
          >
            ⚙️ Security & SSO Policies
          </button>
        </div>
      </div>

      {activeTab === 'users' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
          
          {/* Left Table Panel */}
          <div className="console-panel">
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>👥 Registered Accounts & Details ({directoryUsers.length} of {users.length})</h3>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input 
                  type="text"
                  placeholder="Search user, email, role..."
                  value={userSearchFilter}
                  onChange={(e) => setUserSearchFilter(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-light)', fontSize: '0.75rem', width: '200px' }}
                />
                {userSearchFilter && (
                  <button 
                    onClick={() => setUserSearchFilter('')}
                    style={{ padding: '4px 8px', fontSize: '0.7rem', cursor: 'pointer', borderRadius: '4px', border: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-muted)' }}
                  >
                    ✕ Clear
                  </button>
                )}
              </div>
            </div>

            <div className="table-wrapper" style={{ marginTop: '1rem', maxHeight: '420px' }}>
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
                    <tr><td colSpan="6" style={{ textAlign: 'center', padding: '20px' }}>No user accounts matching search filter.</td></tr>
                  ) : (
                    directoryUsers.map(u => (
                      <tr 
                        key={u.id}
                        onClick={() => setSelectedUser(u)}
                        style={{ cursor: 'pointer', backgroundColor: selectedUser?.id === u.id ? 'var(--primary-glow)' : 'transparent' }}
                      >
                        <td style={{ fontWeight: 700 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '1.1rem' }}>{u.role === 'Super Admin' ? '🛡️' : '👤'}</span>
                            <div>
                              <div>{u.name}</div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="status-badge-inline moderate">{u.role}</span>
                        </td>
                        <td style={{ fontSize: '0.75rem' }}>{u.dept}</td>
                        <td>
                          {u.mfa ? (
                            <span style={{ color: '#10b981', fontWeight: 700, fontSize: '0.7rem' }}>🔒 ENFORCED</span>
                          ) : (
                            <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.7rem' }}>⚠️ OPTIONAL</span>
                          )}
                        </td>
                        <td>
                          <span className={`status-badge-inline ${u.status === 'Active' ? 'healthy' : 'critical'}`}>
                            {u.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button 
                              className="remediate-trigger-btn" 
                              onClick={(e) => { e.stopPropagation(); handleOpenEditModal(u); }}
                              style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                              title="Edit User Profile"
                            >
                              ✏️ Edit
                            </button>
                            <button 
                              className="ignore-trigger-btn" 
                              onClick={(e) => { e.stopPropagation(); handleDeleteUser(u.id); }}
                              style={{ padding: '2px 6px', fontSize: '0.7rem', color: 'var(--critical)' }}
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
            <div className="console-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="panel-header" style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>👤 Account Security Profile</h3>
                <span className="status-badge-inline healthy">ID: #{selectedUser.id}</span>
              </div>

              <div style={{ textAlign: 'center', padding: '1rem 0', background: 'var(--primary-glow)', borderRadius: '8px', border: '1px dashed var(--primary)' }}>
                <span style={{ fontSize: '2.5rem', display: 'block' }}>{selectedUser.role === 'Super Admin' ? '🛡️' : '👤'}</span>
                <h4 style={{ fontSize: '1.1rem', fontWeight: 800, marginTop: '6px' }}>{selectedUser.name}</h4>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selectedUser.email}</span>
                <div style={{ marginTop: '8px' }}>
                  <span className={`status-badge-inline ${selectedUser.status === 'Active' ? 'healthy' : 'critical'}`}>
                    ● {selectedUser.status}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem' }}>
                <div><strong>Assigned Role:</strong> {selectedUser.role}</div>
                <div><strong>Department:</strong> {selectedUser.dept}</div>
                <div><strong>Last Session Activity:</strong> {selectedUser.lastLogin}</div>
                <div><strong>Multi-Factor Auth (MFA):</strong> {selectedUser.mfa ? 'Enabled (Authenticator App)' : 'Disabled'}</div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '0.75rem' }}>
                <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>PERMISSIONS GRANTED ({Array.isArray(selectedUser.permissions) ? selectedUser.permissions.length : 0}):</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {(Array.isArray(selectedUser.permissions) ? selectedUser.permissions : []).map(p => (
                    <span key={p} style={{ background: 'var(--bg-dark)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-light)', fontSize: '0.7rem', fontWeight: 600 }}>
                      ✓ {p.toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                <button 
                  className="remediate-trigger-btn" 
                  onClick={() => handleOpenEditModal(selectedUser)}
                  style={{ flex: 1, padding: '8px', fontSize: '0.78rem' }}
                >
                  ✏️ Edit Profile
                </button>
                <button 
                  className="ignore-trigger-btn" 
                  onClick={() => handleDeleteUser(selectedUser.id)}
                  style={{ flex: 1, padding: '8px', fontSize: '0.78rem', color: 'var(--critical)' }}
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
          <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>🔑 Role-Based Access Control (RBAC) Permissions Matrix ({rbacUsers.length} of {users.length} Users)</h3>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input 
                type="text"
                placeholder="Search user or role..."
                value={rbacSearchFilter}
                onChange={(e) => setRbacSearchFilter(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-light)', fontSize: '0.75rem', width: '200px' }}
              />
              {rbacSearchFilter && (
                <button 
                  onClick={() => setRbacSearchFilter('')}
                  style={{ padding: '4px 8px', fontSize: '0.7rem', cursor: 'pointer', borderRadius: '4px', border: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-muted)' }}
                >
                  ✕ Clear Filter
                </button>
              )}
            </div>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Click checkmarks to dynamically toggle read, remediation, threshold modification, export, and admin privileges for each user. Changes update and persist automatically across all tiles.
          </p>

          <div className="table-wrapper">
            <table className="telemetry-table">
              <thead>
                <tr>
                  <th>User / Email</th>
                  <th>Role</th>
                  <th style={{ textAlign: 'center' }}>Read Telemetry</th>
                  <th style={{ textAlign: 'center' }}>Trigger Remediation</th>
                  <th style={{ textAlign: 'center' }}>Modify Thresholds</th>
                  <th style={{ textAlign: 'center' }}>Export Reports</th>
                  <th style={{ textAlign: 'center' }}>Manage Users</th>
                  <th style={{ textAlign: 'center' }}>API Key Token</th>
                </tr>
              </thead>
              <tbody>
                {rbacUsers.length === 0 ? (
                  <tr><td colSpan="8" style={{ textAlign: 'center', padding: '20px' }}>No user accounts matching filter.</td></tr>
                ) : (
                  rbacUsers.map(u => {
                    const uPerms = Array.isArray(u.permissions) ? u.permissions : [];
                    return (
                      <tr key={u.id} style={{ backgroundColor: selectedUser?.id === u.id ? 'var(--primary-glow)' : 'transparent' }}>
                        <td style={{ fontWeight: 700 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>{u.role === 'Super Admin' ? '🛡️' : '👤'}</span>
                            <div>
                              <div>{u.name}</div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td><span className="status-badge-inline moderate">{u.role}</span></td>
                        
                        {['read', 'remediate', 'thresholds', 'export', 'users', 'tokens'].map(perm => {
                          const active = uPerms.includes(perm);
                          return (
                            <td key={perm} style={{ textAlign: 'center' }}>
                              <input 
                                type="checkbox"
                                checked={active}
                                onChange={() => handleTogglePermission(u.id, perm)}
                                style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--primary)' }}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Top KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <div className="console-panel" style={{ padding: '1rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>SSO ACCESS EVENTS</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--primary)', marginTop: '4px' }}>{ssoAccessLogs.length}</div>
              <div style={{ fontSize: '0.7rem', color: '#10b981', marginTop: '2px' }}>● 100% Authenticated via eLDAP</div>
            </div>
            <div className="console-panel" style={{ padding: '1rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>IDENTITY PROVIDER</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>eLDAP / Active Directory</div>
              <div style={{ fontSize: '0.7rem', color: '#60a5fa', marginTop: '2px' }}>ldaps://ldap.enterprise.corp:636</div>
            </div>
            <div className="console-panel" style={{ padding: '1rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>AUTH PROTOCOL</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '6px' }}>OAuth2 / SAML 2.0</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>Direct Bind & TOTP MFA</div>
            </div>
            <div className="console-panel" style={{ padding: '1rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>ACTIVE SESSION USER</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#10b981', marginTop: '6px' }}>DevSecops Admin</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>devsecops-admin@enterprise.corp</div>
            </div>
          </div>

          {/* Main SSO Logs Table Panel */}
          <div className="console-panel">
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3>🔐 SSO Access & User Session Audit Logs ({filteredSsoLogs.length} of {ssoAccessLogs.length})</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Logs exact timestamp, user identity, eLDAP Distinguished Name (DN), IP address, and session ID whenever the application is accessed.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input 
                  type="text"
                  placeholder="Filter by user, email, IP, DN..."
                  value={ssoSearchFilter}
                  onChange={(e) => setSsoSearchFilter(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-light)', fontSize: '0.75rem', width: '220px' }}
                />
                <button 
                  className="remediate-trigger-btn"
                  onClick={() => handleSimulateSsoLogin()}
                  style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                  title="Simulate a new SSO eLDAP login access event"
                >
                  ⚡ Test SSO Login Event
                </button>
              </div>
            </div>

            <div className="table-wrapper" style={{ marginTop: '1rem', maxHeight: '480px' }}>
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
                    <tr><td colSpan="6" style={{ textAlign: 'center', padding: '20px' }}>No SSO access logs matching search filter.</td></tr>
                  ) : (
                    filteredSsoLogs.map(log => (
                      <tr key={log.id}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--primary)' }}>
                          {log.timestamp}
                        </td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{log.user}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{log.email}</div>
                        </td>
                        <td style={{ fontSize: '0.72rem' }}>
                          <div style={{ color: '#60a5fa', fontWeight: 600 }}>{log.provider}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>{log.ldapDn}</div>
                        </td>
                        <td style={{ fontSize: '0.75rem' }}>
                          <span className="status-badge-inline moderate">{log.role}</span>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>{log.dept}</div>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                          <div>IP: {log.ip}</div>
                          <div style={{ color: 'var(--text-muted)' }}>{log.sessionId}</div>
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
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
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
                {auditLogs.map(log => (
                  <tr key={log.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{log.timestamp}</td>
                    <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{log.user}</td>
                    <td><span className="status-badge-inline healthy">{log.action}</span></td>
                    <td style={{ fontSize: '0.78rem' }}>{log.details}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{log.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: SECURITY & SSO POLICIES */}
      {activeTab === 'policies' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          <div className="console-panel">
            <div className="panel-header">
              <h3>🔒 Authentication & SSO Integration</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Enterprise eLDAP / Active Directory Sync</strong>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Primary auth provider for corp domain</div>
                </div>
                <span className="status-badge-inline healthy">🟢 CONNECTED</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Mandatory MFA Enforcement</strong>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Require TOTP / YubiKey for admin roles</div>
                </div>
                <span className="status-badge-inline healthy">ENABLED</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Session Expiry Timeout</strong>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Auto logout idle administrative sessions</div>
                </div>
                <select style={{ padding: '4px', borderRadius: '4px' }} defaultValue="30">
                  <option value="15">15 Minutes</option>
                  <option value="30">30 Minutes</option>
                  <option value="60">60 Minutes</option>
                </select>
              </div>
            </div>
          </div>

          <div className="console-panel">
            <div className="panel-header">
              <h3>🔑 API Access Tokens & Service Credentials</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', fontSize: '0.8rem' }}>
              <div style={{ background: 'var(--bg-dark)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                <div style={{ fontWeight: 700 }}>CI/CD Pipeline Bot Token</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0' }}>sntl_live_sec_908432xxxxxxxxxx</div>
                <span className="status-badge-inline healthy">ACTIVE • Expires in 89 days</span>
              </div>
              <button className="remediate-trigger-btn" style={{ padding: '6px 12px', fontSize: '0.75rem', alignSelf: 'flex-start' }}>
                🔑 Generate New Admin API Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD NEW USER */}
      {showAddModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="console-panel" style={{ width: '440px', background: 'var(--bg-panel-solid)', border: '1px solid var(--border-light)' }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>➕ Provision New User Account</h3>
              <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleAddUserSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Full Name *</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Alex Morgan"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)', marginTop: '4px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Corporate Email *</label>
                <input 
                  type="email"
                  required
                  placeholder="alex.m@enterprise.corp"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)', marginTop: '4px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Role Assignment</label>
                <select 
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)', marginTop: '4px' }}
                >
                  <option value="Super Admin">Super Admin</option>
                  <option value="SRE Lead">SRE Lead</option>
                  <option value="NOC Operator">NOC Operator</option>
                  <option value="Security Auditor">Security Auditor</option>
                  <option value="Service Account">Service Account</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Department</label>
                <input 
                  type="text"
                  placeholder="e.g. Operations / Cloud SRE"
                  value={newUser.dept}
                  onChange={(e) => setNewUser({ ...newUser, dept: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)', marginTop: '4px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="ignore-trigger-btn" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="remediate-trigger-btn">Provision & Save User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT USER PROFILE */}
      {showEditModal && editFormData && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="console-panel" style={{ width: '460px', background: 'var(--bg-panel-solid)', border: '1px solid var(--border-light)' }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>✏️ Edit User Profile: {editFormData.name}</h3>
              <button onClick={() => setShowEditModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleSaveEditUser} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Full Name</label>
                <input 
                  type="text"
                  required
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)', marginTop: '4px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Corporate Email</label>
                <input 
                  type="email"
                  required
                  value={editFormData.email}
                  onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)', marginTop: '4px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Assigned Role</label>
                  <select 
                    value={editFormData.role}
                    onChange={(e) => setEditFormData({ ...editFormData, role: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)', marginTop: '4px' }}
                  >
                    <option value="Super Admin">Super Admin</option>
                    <option value="SRE Lead">SRE Lead</option>
                    <option value="NOC Operator">NOC Operator</option>
                    <option value="Security Auditor">Security Auditor</option>
                    <option value="Service Account">Service Account</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Account Status</label>
                  <select 
                    value={editFormData.status}
                    onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)', marginTop: '4px' }}
                  >
                    <option value="Active">Active</option>
                    <option value="Suspended">Suspended</option>
                    <option value="Pending 2FA">Pending 2FA</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Department</label>
                <input 
                  type="text"
                  value={editFormData.dept}
                  onChange={(e) => setEditFormData({ ...editFormData, dept: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-light)', marginTop: '4px' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <input 
                  type="checkbox"
                  id="mfaToggle"
                  checked={editFormData.mfa}
                  onChange={(e) => setEditFormData({ ...editFormData, mfa: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--primary)' }}
                />
                <label htmlFor="mfaToggle" style={{ fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                  Enforce Multi-Factor Authentication (MFA)
                </label>
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="ignore-trigger-btn" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="remediate-trigger-btn">Save Profile Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
