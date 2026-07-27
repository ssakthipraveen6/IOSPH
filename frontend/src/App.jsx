import React, { useState, useEffect } from 'react';
import HealthOverview from './components/HealthOverview';
import MetricsDetail from './components/MetricsDetail';
import CommandCenter from './components/CommandCenter';
import PowerBiDashboard from './components/PowerBiDashboard';
import AiLogPerformance from './components/AiLogPerformance';
import UnifiedHealthMatrix from './components/UnifiedHealthMatrix';
import RcaDashboard from './components/RcaDashboard';
import TicketImpactDashboard from './components/TicketImpactDashboard';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('health'); // 'health' | 'metrics' | 'command' | 'pbi' | 'ailogs' | 'matrix'
  const [selectedComponent, setSelectedComponent] = useState('database');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  // Real-time backend states
  const [wsConnected, setWsConnected] = useState(false);
  const [healthData, setHealthData] = useState({
    score: 100,
    componentStatuses: {},
    alertsCount: 0,
    pendingApprovals: 0,
    uptime: '0h 0m 0s'
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
    utc: '', ist: '', ldn: '', portugal: '', montreal: '', newyork: ''
  });

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
        utc: timeStringForZone('UTC'),
        ist: timeStringForZone('Asia/Kolkata'),
        ldn: timeStringForZone('Europe/London'),
        portugal: timeStringForZone('Europe/Lisbon'),
        montreal: timeStringForZone('America/Montreal'),
        newyork: timeStringForZone('America/New_York')
      });
    };

    updateClocks();
    const interval = setInterval(updateClocks, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch all historical metrics from the REST API to build sparklines and charts
  const fetchAllMetrics = async () => {
    try {
      const response = await fetch('/api/metrics');
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
  const fetchInitialStates = async () => {
    try {
      const hRes = await fetch('/api/health');
      if (hRes.ok) setHealthData(await hRes.json());
      
      const aRes = await fetch('/api/alerts');
      if (aRes.ok) setAlerts(await aRes.json());
      
      const rRes = await fetch('/api/recovery');
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
    const metricsPoll = setInterval(fetchAllMetrics, 10000);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws = null;
    let reconnectTimeout = null;

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[WS] Connected to Intelligent Observability & Autonomous Recovery Framework backend');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        const { type, data } = message;

        switch (type) {
          case 'init':
            setHealthData(data.health);
            setAlerts(data.alerts);
            setRecovery(data.recovery);
            setSettings(data.settings);
            setSimulations(data.simulations);
            if (data.customChecks) setCustomChecks(data.customChecks);
            break;
            
          case 'metrics_tick':
            setHealthData(data.health);
            setSimulations(data.simulations);
            if (data.customChecks) setCustomChecks(data.customChecks);
            break;
            
          case 'state':
            setAlerts(data.alerts);
            setRecovery(data.recovery);
            setSettings(data.settings);
            setHealthData(data.health);
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
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autonomousMode: updatedValue })
      });
      if (res.ok) {
        setSettings(await res.json());
      }
    } catch (e) {
      console.error('Failed updating settings:', e);
    }
  };

  const handleSimulate = async (component, type) => {
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch('/api/recovery/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  return (
    <div className={`sentinel-app-layout ${theme === 'dark' ? 'dark-mode' : 'light-mode'}`}>
      
      {/* Collapse Drawer Arrow/Hamburger toggle switch */}
      <button 
        className={`drawer-toggle-overlay-btn ${sidebarOpen ? 'drawer-open' : ''}`}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title={sidebarOpen ? "Collapse Navigation to Icons Only" : "Expand Navigation Menu"}
      >
        {sidebarOpen ? '◀' : '☰'}
      </button>

      {/* Collapsible Left Side Navigation Drawer */}
      <aside className={`sentinel-sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        <div className="sidebar-brand" onClick={() => setActiveTab('health')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="brand-pulse"></span>
            {sidebarOpen ? (
              <h1>INTELLIGENT OBSERVABILITY & AUTONOMOUS RECOVERY</h1>
            ) : (
              <h1 style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.5px' }}>IOARF</h1>
            )}
          </div>
          {sidebarOpen && <span className="brand-subtitle">Enterprise Suite</span>}
        </div>

        <nav className="sidebar-links">
          <button 
            className={`nav-tab-btn ${activeTab === 'health' ? 'active' : ''}`}
            onClick={() => setActiveTab('health')}
            title="Health Overview"
          >
            <span>📊</span>
            {sidebarOpen && " Health Overview"}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'metrics' ? 'active' : ''}`}
            onClick={() => setActiveTab('metrics')}
            title="Detailed Reports"
          >
            <span>📈</span>
            {sidebarOpen && " Detailed Reports"}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'command' ? 'active' : ''}`}
            onClick={() => setActiveTab('command')}
            title="Command Center"
          >
            <span>💻</span>
            {sidebarOpen && " Command Center"}
            {sidebarOpen && healthData.pendingApprovals > 0 && (
              <span className="pending-badge animate-pulse">{healthData.pendingApprovals}</span>
            )}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'pbi' ? 'active' : ''}`}
            onClick={() => setActiveTab('pbi')}
            title="PowerBI Analytics"
          >
            <span>📊</span>
            {sidebarOpen && " PowerBI Analytics"}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'ailogs' ? 'active' : ''}`}
            onClick={() => setActiveTab('ailogs')}
            title="AI & Logs Telemetry"
          >
            <span>🧠</span>
            {sidebarOpen && " AI & Logs Telemetry"}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'matrix' ? 'active' : ''}`}
            onClick={() => setActiveTab('matrix')}
            title="Unified Health Matrix"
          >
            <span>🌍</span>
            {sidebarOpen && " Unified Health Matrix"}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'rca' ? 'active' : ''}`}
            onClick={() => setActiveTab('rca')}
            title="RCA & Correlation"
          >
            <span>🔍</span>
            {sidebarOpen && " RCA Analytics"}
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'tickets' ? 'active' : ''}`}
            onClick={() => setActiveTab('tickets')}
            title="Ticket Impact Timeline"
          >
            <span>🎫</span>
            {sidebarOpen && " Ticket Impact"}
          </button>
          
          {/* Theme mode toggle */}
          <button 
            className="nav-tab-btn theme-toggle-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
            {sidebarOpen && (theme === 'dark' ? ' Light Mode' : ' Dark Mode')}
          </button>
        </nav>

        {sidebarOpen && (
          <div className="sidebar-status-block">
            <div className="navbar-status">
              <div className={`status-dot ${wsConnected ? 'connected' : 'disconnected'}`}></div>
              <span className="status-text">{wsConnected ? 'Live Connection' : 'Disconnected'}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Area Container Frame */}
      <div className={`sentinel-main-frame ${sidebarOpen ? '' : 'collapsed-padding'}`}>
        
        {/* Top Brand Banner Header & Real-time Global Clocks Bar */}
        <div className="sentinel-top-brand-header">
          <div className="top-brand-title-group">
            <h2>Intelligent Observability & Autonomous Recovery Framework</h2>
            <span className="live-pill animate-pulse">● STG CORE</span>
          </div>
          
          <div className="top-timezone-clocks-wrapper">
            <div className="clock-item" title="Coordinated Universal Time"><span className="zone">UTC</span><span className="time">{clocks.utc || '--:--:--'}</span></div>
            <div className="clock-item" title="India Standard Time"><span className="zone">IST</span><span className="time">{clocks.ist || '--:--:--'}</span></div>
            <div className="clock-item" title="London / UK Time"><span className="zone">LDN</span><span className="time">{clocks.ldn || '--:--:--'}</span></div>
            <div className="clock-item" title="Lisbon / Portugal Time"><span className="zone">LIS</span><span className="time">{clocks.portugal || '--:--:--'}</span></div>
            <div className="clock-item" title="Montreal / EST Time"><span className="zone">MTL</span><span className="time">{clocks.montreal || '--:--:--'}</span></div>
            <div className="clock-item" title="New York / EST Time"><span className="zone">NYC</span><span className="time">{clocks.newyork || '--:--:--'}</span></div>
          </div>
        </div>

        <main className="sentinel-main-content" style={{ paddingTop: '1rem' }}>
          {activeTab === 'health' && (
            <HealthOverview 
              healthData={healthData} 
              historicalMetrics={historicalMetrics}
              onSelectComponent={(comp) => {
                setSelectedComponent(comp);
                setActiveTab('metrics');
              }}
              activeSimulations={simulations}
            />
          )}

          {activeTab === 'metrics' && (
            <MetricsDetail 
              selectedComponent={selectedComponent}
              onComponentChange={setSelectedComponent}
              historicalMetrics={historicalMetrics}
              healthData={healthData}
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
            />
          )}

          {activeTab === 'pbi' && (
            <PowerBiDashboard />
          )}

          {activeTab === 'ailogs' && (
            <AiLogPerformance />
          )}

          {activeTab === 'matrix' && (
            <UnifiedHealthMatrix 
              healthData={healthData}
              customChecks={customChecks}
              alerts={alerts}
            />
          )}

          {activeTab === 'rca' && (
            <RcaDashboard />
          )}

          {activeTab === 'tickets' && (
            <TicketImpactDashboard />
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
