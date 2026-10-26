import React, { useCallback, useEffect, useState } from 'react';
import { clearSession, isSessionValid, loadSession, login, saveSession, signup } from './authApi.js';

const inputClass =
  'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500';

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
  }, []);

  // A stored token may have expired or been revoked while the tab was open.
  useEffect(() => {
    if (!checking || !session) return undefined;
    let cancelled = false;
    isSessionValid(session.token).then((valid) => {
      if (cancelled) return;
      if (!valid) logout();
      setChecking(false);
    });
    return () => { cancelled = true; };
  }, [checking, session, logout]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      const next = await (mode === 'login' ? login : signup)(username.trim(), password);
      saveSession(next);
      setPassword('');
      setSession(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (session && !checking) return children({ token: session.token, user: session.user, logout });

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 flex items-center justify-center font-sans">
      <div className="w-full max-w-sm bg-white p-8 rounded-xl border border-gray-200 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-gray-800">THE DARKHOLD EXCHANGE</h1>
        <p className="text-sm text-gray-500 mt-1 mb-6">
          {checking ? 'Checking your session…' : mode === 'login' ? 'Sign in to start trading.' : 'Create a trader account.'}
        </p>

        {!checking && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="text-xs font-semibold text-gray-600 block mb-1">USERNAME</label>
              <input id="username" className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" minLength={3} maxLength={24} required autoFocus />
              {mode === 'signup' && (
                <span className="text-[11px] text-gray-400 mt-1 block">3–24 characters: letters, numbers, underscore.</span>
              )}
            </div>
            <div>
              <label htmlFor="password" className="text-xs font-semibold text-gray-600 block mb-1">PASSWORD</label>
              <input id="password" type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={72} required />
              {mode === 'signup' && <span className="text-[11px] text-gray-400 mt-1 block">At least 8 characters.</span>}
            </div>

            {error && (
              <div role="alert" className="px-3 py-2 rounded-lg text-sm font-medium border bg-red-50 text-red-700 border-red-200">
                {error}
              </div>
            )}

            <button type="submit" disabled={busy}
              className="w-full py-3 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>

            <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}
              className="w-full text-sm font-semibold text-blue-600 hover:text-blue-800 underline">
              {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
