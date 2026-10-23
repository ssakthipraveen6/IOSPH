/**
 * React hook keeping tab, environment and filters in the URL (back/forward work).
 */
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

/**
 * useUrlRouter - Client-side stateful router synchronized with browser URL query parameters.
 * M6 Task 6.1: ?env=&from=&to=&product=&tab=&view=
 * Phase D: Exactly two environments: PROD and STAGING.
 * Demo/sample values are never accepted as runtime environment.
 */
function sanitizeEnv(candidate, fallback = 'staging') {
  if (!candidate) return fallback;
  const lower = String(candidate).toLowerCase();
  if (lower === 'prod' || lower === 'production') return 'prod';
  if (lower === 'stg' || lower === 'staging') return 'staging';
  // A URL or localStorage value of 'demo' or anything invalid is strictly ignored
  return fallback;
}

// Router hook.
export function useUrlRouter({ defaultTab = 'home', defaultEnv = 'staging' } = {}) {
  const safeDefaultEnv = sanitizeEnv(defaultEnv, 'staging');

  // Reads tab and environment from the current URL.
  const getParams = useCallback(() => {
    try {
      const search = window.location.search;
      const params = new URLSearchParams(search);
      const rawEnv = params.get('env') || localStorage.getItem('sentinel_environment') || safeDefaultEnv;
      return {
        tab: params.get('tab') || defaultTab,
        env: sanitizeEnv(rawEnv, safeDefaultEnv),
        product: params.get('product') || null,
        kind: params.get('kind') || null,
        id: params.get('id') || null,
        host: params.get('host') || null,
        from: params.get('from') || null,
        to: params.get('to') || null,
        view: params.get('view') || null
      };
    } catch {
      return {
        tab: defaultTab,
        env: safeDefaultEnv,
        product: null,
        kind: null,
        id: null,
        host: null,
        from: null,
        to: null,
        view: null
      };
    }
  }, [defaultTab, safeDefaultEnv]);

  const [routerState, setRouterState] = useState(getParams);

  // Sync state on browser back / forward
  useEffect(() => {
    const handlePopState = () => {
      setRouterState(getParams());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [getParams]);

  // On mount: if URL has an invalid or demo env param, sanitize the browser URL immediately
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const rawEnv = params.get('env');
      if (rawEnv && rawEnv !== routerState.env) {
        params.set('env', routerState.env);
        const searchStr = params.toString();
        const newUrl = `${window.location.pathname}${searchStr ? `?${searchStr}` : ''}${window.location.hash}`;
        window.history.replaceState(null, '', newUrl);
      }
    } catch (_) {}
  }, [routerState.env]);

  // Navigate and push to browser history
  const navigate = useCallback((updates, { replace = false } = {}) => {
    setRouterState(prev => {
      const next = { ...prev, ...updates };
      if (next.env) next.env = sanitizeEnv(next.env, safeDefaultEnv);
      const params = new URLSearchParams();

      if (next.tab && next.tab !== 'home') params.set('tab', next.tab);
      if (next.env) params.set('env', next.env);
      if (next.product) params.set('product', next.product);
      if (next.kind) params.set('kind', next.kind);
      if (next.id) params.set('id', next.id);
      if (next.host) params.set('host', next.host);
      if (next.from) params.set('from', next.from);
      if (next.to) params.set('to', next.to);
      if (next.view) params.set('view', next.view);

      const searchStr = params.toString();
      const newUrl = `${window.location.pathname}${searchStr ? `?${searchStr}` : ''}${window.location.hash}`;

      if (replace) {
        window.history.replaceState(null, '', newUrl);
      } else {
        window.history.pushState(null, '', newUrl);
      }

      return next;
    });
  }, [safeDefaultEnv]);

  // Environment Switcher: updates URL and dispatches POST /api/environment
  const switchEnvironment = useCallback(async (newEnv) => {
    const normEnv = sanitizeEnv(newEnv, 'staging');
    try {
      localStorage.setItem('sentinel_environment', normEnv);
    } catch (_) {}

    navigate({ env: normEnv });

    try {
      await apiFetch('/api/environment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: normEnv })
      });
    } catch (err) {
      console.warn('[ROUTER] POST /api/environment call completed with warning:', err.message);
    }
  }, [navigate]);

  return {
    ...routerState,
    navigate,
    switchEnvironment
  };
}
