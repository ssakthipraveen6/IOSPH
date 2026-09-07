import React, { useState, useEffect, useRef } from 'react';
import HealthOverview from './components/health/HealthOverview';
import UnifiedHealthMatrix from './components/health/UnifiedHealthMatrix';
import MetricsDetail from './components/analytics/MetricsDetail';
import CommandCenter from './components/sre/CommandCenter';
import PowerBiDashboard from './components/analytics/PowerBiDashboard';
import AiLogPerformance from './components/analytics/AiLogPerformance';
import AdminManagement from './components/admin/AdminManagement';
import StatusBadge, { StatusDot } from './components/shared/StatusBadge';
import Sparkline from './components/shared/Sparkline';
import YamlConfigManager from './components/admin/YamlConfigManager';
import MiscOperations from './components/sre/MiscOperations';
import SreEnterpriseControl from './components/sre/SreEnterpriseControl';
import UnifiedCorrelationTimeline from './components/correlation/UnifiedCorrelationTimeline';
import EntityExplorerView from './components/correlation/EntityExplorerView';
import EntityDrillDownPanel from './components/correlation/EntityDrillDownPanel';
import GlobalEntitySearch from './components/correlation/GlobalEntitySearch';
import { MAINTENANCE_CONFIG } from './maintenanceConfig';
import { MaintenanceBanner } from './components/shared/MaintenanceNotice';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('health'); // 'health' | 'metrics' | 'command' | 'pbi' | 'ailogs' | 'matrix'
  const [selectedComponent, setSelectedComponent] = useState('database');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [environment, setEnvironment] = useState('staging'); // 'prod' | 'staging' | 'demo'
  const envRef = useRef(environment);
  useEffect(() => { envRef.current = environment; }, [environment]);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);

  // Connective Architecture Layer State: Entity-Centric Drill-Down
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [isEntityPanelOpen, setIsEntityPanelOpen] = useState(false);
  const handleOpenEntityPanel = (entityId) => {
    setSelectedEntityId(entityId);
    setIsEntityPanelOpen(true);
  };

  // Real-time backend states
  const [wsConnected, setWsConnected] = useState(false);
  const [healthData, setHealthData] = useState({
    score: 100,
    componentStatuses: {},
    alertsCount: 0,
    pendingApprovals: 0,
    uptime: '0h 0m 0s',
    environment: 'staging'
  });
  const [alerts, setAlerts] = useState([]);
  const [recovery, setRecovery] = useState([]);
  const [settings, setSettings] = useState({ autonomousMode: true });
  const [simulations, setSimulations] = useState({});
  const [historicalMetrics, setHistoricalMetrics] = useState({});
  const [logs, setLogs] = useState([]);
  const [customChecks, setCustomChecks] = useState([]);

  // Timezone clocks state
  const [clocks, setClocks] = useState({
    sg: '', ist: '', est: '', gmt: ''
  });

  // Linear Ergonomics: Command Palette (Cmd+K / Ctrl+K) State
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');

  // Global Keyboard Shortcuts (⌘K, ⌘R, ESC)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Toggle Command Palette (Cmd+K or Ctrl+K)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
      // Quick jump to Autonomous Recovery Center (Cmd+R or Ctrl+R)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setActiveTab('command');
      }
      // Escape to close Command Palette
      if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Admin Users synchronization state
  const [adminUsers, setAdminUsers] = useState(() => {
    const saved = localStorage.getItem('sentinel_admin_users');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
  });

  useEffect(() => {
    const syncUsers = () => {
      const saved = localStorage.getItem('sentinel_admin_users');
      if (saved) {
        try { setAdminUsers(JSON.parse(saved)); } catch (e) {}
      }
    };
    window.addEventListener('sentinel_users_updated', syncUsers);
    return () => window.removeEventListener('sentinel_users_updated', syncUsers);
  }, []);

  // Sync theme selection to localStorage and apply theme class to document.body
  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.body.classList.remove('dark-mode', 'light-mode');
    document.body.classList.add(theme === 'dark' ? 'dark-mode' : 'light-mode');
  }, [theme]);

  // Real-time multi-timezone ticking clocks handler
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      
      const timeStringForZone = (timezone) => {
        return now.toLocaleTimeString('en-GB', { // 24-hour style format
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });
      };

      setClocks({
        sg: timeStringForZone('Asia/Singapore'),
        ist: timeStringForZone('Asia/Kolkata'),
        est: timeStringForZone('America/New_York'),
        gmt: timeStringForZone('Europe/London')
      });
    };

    updateClocks();
    const interval = setInterval(updateClocks, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch all historical metrics from the REST API to build sparklines and charts
  const fetchAllMetrics = async (targetEnv) => {
    const activeEnv = targetEnv || envRef.current || 'staging';
    try {
      const response = await fetch(`/api/metrics?environment=${encodeURIComponent(activeEnv)}`);
      if (response.ok) {
        const rawMetrics = await response.json();
        
        // Group metrics by component
        const grouped = {};
        rawMetrics.forEach(m => {
          if (!grouped[m.component]) {
            grouped[m.component] = [];
          }
          grouped[m.component].push(m);
        });
        
        setHistoricalMetrics(grouped);
      }
    } catch (error) {
      console.error('Error fetching historical metrics:', error);
    }
  };

  // Helper to fetch other states initially
  const fetchInitialStates = async (targetEnv) => {
    const activeEnv = targetEnv || envRef.current || 'staging';
    try {
      const envRes = await fetch('/api/environment');
      let currentEnv = activeEnv;
      if (envRes.ok) {
        const envData = await envRes.json();
        if (envData.environment) {
          currentEnv = envData.environment;
          setEnvironment(envData.environment);
        }
      }

      const hRes = await fetch(`/api/health?environment=${encodeURIComponent(currentEnv)}`);
      if (hRes.ok) {
        const hData = await hRes.json();
        setHealthData(hData);
        if (hData.environment) setEnvironment(hData.environment);
      }
      
      const aRes = await fetch(`/api/alerts?environment=${encodeURIComponent(currentEnv)}`);
      if (aRes.ok) setAlerts(await aRes.json());
      
      const rRes = await fetch(`/api/recovery?environment=${encodeURIComponent(currentEnv)}`);
      if (rRes.ok) setRecovery(await rRes.json());
      
      const sRes = await fetch('/api/settings');
      if (sRes.ok) setSettings(await sRes.json());

      const cRes = await fetch('/api/custom-checks');
      if (cRes.ok) setCustomChecks(await cRes.json());
    } catch (e) {
      console.error('Failed to fetch initial state:', e);
    }
  };

  // Connect to live WebSockets channel
  useEffect(() => {
    fetchInitialStates();
    fetchAllMetrics();

    // Poll metrics every 10s to keep metrics dataset fresh
    const metricsPoll = setInterval(() => fetchAllMetrics(envRef.current), 10000);

    const authToken = localStorage.getItem('sentinel_auth_token') || '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws${authToken ? `?token=${encodeURIComponent(authToken)}` : ''}`;
    let ws = null;
    let reconnectTimeout = null;

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[WS] Connected to Intelligent Observability & Autonomous Recovery Framework backend');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (e) {
          console.warn('[WS] Received non-JSON WebSocket frame, ignoring:', event.data);
          return;
        }
        const { type, data } = message;

        switch (type) {
          case 'init':
            setHealthData(data.health);
            if (data.health?.environment) setEnvironment(data.health.environment);
            setAlerts(data.alerts);
            setRecovery(data.recovery);
            setSettings(data.settings);
            setSimulations(data.simulations);
            if (data.customChecks) setCustomChecks(data.customChecks);
            break;
            
          case 'metrics_tick':
            setHealthData(data.health);
            if (data.health?.environment) setEnvironment(data.health.environment);
            setSimulations(data.simulations);
            if (data.customChecks) setCustomChecks(data.customChecks);
            break;
            
          case 'state':
            setAlerts(data.alerts);
            setRecovery(data.recovery);
            setSettings(data.settings);
            setHealthData(data.health);
            if (data.health?.environment) setEnvironment(data.health.environment);
            if (data.customChecks) setCustomChecks(data.customChecks);
            break;
            
          case 'log':
            setLogs(prev => {
              const updated = [...prev, data];
              // Keep last 400 lines in the terminal to avoid memory bloat
              return updated.slice(-400);
            });
            break;
            
          default:
            break;
        }
      };

      ws.onclose = () => {
        console.warn('[WS] Connection closed, retrying in 3s...');
        setWsConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('[WS] Connection error:', err);
        ws.close();
      };
    }

    connect();

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimeout);
      clearInterval(metricsPoll);
    };
  }, []);

  // --- CONTROL ACTIONS ---

  const handleToggleAutonomous = async () => {
    try {
      const updatedValue = !settings.autonomousMode;
      const token = localStorage.getItem('sentinel_auth_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify({ autonomousMode: updatedValue })
      });
      if (res.ok) {
        const newSettings = await res.json();
        setSettings(newSettings);
      }
    } catch (e) {
      console.error('Failed updating settings:', e);
    }
  };

  const handleSimulate = async (component, type) => {
    try {
      const token = localStorage.getItem('sentinel_auth_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ component, type })
      });
      if (res.ok) {
        const data = await res.json();
        setSimulations(data.simulations);
      }
    } catch (e) {
      console.error('Failed triggering simulation:', e);
    }
  };

  const handleApproveRecovery = async (runId) => {
    try {
      const token = localStorage.getItem('sentinel_auth_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/recovery/approve', {
        method: 'POST',
        headers,
        body: JSON.stringify({ runId })
      });
      if (res.ok) {
        const data = await res.json();
        console.log('[UI] Recovery approved:', data.success);
      }
    } catch (e) {
      console.error('Failed approving recovery action:', e);
    }
  };

  const handleEnvironmentSwitch = async (newEnv) => {
    if (newEnv === environment) return;
    try {
      const token = localStorage.getItem('sentinel_auth_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/environment', {
        method: 'POST',
        headers,
        body: JSON.stringify({ environment: newEnv })
      });
      if (res.ok) {
        const data = await res.json();
        const appliedEnv = data.environment;
        setEnvironment(appliedEnv);
        if (appliedEnv !== 'demo') {
          setSimulations({});
        }
        await fetchInitialStates(appliedEnv);
        await fetchAllMetrics(appliedEnv);
      } else {
        const err = await res.json();
        alert(`Cannot switch environment: ${err.error || 'Permission denied'}`);
      }
    } catch (e) {
      console.error('Environment switch failed:', e);
    }
  };

  return (
    <div className={`sentinel-app-layout ${theme === 'dark' ? 'dark-mode' : 'light-mode'}`}>
      
      {/* 1. VERTICAL LEFT SIDEBAR NAVIGATION DRAWER */}
      <aside className={`sentinel-sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        {/* Sidebar Header & Brand Row */}
        <div className="sidebar-header-row">
          <div className="sidebar-brand-group" onClick={() => setActiveTab('health')} title="Sentinel Enterprise NOC">
            <span className="brand-pulse"></span>
            {sidebarOpen && (
              <div className="sidebar-brand-text">
                <div style={{ fontWeight: 800, fontSize: '0.98rem', letterSpacing: '-0.2px', color: 'var(--text-main)', lineHeight: 1.1 }}>SENTINEL</div>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.8px' }}>ENTERPRISE NOC</div>
              </div>
            )}
          </div>
          <button 
            className="sidebar-toggle-inside-btn" 
            onClick={() => setSidebarOpen(prev => !prev)}
            title={sidebarOpen ? "Collapse navigation (76px mini dock)" : "Expand navigation (280px drawer)"}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {/* Vertical Navigation Links Track (All Canonical Enterprise Views) */}
        <nav className="sidebar-links" id="main-nav-tabs">
          {[
            { id: 'health', icon: '📊', label: 'NOC System Dashboard', tip: 'NOC System Dashboard & Multi-Node Topology' },
            { id: 'metrics', icon: '🔍', label: 'Telemetry & Historical Analytics', tip: 'Live Golden Signals, Timeseries & Historical PowerBI Baseline Trends' },
            { id: 'matrix', icon: '🌍', label: 'Enterprise Health Matrix', tip: 'Multi-Cluster Global Infrastructure Grid' },
            { id: 'command', icon: '⚡', label: 'Autonomous Healing & Operations', tip: 'Self-Healing Orchestrator, Playbook Logs & Team Operations' },
            { id: 'sre', icon: '🏛️', label: 'SRE Platform & Toolchain Capacity', tip: 'Platform Toolchain Saturation, Secret Expiry & Central Governance' },
            { id: 'entities', icon: '🧭', label: 'Universal Entity Explorer', tip: 'Universal Asset & Topology Resolver' },
            { id: 'timeline', icon: '⏱️', label: 'Correlation & RCA Timeline', tip: 'Chronological Causality, Config Drift & RCA Graph' },
            { id: 'yaml', icon: '📄', label: 'YAML Config Manager', tip: 'Live Deployment Manifest Editor' },
            { id: 'admin', icon: '🛡️', label: 'DevSecOps Admin Control', tip: 'RBAC, Audit Logs & Access Control' },
          ].map(tab => (
            <button 
              key={tab.id}
              className={`nav-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              data-tooltip={tab.label}
              title={tab.tip}
            >
              <span className="nav-icon" style={{ fontSize: '1.15rem', flexShrink: 0 }}>{tab.icon}</span>
              {sidebarOpen && <span className="nav-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.label}</span>}
              {tab.id === 'command' && healthData.pendingApprovals > 0 && (
                <span className="pending-badge">{healthData.pendingApprovals}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Live Telemetry Engine status pill at bottom of sidebar */}
        {sidebarOpen && (
          <div className="navbar-status" style={{ marginTop: 'auto', padding: '8px 12px' }}>
            <span className={`status-dot ${wsConnected ? 'connected' : 'disconnected'}`}></span>
            <span className="status-text">{wsConnected ? 'Live Telemetry Engine' : 'Telemetry Offline'}</span>
          </div>
        )}
      </aside>

      {/* 2. MAIN CONTENT FRAME (Adjusts margin based on sidebar open/collapsed) */}
      <div className={`sentinel-main-frame ${sidebarOpen ? '' : 'collapsed-padding'}`}>
        {/* Sticky Top Header Bar */}
        <header className="sentinel-top-brand-header">
          <div className="top-brand-title-group">
            <h2>Intelligent Observability &amp; Autonomous Recovery Framework</h2>
            <span className="live-pill">LIVE NOC ENGINE</span>
            
            {/* Command Palette Trigger Button (⌘K) */}
            <div 
              className="quick-cmd-trigger"
              onClick={() => setIsCommandPaletteOpen(true)}
              title="Open Command Palette (Ctrl+K or ⌘K)"
              style={{
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--bg-panel-subtle)',
                border: '1px solid var(--border-light)',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                color: 'var(--text-muted)'
              }}
            >
              <span>🔍</span>
              <span>Quick Search</span>
              <kbd style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid var(--border-light)',
                borderRadius: '3px',
                padding: '1px 4px',
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--primary)'
              }}>⌘K</kbd>
            </div>

            {/* Connective Architecture Layer: Global Entity Search / Resolver */}
            <GlobalEntitySearch onSelectEntity={handleOpenEntityPanel} />
          </div>

          {/* Header Right Controls: Theme Toggle + Who Has Logged In + 3-Way Env + 4 Timezone Clocks */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            
            {/* Dark/Light Theme Mode Toggle Button */}
            <button 
              className="nav-tab-btn theme-toggle-btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
              style={{ width: 'auto', padding: '5px 9px', fontSize: '0.9rem', margin: 0, borderRadius: '7px' }}
            >
              <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
            </button>

            {/* WHO HAS LOGGED IN: Operator Identity Card & Interactive RBAC Popover */}
            <div className="logged-in-user-container">
              <div 
                className="logged-user-card" 
                onClick={() => setIsUserDropdownOpen(prev => !prev)}
                title="Authenticated via Corporate Active Directory / eLDAP. Click to view RBAC session."
                style={{ padding: '4px 10px' }}
              >
                <div className="user-avatar-badge" style={{ width: '26px', height: '26px', fontSize: '11px' }}>
                  <span>🛡️</span>
                  <span className={`user-online-dot ${wsConnected ? 'online' : 'offline'}`}></span>
                </div>
                <div className="user-text-meta">
                  <div className="user-status-row">
                    <span className="logged-in-label">LOGGED IN</span>
                    <span className="user-online-text" style={{ color: wsConnected ? 'var(--healthy)' : 'var(--critical)' }}>
                      {wsConnected ? '● Active' : '○ Offline'}
                    </span>
                  </div>
                  <span className="user-name">DevSecOps Admin</span>
                  <span className="user-role">NOC Security Lead · AD/eLDAP</span>
                </div>
                <span className="user-chevron">▾</span>
              </div>

              {/* User RBAC Popover Dropdown */}
              <div className={`user-dropdown-menu ${isUserDropdownOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
                <div className="dropdown-header">
                  <div className="dropdown-avatar">🛡️</div>
                  <div>
                    <div className="dropdown-name">DevSecOps Admin</div>
                    <div className="dropdown-email">admin_operator@enterprise.corp</div>
                  </div>
                </div>
                <div className="dropdown-divider"></div>
                <div className="dropdown-section">
                  <div className="dropdown-label">IDENTITY &amp; AUTHENTICATION</div>
                  <div className="dropdown-item-info">Directory: <strong>Corporate Active Directory (eLDAP)</strong></div>
                  <div className="dropdown-item-info">Assigned Role: <strong style={{ color: 'var(--primary)' }}>Super Admin (Tier-1)</strong></div>
                  <div className="dropdown-item-info">MFA Status: <strong style={{ color: 'var(--healthy)' }}>Enforced (FIDO2 / TOTP)</strong></div>
                  <div className="dropdown-item-info">Telemetry Node: <span className="mono" style={{ fontSize: '10px', color: 'var(--primary)' }}>lon-noc-gw-01</span></div>
                </div>
                <div className="dropdown-divider"></div>
                <div className="dropdown-actions">
                  <button 
                    className="dropdown-btn" 
                    onClick={() => { setActiveTab('admin'); setIsUserDropdownOpen(false); }}
                  >
                    🛡️ Manage RBAC &amp; Audit Logs
                  </button>
                  <button 
                    className="dropdown-btn dropdown-btn-danger" 
                    onClick={() => { alert('Session locked. Re-authenticate via SSO.'); setIsUserDropdownOpen(false); }}
                  >
                    🔒 Lock Session
                  </button>
                </div>
              </div>
            </div>

            <div style={{ width: '1px', height: '22px', background: 'var(--border-light)' }}></div>

            {/* 3-Way Environment Switcher */}
            <div className="env-chip-group">
              {[
                { id: 'prod', label: 'PROD', cls: 'active-prod' },
                { id: 'staging', label: 'STG', cls: 'active-stg' },
                { id: 'demo', label: 'DEMO', cls: 'active-demo' }
              ].map(env => (
                <button
                  key={env.id}
                  className={`env-chip ${environment === env.id ? env.cls : ''}`}
                  onClick={() => handleEnvironmentSwitch(env.id)}
                  title={`Switch to ${env.id.toUpperCase()} cluster`}
                >
                  {env.label}
                </button>
              ))}
            </div>

            <div style={{ width: '1px', height: '22px', background: 'var(--border-light)' }}></div>

            {/* 4 Multi-Timezone Clocks */}
            <div className="top-timezone-clocks-wrapper">
              <div className="clock-item"><span className="zone">APAC(SG)</span><span className="time">{clocks.sg || '--:--:--'}</span></div>
              <div className="clock-item"><span className="zone">APAC(ISPL)</span><span className="time">{clocks.ist || '--:--:--'}</span></div>
              <div className="clock-item"><span className="zone">AMER(EST)</span><span className="time">{clocks.est || '--:--:--'}</span></div>
              <div className="clock-item"><span className="zone">EMEA(GMT)</span><span className="time">{clocks.gmt || '--:--:--'}</span></div>
            </div>

          </div>
        </header>

        {/* Sub-Header Environment Notification Banner */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.45)',
          borderBottom: '1px solid var(--border-light)',
          padding: '6px 2.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: 'var(--text-muted)'
        }}>
          <div>
            {environment === 'demo' && (
              <span>🧪 <strong>DEMO MODE:</strong> All telemetry is synthetic simulation. Live production infrastructure unaffected.</span>
            )}
            {environment === 'staging' && (
              <span>⬡ <strong>STAGING ENVIRONMENT:</strong> Connected to non-production pre-release fleet and simulated telemetry streams.</span>
            )}
            {environment === 'prod' && (
              <span>🔒 <strong>PRODUCTION ENVIRONMENT:</strong> Connected to live cluster nodes, VMware AVI ingress, TimescaleDB &amp; Snowflake.</span>
            )}
          </div>
          <span className="uptime-badge" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--primary)' }}>
            Uptime: {healthData.uptime || '248h 12m 45s'}
          </span>
        </div>

        {/* Main Content Area */}
        <main className="sentinel-main-content" style={{ paddingTop: '1.25rem' }}>
          {MAINTENANCE_CONFIG.showGlobalBanner && (
            <MaintenanceBanner message={MAINTENANCE_CONFIG.globalNote} />
          )}

          {activeTab === 'health' && (
            <HealthOverview 
              healthData={healthData} 
              historicalMetrics={historicalMetrics}
              onSelectComponent={(comp) => {
                if (comp === 'timeline' || comp === 'rca') {
                  setActiveTab('timeline');
                } else {
                  setSelectedComponent(comp);
                  setActiveTab('metrics');
                }
              }}
              activeSimulations={simulations}
              environment={environment}
              onInspectEntity={handleOpenEntityPanel}
            />
          )}

          {activeTab === 'metrics' && (
            <MetricsDetail 
              selectedComponent={selectedComponent}
              onComponentChange={setSelectedComponent}
              historicalMetrics={historicalMetrics}
              healthData={healthData}
              environment={environment}
            />
          )}

          {activeTab === 'ailogs' && (
            <AiLogPerformance 
              onSimulate={handleSimulate}
              environment={environment}
            />
          )}

          {activeTab === 'command' && (
            <CommandCenter 
              logs={logs}
              alerts={alerts}
              recovery={recovery}
              settings={settings}
              simulations={simulations}
              healthData={healthData}
              onToggleAutonomous={handleToggleAutonomous}
              onSimulate={handleSimulate}
              onApproveRecovery={handleApproveRecovery}
              onClearLogs={() => setLogs([])}
              environment={environment}
              initialSubTab="recovery"
            />
          )}

          {activeTab === 'misc' && (
            <MiscOperations 
              environment={environment}
            />
          )}

          {activeTab === 'matrix' && (
            <UnifiedHealthMatrix 
              healthData={healthData}
              customChecks={customChecks}
              alerts={alerts}
              environment={environment}
              onSelectComponent={(comp) => {
                setSelectedComponent(comp);
                setActiveTab('metrics');
              }}
              onInspectEntity={handleOpenEntityPanel}
            />
          )}

          {activeTab === 'pbi' && (
            <PowerBiDashboard environment={environment} />
          )}

          {/* Seamless Consolidated Fallback: rca routes to RCA graph sub-tab in UnifiedCorrelationTimeline */}
          {activeTab === 'rca' && (
            <UnifiedCorrelationTimeline 
              onInspectEntity={handleOpenEntityPanel}
              environment={environment}
              initialSubTab="rca"
            />
          )}

          {activeTab === 'timeline' && (
            <UnifiedCorrelationTimeline 
              onInspectEntity={handleOpenEntityPanel}
              environment={environment}
              initialSubTab="timeline"
            />
          )}

          {activeTab === 'entities' && (
            <EntityExplorerView 
              onSelectEntity={handleOpenEntityPanel}
              onNavigateToTimeline={(entityId) => setActiveTab('timeline')}
              environment={environment}
              historicalMetrics={historicalMetrics}
            />
          )}

          {activeTab === 'sre' && (
            <SreEnterpriseControl environment={environment} />
          )}

          {activeTab === 'yaml' && (
            <YamlConfigManager environment={environment} />
          )}

          {activeTab === 'admin' && (
            <AdminManagement environment={environment} />
          )}
        </main>

        {/* Global Footer */}
        <footer className="sentinel-footer">
          <p>&copy; 2026 Intelligent Observability & Autonomous Recovery Framework. Natively Hosted on Windows Server.</p>
        </footer>
      </div>

      {/* Linear Ergonomics: Global Command Palette (⌘K) Modal */}
      {isCommandPaletteOpen && (
        <div 
          className="cmd-palette-backdrop"
          onClick={() => setIsCommandPaletteOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '10vh',
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          <div 
            className="cmd-palette-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '92%',
              maxWidth: '640px',
              background: 'var(--bg-panel-solid)',
              border: '1px solid var(--border-light)',
              borderRadius: '14px',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6), 0 0 32px var(--primary-glow), inset 0 1px 0 rgba(255, 255, 255, 0.18)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Search Input Bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '1rem 1.25rem',
              borderBottom: '1px solid var(--border-light)',
              gap: '12px',
              background: 'var(--bg-panel-subtle)'
            }}>
              <span style={{ fontSize: '1.1rem', color: 'var(--primary)' }}>🔍</span>
              <input
                type="text"
                autoFocus
                placeholder="Type a command, microservice, or environment..."
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-main)',
                  fontSize: '0.95rem',
                  fontFamily: 'var(--font-sans)'
                }}
              />
              <kbd style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid var(--border-light)',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '0.68rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)'
              }}>ESC</kbd>
            </div>

            {/* Filtered Action & Navigation List */}
            <div style={{
              maxHeight: '380px',
              overflowY: 'auto',
              padding: '0.5rem'
            }}>
              <div style={{ padding: '4px 10px', fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                Navigation &amp; Systems
              </div>
              {[
                { id: 'health', label: 'NOC System Dashboard', icon: '📊', category: 'Views', action: () => { setActiveTab('health'); setIsCommandPaletteOpen(false); } },
                { id: 'metrics', label: 'Telemetry & Historical Analytics', icon: '🔍', category: 'Views', action: () => { setActiveTab('metrics'); setIsCommandPaletteOpen(false); } },
                { id: 'matrix', label: 'Enterprise Health Matrix', icon: '🌍', category: 'Views', action: () => { setActiveTab('matrix'); setIsCommandPaletteOpen(false); } },
                { id: 'command', label: 'Autonomous Healing & Operations', icon: '⚡', category: 'Views', action: () => { setActiveTab('command'); setIsCommandPaletteOpen(false); } },
                { id: 'sre', label: 'SRE Platform & Toolchain Capacity', icon: '🏛️', category: 'Views', action: () => { setActiveTab('sre'); setIsCommandPaletteOpen(false); } },
                { id: 'entities', label: 'Universal Entity Explorer', icon: '🧭', category: 'Views', action: () => { setActiveTab('entities'); setIsCommandPaletteOpen(false); } },
                { id: 'timeline', label: 'Correlation & RCA Timeline', icon: '⏱️', category: 'Views', action: () => { setActiveTab('timeline'); setIsCommandPaletteOpen(false); } },
                { id: 'yaml', label: 'YAML Config Manager', icon: '📄', category: 'Views', action: () => { setActiveTab('yaml'); setIsCommandPaletteOpen(false); } },
                { id: 'admin', label: 'DevSecOps Admin Control', icon: '🛡️', category: 'Views', action: () => { setActiveTab('admin'); setIsCommandPaletteOpen(false); } },
                { id: 'ailogs', label: 'Playbook Orchestrator & AI Logs (Sub-Tab)', icon: '⚙️', category: 'Healing Sub-Tab', action: () => { setActiveTab('ailogs'); setIsCommandPaletteOpen(false); } },
                { id: 'misc', label: 'Team Operations & On-Call Runbooks (Sub-Tab)', icon: '🛠️', category: 'Operations Sub-Tab', action: () => { setActiveTab('misc'); setIsCommandPaletteOpen(false); } },
                { id: 'pbi', label: 'Historical PowerBI Baseline Trends (Sub-Tab)', icon: '📈', category: 'Telemetry Sub-Tab', action: () => { setActiveTab('pbi'); setIsCommandPaletteOpen(false); } },
                { id: 'rca', label: 'Root Cause Analytics (RCA Graph)', icon: '🧠', category: 'Diagnostics', action: () => { setActiveTab('rca'); setIsCommandPaletteOpen(false); } }
              ]
              .filter(item => item.label.toLowerCase().includes(paletteQuery.toLowerCase()) || item.category.toLowerCase().includes(paletteQuery.toLowerCase()))
              .map(item => (
                <div
                  key={item.id}
                  onClick={item.action}
                  className="cmd-palette-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.84rem',
                    color: 'var(--text-main)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Jump</span>
                </div>
              ))}

              <div style={{ padding: '8px 10px 4px', fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', borderTop: '1px solid var(--border-light)', marginTop: '4px' }}>
                Environment & Actions
              </div>
              {[
                { id: 'env-prod', label: 'Switch to PROD Environment', icon: '●', color: '#ef4444', action: () => { handleEnvironmentSwitch('prod'); setIsCommandPaletteOpen(false); } },
                { id: 'env-stg', label: 'Switch to STAGING Environment', icon: '⬡', color: '#f59e0b', action: () => { handleEnvironmentSwitch('staging'); setIsCommandPaletteOpen(false); } },
                { id: 'env-demo', label: 'Switch to DEMO Environment', icon: '🧪', color: '#10b981', action: () => { handleEnvironmentSwitch('demo'); setIsCommandPaletteOpen(false); } },
                { id: 'theme-toggle', label: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`, icon: theme === 'dark' ? '☀️' : '🌙', action: () => { setTheme(theme === 'dark' ? 'light' : 'dark'); setIsCommandPaletteOpen(false); } },
                { id: 'sim-bitbucket', label: 'Trigger Bitbucket JVM Memory Spike Simulation', icon: '⚡', action: () => { handleSimulate('bitbucket', 'memory', 92); setIsCommandPaletteOpen(false); } },
                { id: 'sim-db', label: 'Trigger Database Connection Spike Simulation', icon: '⚡', action: () => { handleSimulate('database', 'connections', 96); setIsCommandPaletteOpen(false); } }
              ]
              .filter(item => item.label.toLowerCase().includes(paletteQuery.toLowerCase()))
              .map(item => (
                <div
                  key={item.id}
                  onClick={item.action}
                  className="cmd-palette-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.84rem',
                    color: 'var(--text-main)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: item.color || 'inherit' }}>{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>Execute</span>
                </div>
              ))}
            </div>

            {/* Footer hint */}
            <div style={{
              padding: '0.65rem 1.25rem',
              background: 'var(--bg-panel-subtle)',
              borderTop: '1px solid var(--border-light)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.72rem',
              color: 'var(--text-muted)'
            }}>
              <span>Linear Navigation Mode</span>
              <div style={{ display: 'flex', gap: '8px', fontFamily: 'var(--font-mono)' }}>
                <span>↑↓ Navigate</span>
                <span>↵ Select</span>
                <span>ESC Dismiss</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connective Architecture Layer: Global Entity-Centric Drill-Down Panel */}
      <EntityDrillDownPanel 
        entityId={selectedEntityId}
        isOpen={isEntityPanelOpen}
        onClose={() => setIsEntityPanelOpen(false)}
        onNavigateToTimeline={(id) => {
          setActiveTab('timeline');
          setIsEntityPanelOpen(false);
        }}
        environment={environment}
        historicalMetrics={historicalMetrics}
      />

    </div>
  );
}
