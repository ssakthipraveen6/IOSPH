/**
 * Sign-in page: corporate AD (eLDAP) username and password.
 */
import React, { useState } from 'react';
import { signIn } from '../../auth.js';
import './LoginPage.css';

// Login form; calls onSignedIn(user) after a successful sign-in.
export default function LoginPage({ onSignedIn, notice = null }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await signIn(username.trim(), password);
    setBusy(false);
    if (result.ok) {
      setPassword('');
      onSignedIn(result.user);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <div className="login-brand">
          <span className="login-brand-mark" aria-hidden="true"></span>
          <div>
            <div className="login-brand-name">SENTINEL</div>
            <div className="login-brand-sub">ENTERPRISE NOC</div>
          </div>
        </div>
        <h1 className="login-title">Sign in</h1>

        {notice && !error && <p className="login-notice" role="status">{notice}</p>}

        <label className="login-label" htmlFor="login-username">Username</label>
        <input
          id="login-username"
          className="login-input"
          type="text"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={busy}
        />

        <label className="login-label" htmlFor="login-password">Password</label>
        <input
          id="login-password"
          className="login-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />

        {error && <p className="login-error" role="alert">{error}</p>}

        <button type="submit" className="login-submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="login-hint">Sign in with your corporate AD account.</p>
      </form>
    </div>
  );
}
