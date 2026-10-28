/**
 * Auth API client — centralised fetch wrapper for auth endpoints.
 * All requests go to /api/auth/* on the backend.
 */
// In dev the Vite proxy forwards /api/* → http://localhost:5000
// In production set VITE_API_URL to your backend origin (e.g. https://api.darkhold.io)
const API = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',   // always send cookies (refresh token)
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

export const authApi = {
  register: (name, email, password) =>
    request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),

  login: (email, password) =>
    request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () =>
    request('/api/auth/logout', { method: 'POST' }),

  refresh: () =>
    request('/api/auth/refresh', { method: 'POST' }),

  me: (accessToken) =>
    request('/api/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
};

