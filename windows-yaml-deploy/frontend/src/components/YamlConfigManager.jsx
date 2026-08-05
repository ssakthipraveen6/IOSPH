import React, { useState, useEffect } from 'react';
import { MAINTENANCE_CONFIG } from '../maintenanceConfig';
import { MaintenanceBadge, MaintenanceBanner } from './MaintenanceNotice';

export default function YamlConfigManager() {
  const [applications, setApplications] = useState({});
  const [selectedApp, setSelectedApp] = useState(null); // null = global_config.yaml
  const [rawYaml, setRawYaml] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [prData, setPrData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');

  useEffect(() => {
    fetchApps();
    loadYaml(null);
  }, []);

  const fetchApps = async () => {
    try {
      const res = await fetch('/api/yaml/all');
      if (res.ok) {
        const data = await res.json();
        setApplications(data.applications || {});
      }
    } catch (err) {
      console.error('Failed fetching YAML apps:', err);
    }
  };

  const loadYaml = async (appId) => {
    setSelectedApp(appId);
    setStatusMessage('');
    setPrData(null);
    setLoading(true);
    try {
      const url = appId ? `/api/yaml/raw?appId=${appId}` : '/api/yaml/raw';
      const res = await fetch(url);
      const data = await res.json();
      setRawYaml(data.yaml || '');
      setCommitMsg(`Config Update: Update ${appId ? `applications/${appId}.yaml` : 'global_config.yaml'}`);
    } catch (err) {
      setStatusMessage(`❌ Error loading YAML: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAndCreatePR = async () => {
    setStatusMessage('Creating GitOps Bitbucket Pull Request...');
    setPrData(null);
    try {
      const res = await fetch('/api/yaml/raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: selectedApp,
          rawYaml: rawYaml,
          author: 'DevSecOps Admin',
          commitMessage: commitMsg
        })
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage('✅ Configuration saved & Bitbucket GitOps PR generated successfully!');
        setPrData({
          prId: data.prId,
          prUrl: data.prUrl,
          branchName: data.branchName,
          filePath: data.filePath
        });
        fetchApps();
      } else {
        setStatusMessage(`❌ Syntax/GitOps Error: ${data.error}`);
      }
    } catch (err) {
      setStatusMessage(`❌ Error creating PR: ${err.message}`);
    }
  };

  const appKeys = Object.keys(applications);

  return (
    <div className="yaml-manager-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="section-header-group">
        <h3 className="section-subtitle">GITOPS AUTOMATION ENGINE</h3>
        <h2 className="section-title">
          YAML Configuration Manager & Bitbucket PR Generator
          {MAINTENANCE_CONFIG.pages.yamlConfigManager && <MaintenanceBadge />}
        </h2>
        <p className="section-description">
          Declarative application topology. Updating configuration automatically creates a feature branch, commits changes, and opens a Bitbucket Pull Request for peer review & Jenkins CI validation.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.5rem', minHeight: '600px' }}>
        {/* Sidebar */}
        <div className="console-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>
            GLOBAL CONFIGURATION
          </div>
          <button
            className={`btn-action ${selectedApp === null ? 'primary' : 'secondary'}`}
            style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-start', padding: '0.75rem 1rem' }}
            onClick={() => loadYaml(null)}
          >
            ⚙️ global_config.yaml
          </button>

          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.5px', marginTop: '1rem', marginBottom: '0.25rem' }}>
            APPLICATIONS DECLARATIONS ({appKeys.length})
          </div>
          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '480px' }}>
            {appKeys.map(appId => (
              <button
                key={appId}
                className={`btn-action ${selectedApp === appId ? 'primary' : 'secondary'}`}
                style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-start', padding: '0.6rem 0.8rem', fontSize: '0.82rem' }}
                onClick={() => loadYaml(appId)}
              >
                <span>📄 {appId}.yaml</span>
              </button>
            ))}
          </div>
        </div>

        {/* YAML Editor Panel */}
        <div className="console-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h4 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.1rem' }}>
                Editing: <code style={{ color: 'var(--primary)' }}>{selectedApp ? `applications/${selectedApp}.yaml` : 'global_config.yaml'}</code>
              </h4>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-action primary" onClick={handleSaveAndCreatePR} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                🚀 Save & Create Bitbucket PR
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Commit Msg:</span>
            <input 
              type="text" 
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              style={{ flex: 1, padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-main)', fontSize: '0.85rem' }}
            />
          </div>

          {statusMessage && (
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              fontWeight: 500,
              fontSize: '0.88rem',
              background: statusMessage.includes('❌') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              color: statusMessage.includes('❌') ? '#ef4444' : '#10b981',
              border: statusMessage.includes('❌') ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)'
            }}>
              {statusMessage}
            </div>
          )}

          {/* Bitbucket Pull Request GitOps Banner */}
          {prData && (
            <div style={{
              padding: '1rem 1.25rem',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(139, 92, 246, 0.15))',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  🔀 BITBUCKET GITOPS PULL REQUEST OPENED (PR #{prData.prId})
                </span>
                <a 
                  href={prData.prUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{
                    background: 'var(--primary)',
                    color: 'white',
                    padding: '0.4rem 0.9rem',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)'
                  }}
                >
                  View PR in Bitbucket ↗
                </a>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div><strong>Branch:</strong> <code style={{ color: 'var(--accent-cyan)' }}>{prData.branchName}</code></div>
                <div><strong>Target File:</strong> <code style={{ color: 'var(--accent-cyan)' }}>{prData.filePath}</code></div>
              </div>
            </div>
          )}

          <textarea
            style={{
              flex: 1,
              width: '100%',
              minHeight: '420px',
              fontFamily: "'Fira Code', 'Consolas', monospace",
              fontSize: '0.9rem',
              padding: '1.25rem',
              borderRadius: '8px',
              background: '#090d16',
              color: '#e2e8f0',
              border: '1px solid var(--border-color)',
              lineHeight: '1.5',
              outline: 'none',
              resize: 'vertical'
            }}
            value={rawYaml}
            onChange={(e) => setRawYaml(e.target.value)}
            disabled={loading}
            placeholder="Loading YAML..."
          />
        </div>
      </div>
    </div>
  );
}
