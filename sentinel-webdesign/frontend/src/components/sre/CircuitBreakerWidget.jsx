import React, { useState, useEffect } from 'react';

export default function CircuitBreakerWidget() {
  const [status, setStatus] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/circuit-breaker/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleReset = async () => {
    if (!window.confirm('Reset Jenkins Circuit Breaker to CLOSED? This action is audited under Segregation of Duties.')) {
      return;
    }
    setResetting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/circuit-breaker/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        setMsg('Circuit breaker reset to CLOSED.');
        fetchStatus();
      } else {
        setMsg(`Error: ${data.error || 'Failed to reset'}`);
      }
    } catch (e) {
      setMsg(`Network error: ${e.message}`);
    } finally {
      setResetting(false);
    }
  };

  if (!status) return null;

  const isClosed = status.state === 'CLOSED';
  const isOpen = status.state === 'OPEN';
  const isHalfOpen = status.state === 'HALF-OPEN';

  let stateColor = '#10b981'; // green
  if (isOpen) stateColor = '#ef4444'; // red
  else if (isHalfOpen) stateColor = '#f59e0b'; // amber

  return (
    <div style={{
      background: 'var(--bg-card, #141c2b)',
      border: '1px solid var(--border-light, #223249)',
      borderRadius: '10px',
      padding: '16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          backgroundColor: stateColor,
          boxShadow: `0 0 10px ${stateColor}`
        }} />
        <div>
          <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>
            Jenkins Automation Circuit Breaker
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #7e8da0)' }}>
            State: <strong style={{ color: stateColor }}>{status.state}</strong> · Failures: {status.consecutiveFailures} / {status.maxFailures || 3}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {msg && <span style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>{msg}</span>}
        {(isOpen || isHalfOpen) && (
          <button
            onClick={handleReset}
            disabled={resetting}
            style={{
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            {resetting ? 'Resetting...' : 'Force Reset (SOD)'}
          </button>
        )}
      </div>
    </div>
  );
}
