import React, { useCallback, useEffect, useState } from 'react';
import { clearSession, isSessionValid, loadSession, login, saveSession, signup } from './authApi.js';

const inputClass =
  'w-full bg-[#430605] border border-[#ebd2b5]/30 rounded-lg px-3 py-2 text-white placeholder-[#ebd2b5]/40 focus:outline-none focus:ring-2 focus:ring-[#ebd2b5]';

/**
 * Shows the sign-in / sign-up screen until the user is authenticated, then renders
 * children({ token, user, logout }). Nothing behind it connects to the gateway before login.
 */
export default function AuthGate({ children }) {
  const [session, setSession] = useState(loadSession);
  const [checking, setChecking] = useState(() => loadSession() !== null);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
    setPassword('');
    setChecking(false);
  }, []);

  // Validate stored token wisely with a timeout safeguard
  useEffect(() => {
    if (!checking || !session) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled && checking) {
        setChecking(false); // don't block page if network is slow
      }
    }, 2500);

    isSessionValid(session.token)
      .then((valid) => {
        if (cancelled) return;
        if (!valid) logout();
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [checking, session, logout]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && password.length < 8) {
      return setError('Password must be at least 8 characters.');
    }
    setBusy(true);
    try {
      const next = await (mode === 'login' ? login : signup)(username.trim(), password);
      saveSession(next);
      setPassword('');
      setSession(next);
      setChecking(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (session && !checking) {
    return children({ token: session.token, user: session.user, logout });
  }

  return (
    <div className="min-h-screen bg-[#a5a79b] text-white p-4 flex items-center justify-center font-sans">
      <div className="w-full max-w-sm bg-[#590907] p-8 rounded-xl border border-[#590907] shadow-xl">
        <h1 className="text-2xl font-bold tracking-tight text-[#ebd2b5]">THE DARKHOLD EXCHANGE</h1>
        <p className="text-sm text-[#ebd2b5]/80 mt-1 mb-6">
          {checking
            ? 'Checking your session…'
            : mode === 'login'
            ? 'Sign in to start trading.'
            : 'Create a trader account.'}
        </p>

        {checking ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-3">
            <div className="w-7 h-7 border-3 border-[#ebd2b5] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[#ebd2b5]/80">Verifying authentication…</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="text-xs font-semibold text-[#ebd2b5] block mb-1">USERNAME</label>
              <input
                id="username"
                className={inputClass}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                minLength={3}
                maxLength={24}
                required
                autoFocus
              />
              {mode === 'signup' && (
                <span className="text-[11px] text-[#ebd2b5]/60 mt-1 block">3–24 characters: letters, numbers, underscore.</span>
              )}
            </div>
            <div>
              <label htmlFor="password" className="text-xs font-semibold text-[#ebd2b5] block mb-1">PASSWORD</label>
              <input
                id="password"
                type="password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                maxLength={72}
                required
              />
              {mode === 'signup' && <span className="text-[11px] text-[#ebd2b5]/60 mt-1 block">At least 8 characters.</span>}
            </div>

            {error && (
              <div role="alert" className="px-3 py-2 rounded-lg text-sm font-medium border bg-red-950/60 text-red-200 border-red-500/40">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-lg font-bold text-[#590907] bg-[#ebd2b5] hover:bg-[#dfc3a3] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setError('');
              }}
              className="w-full text-sm font-semibold text-[#ebd2b5] hover:underline"
            >
              {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
