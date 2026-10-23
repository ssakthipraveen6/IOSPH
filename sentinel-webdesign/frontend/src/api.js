/**
 * frontend/src/api.js
 *
 * Shared fetch helpers for the SENTINEL UI.
 * - apiFetch(): same-origin credentials, and the CSRF token (double-submit cookie
 *   `sentinel_csrf` echoed in `X-CSRF-Token`) on every state-changing request.
 * - isPageUnloading(): true once the page is navigating away, so aborted requests
 *   are not reported as errors.
 */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_COOKIE = 'sentinel_csrf';
const CSRF_HEADER = 'X-CSRF-Token';

let unloading = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { unloading = true; });
  window.addEventListener('beforeunload', () => { unloading = true; });
  window.addEventListener('pageshow', () => { unloading = false; });
}

// True while the page is unloading, so aborted fetches are not reported as errors.
export function isPageUnloading() {
  return unloading;
}

// Reads one cookie value by name.
export function readCookie(name) {
  if (typeof document === 'undefined' || !document.cookie) return null;
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// Returns the CSRF token cookie that mutating requests must echo in a header.
export function getCsrfToken() {
  return readCookie(CSRF_COOKIE);
}

/**
 * fetch() wrapper. Adds `credentials: 'same-origin'` and, for POST/PUT/PATCH/DELETE,
 * the CSRF header. A plain object body is sent as JSON.
 */
export async function apiFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  let body = options.body;

  if (body !== undefined && body !== null && typeof body === 'object'
      && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof URLSearchParams)) {
    body = JSON.stringify(body);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }

  if (UNSAFE_METHODS.has(method) && !headers.has(CSRF_HEADER)) {
    const token = getCsrfToken();
    if (token) headers.set(CSRF_HEADER, token);
  }

  return fetch(url, { ...options, method, headers, body, credentials: options.credentials || 'same-origin' });
}

/** Logs a request failure unless the page is navigating away. */
export function reportFetchError(message, err) {
  if (unloading) return;
  if (err && err.name === 'AbortError') return;
  console.error(message, err);
}
