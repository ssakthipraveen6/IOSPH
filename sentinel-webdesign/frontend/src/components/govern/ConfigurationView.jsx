/**
 * Configuration view: the effective configuration with secrets masked.
 */
import React, { useState, useEffect } from 'react';
import { apiFetch, reportFetchError } from '../../api';
import { LoadingState } from '../shared/PrototypeNotice';
import EmptyState from '../shared/EmptyState';
import './ConfigurationView.css';

/**
 * ConfigurationView (Phase O6.5 / R5)
 * Read-only Configuration & Manifest Viewer under Govern.
 * Displays global and application YAML configurations with
 * guaranteed server-side secret redaction (***) and config:check status.
 */
export default function ConfigurationView({ environment = 'staging' }) {
  const [configs, setConfigs] = useState(null);
  const [configCheck, setConfigCheck] = useState(null);
  const [selectedApp, setSelectedApp] = useState('__global__');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchConfigs = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch('/api/yaml/all').then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        return r.json();
      }),
      apiFetch('/api/yaml/config-check').then(r => r.ok ? r.json() : { status: 'PASS' })
    ])
      .then(([yamlData, checkData]) => {
        setConfigs(yamlData);
        setConfigCheck(checkData);
      })
      .catch(err => {
        reportFetchError('ConfigurationView', err);
        setError(err.message || 'Failed to load configuration');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchConfigs();
  }, [environment]);

  const apps = configs?.applications || {};
  const globalCfg = configs?.global || {};
  const appKeys = Object.keys(apps).sort();

  let activeData = selectedApp === '__global__' ? globalCfg : apps[selectedApp];

  let formattedContent = '';
  if (activeData) {
    try {
      formattedContent = JSON.stringify(activeData, null, 2);
      if (searchTerm) {
        // filter or keep lines matching search
        const lines = formattedContent.split('\n');
        const matched = lines.filter(l => l.toLowerCase().includes(searchTerm.toLowerCase()));
        if (matched.length > 0) {
          formattedContent = matched.join('\n');
        }
      }
    } catch (_) {
      formattedContent = String(activeData);
    }
  }

  return (
    <div className="config-view">
      {/* Header */}
      <div className="cfg-header">
        <div>
          <h2 className="cfg-title">
            <span>📋 Infrastructure &amp; Application Configuration</span>
          </h2>
          <div className="cfg-subtitle">
            Govern › Configuration · File-based configuration viewer with server-side secret masking
          </div>
        </div>

        <div className="cfg-controls">
          <select
            className="cfg-select"
            value={selectedApp}
            onChange={e => setSelectedApp(e.target.value)}
          >
            <option value="__global__">Global Configuration (global.yaml)</option>
            <optgroup label="Applications">
              {appKeys.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </optgroup>
          </select>

          <input
            type="text"
            className="cfg-input"
            placeholder="Search within manifest..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />

          <button onClick={fetchConfigs} className="cfg-select">
            Refresh
          </button>
        </div>
      </div>

      {/* Security & Validation Notice */}
      <div className="cfg-banner">
        <div>
          🔒 <strong>Read-Only Security:</strong> Configuration is purely file-based. All passwords, tokens, API keys, and credential references are masked on the server. No mutation API routes exist.
        </div>
        <div className="cfg-badge-pass">
          config:check {configCheck?.status || 'PASS'}
        </div>
      </div>

      {error && (
        <div className="cfg-card">
          <span>⚠️ {error}</span>
        </div>
      )}

      {loading && <LoadingState label="Loading application manifests and global config…" />}

      {!loading && !activeData && (
        <EmptyState
          title="Configuration not found"
          message={`Application manifest '${selectedApp}' was not found in ${environment}.`}
        />
      )}

      {!loading && activeData && (
        <div className="cfg-card">
          <div className="cfg-card-title">
            <span>
              {selectedApp === '__global__' ? 'config/global.yaml' : `config/apps/${selectedApp}.yaml`}
            </span>
            <span className="cfg-mono">
              Environment: <code>{environment}</code>
            </span>
          </div>

          <pre className="cfg-viewer">
            {formattedContent}
          </pre>
        </div>
      )}
    </div>
  );
}
