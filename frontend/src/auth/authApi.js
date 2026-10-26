// Gateway HTTP address: same host as the websocket gateway (override with VITE_API_URL, or VITE_WS_URL as the App already does).
const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.VITE_WS_URL
    ? import.meta.env.VITE_WS_URL.replace(/^ws/, 'http')
    : `${window.location.protocol}//${window.location.hostname}:5000`);

// sessionStorage: each browser tab has its own login (so two tabs can be two traders) and closing the tab signs out.
const KEY = 'darkhold.session';

export function loadSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY));
    return s?.token && s?.user ? s : null;
  } catch {
    return null;
  }
}
export function saveSession(session) {
  try { sessionStorage.setItem(KEY, JSON.stringify(session)); } catch { /* storage unavailable: login lasts until reload */ }
}
export function clearSession() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${API_URL}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error('Cannot reach the gateway. Is the backend running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Request failed.');
  return data; // { token, user: { accountId, username } }
}

export const login = (username, password) => post('login', { username, password });
export const signup = (username, password) => post('signup', { username, password });

// false only when the gateway says the token is no longer valid; if it is unreachable we keep the session
// (the app's own "Gateway offline" indicator covers that case).
export async function isSessionValid(token) {
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    return res.status !== 401;
  } catch {
    return true;
  }
}
