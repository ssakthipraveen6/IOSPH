import React, { useState, useEffect, useRef } from 'react';
import { MAINTENANCE_CONFIG } from '../maintenanceConfig';
import { MaintenanceBadge } from './MaintenanceNotice';

export default function MiscOperations({ environment }) {
  const [mainTab, setMainTab] = useState('rota'); // 'rota' | 'dynatrace'
  const [selectedRotaCategory, setSelectedRotaCategory] = useState('core'); // 'core' | 'bau' | 'montreal'
  const [allRotas, setAllRotas] = useState(null);
  const [dynatraceProblems, setDynatraceProblems] = useState([]);
  const [loadingRota, setLoadingRota] = useState(true);
  const [loadingDynatrace, setLoadingDynatrace] = useState(false);
  const [showAddShiftModal, setShowAddShiftModal] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const fileInputRef = useRef(null);

  // New shift form state
  const [newShift, setNewShift] = useState({
    Date: new Date().toISOString().split('T')[0],
    Day: 'Mon',
    shiftName: '',
    primaryOnCall: '',
    secondaryOnCall: '',
    escalationManager: '',
    location: 'Global Hub',
    notes: ''
  });

  useEffect(() => {
    fetchRotas();
    fetchDynatraceProblems();
  }, [environment]);

  const fetchRotas = async () => {
    setLoadingRota(true);
    try {
      const res = await fetch('/api/misc/rota');
      if (res.ok) {
        const data = await res.json();
        setAllRotas(data);
      }
    } catch (err) {
      console.error('Failed to fetch team rotas:', err);
    } finally {
      setLoadingRota(false);
    }
  };

  const fetchDynatraceProblems = async () => {
    setLoadingDynatrace(true);
    try {
      const res = await fetch(`/api/misc/dynatrace-problems?environment=${encodeURIComponent(environment || 'staging')}`);
      if (res.ok) {
        const data = await res.json();
        setDynatraceProblems(data.problems || []);
      }
    } catch (err) {
      console.error('Failed to fetch Dynatrace problems:', err);
    } finally {
      setLoadingDynatrace(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setUploadingFile(true);
    showToast(`⏳ Parsing & Uploading Monthly Excel Rota for [${selectedRotaCategory.toUpperCase()}]...`);

    try {
      const res = await fetch(`/api/misc/rota/upload?category=${selectedRotaCategory}`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setAllRotas(data.rotas);
        showToast(`✅ Successfully updated monthly table from Excel for [${selectedRotaCategory.toUpperCase()}]!`);
      } else {
        showToast(`❌ Upload failed: ${data.error}`);
      }
    } catch (err) {
      showToast(`❌ Network error uploading file: ${err.message}`);
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownloadTemplate = () => {
    window.open(`/api/misc/rota/template?category=${selectedRotaCategory}`, '_blank');
  };

  const handleAddShiftSubmit = async (e) => {
    e.preventDefault();
    if (!newShift.shiftName || !newShift.primaryOnCall) {
      alert('Please provide Shift Name and Primary On-Call Engineer.');
      return;
    }

    try {
      const res = await fetch(`/api/misc/rota/shift?category=${selectedRotaCategory}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Date: newShift.Date,
          Day: newShift.Day,
          shiftName: newShift.shiftName,
          primaryOnCall: newShift.primaryOnCall,
          secondaryOnCall: newShift.secondaryOnCall,
          escalationManager: newShift.escalationManager,
          "Location / Hub": newShift.location,
          "Handover Notes": newShift.notes
        })
      });
      if (res.ok) {
        const updated = await res.json();
        setAllRotas(updated);
        setShowAddShiftModal(false);
        setNewShift({
          Date: new Date().toISOString().split('T')[0],
          Day: 'Mon',
          shiftName: '',
          primaryOnCall: '',
          secondaryOnCall: '',
          escalationManager: '',
          location: 'Global Hub',
          notes: ''
        });
        showToast(`✅ New shift record added to [${selectedRotaCategory.toUpperCase()}] monthly table!`);
      }
    } catch (err) {
      showToast(`❌ Error saving shift: ${err.message}`);
    }
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4500);
  };

  const activeRota = allRotas ? allRotas[selectedRotaCategory] : null;
  const rawRows = activeRota?.tableRows || [];

  // Filter rows based on search and status
  const filteredRows = rawRows.filter(row => {
    const matchesSearch = Object.values(row).some(val => 
      String(val).toLowerCase().includes(searchQuery.toLowerCase())
    );
    if (!matchesSearch) return false;

    if (statusFilter === 'ACTIVE') {
      return String(row['Status'] || '').toUpperCase().includes('ACTIVE');
    }
    if (statusFilter === 'SCHEDULED') {
      return String(row['Status'] || '').toUpperCase().includes('SCHEDULED');
    }
    if (statusFilter === 'COMPLETED') {
      return String(row['Status'] || '').toUpperCase().includes('COMPLETED');
    }
    return true;
  });

  // Extract columns dynamically from the rows
  const tableColumns = rawRows.length > 0 ? Object.keys(rawRows[0]) : [
    'Date', 'Day', 'Shift Name', 'Primary On-Call', 'Secondary On-Call', 'Escalation Manager', 'Location / Hub', 'Status', 'Handover Notes'
  ];

  const getSeverityStyle = (severity) => {
    switch (severity) {
      case 'AVAILABILITY':
      case 'ERROR':
        return { bg: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' };
      case 'PERFORMANCE':
      case 'RESOURCE_CONTENTION':
        return { bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' };
      default:
        return { bg: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)' };
    }
  };

  return (
    <div className="misc-operations-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header */}
      <div className="section-header-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 className="section-subtitle">OPERATIONS & OBSERVABILITY MISCELLANEOUS HUB</h3>
            <h2 className="section-title">
              Monthly Team On-Call Rota (Excel Sync) & Dynatrace Problems
              {MAINTENANCE_CONFIG?.pages?.miscOperations && <MaintenanceBadge />}
            </h2>
            <p className="section-description">
              Full month tabular shift schedule with dynamic Excel spreadsheet upload/export, multi-tier roster categories (Core SRE, BAU Platform Support, and Montreal Hub), and live Dynatrace Davis AI problem feeds.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="nav-tab-group" style={{ display: 'flex', gap: '6px', background: 'var(--bg-panel)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
              <button
                className={`nav-tab-btn ${mainTab === 'rota' ? 'active' : ''}`}
                style={{
                  padding: '0.45rem 1.1rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  background: mainTab === 'rota' ? 'var(--primary)' : 'transparent',
                  color: mainTab === 'rota' ? '#ffffff' : 'var(--text-muted)'
                }}
                onClick={() => setMainTab('rota')}
              >
                📊 Monthly Team Rota Table ({rawRows.length} Days)
              </button>
              <button
                className={`nav-tab-btn ${mainTab === 'dynatrace' ? 'active' : ''}`}
                style={{
                  padding: '0.45rem 1.1rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  background: mainTab === 'dynatrace' ? 'var(--primary)' : 'transparent',
                  color: mainTab === 'dynatrace' ? '#ffffff' : 'var(--text-muted)'
                }}
                onClick={() => setMainTab('dynatrace')}
              >
                ⚡ Dynatrace Active Problems ({dynatraceProblems.length})
              </button>
            </div>

            {mainTab === 'dynatrace' && (
              <button
                className="btn-action secondary"
                onClick={fetchDynatraceProblems}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', padding: '0.5rem 0.9rem' }}
              >
                🔄 Refresh Problems
              </button>
            )}
          </div>
        </div>
      </div>

      {toastMessage && (
        <div style={{
          padding: '0.75rem 1.25rem',
          borderRadius: '8px',
          background: toastMessage.includes('❌') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
          color: toastMessage.includes('❌') ? '#ef4444' : '#10b981',
          border: toastMessage.includes('❌') ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
          fontWeight: 600,
          fontSize: '0.85rem'
        }}>
          {toastMessage}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: FULL MONTH EXCEL ROTA TABLE VIEWER                                */}
      {/* ========================================================================= */}
      {mainTab === 'rota' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Top Control Bar: Category Selector & Excel Actions */}
          <div className="console-panel" style={{ padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            {/* 3 Rota Pills: Core, BAU, Montreal */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginRight: '4px' }}>
                Roster:
              </span>
              <button
                onClick={() => setSelectedRotaCategory('core')}
                style={{
                  padding: '0.45rem 1rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: selectedRotaCategory === 'core' ? '1px solid var(--primary)' : '1px solid var(--border-light)',
                  background: selectedRotaCategory === 'core' ? 'var(--primary)' : 'var(--bg-dark)',
                  color: selectedRotaCategory === 'core' ? '#ffffff' : 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                🔥 Core 24/7 SRE Rota
              </button>
              <button
                onClick={() => setSelectedRotaCategory('bau')}
                style={{
                  padding: '0.45rem 1rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: selectedRotaCategory === 'bau' ? '1px solid #10b981' : '1px solid var(--border-light)',
                  background: selectedRotaCategory === 'bau' ? '#10b981' : 'var(--bg-dark)',
                  color: selectedRotaCategory === 'bau' ? '#ffffff' : 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                🛠️ BAU Operations Rota
              </button>
              <button
                onClick={() => setSelectedRotaCategory('montreal')}
                style={{
                  padding: '0.45rem 1rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: selectedRotaCategory === 'montreal' ? '1px solid #f59e0b' : '1px solid var(--border-light)',
                  background: selectedRotaCategory === 'montreal' ? '#f59e0b' : 'var(--bg-dark)',
                  color: selectedRotaCategory === 'montreal' ? '#ffffff' : 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                🍁 Montreal Regional Rota
              </button>
            </div>

            {/* Excel Upload & Download Actions */}
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <input
                type="file"
                ref={fileInputRef}
                accept=".xlsx, .xls, .csv"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
              
              <button
                className="btn-action secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
                title="Upload full month Excel spreadsheet (.xlsx, .xls, .csv)"
              >
                📁 Upload Excel Table
              </button>

              <button
                className="btn-action secondary"
                onClick={handleDownloadTemplate}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
                title="Download full month Excel spreadsheet"
              >
                📥 Download Monthly Excel
              </button>

              <button
                className="btn-action primary"
                onClick={() => setShowAddShiftModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
              >
                ➕ Add Shift Row
              </button>
            </div>
          </div>

          {/* Search, Filters, and Table Statistics */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', background: 'var(--bg-dark)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flex: 1, minWidth: '300px' }}>
              <input
                type="text"
                placeholder="🔍 Search by engineer name, date (e.g. 2026-08-30), shift, or notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-main)',
                  fontSize: '0.82rem'
                }}
              />

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-main)',
                  fontSize: '0.82rem'
                }}
              >
                <option value="ALL">Status: All Shifts ({rawRows.length})</option>
                <option value="ACTIVE">🔴 Active Today Only</option>
                <option value="SCHEDULED">📅 Scheduled</option>
                <option value="COMPLETED">✅ Completed</option>
              </select>
            </div>

            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: '12px' }}>
              <span>Total Days: <strong style={{ color: 'var(--primary)' }}>{rawRows.length}</strong></span>
              <span>Showing: <strong style={{ color: '#10b981' }}>{filteredRows.length}</strong></span>
              <span>Roster: <strong style={{ color: 'var(--text-main)' }}>{activeRota?.name}</strong></span>
            </div>
          </div>

          {/* Full Month Excel Spreadsheet Table */}
          <div className="metrics-panel-card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', maxHeight: '640px' }}>
              <table className="sentinel-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#0b1120', zIndex: 10, borderBottom: '2px solid var(--border-color)' }}>
                  <tr>
                    {tableColumns.map((col, idx) => (
                      <th 
                        key={idx} 
                        style={{ 
                          padding: '12px 14px', 
                          color: 'var(--accent-cyan)', 
                          fontWeight: 800, 
                          textTransform: 'uppercase', 
                          letterSpacing: '0.5px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingRota ? (
                    <tr>
                      <td colSpan={tableColumns.length} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Loading full month schedule...
                      </td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={tableColumns.length} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {searchQuery ? `No records match the search filter "${searchQuery}".` : 'Data Not Available'}
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row, rIdx) => {
                      const isToday = String(row['Status'] || '').toUpperCase().includes('ACTIVE') || String(row['Date'] || '').includes('2026-08-30');
                      return (
                        <tr 
                          key={rIdx}
                          style={{
                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                            background: isToday ? 'rgba(59, 130, 246, 0.12)' : (rIdx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent'),
                            borderLeft: isToday ? '4px solid #ef4444' : '4px solid transparent',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {tableColumns.map((col, cIdx) => {
                            const val = row[col];
                            const isStatus = col.toLowerCase() === 'status';
                            const isDate = col.toLowerCase() === 'date';
                            const isPrimary = col.toLowerCase().includes('primary');

                            return (
                              <td 
                                key={cIdx} 
                                style={{ 
                                  padding: '10px 14px', 
                                  whiteSpace: col.toLowerCase().includes('notes') ? 'normal' : 'nowrap',
                                  maxWidth: col.toLowerCase().includes('notes') ? '340px' : 'none',
                                  fontWeight: isToday ? 700 : 400
                                }}
                              >
                                {isStatus ? (
                                  <span style={{
                                    padding: '3px 8px',
                                    borderRadius: '4px',
                                    fontSize: '0.7rem',
                                    fontWeight: 800,
                                    background: isToday ? 'rgba(239, 68, 68, 0.2)' : String(val).includes('Completed') ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.08)',
                                    color: isToday ? '#ef4444' : String(val).includes('Completed') ? '#10b981' : 'var(--text-muted)',
                                    border: isToday ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255,255,255,0.1)'
                                  }}>
                                    {val || (isToday ? 'ACTIVE TODAY' : 'Scheduled')}
                                  </span>
                                ) : isDate ? (
                                  <span style={{ fontFamily: 'var(--font-mono)', color: isToday ? 'var(--primary)' : 'var(--text-main)', fontWeight: 700 }}>
                                    {val}
                                  </span>
                                ) : isPrimary ? (
                                  <span style={{ color: 'var(--text-main)', fontWeight: 700 }}>
                                    {val}
                                  </span>
                                ) : (
                                  <span style={{ color: isToday ? 'var(--text-main)' : 'var(--text-muted)' }}>
                                    {val || '—'}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: DYNATRACE ACTIVE OPEN PROBLEMS INTEGRATION                        */}
      {/* ========================================================================= */}
      {mainTab === 'dynatrace' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="metrics-panel-card" style={{ padding: '1.5rem' }}>
            <div className="panel-header" style={{ marginBottom: '1.25rem' }}>
              <div>
                <h3>Dynatrace Active Open Problems (Davis AI Real-Time Feed)</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Real-time problem events synchronized directly from Dynatrace API v2 (<code>/api/v2/problems?problemSelector=status("OPEN")</code>).
                </p>
              </div>
              <span className="panel-badge-green">Sync Active</span>
            </div>

            {loadingDynatrace ? (
              <div className="command-center-loading-card">
                <h3>Querying Dynatrace API v2 Problems Feed...</h3>
              </div>
            ) : dynatraceProblems.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#10b981', background: 'rgba(16, 185, 129, 0.05)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                <h3>🎉 No Active Open Problems in Dynatrace</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>All monitored services, applications, and infrastructure hosts are performing within SLA thresholds.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {dynatraceProblems.map((prob) => {
                  const sevStyle = getSeverityStyle(prob.severityLevel);
                  return (
                    <div 
                      key={prob.problemId} 
                      style={{
                        padding: '1.25rem',
                        borderRadius: '8px',
                        background: 'var(--bg-dark)',
                        border: sevStyle.border,
                        borderLeft: `4px solid ${sevStyle.color}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ 
                            padding: '3px 8px', 
                            borderRadius: '4px', 
                            fontSize: '0.7rem', 
                            fontWeight: 800, 
                            background: sevStyle.bg, 
                            color: sevStyle.color 
                          }}>
                            {prob.severityLevel}
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.8rem', color: 'var(--primary)' }}>
                            {prob.displayId || prob.problemId}
                          </span>
                          <span className="badge-gray" style={{ fontSize: '0.7rem' }}>
                            {prob.managementZone || 'Global Zone'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Opened: {new Date(prob.startTime).toLocaleTimeString()}
                          </span>
                          {prob.remediationUrl && (
                            <a 
                              href={prob.remediationUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                background: 'rgba(59, 130, 246, 0.15)',
                                color: 'var(--primary)',
                                border: '1px solid rgba(59, 130, 246, 0.3)',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                textDecoration: 'none',
                                fontSize: '0.75rem',
                                fontWeight: 600
                              }}
                            >
                              Dynatrace Portal ↗
                            </a>
                          )}
                        </div>
                      </div>

                      <h4 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                        {prob.title}
                      </h4>

                      {prob.davisAiSummary && (
                        <div style={{ 
                          fontSize: '0.8rem', 
                          color: 'var(--text-main)', 
                          background: 'rgba(255,255,255,0.03)', 
                          padding: '8px 12px', 
                          borderRadius: '4px', 
                          border: '1px solid var(--border-light)' 
                        }}>
                          <strong>🧠 Davis AI Root Cause:</strong> {prob.davisAiSummary}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        <div>
                          <strong>Impacted Entities:</strong> {(prob.affectedEntities || []).map(e => e.name).join(', ') || 'Cluster Components'}
                        </div>
                        {prob.rootCauseEntity && (
                          <div>
                            <strong>Root Cause Entity:</strong> <code style={{ color: '#ef4444' }}>{prob.rootCauseEntity.name}</code>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD SHIFT ROW TO MONTHLY EXCEL TABLE                               */}
      {/* ========================================================================= */}
      {showAddShiftModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '2rem',
            width: '90%',
            maxWidth: '560px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
          }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
              ➕ Add Shift Row to [{selectedRotaCategory.toUpperCase()}] Table
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Enter date, shift designation, and assigned on-call team members for this monthly record.
            </p>

            <form onSubmit={handleAddShiftSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Shift Date
                  </label>
                  <input
                    type="date"
                    value={newShift.Date}
                    onChange={(e) => {
                      const d = new Date(e.target.value);
                      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                      setNewShift({ ...newShift, Date: e.target.value, Day: days[d.getDay()] || 'Mon' });
                    }}
                    style={{ width: '100%', padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-main)' }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Day of Week
                  </label>
                  <input
                    type="text"
                    value={newShift.Day}
                    readOnly
                    style={{ width: '100%', padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Shift Name / Designation
                </label>
                <input
                  type="text"
                  placeholder="e.g. APAC Morning Escalation (06:00-14:30 SGT)"
                  value={newShift.shiftName}
                  onChange={(e) => setNewShift({ ...newShift, shiftName: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-main)' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Primary On-Call SRE
                  </label>
                  <input
                    type="text"
                    placeholder="Engineer Name"
                    value={newShift.primaryOnCall}
                    onChange={(e) => setNewShift({ ...newShift, primaryOnCall: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-main)' }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Secondary On-Call SRE
                  </label>
                  <input
                    type="text"
                    placeholder="Backup Engineer"
                    value={newShift.secondaryOnCall}
                    onChange={(e) => setNewShift({ ...newShift, secondaryOnCall: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-main)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Escalation Manager
                  </label>
                  <input
                    type="text"
                    placeholder="Manager Name"
                    value={newShift.escalationManager}
                    onChange={(e) => setNewShift({ ...newShift, escalationManager: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-main)' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Location / Hub
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Singapore Hub / Montreal"
                    value={newShift.location}
                    onChange={(e) => setNewShift({ ...newShift, location: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-main)' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Handover Notes
                </label>
                <textarea
                  rows="2"
                  placeholder="Special shift instructions or handover focus..."
                  value={newShift.notes}
                  onChange={(e) => setNewShift({ ...newShift, notes: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-main)', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-action secondary"
                  onClick={() => setShowAddShiftModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-action primary"
                >
                  💾 Save Shift Row
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
