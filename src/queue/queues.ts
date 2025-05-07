import { Queue, Worker } from 'bullmq';
import { getRedis } from '@/booking/lockService';
import { logger } from '@/config/logger';

export const webhookQueue = new Queue('webhooks', {
  connection: getRedis() as unknown as { host: string; port: number },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const reminderQueue = new Queue('reminders', {
  connection: getRedis() as unknown as { host: string; port: number },
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: 50,
  },
});

export async function dispatchBookingEvent(
  event: 'booking.created' | 'booking.cancelled' | 'booking.rescheduled',
  booking: { id: string; tenantId: string; [key: string]: unknown },
): Promise<void> {
  await webhookQueue.add('deliver', {
    event,
    tenantId: booking.tenantId,
    bookingId: booking.id,
    payload: booking,
    timestamp: new Date().toISOString(),
  });
  logger.debug({ event, bookingId: booking.id }, 'Booking event queued');
}

const workers: Worker[] = [];

export async function startWorkers(): Promise<void> {
  const { webhookWorker } = await import('@/queue/workers/webhookWorker');
  const { reminderWorker } = await import('@/queue/workers/reminderWorker');
  workers.push(webhookWorker, reminderWorker);
  logger.info('BullMQ workers started');
}

export async function closeQueues(): Promise<void> {
  await Promise.all(workers.map(w => w.close()));
  await webhookQueue.close();
  await reminderQueue.close();
  logger.info('BullMQ queues closed');
}
