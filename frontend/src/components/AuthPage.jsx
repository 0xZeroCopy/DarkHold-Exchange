import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

// ─── Shared field ─────────────────────────────────────────────────────────────
function Field({ label, id, type = 'text', value, onChange, placeholder, required = true }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-500 uppercase mb-1">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={type === 'password' ? 'current-password' : 'on'}
        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-800
                   focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
      />
    </div>
  );
}

// ─── Login form ───────────────────────────────────────────────────────────────
function LoginForm({ onSwitch }) {
  const { login }         = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      // AuthContext sets the user — App will re-render into the trading view.
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="Email" id="login-email" type="email" value={email} onChange={setEmail} placeholder="trader@darkhold.io" />
      <Field label="Password" id="login-password" type="password" value={password} onChange={setPassword} placeholder="••••••••" />

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full py-3 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700
                   disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
      >
        {busy ? 'Signing in…' : 'Sign In'}
      </button>

      <p className="text-sm text-center text-gray-500">
        No account?{' '}
        <button type="button" onClick={onSwitch} className="text-blue-600 hover:underline font-medium">
          Register
        </button>
      </p>
    </form>
  );
}

// ─── Register form ────────────────────────────────────────────────────────────
function RegisterForm({ onSwitch }) {
  const { register }      = useAuth();
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword]   = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== password2) return setError('Passwords do not match.');
    if (password.length < 8)    return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      await register(name, email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="Display Name" id="reg-name" value={name} onChange={setName} placeholder="My Trader Name" />
      <Field label="Email" id="reg-email" type="email" value={email} onChange={setEmail} placeholder="trader@darkhold.io" />
      <Field label="Password" id="reg-password" type="password" value={password} onChange={setPassword} placeholder="min 8 chars" />
      <Field label="Confirm Password" id="reg-password2" type="password" value={password2} onChange={setPassword2} placeholder="repeat password" />

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full py-3 rounded-lg font-bold text-white bg-green-600 hover:bg-green-700
                   disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
      >
        {busy ? 'Creating account…' : 'Create Account'}
      </button>

      <p className="text-sm text-center text-gray-500">
        Already have an account?{' '}
        <button type="button" onClick={onSwitch} className="text-blue-600 hover:underline font-medium">
          Sign In
        </button>
      </p>
    </form>
  );
}

// ─── Auth Page (combines both forms) ─────────────────────────────────────────
export default function AuthPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">
            THE DARKHOLD EXCHANGE
          </h1>
          <p className="text-sm text-gray-500 mt-1">Ticket trading, dark-pool style.</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-8">
          {/* Tab switcher */}
          <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                mode === 'login'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                mode === 'register'
                  ? 'bg-white text-green-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Register
            </button>
          </div>

          {mode === 'login'
            ? <LoginForm    onSwitch={() => setMode('register')} />
            : <RegisterForm onSwitch={() => setMode('login')}    />
          }
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Your session is secured with JWT + HttpOnly refresh cookies.
        </p>
      </div>
    </div>
  );
}

