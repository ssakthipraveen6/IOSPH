/**
 * Main application shell: sidebar navigation (NAV_GROUPS), URL routing, environment switch
 * (PRD/STG/Demo), sign-in state, and which view is shown for the active tab.
 */
import React, { useState, useEffect, useRef } from 'react';
import AdminManagement from './components/admin/AdminManagement';
import StatusBadge, { StatusDot } from './components/shared/StatusBadge';
import { MaintenanceBanner } from './components/shared/MaintenanceNotice';
import MiscOperations from './components/sre/MiscOperations';
import EntityDrillDownPanel from './components/correlation/EntityDrillDownPanel';
import GlobalEntitySearch from './components/correlation/GlobalEntitySearch';
import { MAINTENANCE_CONFIG } from './maintenanceConfig';
import LogExplorerView from './components/logs/LogExplorerView';
import FleetExplorerView from './components/fleet/FleetExplorerView';
import BlastRadiusView from './components/correlation/BlastRadiusView';
import SloErrorBudget from './components/sre/SloErrorBudget';
import KubernetesMeshView from './components/k8s/KubernetesMeshView';
import EdgePerimeterView from './components/perimeter/EdgePerimeterView';
import ProductPage from './components/product/ProductPage';
import DatabaseView from './components/database/DatabaseView';
import SecurityView from './components/security/SecurityView';
import StorageView from './components/storage/StorageView';
import ChangeWindowsView from './components/govern/ChangeWindowsView';
import SodGovernanceBanner from './components/governance/SodGovernanceBanner';
import HomeScorecardView from './components/home/HomeScorecardView';
import ProblemsView from './components/respond/ProblemsView';
import AlertsView from './components/respond/AlertsView';
import EvidencePacksView from './components/respond/EvidencePacksView';
import DashboardBuilderView from './components/explore/DashboardBuilderView';
import TimePicker from './components/shared/TimePicker';
import DemoView from './components/demo/DemoView';
import ConsoleView from './components/console/ConsoleView';
import ComponentPage from './components/component/ComponentPage';
import HostListView from './components/infra/HostListView';
import HostDetailView from './components/infra/HostDetailView';
import ComponentRouter from './components/apps/ComponentRouter';
import HealthChecksView from './components/health/HealthChecksView';
import PlatformHealthView from './components/govern/PlatformHealthView';
import RemediationView from './components/respond/RemediationView';
import TracesView from './components/explore/TracesView';
import ConfigurationView from './components/govern/ConfigurationView';
import ExpiryView from './components/expiry/ExpiryView';
import CapacityView from './components/capacity/CapacityView';
import { useUrlRouter } from './router/useUrlRouter';
import { reportFetchError, apiFetch } from './api';
import {
  IconHome,
  IconAlertCircle,
  IconBell,
  IconTarget,
  IconFileText,
  IconPackage,
  IconServer,
  IconHardDrive,
  IconGlobe,
  IconDatabase,
  IconLayers,
  IconTerminal,
  IconShare2,
  IconBarChart2,
  IconShield,
  IconLock,
  IconCpu,
  IconCalendar,
  IconPlayCircle
} from './components/navigation/NavIcons';
import './App.css';

