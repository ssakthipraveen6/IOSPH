/**
 * Demo view: renders the normal screens with built-in sample data (read-only) for presentations.
 */
import React, { useState, useEffect } from 'react';
import HomeScorecardView from '../home/HomeScorecardView';
import ProblemsView from '../respond/ProblemsView';
import AlertsView from '../respond/AlertsView';
import EvidencePacksView from '../respond/EvidencePacksView';
import ProductPage from '../product/ProductPage';
import EdgePerimeterView from '../perimeter/EdgePerimeterView';
import DatabaseView from '../database/DatabaseView';
import KubernetesMeshView from '../k8s/KubernetesMeshView';
import FleetExplorerView from '../fleet/FleetExplorerView';
import BlastRadiusView from '../correlation/BlastRadiusView';
import DashboardBuilderView from '../explore/DashboardBuilderView';
import UnifiedCorrelationTimeline from '../correlation/UnifiedCorrelationTimeline';
import OverviewScreen from '../console/OverviewScreen';
import JenkinsScreen from '../console/JenkinsScreen';
import GeoScreen from '../console/GeoScreen';
import ComplianceScreen from '../console/ComplianceScreen';
import DependenciesScreen from '../console/DependenciesScreen';
import ReportsScreen from '../console/ReportsScreen';
import './DemoView.css';

// Label shown by the real screens where they print the environment name.
const DEMO_ENV_LABEL = 'demo';

/*
 * Each sub-tab renders the REAL screen component (the same one App.jsx uses for
 * the matching tab) with `demoData` (sample payload, no live fetch) and
 * `readOnly` (every action disabled with "Not available in demo").
 * `map` adapts the /api/demo/<area> fixture shape to what that screen expects.
 */
const DEMO_TABS = [
  { id: 'home', label: 'Scorecard', endpoints: ['/api/demo/home'], map: mapHome },
  { id: 'problems', label: 'Problems', endpoints: ['/api/demo/problems'], map: mapProblems },
  { id: 'alerts', label: 'Alerts', endpoints: ['/api/demo/alerts'], map: mapAlerts },
  { id: 'products', label: 'Products', endpoints: ['/api/demo/products'], map: mapProducts },
  { id: 'avi', label: 'AVI', endpoints: ['/api/demo/avi'], map: mapAvi },
  { id: 'databases', label: 'Databases', endpoints: ['/api/demo/databases'], map: mapDatabases },
  { id: 'kubernetes', label: 'Kubernetes', endpoints: ['/api/demo/kubernetes'], map: mapKubernetes },
  { id: 'hosts', label: 'Hosts', endpoints: ['/api/demo/hosts'], map: mapHosts },
  { id: 'topology', label: 'Topology', endpoints: ['/api/demo/topology', '/api/demo/problems'], map: mapTopology },
  { id: 'evidence', label: 'Evidence Pack', endpoints: ['/api/demo/evidence/PRB-SAMPLE-01'], map: mapEvidence },
  { id: 'dashboards', label: 'Dashboards', endpoints: ['/api/demo/dashboards'], map: mapDashboards },
  { id: 'correlation', label: 'Correlation', endpoints: ['/api/demo/correlation'], map: mapCorrelation },
  // Observability-console screens: the fixture is already in the shape the screen renders.
  { id: 'console-overview', label: 'Console overview', endpoints: ['/api/demo/console/overview'], map: identity },
  { id: 'console-jenkins', label: 'Jenkins', endpoints: ['/api/demo/console/jenkins'], map: identity },
  { id: 'console-geo', label: 'Geo replication', endpoints: ['/api/demo/console/geo'], map: identity },
  { id: 'console-compliance', label: 'Compliance', endpoints: ['/api/demo/console/compliance'], map: identity },
  { id: 'console-dependencies', label: 'Dependencies', endpoints: ['/api/demo/console/dependencies'], map: identity },
  { id: 'console-reports', label: 'SLO reports', endpoints: ['/api/demo/console/reports'], map: identity }
];

