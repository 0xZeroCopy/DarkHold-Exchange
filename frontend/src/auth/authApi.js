// Gateway HTTP address:
// In dev and Codespaces, Vite proxies /api -> http://localhost:5000 (relative URL avoids CORS and domain issues).
const API_URL = import.meta.env.VITE_API_URL || '';

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
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable */
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${API_URL}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error('Cannot reach the gateway. Is the backend running?');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || 'Request failed.');
  }
  return data; // { token, user: { accountId, username } }
}

export const login = (username, password) => post('login', { username, password });
export const signup = (username, password) => post('signup', { username, password });

// Fast token validity check using /api/auth/me
export async function isSessionValid(token) {
  if (!token) return false;
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.status === 200;
  } catch {
    // If backend is momentarily unreachable, keep session so UI doesn't flicker or get stuck
    return true;
  }
}
