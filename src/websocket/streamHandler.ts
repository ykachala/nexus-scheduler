import { WebSocket } from 'ws';
import { z } from 'zod';
import crypto from 'crypto';
import { JwtPayload } from '@/api/middleware/auth';
import { resolveIntent } from '@/ai/intentResolver';
import { createBookingAtomic, cancelBooking, rescheduleBooking } from '@/booking/bookingService';
import { getAvailableSlots } from '@/booking/availabilityService';
import { queryBookings } from '@/db/bookingRepository';
import { dispatchBookingEvent } from '@/queue/queues';
import { logger } from '@/config/logger';

const messageSchema = z.object({
  type: z.literal('intent'),
  message: z.string().min(1).max(1000),
  requestId: z.string().optional(),
});

function send(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export async function handleStreamMessage(
  ws: WebSocket,
  raw: unknown,
  user: JwtPayload,
): Promise<void> {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) {
    send(ws, { type: 'error', message: 'Invalid message format' });
    return;
  }

  const { message, requestId } = parsed.data;
  const { userId, tenantId } = user;

  send(ws, { type: 'processing', requestId, message: 'Resolving your request...' });

  try {
    const intent = await resolveIntent(
      message,
      { userId, tenantId, currentTime: new Date().toISOString(), userTimezone: 'UTC' },
      (delta) => send(ws, { type: 'stream', requestId, delta }),
    );

    send(ws, { type: 'resolved', requestId, intent });

    if (intent.action === 'clarification_needed') {
      send(ws, { type: 'clarification', requestId, message: intent.parameters.message });
      return;
    }

    const result = await executeIntent(intent, userId, tenantId);
    send(ws, { type: 'confirmed', requestId, result });
  } catch (err) {
    logger.error({ err, userId }, 'WebSocket intent handling error');
    const message = err instanceof Error ? err.message : 'An error occurred';
    send(ws, { type: 'error', requestId, message });
  }
}

async function executeIntent(
  intent: { action: string; parameters: Record<string, unknown> },
  userId: string,
  tenantId: string,
): Promise<unknown> {
  const p = intent.parameters;

  switch (intent.action) {
    case 'create_booking': {
      const booking = await createBookingAtomic({
        tenantId,
        organizerId: userId,
        title: String(p.title),
        description: p.description ? String(p.description) : undefined,
        startTime: new Date(String(p.start_time)),
        endTime: new Date(String(p.end_time)),
        timezone: String(p.timezone ?? 'UTC'),
        idempotencyKey: crypto.randomUUID(),
      });
      await dispatchBookingEvent('booking.created', booking);
      return { booking };
    }

    case 'cancel_booking': {
      const cancelled = await cancelBooking(String(p.booking_id), tenantId, userId);
      await dispatchBookingEvent('booking.cancelled', cancelled);
      return { booking: cancelled };
    }

    case 'reschedule_booking': {
      const rescheduled = await rescheduleBooking({
        tenantId,
        bookingId: String(p.booking_id),
        startTime: new Date(String(p.new_start_time)),
        endTime: new Date(String(p.new_end_time)),
      });
      await dispatchBookingEvent('booking.rescheduled', rescheduled);
      return { booking: rescheduled };
    }

    case 'query_availability': {
      const slots = await getAvailableSlots({
        tenantId,
        organizerId: userId,
        date: new Date(String(p.date) + 'T00:00:00Z'),
        slotDurationMinutes: p.duration_minutes ? Number(p.duration_minutes) : 30,
      });
      return { slots };
    }

    case 'query_bookings': {
      const [bookings] = await queryBookings({
        tenantId,
        organizerId: userId,
        startAfter: p.start_after ? new Date(String(p.start_after)) : undefined,
        startBefore: p.start_before ? new Date(String(p.start_before)) : undefined,
      });
      return { bookings };
    }

    default:
      throw new Error(`Unknown action: ${intent.action}`);
  }
}