// Demo page; loads demo fixtures and shows the chosen sub-tab.
export default function DemoView() {
  const [activeSubTab, setActiveSubTab] = useState('home');
  const [viewData, setViewData] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const currentTabConfig = DEMO_TABS.find(t => t.id === activeSubTab) || DEMO_TABS[0];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setViewData(null);

    Promise.all(currentTabConfig.endpoints.map(endpoint =>
      fetch(endpoint, { credentials: 'same-origin' }).then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load demo data`);
        return res.json();
      })
    ))
      .then(payloads => {
        if (cancelled) return;
        // Map once per load so the real screens receive a stable `demoData` object.
        setViewData(currentTabConfig.map(...payloads.map(p => p.data), payloads[0].generated_at));
        setGeneratedAt(payloads[0].generated_at);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [currentTabConfig]);

  return (
    <div className="demo-view-container">

      {/* 1. Mandatory Fixed Banner */}
      <div
        role="alert"
        className="demo-fixed-banner demo-banner"
      >
        <div className="demo-banner-main">
          <span className="demo-banner-icon">🧪</span>
          <div>
            <div className="demo-banner-title">
              Demo · sample data · not from any real system
            </div>
            <div className="demo-banner-note">
              All interactions and mutations are disabled. Normal environments (PROD &amp; STAG) show real telemetry or empty states.
            </div>
          </div>
        </div>
        {generatedAt && (
          <div className="demo-banner-stamp">
            Snapshot generated: {new Date(generatedAt).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* 2. Sub-tabs Navigation */}
      <div className="demo-tabs">
        {DEMO_TABS.map(tab => (
          <button
            key={tab.id}
            data-demo-tab={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`demo-tab${activeSubTab === tab.id ? ' demo-tab--active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 3. Sub-tab Content Area: the real screen, fed sample data */}
      {loading ? (
        <div className="demo-loading">
          Loading demo fixture...
        </div>
      ) : error ? (
        <div className="demo-error">
          Error: {error}
        </div>
      ) : viewData ? (
        <div className="demo-content-body" data-demo-active={activeSubTab}>
          <DemoScreen key={activeSubTab} tabId={activeSubTab} demoData={viewData} onDrill={setActiveSubTab} />
        </div>
      ) : null}
    </div>
  );
}

// Picks the screen component for a demo sub-tab.
function DemoScreen({ tabId, demoData, onDrill }) {
  const common = { environment: DEMO_ENV_LABEL, demoData, readOnly: true };
  switch (tabId) {
    case 'home': return <HomeScorecardView {...common} />;
    case 'problems': return <ProblemsView {...common} />;
    case 'alerts': return <AlertsView {...common} />;
    case 'products': return <ProductPage {...common} />;
    case 'avi': return <EdgePerimeterView {...common} />;
    case 'databases': return <DatabaseView {...common} />;
    case 'kubernetes': return <KubernetesMeshView {...common} />;
    case 'hosts': return <FleetExplorerView {...common} />;
    case 'topology': return <BlastRadiusView {...common} />;
    case 'evidence': return <EvidencePacksView {...common} />;
    case 'dashboards': return <DashboardBuilderView {...common} />;
    case 'correlation': return <UnifiedCorrelationTimeline {...common} initialSubTab="timeline" />;
    case 'console-overview': return <OverviewScreen {...common} onDrill={onDrill} />;
    case 'console-jenkins': return <JenkinsScreen {...common} />;
    case 'console-geo': return <GeoScreen {...common} />;
    case 'console-compliance': return <ComplianceScreen {...common} />;
    case 'console-dependencies': return <DependenciesScreen {...common} />;
    case 'console-reports': return <ReportsScreen {...common} />;
    default: return null;
  }
}

/* ---------- Fixture → real-screen shape adapters ---------- */

function identity(data) { return data; }
// Value as an array (empty when not an array).
const asArray = (v) => (Array.isArray(v) ? v : []);

// Shapes demo home data for HomeScorecardView.
function mapHome(data) {
  const d = data || {};
  return {
    scorecards: asArray(d.scorecards).map(sc => ({
      product_id: sc.productId,
      product_name: sc.productName,
      availability_pct: sc.availabilityPct,
      p95_ms: sc.p95Ms,
      p95_change_pct: sc.p95DeltaPct,
      change_points_count: sc.changePointsCount,
      open_cves_count: sc.openCvesCount,
      top_cause: sc.topCause
    })),
    problems: asArray(d.activeProblems)
  };
}

// Shapes demo problems data.
function mapProblems(data) {
  return { problems: asArray(data) };
}

const ALERT_STATUS_LABELS = {
  OPEN: 'Active',
  ACKNOWLEDGED: 'Acknowledged',
  SNOOZED: 'Snoozed',
  RESOLVED: 'Resolved'
};

// Shapes demo alerts data.
function mapAlerts(data) {
  return {
    alerts: asArray(data).map(a => ({
      id: a.id,
      severity: a.severity,
      component: a.entity_id,
      message: a.title,
      rule_id: a.rule_id,
      status: ALERT_STATUS_LABELS[a.status] || a.status,
      acked_by: a.acked_by,
      snoozed_until: a.snoozed_until
    }))
  };
}

// Shapes demo products data for ProductPage.
function mapProducts(data, generatedAt) {
  const products = asArray(data);
  const details = {};
  products.forEach(p => {
    details[p.id] = {
      journeys: asArray(p.journeys).map(j => ({
        id: j.id,
        name: j.name,
        tier: p.category,
        interval_seconds: 60,
        last_run_ts: generatedAt,
        last_status: j.status === 'FAILING' ? 'FAILED' : j.status,
        p95_latency_ms: j.p95_ms ?? null,
        steps: []
      })),
      runs: []
    };
  });
  return {
    products: products.map(p => ({
      id: p.id,
      name: p.name,
      version: p.version,
      tier: p.category,
      alert_count: asArray(p.journeys).filter(j => j.status !== 'HEALTHY').length
    })),
    details
  };
}

// Shapes demo AVI data for the perimeter view.
function mapAvi(data) {
  const vips = asArray(data && data.vips);
  const rows = vips.map(v => {
    const t = v.timings || {};
    return {
      url: `https://${v.vip_name}:${v.port}`,
      component: v.vip_name.split('-')[0],
      productId: v.vip_name.split('-')[0],
      status: v.status === 'UP' ? 'HEALTHY' : v.status,
      dns_ms: t.dns_ms ?? null,
      tcp_ms: t.tcp_ms ?? null,
      tls_ms: t.tls_ms ?? null,
      ttfb_ms: t.ttfb_ms ?? null,
      total_ms: t.total_ms ?? null
    };
  });
  const statusCounts = {};
  vips.forEach(v => { statusCounts[v.status] = (statusCounts[v.status] || 0) + 1; });
  return {
    vips: rows,
    timingBreakdown: rows,
    worstVips: [...rows].sort((a, b) => (b.total_ms || 0) - (a.total_ms || 0)).slice(0, 5),
    certExpiries: vips.map(v => ({
      url: `https://${v.vip_name}`,
      productId: v.vip_name.split('-')[0],
      subject: `CN=${v.vip_name}`,
      issuer: null,
      protocol: v.tls_version,
      cipher: null,
      days_left: v.cert_days_remaining ?? null,
      status: v.cert_days_remaining != null && v.cert_days_remaining <= 30 ? 'EXPIRING_SOON' : 'VALID'
    })),
    statusDistribution: Object.entries(statusCounts).map(([status, count]) => ({
      status,
      count,
      percentage: Math.round((count / (vips.length || 1)) * 100)
    }))
  };
}

// Shapes demo database data.
function mapDatabases(data) {
  return {
    databases: asArray(data && data.databases).map(d => ({
      ...d,
      tablespace_pct: d.tablespace_used_pct
    })),
    top_queries: []
  };
}

// Shapes demo Kubernetes data (clusters, nodes, workloads).
function mapKubernetes(data) {
  const clusters = asArray(data && data.clusters);
  const workloads = [];
  const nodes = [];
  clusters.forEach(c => {
    asArray(c.workloads).forEach(w => {
      workloads.push({
        name: `${c.name}/${w.name}`,
        cpuPercent: w.cpuPercent,
        cores: w.cores,
        podsReady: w.podsReady,
        podsDesired: w.podsDesired,
        status: w.status === 'degraded' ? 'warning' : 'healthy'
      });
    });
    for (let i = 0; i < (c.nodes_total || 0); i++) {
      nodes.push({
        id: `${c.name}-n${i + 1}`,
        status: i < (c.nodes_ready || 0) ? 'healthy' : 'critical',
        cpuLoad: '—',
        memoryLoad: '—'
      });
    }
  });
  return {
    cluster: clusters.map(c => c.name).join(', ') || null,
    k8sVersion: clusters[0] ? clusters[0].version : null,
    controlPlaneNodes: null,
    coresAllocated: workloads.reduce((sum, w) => sum + (w.cores || 0), 0),
    coresTotal: null,
    memoryCommittedTb: null,
    objectCounts: {
      namespaces: null,
      statefulSets: null,
      deployments: workloads.length,
      runningPods: workloads.reduce((sum, w) => sum + (w.podsReady || 0), 0)
    },
    namespaceUsage: workloads,
    nodes,
    containerRestarts: { history: [] }
  };
}

// Region from a demo host-name prefix.
function regionFromHostname(hostname) {
  if (/^(lon|fra|ams)-/.test(hostname)) return 'EMEA';
  if (/^(ny|chi|tor)-/.test(hostname)) return 'AMER';
  if (/^(sg|hk|tok)-/.test(hostname)) return 'APAC';
  return null;
}

// Shapes demo hosts data for the fleet view.
function mapHosts(data) {
  const d = data || {};
  const summary = d.summary || {};
  const expected = summary.total_hosts || 0;
  const discovered = summary.active_agents || 0;
  return {
    entities: asArray(d.hosts).map(h => ({
      entity_id: h.hostname,
      name: h.hostname.split('.')[0],
      kind: 'host',
      region: regionFromHostname(h.hostname),
      status: h.status,
      labels: { shipper_version: h.agent_version, appKey: h.product },
      last_seen: h.last_seen
    })),
    summary: {
      agentsDiscoveredVsExpected: {
        discovered,
        expected,
        coveragePct: expected ? Math.round((discovered / expected) * 1000) / 10 : 0
      },
      staleEntitiesCount: summary.silent_hosts || 0
    }
  };
}

// Shapes demo topology data.
function mapTopology(topology, problems) {
  const layers = asArray(topology && topology.layers);
  const entities = layers.flatMap(l => asArray(l.entities));
  const edges = asArray(topology && topology.edges);
  const hypotheses = [];
  const blastRadius = {};

  asArray(problems).forEach(p => {
    const hypothesisId = `HYP-${p.id}`;
    const suspect = entities.find(e => e.id.endsWith(`:${p.suspect_entity}`));
    // Applications reachable from the suspect entity through the topology graph.
    const affected = [];
    if (suspect) {
      const touching = edges.filter(e => e.from === suspect.id || e.to === suspect.id)
        .map(e => (e.from === suspect.id ? e.to : e.from));
      const neighbours = new Set(touching);
      edges.forEach(e => { if (neighbours.has(e.from)) neighbours.add(e.to); });
      neighbours.forEach(id => {
        const ent = entities.find(x => x.id === id);
        if (ent && ent.type === 'application') affected.push(id);
      });
    }
    blastRadius[hypothesisId] = { affected_applications: affected };
    hypotheses.push({
      hypothesis_id: hypothesisId,
      suspect_entity_id: suspect ? suspect.id : p.suspect_entity,
      trigger_event_id: asArray(p.alerts)[0] ? p.alerts[0].id : null,
      confidence: p.confidence || 0,
      blast_radius: affected.length,
      status: 'open',
      rationale: asArray(p.alerts).map((a, idx) => ({
        step: idx + 1,
        entity_id: p.suspect_entity,
        event_id: a.id,
        observation: a.title
      }))
    });
  });

  return { hypotheses, blastRadius };
}

// Shapes demo evidence-pack data.
function mapEvidence(data) {
  if (!data) return { problems: [] };
  return {
    problems: [{
      id: data.id,
      title: data.title,
      severity: data.severity,
      top_layer: data.top_layer,
      suspect_entity: data.suspect_entity,
      created_at: data.created_at
    }]
  };
}

// Shapes demo dashboards data.
function mapDashboards(data) {
  return {
    dashboards: asArray(data).map(d => ({
      ...d,
      panels: asArray(d.panels).map(p => ({
        ...p,
        layout: { w: 3 },
        query: `sample value: ${p.value} (${p.status})`
      }))
    }))
  };
}

const TRACK_ICONS = {
  drift: '⚖️',
  deploy: '🚀',
  net: '⚖️'
};

// Shapes demo correlation events.
function mapCorrelation(data) {
  return {
    events: asArray(data && data.events).map(e => ({
      ...e,
      icon: TRACK_ICONS[e.trackId] || '•'
    }))
  };
}
