import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'darkhold_jwt_secret_key_2026';

export const protect = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Not authorized, no token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token verification failed' });
  }
};

export const verifyWsToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};
