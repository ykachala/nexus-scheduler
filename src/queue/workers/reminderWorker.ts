import { Worker, Job } from 'bullmq';
import { prisma } from '@/db/client';
import { getRedis } from '@/booking/lockService';
import { logger } from '@/config/logger';

interface ReminderJobData {
  bookingId: string;
  minutesBefore: number;
}

async function processReminder(job: Job<ReminderJobData>): Promise<void> {
  const { bookingId } = job.data;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { organizer: true, participants: { include: { user: true } } },
  });

  if (!booking || booking.status === 'CANCELLED') {
    logger.debug({ bookingId }, 'Reminder skipped: booking not found or cancelled');
    return;
  }

  const recipients = [
    booking.organizer,
    ...booking.participants.map(p => p.user),
  ];

  logger.info(
    { bookingId, recipients: recipients.map(r => r.email), minutesBefore: job.data.minutesBefore },
    'Booking reminder dispatched',
  );
}

export const reminderWorker = new Worker<ReminderJobData>('reminders', processReminder, {
  connection: getRedis() as unknown as { host: string; port: number },
  concurrency: 3,
});

reminderWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Reminder processing failed');
});