export const NAV_GROUPS = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { id: 'home', label: 'Scorecard', icon: IconHome, tip: 'Weekly Product Scorecards & Top Problems' }
    ]
  },
  {
    id: 'respond',
    label: 'Respond',
    items: [
      { id: 'problems', label: 'Problems', icon: IconAlertCircle, tip: 'Grouped multi-layer incidents & root causes' },
      { id: 'alerts', label: 'Alerts', icon: IconBell, tip: 'Alert rules lifecycle, ack, snooze & resolve' },
      { id: 'slos', label: 'SLOs', icon: IconTarget, tip: 'Product journey objectives & burn rate' },
      { id: 'evidence', label: 'Evidence Packs', icon: IconFileText, tip: 'Automated evidence reports & ServiceNow templates' },
      { id: 'remediation', label: 'Remediation', icon: IconTarget, tip: 'Autonomous playbooks, four-eyes gatekeeping & runs' },
      { id: 'on_call', label: 'On-Call', icon: IconCalendar, tip: 'DevSecOps on-call shift schedule & escalation rota' }
    ]
  },
  {
    id: 'observe',
    label: 'Observe',
    items: [
      { id: 'applications', label: 'Applications', icon: IconPackage, tip: 'End-to-end application map & component drill-down' },
      { id: 'products', label: 'Products', icon: IconPackage, tip: 'DevOps toolchain products & golden journeys' },
      { id: 'hosts', label: 'Hosts', icon: IconServer, tip: 'Linux & Windows Server agent health & drift' },
      { id: 'infra_linux', label: 'Linux', icon: IconServer, tip: 'Linux compute infrastructure & host metrics' },
      { id: 'infra_windows', label: 'Windows', icon: IconServer, tip: 'Windows Server compute infrastructure & perf counters' },
      { id: 'health_checks', label: 'Health Checks', icon: IconTarget, tip: 'Synthetic health checks & endpoint availability' },
      { id: 'expiry', label: 'Certificates & Licences', icon: IconLock, tip: 'TLS certificates, secret & licence expiry tracking' },
      { id: 'capacity', label: 'Capacity & Runway', icon: IconHardDrive, tip: 'Capacity saturation & linear runway forecasts' },
      { id: 'storage', label: 'Storage', icon: IconHardDrive, tip: 'NAS shares, S3 performance & IOPS' },
      { id: 'avi', label: 'AVI', icon: IconGlobe, tip: 'AVI VIP probes & perimeter network' },
      { id: 'databases', label: 'Databases', icon: IconDatabase, tip: 'Oracle, SQL Server & PostgreSQL instances' },
      { id: 'kubernetes', label: 'Kubernetes', icon: IconLayers, tip: 'Toolchain K8s clusters, nodes & pods' },
      { id: 'logs', label: 'Logs', icon: IconTerminal, tip: 'Structured logs & keyset pagination' }
    ]
  },
  {
    id: 'explore',
    label: 'Explore',
    items: [
      { id: 'topology', label: 'Topology', icon: IconShare2, tip: 'Multi-layer graph & blast radius' },
      { id: 'traces', label: 'Traces', icon: IconLayers, tip: 'W3C distributed trace spans & latency waterfall' },
      { id: 'dashboards', label: 'Dashboards', icon: IconBarChart2, tip: 'Metrics telemetry & analytics' }
    ]
  },
  {
    id: 'govern',
    label: 'Govern',
    items: [
      { id: 'access', label: 'Access', icon: IconShield, tip: 'RBAC, eLDAP SSO & role entitlements' },
      { id: 'audit', label: 'Audit', icon: IconLock, tip: 'Immutable WAL audit logs & dual signatures' },
      { id: 'agents', label: 'Agents', icon: IconCpu, tip: 'Agent fleet, dynamic config & drift' },
      { id: 'platform_health', label: 'Platform Health', icon: IconCpu, tip: 'Ingest pipeline telemetry, daemons & leader node' },
      { id: 'configuration', label: 'Configuration', icon: IconFileText, tip: 'File-based YAML config viewer & secret masking' },
      { id: 'change_windows', label: 'Change Windows', icon: IconCalendar, tip: 'Change windows & unapproved file changes' },
      { id: 'security', label: 'Security', icon: IconShield, tip: 'CVE findings & EOL components per host and product' }
    ]
  },
  {
    id: 'console_group',
    label: 'Console',
    items: [
      { id: 'console', label: 'Console', icon: IconLayers, tip: 'Estate overview, Jenkins, compliance & more · real data only' }
    ]
  },
  {
    id: 'demo_group',
    label: 'Demo',
    items: [
      { id: 'demo', label: 'Demo', icon: IconPlayCircle, tip: 'Demo · sample data · not from any real system' }
    ]
  }
];

