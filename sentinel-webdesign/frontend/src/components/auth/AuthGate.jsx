/**
 * Sign-in gate: shows the login page until there is a valid session, then renders
 * the app. Nothing behind the gate (data requests, WebSocket) runs while signed out.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AUTH_REQUIRED_EVENT, fetchMe, installAuthWatch, signOut } from '../../auth.js';
import LoginPage from './LoginPage.jsx';
import './LoginPage.css';

const SESSION_ENDED = 'Your session ended. Sign in again.';
const SERVICE_UNAVAILABLE = 'Sign-in service unavailable. Try again or contact the Sentinel admins.';

// Applies the saved light/dark theme to the page, as App does once mounted.
function applySavedTheme() {
  let theme = 'light';
  try { theme = localStorage.getItem('theme') || 'light'; } catch (_) { /* storage blocked */ }
  document.body.classList.remove('dark-mode', 'light-mode');
  document.body.classList.add(theme === 'dark' ? 'dark-mode' : 'light-mode');
}

// Points the URL (and the saved choice) at an environment the user may see, before App reads it.
function alignEnvironment(user) {
  const allowed = Array.isArray(user.allowedEnvironments) && user.allowedEnvironments.length
    ? user.allowedEnvironments : ['prod', 'staging'];
  const params = new URLSearchParams(window.location.search);
  let saved = null;
  try { saved = localStorage.getItem('sentinel_environment'); } catch (_) { /* storage blocked */ }
  const current = params.get('env') || saved;
  if (current && allowed.includes(current)) return;
  const target = allowed.includes(user.environment) ? user.environment : allowed[0];
  params.set('env', target);
  try { localStorage.setItem('sentinel_environment', target); } catch (_) { /* storage blocked */ }
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
}

// Renders children(user, onSignOut) once signed in, otherwise the login page.
export default function AuthGate({ children }) {
  const [state, setState] = useState({ phase: 'checking', user: null, notice: null });

  useEffect(() => {
    applySavedTheme();
    installAuthWatch();
    let active = true;
    fetchMe()
      .then(user => {
        if (!active) return;
        if (user) {
          alignEnvironment(user);
          setState({ phase: 'signed-in', user, notice: null });
        } else {
          setState({ phase: 'signed-out', user: null, notice: null });
        }
      })
      .catch(() => { if (active) setState({ phase: 'signed-out', user: null, notice: SERVICE_UNAVAILABLE }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onAuthRequired = () => {
      setState(prev => (prev.phase === 'signed-in' ? { phase: 'signed-out', user: null, notice: SESSION_ENDED } : prev));
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const handleSignedIn = useCallback((user) => {
    alignEnvironment(user);
    setState({ phase: 'signed-in', user, notice: null });
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut();
    applySavedTheme();
    setState({ phase: 'signed-out', user: null, notice: null });
  }, []);

  if (state.phase === 'checking') {
    return <div className="auth-checking">Checking your session…</div>;
  }
  if (state.phase === 'signed-out') {
    return <LoginPage onSignedIn={handleSignedIn} notice={state.notice} />;
  }
  return children(state.user, handleSignOut);
}
