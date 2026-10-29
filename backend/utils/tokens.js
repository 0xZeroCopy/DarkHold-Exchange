import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const ACCESS_SECRET  = process.env.JWT_SECRET || 'darkhold_jwt_secret_key_2026';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || ACCESS_SECRET + '_refresh';
const ACCESS_TTL     = '15m';   // short-lived
const REFRESH_TTL    = '7d';    // longer-lived, rotated on use

/**
 * Sign a short-lived access token.
 * Payload: { sub, accountId, role }
 */
export const signAccessToken = (user) =>
  jwt.sign(
    { sub: user._id.toString(), accountId: user.accountId, role: user.role },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );

/**
 * Sign a long-lived refresh token.
 * Payload: { sub, family } — family prevents parallel-refresh attacks.
 */
export const signRefreshToken = (user, family = crypto.randomUUID()) =>
  jwt.sign(
    { sub: user._id.toString(), family },
    REFRESH_SECRET,
    { expiresIn: REFRESH_TTL }
  );

/** Verify an access token — returns payload or throws. */
export const verifyAccessToken = (token) => jwt.verify(token, ACCESS_SECRET);

/** Verify a refresh token — returns payload or throws. */
export const verifyRefreshToken = (token) => jwt.verify(token, REFRESH_SECRET);

/** Hash a refresh token for safe storage in the DB. */
export const hashToken = (token) => bcrypt.hash(token, 8);

/** Compare a plain refresh token against the stored hash. */
export const compareToken = (token, hash) => bcrypt.compare(token, hash);