// Maps any tab name from the URL (including old aliases) to the canonical tab id used by the sidebar.
export function resolveCanonicalTab(rawTab) {
  if (!rawTab) return 'home';
  const t = rawTab.toLowerCase();
  if (t === 'demo') return 'demo';
  if (t === 'console') return 'console';
  const aliasMap = {
    'health': 'home',
    'scorecard': 'home',
    'apps': 'applications',
    'applications': 'applications',
    'noc-apm': 'products',
    'k8s-mesh': 'kubernetes',
    'perimeter-logs': 'avi',
    'flamegraph': 'products',
    'traces': 'traces',
    'trace': 'traces',
    'health_checks': 'health_checks',
    'health-checks': 'health_checks',
    'platform_health': 'platform_health',
    'platform-health': 'platform_health',
    'remediation': 'remediation',
    'capacity': 'capacity',
    'runway': 'capacity',
    'on_call': 'on_call',
    'on-call': 'on_call',
    'rota': 'on_call',
    'configuration': 'configuration',
    'sod-gov': 'audit',
    'slo': 'slos',
    'metrics': 'dashboards',
    'pbi': 'dashboards',
    'matrix': 'products',
    'fleet': 'hosts',
    'blast-radius': 'topology',
    'pipeline-ops': 'platform_health',
    'command': 'problems',
    'itsm': 'evidence',
    'sre': 'change_windows',
    'entities': 'topology',
    'timeline': 'topology',
    'rca': 'topology',
    'yaml': 'configuration',
    'admin': 'access'
  };
  return aliasMap[t] || t;
}

// True when the tab is enabled in views_enabled (config/global.yaml); an empty list means every tab is
// on.
function isTabEnabled(tabId) {
  const views = MAINTENANCE_CONFIG.views_enabled;
  if (!views || Object.keys(views).length === 0) return true;
  const canonical = resolveCanonicalTab(tabId);
  const normalized = canonical.replace(/-/g, '_');
  if (views[canonical] !== undefined) return Boolean(views[canonical]);
  if (views[normalized] !== undefined) return Boolean(views[normalized]);
  if (views[tabId] !== undefined) return Boolean(views[tabId]);
  return true;
}

