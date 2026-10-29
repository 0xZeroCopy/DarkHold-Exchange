import mongoose from 'mongoose';
import User, { DEFAULT_BALANCES } from '../models/User.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'darkhold_jwt_secret_key_2026';

// In-memory fallback store when MongoDB is not running or disconnected
const defaultDemoPasswordHash = bcrypt.hashSync('password123', 10);
const memoryUsers = new Map([
  [
    'trader1001',
    {
      _id: 'mem_1001',
      accountId: 1001,
      username: 'trader1001',
      name: 'Trader #1001',
      passwordHash: defaultDemoPasswordHash,
      balances: { ...DEFAULT_BALANCES }
    }
  ],
  [
    'trader1002',
    {
      _id: 'mem_1002',
      accountId: 1002,
      username: 'trader1002',
      name: 'Trader #1002',
      passwordHash: defaultDemoPasswordHash,
      balances: { ...DEFAULT_BALANCES }
    }
  ]
]);

export function findMemoryUserByAccountId(accountId) {
  const numId = Number(accountId);
  for (const u of memoryUsers.values()) {
    if (u.accountId === numId) return u;
  }
  return null;
}

const isDbConnected = () => mongoose.connection.readyState === 1;

// Derive or generate unique account ID (maps to C++ uint64_t accountID)
async function getNextAccountId() {
  if (isDbConnected()) {
    try {
      const lastUser = await User.findOne().sort({ accountId: -1 }).lean();
      if (lastUser && lastUser.accountId >= 1001) {
        return lastUser.accountId + 1;
      }
    } catch (_) {}
  }
  let maxId = 1002;
  for (const u of memoryUsers.values()) {
    if (u.accountId > maxId) maxId = u.accountId;
  }
  return maxId + 1;
}

export const registerUser = async (req, res) => {
  const username = (req.body.username || req.body.name || req.body.email || '').trim();
  const password = req.body.password || '';

  if (!username || username.length < 3) {
    return res.status(400).json({ message: 'Username must be at least 3 characters.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  try {
    let existing = null;
    if (isDbConnected()) {
      existing = await User.findOne({ username }).catch(() => null);
    }
    if (!existing) {
      existing = memoryUsers.get(username.toLowerCase()) || null;
    }
    if (existing) {
      return res.status(409).json({ message: 'Username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const accountId = await getNextAccountId();

    let user = null;
    if (isDbConnected()) {
      try {
        user = await User.create({
          accountId,
          username,
          name: username,
          passwordHash,
          balances: { ...DEFAULT_BALANCES }
        });
      } catch (dbErr) {
        console.warn('MongoDB write failed, falling back to memory store:', dbErr.message);
      }
    }

    if (!user) {
      user = {
        _id: `mem_${accountId}`,
        accountId,
        username,
        name: username,
        passwordHash,
        balances: { ...DEFAULT_BALANCES }
      };
      memoryUsers.set(username.toLowerCase(), user);
    }

    // Token carries accountId and username wisely so downstream components don't need extra DB lookups
    const token = jwt.sign(
      { accountId: user.accountId, username: user.username, sub: String(user._id) },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      accessToken: token,
      user: {
        accountId: user.accountId,
        username: user.username,
        name: user.name || user.username
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
};

export const loginUser = async (req, res) => {
  const username = (req.body.username || req.body.email || req.body.name || '').trim();
  const password = req.body.password || '';

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    let user = null;
    if (isDbConnected()) {
      user = await User.findOne({ username }).catch(() => null);
    }
    if (!user) {
      user = memoryUsers.get(username.toLowerCase()) || null;
    }

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      { accountId: user.accountId, username: user.username, sub: String(user._id) },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      accessToken: token,
      user: {
        accountId: user.accountId,
        username: user.username,
        name: user.name || user.username
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
};

export const getMe = async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({
      user: {
        accountId: decoded.accountId,
        username: decoded.username
      }
    });
  } catch (err) {
    return res.status(401).json({ message: 'Token is invalid or expired.' });
  }
};

export const logoutUser = async (_req, res) => {
  res.clearCookie('token');
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out successfully.' });
};

export const refreshToken = async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (req.cookies?.token || req.cookies?.refreshToken);

  if (!token) {
    return res.status(401).json({ message: 'No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const newToken = jwt.sign(
      { accountId: decoded.accountId, username: decoded.username, sub: decoded.sub },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token: newToken,
      user: {
        accountId: decoded.accountId,
        username: decoded.username
      }
    });
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};
