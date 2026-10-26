import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  throw new Error(
    'JWT_SECRET is missing or too short (need 32+ characters). Generate one with:\n' +
    "  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"\n" +
    'and put it in backend/.env as JWT_SECRET=...'
  );
}

export const TOKEN_TTL = '12h';

// The token carries the trader's accountId: it is the only identity the gateway trusts.
export const signToken = ({ accountId, username }) =>
  jwt.sign({ accountId, username }, secret, { algorithm: 'HS256', expiresIn: TOKEN_TTL });

// Returns the decoded payload, or null if the token is missing, forged or expired.
export const verifyToken = (token) => {
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return Number.isSafeInteger(payload.accountId) && payload.accountId > 0 ? payload : null;
  } catch {
    return null;
  }
};
