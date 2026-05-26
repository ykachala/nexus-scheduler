import rateLimit from 'express-rate-limit';
import { config } from '@/config';

export const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  keyGenerator: (req) => {
    const tenantId = (req as Express.Request).user?.tenantId ?? req.ip ?? 'unknown';
    return tenantId;
  },
});

export const strictRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests on this endpoint' },
});
