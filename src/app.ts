import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from '@/config/logger';
import { rateLimiter } from '@/api/middleware/rateLimiter';
import { errorHandler } from '@/api/middleware/errorHandler';
import { authRouter } from '@/api/routes/auth';
import { bookingsRouter } from '@/api/routes/bookings';
import { availabilityRouter } from '@/api/routes/availability';
import { webhooksRouter } from '@/api/routes/webhooks';

export function createApp(): express.Application {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));
  app.use(rateLimiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/v1', authRouter);
  app.use('/api/v1', bookingsRouter);
  app.use('/api/v1', availabilityRouter);
  app.use('/api/v1', webhooksRouter);

  app.use(errorHandler);

  return app;
}
