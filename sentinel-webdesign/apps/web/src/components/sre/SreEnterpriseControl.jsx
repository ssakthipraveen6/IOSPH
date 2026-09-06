import React, { useState } from 'react';
import { getStatusColor } from '@sentinel/shared-constants';

export default function SreEnterpriseControl({ environment = 'prod' }) {
  const [activePillar, setActivePillar] = useState('all'); // 'all' | 'devops' | 'auto'

  const isProdOrStg = environment === 'prod' || environment === 'staging';

  // 1. DevOps & Platform Engineering Toolchain Data
  const demoToolchainCapacity = [
    { tool: 'Jenkins Master & Agents', metric: 'Runner Pool Saturation', current: '88% (44/50 active executors)', queueTime: '4m 12s avg wait', status: 'warning' },
    { tool: 'Artifactory Storage', metric: 'Primary SAN / S3 Fill Rate', current: '78.4 TB / 100 TB (78%)', queueTime: 'Est. 42 days to full', status: 'healthy' },
    { tool: 'Bitbucket Core', metric: 'Git Packfile Concurrency', current: '312 concurrent SSH/HTTPS clones', queueTime: 'Pool headroom: 48%', status: 'healthy' },
    { tool: 'Database Engine', metric: 'Active PG Connection Pool', current: '472 / 500 connections (94%)', queueTime: 'Lock wait avg: 14ms', status: 'critical' }
  ];

  const toolchainCapacity = isProdOrStg ? [
    { tool: 'Jenkins Master & Agents', metric: 'Runner Pool Saturation', current: 'Value Not Available', queueTime: 'Value Not Available', status: 'DATA_UNAVAILABLE' },
    { tool: 'Artifactory Storage', metric: 'Primary SAN / S3 Fill Rate', current: 'Value Not Available', queueTime: 'Value Not Available', status: 'DATA_UNAVAILABLE' },
    { tool: 'Bitbucket Core', metric: 'Git Packfile Concurrency', current: 'Value Not Available', queueTime: 'Value Not Available', status: 'DATA_UNAVAILABLE' },
    { tool: 'Database Engine', metric: 'Active PG Connection Pool', current: 'Value Not Available', queueTime: 'Value Not Available', status: 'DATA_UNAVAILABLE' }
  ] : demoToolchainCapacity;

  // 2. TLS Certificate & Secret Expiry Radar
  const demoCertificatesRadar = [
    { domain: 'bitbucket.internal.corp', issuer: 'DigiCert Corporate CA', expiresDays: 12, status: 'warning', autoRenew: 'HashiCorp Vault Cert Manager' },
    { domain: 'artifactory.internal.corp', issuer: 'DigiCert Corporate CA', expiresDays: 148, status: 'healthy', autoRenew: 'Let’s Encrypt Enterprise' },
    { domain: 'jenkins.internal.corp', issuer: 'Internal Root CA v3', expiresDays: 4, status: 'critical', autoRenew: 'Manual CAB Approval Required' },
    { domain: 'sonarqube.internal.corp', issuer: 'DigiCert Corporate CA', expiresDays: 92, status: 'healthy', autoRenew: 'Automated ACME' },
    { domain: 'vault.internal.corp', issuer: 'CyberArk Corporate Sub-CA', expiresDays: 28, status: 'warning', autoRenew: 'Managed PKI Engine' }
  ];

  const certificatesRadar = isProdOrStg ? [
    { domain: `bitbucket-${environment}.internal.corp`, issuer: 'DigiCert Corporate CA', expiresDays: 'Value Not Available', status: 'DATA_UNAVAILABLE', autoRenew: 'Value Not Available' },
    { domain: `artifactory-${environment}.internal.corp`, issuer: 'DigiCert Corporate CA', expiresDays: 'Value Not Available', status: 'DATA_UNAVAILABLE', autoRenew: 'Value Not Available' },
    { domain: `jenkins-${environment}.internal.corp`, issuer: 'Internal Root CA v3', expiresDays: 'Value Not Available', status: 'DATA_UNAVAILABLE', autoRenew: 'Value Not Available' },
    { domain: `sonarqube-${environment}.internal.corp`, issuer: 'DigiCert Corporate CA', expiresDays: 'Value Not Available', status: 'DATA_UNAVAILABLE', autoRenew: 'Value Not Available' },
    { domain: `vault-${environment}.internal.corp`, issuer: 'CyberArk Corporate Sub-CA', expiresDays: 'Value Not Available', status: 'DATA_UNAVAILABLE', autoRenew: 'Value Not Available' }
  ] : demoCertificatesRadar;

  return (
    <div className="sre-enterprise-control" style={{ animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* 1. Header Banner & Pillar Switcher */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '1.25rem',
        background: 'var(--bg-panel)',
        borderRadius: '12px',
        border: '1px solid var(--border-light)',
        marginBottom: '1.5rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.4rem' }}>🏛️</span>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--text-main)' }}>
              SRE &amp; Platform Command Control
            </h2>
            <span style={{
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#3b82f6',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '0.68rem',
              fontWeight: 800,
              letterSpacing: '0.5px'
            }}>
              GLOBAL MNC PLATFORM
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Mission-control oversight spanning platform toolchain capacity, certificate expiry countdowns, and 4-eyes autonomous governance.
          </p>
        </div>

        {/* Module Filter Buttons */}
        <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-panel-subtle)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
          {[
            { id: 'all', label: 'All Modules', icon: '🌐' },
            { id: 'devops', label: 'Platform & Toolchain', icon: '⚡' },
            { id: 'auto', label: 'Autonomous ROI & 4-Eyes', icon: '🤖' }
          ].map(btn => (
            <button
              key={btn.id}
              onClick={() => setActivePillar(btn.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                background: activePillar === btn.id ? 'var(--primary, #14b8a6)' : 'transparent',
                color: activePillar === btn.id ? '#041212' : 'var(--text-muted)',
                fontWeight: activePillar === btn.id ? 700 : 500,
                fontSize: '0.78rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{btn.icon}</span>
              <span>{btn.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODULE 1: PLATFORM ENGINEERING & TOOLCHAIN SATURATION                     */}
      {/* ========================================================================= */}
      {(activePillar === 'all' || activePillar === 'devops') && (
        <section style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.85rem' }}>
            <span style={{ fontSize: '1.2rem', color: '#38bdf8' }}>⚡</span>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, letterSpacing: '-0.2px', textTransform: 'uppercase', color: 'var(--text-main)' }}>
              DevOps &amp; Platform Engineering Toolchain Saturation
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.25rem' }}>
            
            {/* Toolchain Capacity Table */}
            <div style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-light)',
              borderRadius: '12px',
              padding: '1.25rem',
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  Platform Shared Services &amp; Runners
                </h4>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Real-time concurrency</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-light)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px 6px', fontWeight: 600 }}>Platform Shared Component</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600 }}>Saturation Metric</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600 }}>Current Utilization</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600 }}>Queue / Latency</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toolchainCapacity.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-light)', background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                        <td style={{ padding: '9px 6px', fontWeight: 700, color: 'var(--text-main)' }}>{item.tool}</td>
                        <td style={{ padding: '9px 6px', color: 'var(--text-muted)' }}>{item.metric}</td>
                        <td style={{ padding: '9px 6px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-main)' }}>{item.current}</td>
                        <td style={{ padding: '9px 6px', color: 'var(--text-muted)', fontSize: '0.72rem' }}>{item.queueTime}</td>
                        <td style={{ padding: '9px 6px' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '0.68rem',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            background: item.status === 'DATA_UNAVAILABLE' ? 'rgba(148, 163, 184, 0.15)' : `${getStatusColor(item.status)}26`,
                            color: item.status === 'DATA_UNAVAILABLE' ? '#94a3b8' : getStatusColor(item.status)
                          }}>
                            ● {item.status === 'DATA_UNAVAILABLE' ? 'Value Not Available' : item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* TLS & Secrets Expiry Countdown */}
            <div style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-light)',
              borderRadius: '12px',
              padding: '1.25rem',
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  TLS Certificates &amp; Secrets Expiry Radar
                </h4>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Automated rotation tracking</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-light)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px', fontWeight: 600 }}>Domain / Service</th>
                      <th style={{ padding: '8px', fontWeight: 600 }}>Issuing Authority</th>
                      <th style={{ padding: '8px', fontWeight: 600 }}>Days to Expiry</th>
                      <th style={{ padding: '8px', fontWeight: 600 }}>Automation Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {certificatesRadar.map((cert, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-main)' }}>{cert.domain}</td>
                        <td style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '0.72rem' }}>{cert.issuer}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: cert.status === 'DATA_UNAVAILABLE' ? 'rgba(148, 163, 184, 0.15)' : `${getStatusColor(cert.status)}33`,
                            color: cert.status === 'DATA_UNAVAILABLE' ? '#94a3b8' : getStatusColor(cert.status)
                          }}>
                            {cert.expiresDays === 'Value Not Available' ? 'Value Not Available' : `${cert.expiresDays} days`}
                          </span>
                        </td>
                        <td style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '0.7rem' }}>{cert.autoRenew}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* MODULE 2: AUTONOMOUS OPERATIONS ROI & 4-EYES APPROVAL GATE              */}
      {/* ========================================================================= */}
      {(activePillar === 'all' || activePillar === 'auto') && (
        <section style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.85rem' }}>
            <span style={{ fontSize: '1.2rem', color: '#8b5cf6' }}>🤖</span>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, letterSpacing: '-0.2px', textTransform: 'uppercase', color: 'var(--text-main)' }}>
              Autonomous Operations ROI &amp; 4-Eyes Security Gate
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.25rem' }}>
            
            {/* Remediation Playbook ROI */}
            <div style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-light)',
              borderRadius: '12px',
              padding: '1.25rem',
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    Self-Healing ROI &amp; MTTR Comparison
                  </h4>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Demonstrates measurable value of autonomous recovery runbooks
                  </span>
                </div>
                <span style={{
                  background: isProdOrStg ? 'rgba(148, 163, 184, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                  color: isProdOrStg ? '#94a3b8' : '#10b981',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '0.68rem',
                  fontWeight: 800
                }}>
                  {isProdOrStg ? 'Value Not Available' : '94.6% AUTONOMOUS SUCCESS'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '1rem' }}>
                <div style={{ padding: '10px', background: 'var(--bg-panel-subtle)', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: isProdOrStg ? '0.85rem' : '1.3rem', fontWeight: 800, color: isProdOrStg ? 'var(--text-muted)' : 'var(--sentinel-teal, #14b8a6)', fontFamily: 'var(--font-mono)' }}>
                    {isProdOrStg ? 'Value Not Available' : '142'}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Auto-Healed This Month</div>
                </div>
                <div style={{ padding: '10px', background: 'var(--bg-panel-subtle)', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: isProdOrStg ? '0.85rem' : '1.3rem', fontWeight: 800, color: isProdOrStg ? 'var(--text-muted)' : '#10b981', fontFamily: 'var(--font-mono)' }}>
                    {isProdOrStg ? 'Value Not Available' : '71.4 hrs'}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Engineer Hours Saved</div>
                </div>
                <div style={{ padding: '10px', background: 'var(--bg-panel-subtle)', borderRadius: '8px', textAlign: 'center', border: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: isProdOrStg ? '0.85rem' : '1.3rem', fontWeight: 800, color: isProdOrStg ? 'var(--text-muted)' : '#f59e0b', fontFamily: 'var(--font-mono)' }}>
                    {isProdOrStg ? 'Value Not Available' : '34 sec'}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Avg Auto-MTTR (vs 45m manual)</div>
                </div>
              </div>

              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                💡 <em>{isProdOrStg ? 'Live self-healing telemetry not connected for this environment.' : 'Autonomous runbooks have successfully averted 14 P1 escalations this quarter without human pageout.'}</em>
              </div>
            </div>

            {/* Central Governance & Authoritative 4-Eyes Signoff Pointer */}
            <div style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-light)',
              borderRadius: '12px',
              padding: '1.25rem',
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    Enterprise 4-Eyes Dual Authorization Governance
                  </h4>
                  <span style={{
                    background: 'rgba(59, 130, 246, 0.15)',
                    color: 'var(--primary)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.68rem',
                    fontWeight: 700
                  }}>
                    SOC 2 / ISO 27001
                  </span>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.4', margin: '0 0 1rem 0' }}>
                  Production failovers, ingress traffic reroutes, and container cluster drains require two independent privileged signoffs. All live approval queues and pending dual-authorization tickets are centralized under <strong>Autonomous Healing &amp; Operations</strong>.
                </p>
              </div>

              <div style={{
                padding: '10px 14px',
                background: 'var(--bg-panel-subtle)',
                border: '1px solid var(--border-light)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.76rem', color: 'var(--text-main)' }}>
                  <span>🔒</span>
                  <span>Authoritative Queue: <strong>Live Recovery Orchestrator</strong></span>
                </div>
                <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700 }}>
                  Active &amp; Enforced
                </span>
              </div>
            </div>

          </div>
        </section>
      )}

    </div>
  );
}
