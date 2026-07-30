import React, { useState, useEffect } from 'react';

const classifierRules = [
  { pattern: '/OOMKilled|OutOfMemoryError/i', classification: 'Memory Leak Outage', severity: 'Critical', action: 'artifactory-jvm-recycle' },
  { pattern: '/No space left on device/i', classification: 'Disk Space Exhausted', severity: 'Critical', action: 'nas-log-purge' },
  { pattern: '/Database connection pool saturated/i', classification: 'TCP Pool Saturation', severity: 'Critical', action: 'db-connection-flush' },
  { pattern: '/Ingress network bottleneck/i', classification: 'Traffic Gateway Saturation', severity: 'Warning', action: 'avi-ingress-scale' }
];

export default function AiLogPerformance() {
  const [remediations, setRemediations] = useState([
    { id: "RUN-9921", timestamp: "2026-07-27 16:32:00", job: "nas-log-purge", target: "nas_performance", status: "Success", duration: "18.5s", log: "LLM Pattern Detected: Disk utilization reached 98.4%. Executing log rotation runbook. Cleared 42GB of build caches. Status verified: Health restored." },
    { id: "RUN-9918", timestamp: "2026-07-27 14:12:05", job: "artifactory-jvm-recycle", target: "artifactory", status: "Success", duration: "44.2s", log: "LLM Pattern Detected: Heap leak signature [OutOfMemoryError] in JVM logs. Compacting garbage collector spaces. JVM Heap stabilized at 52.4%." },
    { id: "RUN-9905", timestamp: "2026-07-26 10:15:33", job: "db-connection-flush", target: "database", status: "Success", duration: "12.1s", log: "LLM Pattern Detected: TCP pool saturation on Postgres. Terminating idle backend threads. Active pool count reduced from 450 to 92 conns." }
  ]);

  const [aiStats, setAiStats] = useState({
    scanThroughput: 840,
    accuracy: 99.8,
    latency: 1.2,
    queueSize: 0
  });

  useEffect(() => {
    const generateStats = () => {
      setAiStats({
        scanThroughput: 800 + Math.floor(Math.random() * 80),
        accuracy: 99.8,
        latency: parseFloat((1.1 + Math.random() * 0.3).toFixed(2)),
        queueSize: Math.floor(Math.random() * 2)
      });
    };

    generateStats();
    const interval = setInterval(generateStats, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header */}
      <div className="console-panel" style={{ padding: '1.25rem' }}>
        <div className="panel-header">
          <h3>⚙️ Auto Remediation Engine & LLM Telemetry</h3>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '4px' }}>
          This view tracks the live status of the autonomous healing engine, including integration tokens with the remote CloudBees Jenkins orchestrator pool, LLM processing diagnostic speeds, and recovery workflow execution logs.
        </p>
      </div>

      {/* Connection Registry and KPI Block */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        
        {/* Connection status card */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>Jenkins Orchestrator Pool Connection</h3>
            <span className="badge-teal">CONNECTED</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>CloudBees CJOC Endpoint:</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>https://jenkins-prod.internal.corp/job</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Authentication Provider:</span>
              <span style={{ fontWeight: 600 }}>SSO Gateway / LDAP Auth</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Remediation API Crumb Token:</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>jenkins_user:1120409aed82...</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Active Job Executors:</span>
              <span style={{ fontWeight: 600 }}>8 Pods (K8s dynamic agent nodes)</span>
            </div>
          </div>
        </div>

        {/* AI Classifier statistics */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>LLM Log Classifier Telemetry</h3>
            <span className="badge-teal">ACTIVE</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary)' }}>{aiStats.scanThroughput} logs/s</div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Log Ingestion Rate</span>
            </div>
            <div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary)' }}>{aiStats.accuracy}%</div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>LLM Classification Accuracy</span>
            </div>
            <div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary)' }}>{aiStats.latency} ms</div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Inference Ingestion Delay</span>
            </div>
            <div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary)' }}>{aiStats.queueSize} items</div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Queue Processing Pipeline</span>
            </div>
          </div>
        </div>

      </div>

      {/* Rules Registry & Recent Healing Runs list */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem' }}>
        
        {/* Rules column */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>LLM Pattern Registry</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {classifierRules.map((rule, idx) => (
              <div key={idx} style={{ padding: '10px', backgroundColor: 'var(--bg-dark)', borderRadius: '4px', borderLeft: '3px solid var(--primary)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>{rule.pattern}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  <span>{rule.classification}</span>
                  <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{rule.action}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Executions log column */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>Recent Auto-Remediation Executions</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {remediations.map(rem => (
              <div key={rem.id} style={{ padding: '10px', backgroundColor: 'var(--bg-dark)', borderRadius: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '0.8rem', color: 'var(--primary)' }}>{rem.id} - {rem.job}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{rem.timestamp} ({rem.duration})</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.3 }}>
                  {rem.log}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* 
        Colleague Integration Placeholder: AiLogPerformance
        -------------------------------------------------
        To integrate your colleague's custom module or AI orchestration tools here:
        1. Import the component (e.g., import ColleagueAiModule from './ColleagueAiModule';)
        2. Render it inside this container with the appropriate AI rules/remediations data props.
        
        Example:
        <div className="colleague-module-container" style={{ marginTop: '2rem', border: '1px dashed var(--border-light)', padding: '15px', borderRadius: '6px' }}>
          <h4 style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '8px' }}>Colleague AI Remediations Module</h4>
          Example: ColleagueAiModule remediations={remediations} stats={aiStats}
        </div>
      */}

    </div>
  );
}
