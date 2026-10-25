const userBuckets = new Map();

// Token bucket rate limiting per account
export const tokenBucketLimiter = (req, res, next) => {
  const userId = req.user?.id || req.ip;
  const now = Date.now();
  const capacity = 10;
  const refillRateMs = 1000;

  if (!userBuckets.has(userId)) {
    userBuckets.set(userId, { tokens: capacity, lastRefill: now });
  }

  const bucket = userBuckets.get(userId);
  const timePassed = now - bucket.lastRefill;
  bucket.tokens = Math.min(capacity, bucket.tokens + timePassed / refillRateMs);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    next();
  } else {
    res.status(429).json({ message: 'Rate limit exceeded. Please slow down order submissions.' });
  }
};