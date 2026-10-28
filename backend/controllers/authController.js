import User, { DEFAULT_BALANCES } from '../models/User.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'darkhold_jwt_secret_key_2026';

// Derive or generate unique account ID (maps to C++ uint64_t accountID)
async function getNextAccountId() {
  const lastUser = await User.findOne().sort({ accountId: -1 }).lean();
  if (lastUser && lastUser.accountId >= 1001) {
    return lastUser.accountId + 1;
  }
  return 1001;
}

export const registerUser = async (req, res) => {
  const username = (req.body.username || req.body.name || '').trim();
  const password = req.body.password || '';

  if (!username || username.length < 3) {
    return res.status(400).json({ message: 'Username must be at least 3 characters.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ message: 'Username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const accountId = await getNextAccountId();

    const user = await User.create({
      accountId,
      username,
      name: username,
      passwordHash,
      balances: { ...DEFAULT_BALANCES }
    });

    // Token carries accountId and username wisely so downstream components don't need extra DB lookups
    const token = jwt.sign(
      { accountId: user.accountId, username: user.username, sub: String(user._id) },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        accountId: user.accountId,
        username: user.username
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
};

export const loginUser = async (req, res) => {
  const username = (req.body.username || req.body.email || '').trim();
  const password = req.body.password || '';

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const user = await User.findOne({ username });
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
      user: {
        accountId: user.accountId,
        username: user.username
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
