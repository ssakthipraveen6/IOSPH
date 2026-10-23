/**
 * SRE tools: on-call rota and Dynatrace problem lookup.
 */
import React, { useState, useEffect, useRef } from 'react';
import { MAINTENANCE_CONFIG } from '../../maintenanceConfig';
import { MaintenanceBadge } from '../shared/MaintenanceNotice';
import { apiFetch } from '../../api';
import './MiscOperations.css';

// SRE operations page.
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
      const res = await apiFetch(`/api/misc/rota/upload?category=${selectedRotaCategory}`, {
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
      const res = await apiFetch(`/api/misc/rota/shift?category=${selectedRotaCategory}`, {
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

  // Severity -> CSS modifier (see .misc-sev--* / .misc-problem--* in MiscOperations.css)
  const getSeverityClass = (severity) => {
    switch (severity) {
      case 'AVAILABILITY':
      case 'ERROR':
        return 'critical';
      case 'PERFORMANCE':
      case 'RESOURCE_CONTENTION':
        return 'warning';
      default:
        return 'info';
    }
  };

  return (
    <div className="misc-operations-container misc-root">
      
      {/* Header */}
      <div className="section-header-group">
        <div className="misc-header-row">
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

          <div className="misc-header-actions">
            <div className="nav-tab-group misc-tabs">
              <button
                className={`nav-tab-btn misc-tab ${mainTab === 'rota' ? 'active misc-tab--active' : ''}`}
                onClick={() => setMainTab('rota')}
              >
                📊 Monthly Team Rota Table ({rawRows.length} Days)
              </button>
              <button
                className={`nav-tab-btn misc-tab ${mainTab === 'dynatrace' ? 'active misc-tab--active' : ''}`}
                onClick={() => setMainTab('dynatrace')}
              >
                ⚡ Dynatrace Active Problems ({dynatraceProblems.length})
              </button>
            </div>

            {mainTab === 'dynatrace' && (
              <button
                className="btn-action secondary misc-btn misc-btn--refresh"
                onClick={fetchDynatraceProblems}
              >
                🔄 Refresh Problems
              </button>
            )}
          </div>
        </div>
      </div>

      {toastMessage && (
        <div className={`misc-toast${toastMessage.includes('❌') ? ' misc-toast--error' : ''}`}>
          {toastMessage}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: FULL MONTH EXCEL ROTA TABLE VIEWER                                */}
      {/* ========================================================================= */}
      {mainTab === 'rota' && (
        <div className="misc-stack misc-stack--tight">
          
          {/* Top Control Bar: Category Selector & Excel Actions */}
          <div className="console-panel misc-controls">
            {/* 3 Rota Pills: Core, BAU, Montreal */}
            <div className="misc-pills">
              <span className="misc-pills__label">
                Roster:
              </span>
              <button
                onClick={() => setSelectedRotaCategory('core')}
                className={`misc-pill misc-pill--core${selectedRotaCategory === 'core' ? ' misc-pill--selected' : ''}`}
              >
                🔥 Core 24/7 SRE Rota
              </button>
              <button
                onClick={() => setSelectedRotaCategory('bau')}
                className={`misc-pill misc-pill--bau${selectedRotaCategory === 'bau' ? ' misc-pill--selected' : ''}`}
              >
                🛠️ BAU Operations Rota
              </button>
              <button
                onClick={() => setSelectedRotaCategory('montreal')}
                className={`misc-pill misc-pill--montreal${selectedRotaCategory === 'montreal' ? ' misc-pill--selected' : ''}`}
              >
                🍁 Montreal Regional Rota
              </button>
            </div>

            {/* Excel Upload & Download Actions */}
            <div className="misc-file-actions">
              <input
                type="file"
                ref={fileInputRef}
                accept=".xlsx, .xls, .csv"
                className="misc-hidden"
                onChange={handleFileUpload}
              />
              
              <button
                className="btn-action secondary misc-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
                title="Upload full month Excel spreadsheet (.xlsx, .xls, .csv)"
              >
                📁 Upload Excel Table
              </button>

              <button
                className="btn-action secondary misc-btn"
                onClick={handleDownloadTemplate}
                title="Download full month Excel spreadsheet"
              >
                📥 Download Monthly Excel
              </button>

              <button
                className="btn-action primary misc-btn"
                onClick={() => setShowAddShiftModal(true)}
              >
                ➕ Add Shift Row
              </button>
            </div>
          </div>

          {/* Search, Filters, and Table Statistics */}
          <div className="misc-filterbar">
            <div className="misc-filterbar__inputs">
              <input
                type="text"
                placeholder="🔍 Search by engineer name, date (e.g. 2026-08-30), shift, or notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="misc-filter-input misc-filter-input--search"
              />

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="misc-filter-input"
              >
                <option value="ALL">Status: All Shifts ({rawRows.length})</option>
                <option value="ACTIVE">🔴 Active Today Only</option>
                <option value="SCHEDULED">📅 Scheduled</option>
                <option value="COMPLETED">✅ Completed</option>
              </select>
            </div>

            <div className="misc-stats">
              <span>Total Days: <strong className="misc-stats__primary">{rawRows.length}</strong></span>
              <span>Showing: <strong className="misc-stats__healthy">{filteredRows.length}</strong></span>
              <span>Roster: <strong className="misc-stats__main">{activeRota?.name}</strong></span>
            </div>
          </div>

          {/* Full Month Excel Spreadsheet Table */}
          <div className="metrics-panel-card misc-table-card">
            <div className="misc-table-scroll">
              <table className="sentinel-table misc-table">
                <thead className="misc-table__head">
                  <tr>
                    {tableColumns.map((col, idx) => (
                      <th 
                        key={idx} 
                        className="misc-table__th"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingRota ? (
                    <tr>
                      <td colSpan={tableColumns.length} className="misc-table__placeholder">
                        Loading full month schedule...
                      </td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={tableColumns.length} className="misc-table__placeholder">
                        {searchQuery ? `No records match the search filter "${searchQuery}".` : 'Value Not Available'}
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row, rIdx) => {
                      const isToday = String(row['Status'] || '').toUpperCase().includes('ACTIVE') || String(row['Date'] || '').includes('2026-08-30');
                      return (
                        <tr 
                          key={rIdx}
                          className={`misc-row${isToday ? ' misc-row--today' : (rIdx % 2 === 0 ? ' misc-row--even' : '')}`}
                        >
                          {tableColumns.map((col, cIdx) => {
                            const val = row[col];
                            const isStatus = col.toLowerCase() === 'status';
                            const isDate = col.toLowerCase() === 'date';
                            const isPrimary = col.toLowerCase().includes('primary');

                            return (
                              <td 
                                key={cIdx} 
                                className={`misc-cell${col.toLowerCase().includes('notes') ? ' misc-cell--notes' : ''}${isToday ? ' misc-cell--today' : ''}`}
                              >
                                {isStatus ? (
                                  <span className={`misc-status${isToday ? ' misc-status--today' : String(val).includes('Completed') ? ' misc-status--completed' : ''}`}>
                                    {val || (isToday ? 'ACTIVE TODAY' : 'Scheduled')}
                                  </span>
                                ) : isDate ? (
                                  <span className={`misc-date${isToday ? ' misc-date--today' : ''}`}>
                                    {val}
                                  </span>
                                ) : isPrimary ? (
                                  <span className="misc-primary">
                                    {val}
                                  </span>
                                ) : (
                                  <span className={`misc-val${isToday ? ' misc-val--today' : ''}`}>
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
        <div className="misc-stack">
          
          <div className="metrics-panel-card misc-problems-card">
            <div className="panel-header misc-problems-header">
              <div>
                <h3>Dynatrace Active Open Problems (Davis AI Real-Time Feed)</h3>
                <p className="misc-note">
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
              <div className="misc-all-clear">
                <h3>🎉 No Active Open Problems in Dynatrace</h3>
                <p className="misc-note misc-note--sm">All monitored services, applications, and infrastructure hosts are performing within SLA thresholds.</p>
              </div>
            ) : (
              <div className="misc-problems">
                {dynatraceProblems.map((prob) => {
                  const sevClass = getSeverityClass(prob.severityLevel);
                  return (
                    <div 
                      key={prob.problemId} 
                      className={`misc-problem misc-problem--${sevClass}`}
                    >
                      <div className="misc-problem__top">
                        <div className="misc-problem__ids">
                          <span className={`misc-sev misc-sev--${sevClass}`}>
                            {prob.severityLevel}
                          </span>
                          <span className="misc-problem__id">
                            {prob.displayId || prob.problemId}
                          </span>
                          <span className="badge-gray misc-zone">
                            {prob.managementZone || 'Global Zone'}
                          </span>
                        </div>

                        <div className="misc-problem__right">
                          <span className="misc-problem__opened">
                            Opened: {new Date(prob.startTime).toLocaleTimeString()}
                          </span>
                          {prob.remediationUrl && (
                            <a 
                              href={prob.remediationUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="misc-portal-link"
                            >
                              Dynatrace Portal ↗
                            </a>
                          )}
                        </div>
                      </div>

                      <h4 className="misc-problem__title">
                        {prob.title}
                      </h4>

                      {prob.davisAiSummary && (
                        <div className="misc-davis">
                          <strong>🧠 Davis AI Root Cause:</strong> {prob.davisAiSummary}
                        </div>
                      )}

                      <div className="misc-problem__meta">
                        <div>
                          <strong>Impacted Entities:</strong> {(prob.affectedEntities || []).map(e => e.name).join(', ') || 'Cluster Components'}
                        </div>
                        {prob.rootCauseEntity && (
                          <div>
                            <strong>Root Cause Entity:</strong> <code className="misc-root-cause">{prob.rootCauseEntity.name}</code>
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
        <div className="misc-modal-backdrop">
          <div className="misc-modal">
            <h3 className="misc-modal__title">
              ➕ Add Shift Row to [{selectedRotaCategory.toUpperCase()}] Table
            </h3>
            <p className="misc-modal__desc">
              Enter date, shift designation, and assigned on-call team members for this monthly record.
            </p>

            <form onSubmit={handleAddShiftSubmit} className="misc-form">
              <div className="misc-form__row">
                <div>
                  <label className="misc-form__label">
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
                    className="misc-form__input"
                    required
                  />
                </div>

                <div>
                  <label className="misc-form__label">
                    Day of Week
                  </label>
                  <input
                    type="text"
                    value={newShift.Day}
                    readOnly
                    className="misc-form__input misc-form__input--readonly"
                  />
                </div>
              </div>

              <div>
                <label className="misc-form__label">
                  Shift Name / Designation
                </label>
                <input
                  type="text"
                  placeholder="e.g. APAC Morning Escalation (06:00-14:30 SGT)"
                  value={newShift.shiftName}
                  onChange={(e) => setNewShift({ ...newShift, shiftName: e.target.value })}
                  className="misc-form__input"
                  required
                />
              </div>

              <div className="misc-form__row">
                <div>
                  <label className="misc-form__label">
                    Primary On-Call SRE
                  </label>
                  <input
                    type="text"
                    placeholder="Engineer Name"
                    value={newShift.primaryOnCall}
                    onChange={(e) => setNewShift({ ...newShift, primaryOnCall: e.target.value })}
                    className="misc-form__input"
                    required
                  />
                </div>

                <div>
                  <label className="misc-form__label">
                    Secondary On-Call SRE
                  </label>
                  <input
                    type="text"
                    placeholder="Backup Engineer"
                    value={newShift.secondaryOnCall}
                    onChange={(e) => setNewShift({ ...newShift, secondaryOnCall: e.target.value })}
                    className="misc-form__input"
                  />
                </div>
              </div>

              <div className="misc-form__row">
                <div>
                  <label className="misc-form__label">
                    Escalation Manager
                  </label>
                  <input
                    type="text"
                    placeholder="Manager Name"
                    value={newShift.escalationManager}
                    onChange={(e) => setNewShift({ ...newShift, escalationManager: e.target.value })}
                    className="misc-form__input"
                  />
                </div>

                <div>
                  <label className="misc-form__label">
                    Location / Hub
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Singapore Hub / Montreal"
                    value={newShift.location}
                    onChange={(e) => setNewShift({ ...newShift, location: e.target.value })}
                    className="misc-form__input"
                  />
                </div>
              </div>

              <div>
                <label className="misc-form__label">
                  Handover Notes
                </label>
                <textarea
                  rows="2"
                  placeholder="Special shift instructions or handover focus..."
                  value={newShift.notes}
                  onChange={(e) => setNewShift({ ...newShift, notes: e.target.value })}
                  className="misc-form__input misc-form__input--textarea"
                />
              </div>

              <div className="misc-form__actions">
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
