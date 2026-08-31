import React, { useState, useEffect, useRef } from 'react';
import HealthOverview from './components/HealthOverview';
import MetricsDetail from './components/MetricsDetail';
import CommandCenter from './components/CommandCenter';
import PowerBiDashboard from './components/PowerBiDashboard';
import AiLogPerformance from './components/AiLogPerformance';
import UnifiedHealthMatrix from './components/UnifiedHealthMatrix';
import RcaDashboard from './components/RcaDashboard';
import AdminManagement from './components/AdminManagement';
import YamlConfigManager from './components/YamlConfigManager';
import MiscOperations from './components/MiscOperations';
import { MAINTENANCE_CONFIG } from './maintenanceConfig';
import { MaintenanceBanner, MaintenanceBadge } from './components/MaintenanceNotice';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('health'); // 'health' | 'metrics' | 'command' | 'pbi' | 'ailogs' | 'matrix'
  const [selectedComponent, setSelectedComponent] = useState('database');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [environment, setEnvironment] = useState('staging'); // 'prod' | 'staging' | 'demo'
  const envRef = useRef(environment);
  useEffect(() => { envRef.current = environment; }, [environment]);

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
      
      {/* Collapsible Left Side Navigation Drawer */}
      <aside className={`sentinel-sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        
        {/* Sidebar Header Brand (Top) */}
        <div className="sidebar-header-row">
          <div className="sidebar-brand-group" onClick={() => setActiveTab('health')}>
            <span className="brand-pulse"></span>
            {sidebarOpen ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <h1 style={{ fontSize: '1.1rem', letterSpacing: '1.5px', fontWeight: '900', color: '#ffffff' }}>SENTINEL</h1>
                <span className="brand-subtitle">Enterprise NOC</span>
              </div>
            ) : (
              <h1 style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.5px' }}>SNTL</h1>
            )}
          </div>
        </div>

        <nav className="sidebar-links">
          <button 
            className={`nav-tab-btn ${activeTab === 'health' ? 'active' : ''}`}
            onClick={() => setActiveTab('health')}
            title="NOC System Dashboard"
            data-tooltip="NOC System Dashboard"
          >
            <span>📊</span>
            {sidebarOpen && " NOC System Dashboard"}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'metrics' ? 'active' : ''}`}
            onClick={() => setActiveTab('metrics')}
            title="Telemetry Detailed Analysis"
            data-tooltip="Telemetry Detailed Analysis"
          >
            <span>🔍</span>
            {sidebarOpen && " Telemetry Detailed Analysis"}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'command' ? 'active' : ''}`}
            onClick={() => setActiveTab('command')}
            title="Autonomous Recovery Center"
            data-tooltip="Autonomous Recovery Center"
          >
            <span>⚡</span>
            {sidebarOpen && " Autonomous Recovery Center"}
            {sidebarOpen && healthData.pendingApprovals > 0 && (
              <span className="pending-badge animate-pulse">{healthData.pendingApprovals}</span>
            )}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'pbi' ? 'active' : ''}`}
            onClick={() => setActiveTab('pbi')}
            title="Historical Telemetry Analytics"
            data-tooltip="Historical Telemetry Analytics"
          >
            <span>📈</span>
            {sidebarOpen && " Historical Telemetry Analytics"}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'ailogs' ? 'active' : ''}`}
            onClick={() => setActiveTab('ailogs')}
            title="Auto Remediation Orchestrator"
            data-tooltip="Auto Remediation Orchestrator"
          >
            <span>⚙️</span>
            {sidebarOpen && " Auto Remediation Orchestrator"}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'matrix' ? 'active' : ''}`}
            onClick={() => setActiveTab('matrix')}
            title="Enterprise Health Matrix"
            data-tooltip="Enterprise Health Matrix"
          >
            <span>🌍</span>
            {sidebarOpen && " Enterprise Health Matrix"}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'rca' ? 'active' : ''}`}
            onClick={() => setActiveTab('rca')}
            title="Root Cause Analytics (RCA)"
            data-tooltip="Root Cause Analytics (RCA)"
          >
            <span>🧠</span>
            {sidebarOpen && " Root Cause Analytics (RCA)"}
          </button>

          <button 
            className={`nav-tab-btn ${activeTab === 'yaml' ? 'active' : ''}`}
            onClick={() => setActiveTab('yaml')}
            title="YAML Configuration Manager"
            data-tooltip="YAML Configuration Manager"
          >
            <span>📄</span>
            {sidebarOpen && " YAML Configuration Manager"}
          </button>

          <button 
            className={`nav-tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => setActiveTab('admin')}
            title="DevSecOps Admin Control"
            data-tooltip="DevSecOps Admin Control"
          >
            <span>🛡️</span>
            {sidebarOpen && " DevSecOps Admin Control"}
          </button>

          <button 
            className={`nav-tab-btn ${activeTab === 'misc' ? 'active' : ''}`}
            onClick={() => setActiveTab('misc')}
            title="Misc Operations & Dynatrace Hub"
            data-tooltip="Misc Operations & Dynatrace Hub"
          >
            <span>⚡</span>
            {sidebarOpen && " Misc Operations"}
          </button>
          
          {/* Navigation Collapse/Expand Item */}
          <button 
            className="nav-tab-btn sidebar-collapse-link-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? "Collapse Navigation Menu" : "Expand Navigation Menu"}
            data-tooltip={sidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
          >
            <span>{sidebarOpen ? '◀' : '▶'}</span>
            {sidebarOpen && " Collapse Sidebar"}
          </button>

          {/* Theme mode toggle */}
          <button 
            className="nav-tab-btn theme-toggle-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
            data-tooltip={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
            {sidebarOpen && (theme === 'dark' ? ' Light Mode' : ' Dark Mode')}
          </button>
        </nav>

        {/* Sidebar Bottom: User Profile Details & Live Connection Status */}
        <div className="sidebar-user-block">
          <div 
            className="user-profile-card" 
            onClick={() => setActiveTab('admin')}
            data-tooltip="DevSecops Admin (Click to Manage Permissions)"
            style={{ cursor: 'pointer' }}
          >
            <div className="user-avatar-badge">
              <span>🛡️</span>
              <span className={`user-status-dot ${wsConnected ? 'online' : 'offline'}`}></span>
            </div>
            {sidebarOpen && (
              <div className="user-info-text">
                <span className="user-name">DevSecops Admin</span>
                <span className="user-role">NOC Security Lead</span>
              </div>
            )}
          </div>
          {sidebarOpen && (
            <div className="navbar-status">
              <div className={`status-dot ${wsConnected ? 'connected' : 'disconnected'}`}></div>
              <span className="status-text">{wsConnected ? 'Live Telemetry Engine' : 'Disconnected'}</span>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area Container Frame */}
      <div className={`sentinel-main-frame ${sidebarOpen ? '' : 'collapsed-padding'}`}>
        
        {/* Top Brand Banner Header & Real-time Global Clocks Bar */}
        <div className="sentinel-top-brand-header">
          <div className="top-brand-title-group" style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <h2>Intelligent Observability and Autonomous Recovery Framework</h2>
            
            {/* [TASK 1] 3-Way Environment Switcher */}
            <div className="env-switcher-group" style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'rgba(0,0,0,0.35)', padding: '3px 6px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}>
              {[
                { id: 'prod', label: '● PROD', color: '#ef4444', bg: 'rgba(239,68,68,0.2)', border: 'rgba(239,68,68,0.6)' },
                { id: 'staging', label: '⬡ STG', color: '#f59e0b', bg: 'rgba(245,158,11,0.2)', border: 'rgba(245,158,11,0.6)' },
                { id: 'demo', label: '🧪 DEMO', color: '#10b981', bg: 'rgba(16,185,129,0.2)', border: 'rgba(16,185,129,0.6)' }
              ].map(env => {
                const isActive = environment === env.id;
                return (
                  <button
                    key={env.id}
                    onClick={() => handleEnvironmentSwitch(env.id)}
                    title={`Switch to ${env.id.toUpperCase()} environment`}
                    style={{
                      padding: '3px 10px',
                      borderRadius: '12px',
                      fontSize: '0.72rem',
                      fontWeight: isActive ? 800 : 500,
                      cursor: 'pointer',
                      border: 'none',
                      background: isActive ? env.bg : 'transparent',
                      color: isActive ? env.color : 'rgba(255,255,255,0.45)',
                      boxShadow: isActive ? `0 0 8px ${env.bg}` : 'none',
                      outline: isActive ? `1px solid ${env.border}` : '1px solid transparent',
                      transition: 'all 0.2s ease',
                      letterSpacing: '0.5px'
                    }}
                  >
                    {env.label}
                  </button>
                );
              })}
            </div>
          </div>
          
          <div className="top-timezone-clocks-wrapper">
            <div className="clock-item" title="Singapore Time (SG)"><span className="zone">APAC (SG)</span><span className="time">{clocks.sg || '--:--:--'}</span></div>
            <div className="clock-item" title="India Standard Time (ISPL)"><span className="zone">APAC (ISPL)</span><span className="time">{clocks.ist || '--:--:--'}</span></div>
            <div className="clock-item" title="Eastern Standard Time (EST)"><span className="zone">AMER (EST)</span><span className="time">{clocks.est || '--:--:--'}</span></div>
            <div className="clock-item" title="London Time (GMT/LDN)"><span className="zone">EMEA (GMT/LDN)</span><span className="time">{clocks.gmt || '--:--:--'}</span></div>
          </div>
        </div>

        {/* Environment Banners */}
        {environment === 'demo' && (
          <div style={{ background: '#064e3b', color: '#6ee7b7', padding: '6px 16px', fontSize: '0.8rem', fontWeight: 600, textAlign: 'center', letterSpacing: '0.5px', borderBottom: '1px solid rgba(16,185,129,0.3)' }}>
            🧪 DEMO MODE — All data shown is synthetic simulation and does not reflect live production infrastructure.
          </div>
        )}
        {environment === 'staging' && (
          <div style={{ background: '#422006', color: '#fcd34d', padding: '5px 16px', fontSize: '0.75rem', fontWeight: 600, textAlign: 'center', letterSpacing: '0.5px', borderBottom: '1px solid rgba(245,158,11,0.3)' }}>
            ⬡ STAGING ENVIRONMENT — Connected to non-production pre-release fleet and simulated telemetry streams.
          </div>
        )}

        <main className="sentinel-main-content" style={{ paddingTop: '1rem' }}>
          {MAINTENANCE_CONFIG.showGlobalBanner && (
            <MaintenanceBanner message={MAINTENANCE_CONFIG.globalNote} />
          )}

          {activeTab === 'health' && (
            <HealthOverview 
              healthData={healthData} 
              historicalMetrics={historicalMetrics}
              onSelectComponent={(comp) => {
                setSelectedComponent(comp);
                setActiveTab('metrics');
              }}
              activeSimulations={simulations}
              environment={environment}
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
            />
          )}

          {activeTab === 'pbi' && (
            <PowerBiDashboard environment={environment} />
          )}

          {activeTab === 'ailogs' && (
            <AiLogPerformance environment={environment} onSimulate={handleSimulate} />
          )}

          {activeTab === 'matrix' && (
            <UnifiedHealthMatrix 
              healthData={healthData}
              customChecks={customChecks}
              alerts={alerts}
              environment={environment}
            />
          )}

          {activeTab === 'rca' && (
            <RcaDashboard environment={environment} />
          )}

          {activeTab === 'yaml' && (
            <YamlConfigManager environment={environment} />
          )}

          {activeTab === 'admin' && (
            <AdminManagement environment={environment} />
          )}

          {activeTab === 'misc' && (
            <MiscOperations environment={environment} />
          )}
        </main>

        {/* Global Footer */}
        <footer className="sentinel-footer">
          <p>&copy; 2026 Intelligent Observability & Autonomous Recovery Framework. Natively Hosted on Windows Server.</p>
        </footer>
      </div>

    </div>
  );
}
