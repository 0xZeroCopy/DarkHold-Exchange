import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { authApi } from '../api/authApi.js';

// ─── Context ────────────────────────────────────────────────────────────────
const AuthContext = createContext(null);

/** Access token lives only in memory — never in localStorage. */
let _accessToken = null;

export const getAccessToken = () => _accessToken;

// ─── Provider ────────────────────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [user, setUser]         = useState(null);   // public user object
  const [loading, setLoading]   = useState(true);   // initial session check
  const refreshTimer            = useRef(null);

  // Schedule a silent token refresh 60 s before the 15-min window closes.
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(silentRefresh, (15 * 60 - 60) * 1000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const silentRefresh = useCallback(async () => {
    try {
      const data = await authApi.refresh();
      _accessToken = data.accessToken;
      setUser(data.user);
      scheduleRefresh();
    } catch {
      // Refresh token expired / invalid — log the user out
      _accessToken = null;
      setUser(null);
    }
  }, [scheduleRefresh]);

  /** On mount, try to restore session from the HttpOnly refresh-token cookie. */
  useEffect(() => {
    silentRefresh().finally(() => setLoading(false));
    return () => clearTimeout(refreshTimer.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ────────────────────────────────────────────────────────────────
  const register = useCallback(async (name, email, password) => {
    const data   = await authApi.register(name, email, password);
    _accessToken = data.accessToken;
    setUser(data.user);
    scheduleRefresh();
    return data.user;
  }, [scheduleRefresh]);

  const login = useCallback(async (email, password) => {
    const data   = await authApi.login(email, password);
    _accessToken = data.accessToken;
    setUser(data.user);
    scheduleRefresh();
    return data.user;
  }, [scheduleRefresh]);

  const logout = useCallback(async () => {
    clearTimeout(refreshTimer.current);
    try { await authApi.logout(); } catch (_) {/* ignore network errors */}
    _accessToken = null;
    setUser(null);
  }, []);

  const value = { user, loading, register, login, logout, getAccessToken };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

