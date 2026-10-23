/**
 * Console container: tab bar for the console screens, loads /api/v2/console/<screen> for the
 * environment and handles app:<id> drill-down.
 */
import React, { useState, useEffect } from 'react';
import OverviewScreen from './OverviewScreen';
import JenkinsScreen from './JenkinsScreen';
import GeoScreen from './GeoScreen';
import ComplianceScreen from './ComplianceScreen';
import DependenciesScreen from './DependenciesScreen';
import ReportsScreen from './ReportsScreen';
import AppDetailScreen from './AppDetailScreen';
import { ConsoleEmpty } from './ConsolePrimitives';
import '../demo/DemoView.css';

/*
 * Observability console, live. Same six screens as the Demo tabs, fed by
 * /api/v2/console/<screen> (built only from received data). A screen with no
 * source answers DATA_UNAVAILABLE and shows the reason; nothing is drawn as a placeholder.
 */
const TABS = [
  { id: 'overview', label: 'Overview', Screen: OverviewScreen, name: 'Platform overview' },
  { id: 'jenkins', label: 'Jenkins', Screen: JenkinsScreen, name: 'CloudBees Jenkins' },
  { id: 'geo', label: 'Geo replication', Screen: GeoScreen, name: 'Geo replication' },
  { id: 'compliance', label: 'Compliance', Screen: ComplianceScreen, name: 'Compliance and lifecycle' },
  { id: 'dependencies', label: 'Dependencies', Screen: DependenciesScreen, name: 'Dependencies and probes' },
  { id: 'reports', label: 'SLO reports', Screen: ReportsScreen, name: 'SLO and DORA reports' }
];

// Console page; fetches the selected screen and passes the data to it.
export default function ConsoleView({ environment }) {
  const [tabId, setTabId] = useState('overview');
  const [state, setState] = useState({ loading: true, data: null, reason: null, error: null });
  const appId = tabId.startsWith('app:') ? tabId.slice(4) : null;
  const tab = appId ? { id: 'overview', Screen: AppDetailScreen, name: appId } : (TABS.find(t => t.id === tabId) || TABS[0]);
  const url = appId ? `/api/v2/console/app/${encodeURIComponent(appId)}` : `/api/v2/console/${tab.id}`;

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, reason: null, error: null });
    fetch(`${url}?environment=${encodeURIComponent(environment || '')}`, { credentials: 'same-origin' })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(body => {
        if (cancelled) return;
        if (body.status === 'DATA_UNAVAILABLE') setState({ loading: false, data: null, reason: body.reason, error: null });
        else setState({ loading: false, data: body.data || null, reason: null, error: null });
      })
      .catch(err => { if (!cancelled) setState({ loading: false, data: null, reason: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [url, environment]);

  const Screen = tab.Screen;
  return (
    <div className="demo-view-container">
      <div className="demo-tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab.id === t.id} data-console-tab={t.id}
            onClick={() => setTabId(t.id)} className={`demo-tab${tab.id === t.id ? ' demo-tab--active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>
      {state.loading ? <div className="demo-loading">Loading…</div>
        : state.error ? <div className="demo-error">Error: {state.error}</div>
        : state.data ? <Screen key={url} demoData={state.data} environment={environment} live onDrill={(id) => setTabId(id)} onBack={() => setTabId('overview')} />
        : <ConsoleEmpty environment={environment} name={tab.name} reason={state.reason} />}
    </div>
  );
}
