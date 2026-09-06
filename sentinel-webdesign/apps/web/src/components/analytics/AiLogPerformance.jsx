import React, { useState, useEffect } from 'react';
import SelfRunbook from '../sre/SelfRunbook';
import { MAINTENANCE_CONFIG } from '../../maintenanceConfig';
import { MaintenanceBadge, MaintenanceBanner } from '../shared/MaintenanceNotice';
import { SEVERITY } from '@sentinel/shared-constants';

const classifierRules = [
  { pattern: '/OOMKilled|OutOfMemoryError/i', classification: 'Memory Leak Outage', severity: SEVERITY.CRITICAL, action: 'artifactory-jvm-recycle' },
  { pattern: '/No space left on device/i', classification: 'Disk Space Exhausted', severity: SEVERITY.CRITICAL, action: 'nas-log-purge' },
  { pattern: '/Database connection pool saturated/i', classification: 'TCP Pool Saturation', severity: SEVERITY.CRITICAL, action: 'db-connection-flush' },
  { pattern: '/Ingress network bottleneck/i', classification: 'Traffic Gateway Saturation', severity: SEVERITY.WARNING, action: 'avi-ingress-scale' }
];

export default function AiLogPerformance({ onSimulate, environment = 'staging' }) {
  const currentEnv = environment || 'staging';

  const jenkinsEndpoint = currentEnv === 'prod' 
    ? 'https://jenkins-prod.internal.corp/job' 
    : (currentEnv === 'demo' ? 'https://jenkins-demo.internal.corp/job' : 'https://jenkins-stg.internal.corp/job');

  const remediationsByEnv = {
    prod: [],
    staging: [],
    demo: [
      { id: "RUN-DEMO-01", timestamp: "2026-08-30 12:00:00", job: "artifactory-jvm-recycle", target: "artifactory", status: "Success", duration: "12.5s", log: "[DEMO] Davis AI Anomaly Trigger: Autonomous self-healing stabilized JVM Heap to 18ms SLA." }
    ]
  };

  const remediations = (currentEnv === 'prod' || currentEnv === 'staging') ? [] : (remediationsByEnv[currentEnv] || []);

  const [aiStats, setAiStats] = useState({
    scanThroughput: 840,
    accuracy: 99.8,
    latency: 1.2,
    queueSize: 0
  });

  useEffect(() => {
    const generateStats = () => {
      setAiStats({
        scanThroughput: currentEnv === 'prod' ? 1250 : 800 + Math.floor(Math.random() * 80),
        accuracy: 99.9,
        latency: parseFloat((1.0 + Math.random() * 0.2).toFixed(2)),
        queueSize: 0
      });
    };

    generateStats();
    const interval = setInterval(generateStats, 5000);
    return () => clearInterval(interval);
  }, [currentEnv]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header */}
      <div className="console-panel" style={{ padding: '1.25rem' }}>
        <div className="panel-header">
          <h3>
            ⚙️ Auto Remediation Engine & LLM Telemetry ({currentEnv.toUpperCase()})
            {MAINTENANCE_CONFIG.pages.aiLogPerformance && <MaintenanceBadge />}
          </h3>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '4px' }}>
          This view tracks the live status of the autonomous healing engine, including integration tokens with the remote CloudBees Jenkins orchestrator pool, LLM processing diagnostic speeds, and recovery workflow execution logs for {currentEnv.toUpperCase()}.
        </p>
      </div>

      {/* Connection Registry and KPI Block */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        
        {/* Connection status card */}
        <div className="console-panel" style={{ padding: '1.25rem' }}>
          <div className="panel-header" style={{ marginBottom: '1rem' }}>
            <h3>Jenkins Orchestrator Pool Connection</h3>
            <span className="badge-teal">CONNECTED ({currentEnv.toUpperCase()})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>CloudBees CJOC Endpoint:</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{jenkinsEndpoint}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Authentication Provider:</span>
              <span style={{ fontWeight: 600 }}>SSO Gateway / LDAP Auth</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Remediation API Crumb Token:</span>
              <span style={{ color: '#10b981', fontWeight: 600 }}>Configured ✓ (CyberArk Vaulted)</span>
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
            <span className={currentEnv === 'demo' ? "badge-teal" : "badge-gray"} style={{
              background: currentEnv === 'demo' ? 'rgba(20, 184, 166, 0.2)' : 'rgba(148, 163, 184, 0.15)',
              color: currentEnv === 'demo' ? '#14b8a6' : '#94a3b8',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.68rem',
              fontWeight: 800
            }}>
              {currentEnv === 'demo' ? 'ACTIVE' : 'STANDBY (LIVE EXPORTER OFFLINE)'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: currentEnv === 'demo' ? '1.2rem' : '0.85rem', fontWeight: 'bold', color: currentEnv === 'demo' ? 'var(--primary)' : 'var(--text-muted)' }}>
                {currentEnv === 'demo' ? `${aiStats.scanThroughput} logs/s` : 'Value Not Available'}
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Log Ingestion Rate</span>
            </div>
            <div>
              <div style={{ fontSize: currentEnv === 'demo' ? '1.2rem' : '0.85rem', fontWeight: 'bold', color: currentEnv === 'demo' ? 'var(--primary)' : 'var(--text-muted)' }}>
                {currentEnv === 'demo' ? `${aiStats.accuracy}%` : 'Value Not Available'}
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>LLM Classification Accuracy</span>
            </div>
            <div>
              <div style={{ fontSize: currentEnv === 'demo' ? '1.2rem' : '0.85rem', fontWeight: 'bold', color: currentEnv === 'demo' ? 'var(--primary)' : 'var(--text-muted)' }}>
                {currentEnv === 'demo' ? `${aiStats.latency} ms` : 'Value Not Available'}
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Inference Ingestion Delay</span>
            </div>
            <div>
              <div style={{ fontSize: currentEnv === 'demo' ? '1.2rem' : '0.85rem', fontWeight: 'bold', color: currentEnv === 'demo' ? 'var(--primary)' : 'var(--text-muted)' }}>
                {currentEnv === 'demo' ? `${aiStats.queueSize} items` : 'Value Not Available'}
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Async Queue Depth</span>
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
            {remediations.length === 0 ? (
              <div style={{ padding: '10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>Value Not Available</div>
            ) : (
              remediations.map(rem => (
                <div key={rem.id} style={{ padding: '10px', backgroundColor: 'var(--bg-dark)', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '0.8rem', color: 'var(--primary)' }}>{rem.id} - {rem.job}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{rem.timestamp} ({rem.duration})</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.3 }}>
                    {rem.log}
                  </div>
                </div>
              ))
            )}
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
      {/* Embedded Self-Healing Runbooks Registry */}
      <SelfRunbook onSimulate={onSimulate} />

    </div>
  );
}
