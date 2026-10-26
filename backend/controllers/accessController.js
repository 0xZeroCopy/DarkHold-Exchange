import bcrypt from 'bcryptjs';
import Credential from '../models/Credential.js';
import User, { DEFAULT_BALANCES } from '../models/User.js';
import { signToken } from '../services/authService.js';

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const BCRYPT_ROUNDS = 12;
// Compared against when the username doesn't exist, so "unknown user" and "wrong password" take the same time.
const DUMMY_HASH = bcrypt.hashSync('darkhold-dummy-password', BCRYPT_ROUNDS);

// Small in-memory limiter (fine for a single gateway process; no extra services needed).
function makeLimiter(limit, windowMs) {
  const hits = new Map(); // key -> { count, resetAt }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
  }, 60_000).unref();
  return {
    blocked(key) {
      const h = hits.get(key);
      return Boolean(h && h.resetAt >= Date.now() && h.count >= limit);
    },
    hit(key) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || h.resetAt < now) hits.set(key, { count: 1, resetAt: now + windowMs });
      else h.count++;
    },
    clear(key) { hits.delete(key); }
  };
}
const loginFailures = makeLimiter(8, 15 * 60_000);  // 8 wrong passwords per IP+username per 15 min
const signups = makeLimiter(10, 60 * 60_000);       // 10 sign-ups per IP per hour

const str = (v) => (typeof v === 'string' ? v : ''); // also blocks NoSQL operator objects like {"$ne": ""}

const nextAccountId = async () => {
  const [u, c] = await Promise.all([
    User.findOne().sort({ accountId: -1 }).select('accountId').lean(),
    Credential.findOne().sort({ accountId: -1 }).select('accountId').lean()
  ]);
  return Math.max(1002, u?.accountId ?? 0, c?.accountId ?? 0) + 1; // 1001/1002 are the seeded demo traders
};

const sessionFor = (cred) => ({
  token: signToken({ accountId: cred.accountId, username: cred.username }),
  user: { accountId: cred.accountId, username: cred.username }
});

export const signup = async (req, res) => {
  const username = str(req.body?.username).trim().toLowerCase();
  const password = str(req.body?.password);

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ message: 'Username must be 3–24 characters: letters, numbers or underscore.' });
  }
  if (password.length < 8 || Buffer.byteLength(password) > 72) {
    return res.status(400).json({ message: 'Password must be 8–72 characters.' });
  }
  if (signups.blocked(req.ip)) return res.status(429).json({ message: 'Too many sign-ups. Try again later.' });
  signups.hit(req.ip);

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    for (let attempt = 0; attempt < 5; attempt++) {
      const accountId = await nextAccountId();
      try {
        const cred = await Credential.create({ accountId, username, passwordHash });
        await User.updateOne(
          { accountId },
          { $setOnInsert: { accountId, name: username, balances: { ...DEFAULT_BALANCES } } },
          { upsert: true }
        );
        return res.status(201).json(sessionFor(cred));
      } catch (err) {
        if (err.code !== 11000) throw err;
        if (err.keyPattern?.username) return res.status(409).json({ message: 'That username is taken.' });
        // otherwise a concurrent sign-up grabbed this accountId: loop and take the next one
      }
    }
    return res.status(503).json({ message: 'Busy right now. Please try again.' });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ message: 'Sign-up failed.' });
  }
};

export const login = async (req, res) => {
  const username = str(req.body?.username).trim().toLowerCase();
  const password = str(req.body?.password);
  if (!username || !password) return res.status(400).json({ message: 'Username and password are required.' });

  const key = `${req.ip}|${username}`;
  if (loginFailures.blocked(key)) {
    return res.status(429).json({ message: 'Too many failed attempts. Try again in a few minutes.' });
  }

  try {
    const cred = await Credential.findOne({ username });
    const ok = await bcrypt.compare(password, cred?.passwordHash ?? DUMMY_HASH);
    if (!cred || !ok) {
      loginFailures.hit(key);
      return res.status(401).json({ message: 'Invalid username or password.' });
    }
    loginFailures.clear(key);
    return res.json(sessionFor(cred));
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Login failed.' });
  }
};

// Used by the UI on page load to confirm a stored token is still good. Runs behind `protect`.
export const me = async (req, res) => {
  const { accountId, username } = req.user;
  if (!Number.isSafeInteger(accountId) || !(await Credential.exists({ accountId }))) {
    return res.status(401).json({ message: 'Session is no longer valid.' });
  }
  return res.json({ user: { accountId, username } });
};