// Root component: holds session, environment and active tab, and renders the sidebar plus the selected
// view.
export default function App() {
  const router = useUrlRouter({ defaultTab: 'home', defaultEnv: 'staging' });
  const activeTab = resolveCanonicalTab(router.tab);
  const environment = router.env;
  const { navigate, switchEnvironment } = router;
  const setActiveTab = (tabId) => navigate({ tab: tabId });
  const [selectedComponent, setSelectedComponent] = useState('database');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const envRef = useRef(environment);
  const wsRef = useRef(null);
  useEffect(() => { envRef.current = environment; }, [environment]);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.username) {
          setCurrentUser(data);
        }
      })
      .catch(() => {});
  }, []);

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
      // Quick jump to Problems (Cmd/Ctrl+Shift+R)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setActiveTab('problems');
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
      reportFetchError('Error fetching historical metrics:', error);
    }
  };

  // Helper to fetch other states initially
  const fetchInitialStates = async (targetEnv) => {
    const activeEnv = targetEnv || envRef.current || 'staging';
    try {
      const hRes = await fetch(`/api/health?environment=${encodeURIComponent(activeEnv)}`);
      if (hRes.ok) {
        const hData = await hRes.json();
        setHealthData(hData);
      }
      
      const aRes = await fetch(`/api/alerts?environment=${encodeURIComponent(activeEnv)}`);
      if (aRes.ok) setAlerts(await aRes.json());
      
      const rRes = await fetch(`/api/recovery?environment=${encodeURIComponent(activeEnv)}`);
      if (rRes.ok) setRecovery(await rRes.json());
      
      const sRes = await fetch('/api/settings');
      if (sRes.ok) setSettings(await sRes.json());

      const cRes = await fetch('/api/custom-checks');
      if (cRes.ok) setCustomChecks(await cRes.json());
    } catch (e) {
      reportFetchError('Failed to fetch initial state:', e);
    }
  };

  // Connect to live WebSockets channel
  useEffect(() => {
    fetchInitialStates();
    fetchAllMetrics();

    // Poll metrics every 10s to keep metrics dataset fresh
    const metricsPoll = setInterval(() => fetchAllMetrics(envRef.current), 10000);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws = null;
    let reconnectTimeout = null;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?environment=${encodeURIComponent(envRef.current || 'staging')}`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to Intelligent Observability & Autonomous Recovery Framework backend');
        setWsConnected(true);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'subscribe', environment: envRef.current || 'staging' }));
        }
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

  function getCsrfToken() {
    const match = document.cookie.match(/(^|;\s*)sentinel_csrf=([^;]*)/);
    return match ? decodeURIComponent(match[2]) : '';
  }

  const handleToggleAutonomous = async () => {
    try {
      const updatedValue = !settings.autonomousMode;
      const headers = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      };

      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
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
      const headers = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      };

      const res = await apiFetch('/api/simulate', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
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
      const headers = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      };

      const res = await apiFetch('/api/recovery/approve', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
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
      localStorage.setItem('sentinel_environment', newEnv);
      switchEnvironment(newEnv);
      envRef.current = newEnv;

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'subscribe', environment: newEnv }));
      }

      const headers = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      };

      const res = await apiFetch('/api/environment', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ environment: newEnv })
      });
      if (res.ok) {
        const data = await res.json();
        const appliedEnv = data.environment || newEnv;
        setSimulations({});
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
          {NAV_GROUPS.map(group => {
            const enabledItems = group.items.filter(item => isTabEnabled(item.id));
            if (enabledItems.length === 0) return null;

            return (
              <div key={group.id} className="nav-group">
                {sidebarOpen && (
                  <div className="nav-group__label">
                    {group.label}
                  </div>
                )}
                {enabledItems.map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      className={`nav-tab-btn ${isActive ? 'active' : ''}`}
                      onClick={() => navigate({ tab: item.id })}
                      data-tooltip={item.label}
                      title={item.tip}
                    >
                      <span className="nav-icon" style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                        <Icon size={16} />
                      </span>
                      {sidebarOpen && (
                        <span className="nav-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.label}
                        </span>
                      )}
                      {item.id === 'problems' && healthData.pendingApprovals > 0 && (
                        <span className="pending-badge">{healthData.pendingApprovals}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
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
            <GlobalEntitySearch onSelectEntity={handleOpenEntityPanel} environment={environment} />

            {/* M6 Task 6.1: Time Range Scrubber */}
            <TimePicker onRangeChange={({ from, to }) => navigate({ from, to })} />
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
                    <span className="logged-in-label">{currentUser ? 'LOGGED IN' : 'SESSION'}</span>
                    <span className="user-online-text" style={{ color: currentUser ? (wsConnected ? 'var(--healthy)' : 'var(--critical)') : 'var(--text-muted)' }}>
                      {currentUser ? (wsConnected ? '● Active' : '○ Offline') : 'Signing in…'}
                    </span>
                  </div>
                  <span className="user-name">{currentUser ? (currentUser.name || currentUser.username) : 'Signing in…'}</span>
                  <span className="user-role">{currentUser ? `${currentUser.role} · AD/eLDAP` : 'Authenticating…'}</span>
                </div>
                <span className="user-chevron">▾</span>
              </div>

              {/* User RBAC Popover Dropdown */}
              <div className={`user-dropdown-menu ${isUserDropdownOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
                {currentUser ? (
                  <>
                    <div className="dropdown-header">
                      <div className="dropdown-avatar">🛡️</div>
                      <div>
                        <div className="dropdown-name">{currentUser.name || currentUser.username}</div>
                        <div className="dropdown-email">{currentUser.email || `${currentUser.username}@enterprise.corp`}</div>
                      </div>
                    </div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-section">
                      <div className="dropdown-label">IDENTITY &amp; AUTHENTICATION</div>
                      <div className="dropdown-item-info">Directory: <strong>{currentUser.directory || 'Corporate Active Directory (eLDAP)'}</strong></div>
                      <div className="dropdown-item-info">Assigned Role: <strong style={{ color: 'var(--primary)' }}>{currentUser.role}</strong></div>
                      <div className="dropdown-item-info">MFA Status: <strong style={{ color: 'var(--healthy)' }}>{currentUser.mfaEnforced ? 'Enforced (FIDO2 / TOTP)' : 'Disabled'}</strong></div>
                      <div className="dropdown-item-info">Telemetry Node: <span className="mono" style={{ fontSize: '10px', color: 'var(--primary)' }}>{currentUser.nodeName || 'lon-noc-gw-01'}</span></div>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                    <div style={{ fontSize: '1.2rem', marginBottom: '6px' }}>🔒</div>
                    <div>No Active Session</div>
                    <div style={{ marginTop: '4px', fontSize: '11px' }}>Authenticate via Corporate SSO / eLDAP.</div>
                  </div>
                )}
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

            {/* 2-Way Environment Switcher (PROD and STAG only) */}
            <div className="env-chip-group">
              {[
                { id: 'prod', label: 'PROD', cls: 'active-prod' },
                { id: 'staging', label: 'STAG', cls: 'active-stg' }
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
            {environment === 'staging' && (
              <span>⬡ <strong>STAGING ENVIRONMENT:</strong> Connected to non-production pre-release fleet and simulated telemetry streams.</span>
            )}
            {environment === 'prod' && (
              <span>🔒 <strong>PRODUCTION ENVIRONMENT:</strong> Connected to live cluster nodes, VMware AVI ingress, TimescaleDB &amp; Snowflake.</span>
            )}
          </div>
          <span className="uptime-badge" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--primary)' }}>
            Uptime: {healthData.uptime || '—'}
          </span>
        </div>

        {/* Main Content Area */}
        <main className="sentinel-main-content" style={{ paddingTop: '1.25rem' }}>
          {MAINTENANCE_CONFIG.showGlobalBanner && (
            <MaintenanceBanner message={MAINTENANCE_CONFIG.globalNote} />
          )}

          {activeTab === 'console' && (
            <ConsoleView environment={environment} />
          )}

          {activeTab === 'demo' && (
            <DemoView />
          )}

          {/* M6 CANONICAL RESPOND & OVERVIEW WORKSPACES */}
          {activeTab === 'home' && (
            <HomeScorecardView
              environment={environment}
              onSelectProduct={(p) => navigate({ tab: 'products', product: p })}
              onNavigateTab={(t) => navigate({ tab: t })}
            />
          )}

          {activeTab === 'problems' && (
            <ProblemsView environment={environment} />
          )}

          {activeTab === 'alerts' && (
            <AlertsView environment={environment} />
          )}

          {activeTab === 'slos' && (
            <SloErrorBudget environment={environment} />
          )}

          {activeTab === 'evidence' && (
            <EvidencePacksView environment={environment} />
          )}

          {activeTab === 'hosts' && (
            <FleetExplorerView
              environment={environment}
              onInspectEntity={handleOpenEntityPanel}
            />
          )}

          {activeTab === 'infra_linux' && (
            router.host ? (
              <HostDetailView
                host={router.host}
                os="linux"
                environment={environment}
                onBack={() => navigate({ tab: 'infra_linux', host: null })}
                onNavigateToLogs={(query) => {
                  setSelectedEntityId(query);
                  setActiveTab('logs');
                }}
              />
            ) : (
              <HostListView
                os="linux"
                environment={environment}
                onSelectHost={(hostName) => navigate({ tab: 'infra_linux', host: hostName })}
              />
            )
          )}

          {activeTab === 'infra_windows' && (
            router.host ? (
              <HostDetailView
                host={router.host}
                os="windows"
                environment={environment}
                onBack={() => navigate({ tab: 'infra_windows', host: null })}
                onNavigateToLogs={(query) => {
                  setSelectedEntityId(query);
                  setActiveTab('logs');
                }}
              />
            ) : (
              <HostListView
                os="windows"
                environment={environment}
                onSelectHost={(hostName) => navigate({ tab: 'infra_windows', host: hostName })}
              />
            )
          )}

          {activeTab === 'storage' && (
            <StorageView environment={environment} />
          )}

          {activeTab === 'avi' && (
            <EdgePerimeterView
              environment={environment}
              onSelectTrace={(tid) => { setSelectedEntityId(tid); navigate({ tab: 'products' }); }}
            />
          )}

          {activeTab === 'topology' && (
            <BlastRadiusView
              environment={environment}
              onInspectEntity={handleOpenEntityPanel}
            />
          )}

          {activeTab === 'dashboards' && (
            <DashboardBuilderView
              environment={environment}
            />
          )}

          {activeTab === 'access' && (
            <AdminManagement environment={environment} />
          )}

          {activeTab === 'audit' && (
            <SodGovernanceBanner environment={environment} />
          )}

          {activeTab === 'agents' && (
            <FleetExplorerView
              environment={environment}
              mode="agents"
              onInspectEntity={handleOpenEntityPanel}
            />
          )}

          {activeTab === 'change_windows' && (
            <ChangeWindowsView environment={environment} user={currentUser} />
          )}

          {activeTab === 'applications' && (
            <ComponentRouter
              environment={environment}
              initialAppId={router.product || 'bitbucket'}
            />
          )}

          {activeTab === 'component' && (
            <ComponentPage
              kind={router.kind || 'vip'}
              id={router.id || 'bitbucket'}
              environment={environment}
              onClose={() => navigate({ tab: 'applications' })}
            />
          )}

          {activeTab === 'products' && (
            <ProductPage
              environment={environment}
              selectedProduct={router.product}
              onSelectProduct={(p) => navigate({ product: p })}
            />
          )}

          {activeTab === 'kubernetes' && (
            <KubernetesMeshView environment={environment} />
          )}

          {activeTab === 'databases' && (
            <DatabaseView environment={environment} />
          )}

          {activeTab === 'security' && (
            <SecurityView environment={environment} />
          )}

          {activeTab === 'misc' && (
            <MiscOperations 
              environment={environment}
            />
          )}

          {activeTab === 'on_call' && (
            <MiscOperations 
              environment={environment}
            />
          )}

          {activeTab === 'health_checks' && (
            <HealthChecksView 
              environment={environment}
            />
          )}

          {activeTab === 'platform_health' && (
            <PlatformHealthView 
              environment={environment}
            />
          )}

          {activeTab === 'remediation' && (
            <RemediationView 
              environment={environment}
            />
          )}

          {activeTab === 'traces' && (
            <TracesView 
              environment={environment}
            />
          )}

          {activeTab === 'configuration' && (
            <ConfigurationView 
              environment={environment}
            />
          )}

          {(activeTab === 'expiry' || activeTab === 'certificates_licences') && (
            <ExpiryView 
              environment={environment}
            />
          )}

          {activeTab === 'capacity' && (
            <CapacityView 
              environment={environment}
            />
          )}

          {activeTab === 'logs' && (
            <LogExplorerView 
              environment={environment}
              onInspectEntity={handleOpenEntityPanel}
            />
          )}

          {activeTab === 'component' && (
            <ComponentPage
              kind={router.kind || 'host_linux'}
              id={router.id || 'test-host-01'}
              environment={environment}
              onNavigateToLogs={(entityId) => {
                setSelectedEntityId(entityId);
                setActiveTab('logs');
              }}
            />
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
                { id: 'logs', label: 'Log Explorer', icon: '📋', category: 'Views', action: () => { setActiveTab('logs'); setIsCommandPaletteOpen(false); } },
                { id: 'misc', label: 'Team Operations & On-Call Rota', icon: '🛠️', category: 'Tools', action: () => { setActiveTab('misc'); setIsCommandPaletteOpen(false); } }
              ]
              .filter(item => isTabEnabled(item.id))
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
        onNavigateToTimeline={() => {
          setActiveTab('timeline');
          setIsEntityPanelOpen(false);
        }}
        onNavigateToComponent={({ kind, id }) => {
          setIsEntityPanelOpen(false);
          navigate({ tab: 'component', kind, id });
        }}
        environment={environment}
        historicalMetrics={historicalMetrics}
      />

    </div>
  );
}
