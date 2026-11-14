/**
 * frontend/src/auth.js
 *
 * Sign-in, sign-out and session checks for the SENTINEL UI.
 * - fetchMe(): the signed-in user, or null when there is no valid session.
 * - signIn() / signOut(): eLDAP sign-in and server-side token revocation.
 * - installAuthWatch(): turns any later 401 from /api into AUTH_REQUIRED_EVENT,
 *   so an expired or revoked session goes back to the login page.
 */
import { apiFetch } from './api.js';

export const AUTH_REQUIRED_EVENT = 'sentinel:auth-required';

const SERVICE_UNAVAILABLE = 'Sign-in service unavailable. Try again or contact the Sentinel admins.';
const TOO_MANY_ATTEMPTS = 'Too many sign-in attempts. Wait 15 minutes and try again.';

// Paths whose 401 is an expected answer, not a lost session.
const AUTH_PATHS = ['/api/auth/sso/login', '/api/auth/me', '/api/auth/logout'];

// Returns the signed-in user, or null when the server says there is no valid session.
export async function fetchMe() {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Session check failed (${res.status})`);
  const data = await res.json();
  return data && data.username ? data : null;
}

// Signs in with AD credentials; never throws.
export async function signIn(username, password) {
  let res;
  try {
    res = await fetch('/api/auth/sso/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
  } catch (_) {
    return { ok: false, status: 0, error: SERVICE_UNAVAILABLE };
  }
  let body = {};
  try { body = await res.json(); } catch (_) { body = {}; }
  if (res.ok && body.user) return { ok: true, user: body.user };
  if (res.status === 429) return { ok: false, status: 429, error: TOO_MANY_ATTEMPTS };
  if (res.status === 503 || res.status >= 500) return { ok: false, status: res.status, error: body.error || SERVICE_UNAVAILABLE };
  return { ok: false, status: res.status, error: body.error || 'Sign-in failed.' };
}

// Revokes the session on the server; the cookie is cleared even if the call fails.
export async function signOut() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (_) { /* the session cookie still expires on its own */ }
}

let watching = false;

// Wraps window.fetch once so any 401 from /api raises AUTH_REQUIRED_EVENT.
export function installAuthWatch() {
  if (watching || typeof window === 'undefined' || !window.fetch) return;
  watching = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await originalFetch(input, init);
    if (res.status === 401) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const path = url.replace(window.location.origin, '');
      if (path.startsWith('/api/') && !AUTH_PATHS.some(p => path.startsWith(p))) {
        window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
      }
    }
    return res;
  };
}
