import { createApp } from '@/app';
import { connectDb, disconnectDb } from '@/db/client';
import { disconnectRedis } from '@/booking/lockService';
import { closeQueues } from '@/queue/queues';
import { config } from '@/config';
import { logger } from '@/config/logger';

async function main(): Promise<void> {
  await connectDb();

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'Server listening');
  });

  const shutdown = async () => {
    logger.info('Shutting down gracefully');
    server.close(async () => {
      await closeQueues();
      await disconnectRedis();
      await disconnectDb();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
