/**
 * React hook: fetches a view endpoint for the environment and returns { state, data, reason }.
 */
import { useEffect, useState } from 'react';

/**
 * Fetches a prototype-view endpoint for the given environment.
 *
 * Returns { state, data, reason } where state is
 *   'loading'     - request in flight
 *   'unavailable' - server said DATA_UNAVAILABLE, or the request failed
 *   'ready'       - data holds the server payload
 *
 * Nothing is seeded: if the server cannot answer, the view shows the
 * explicit empty state rather than local sample numbers.
 */
export default function usePrototypeData(path, environment) {
  const [result, setResult] = useState({ state: 'loading', data: null, reason: null, key: null });
  const key = `${path}|${environment}`;

  useEffect(() => {
    let cancelled = false;
    const sep = path.includes('?') ? '&' : '?';
    fetch(`${path}${sep}environment=${encodeURIComponent(environment)}`, { credentials: 'same-origin' })
      .then(async r => {
        let body = null;
        try { body = await r.json(); } catch { body = null; }
        if (cancelled) return;
        if (!r.ok) {
          setResult({ state: 'unavailable', data: null, reason: (body && body.error) || `Request failed (HTTP ${r.status}).`, key });
        } else if (!body || body.status === 'DATA_UNAVAILABLE') {
          setResult({ state: 'unavailable', data: body, reason: (body && body.reason) || 'The server returned no data.', key });
        } else {
          setResult({ state: 'ready', data: body, reason: null, key });
        }
      })
      .catch(err => {
        if (!cancelled) setResult({ state: 'unavailable', data: null, reason: `Could not reach the server: ${err.message}`, key });
      });
    return () => { cancelled = true; };
  }, [path, environment, key]);

  // A stale result from a previous environment is never shown.
  if (result.key !== key) return { state: 'loading', data: null, reason: null };
  return result;
}
