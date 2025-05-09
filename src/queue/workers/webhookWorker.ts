import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import { prisma } from '@/db/client';
import { getRedis } from '@/booking/lockService';
import { logger } from '@/config/logger';

interface WebhookJobData {
  event: string;
  tenantId: string;
  bookingId: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

async function deliverWebhook(job: Job<WebhookJobData>): Promise<void> {
  const { event, tenantId, payload, timestamp } = job.data;

  const webhooks = await prisma.webhook.findMany({
    where: { tenantId, isActive: true, events: { has: event } },
  });

  if (webhooks.length === 0) return;

  const body = JSON.stringify({ event, timestamp, data: payload });

  await Promise.allSettled(
    webhooks.map(async (webhook) => {
      const signature = crypto
        .createHmac('sha256', webhook.secret)
        .update(body)
        .digest('hex');

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Signature': `sha256=${signature}`,
          'X-Nexus-Event': event,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Webhook ${webhook.id} returned ${response.status}`);
      }

      logger.debug({ webhookId: webhook.id, event }, 'Webhook delivered');
    }),
  );
}

export const webhookWorker = new Worker<WebhookJobData>('webhooks', deliverWebhook, {
  connection: getRedis() as unknown as { host: string; port: number },
  concurrency: 5,
});

webhookWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Webhook delivery failed');
});
