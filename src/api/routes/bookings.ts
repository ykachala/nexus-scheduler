import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { requireAuth } from '@/api/middleware/auth';
import { AppError } from '@/api/middleware/errorHandler';
import { createBookingAtomic, cancelBooking, rescheduleBooking } from '@/booking/bookingService';
import { getBookingById, queryBookings } from '@/db/bookingRepository';
import { resolveIntent } from '@/ai/intentResolver';
import { dispatchBookingEvent } from '@/queue/queues';

const router = Router();

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  timezone: z.string().default('UTC'),
  participantIds: z.array(z.string().uuid()).optional(),
  idempotencyKey: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const intentSchema = z.object({
  message: z.string().min(1).max(1000),
});

router.use(requireAuth);

router.post('/bookings/intent', async (req, res, next) => {
  try {
    const { message } = intentSchema.parse(req.body);
    const { userId, tenantId } = req.user!;

    const intent = await resolveIntent(message, {
      userId,
      tenantId,
      currentTime: new Date().toISOString(),
      userTimezone: 'UTC',
    });

    res.json({ intent });
  } catch (err) {
    next(err);
  }
});

router.post('/bookings', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const { userId, tenantId } = req.user!;

    const booking = await createBookingAtomic({
      tenantId,
      organizerId: userId,
      title: body.title,
      description: body.description,
      startTime: new Date(body.startTime),
      endTime: new Date(body.endTime),
      timezone: body.timezone,
      idempotencyKey: body.idempotencyKey ?? crypto.randomUUID(),
      participantIds: body.participantIds,
      metadata: body.metadata,
    });

    await dispatchBookingEvent('booking.created', booking);
    res.status(201).json({ booking });
  } catch (err) {
    next(err);
  }
});

router.get('/bookings', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user!;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const [bookings, total] = await queryBookings({
      tenantId,
      organizerId: userId,
      limit,
      offset,
    });

    res.json({ bookings, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get('/bookings/:id', async (req, res, next) => {
  try {
    const { tenantId } = req.user!;
    const booking = await getBookingById(req.params.id, tenantId);
    if (!booking) throw new AppError(404, 'Booking not found');
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

router.patch('/bookings/:id', async (req, res, next) => {
  try {
    const body = z.object({
      startTime: z.string().datetime(),
      endTime: z.string().datetime(),
      timezone: z.string().default('UTC'),
      idempotencyKey: z.string().optional(),
    }).parse(req.body);

    const { tenantId } = req.user!;
    const booking = await rescheduleBooking({
      tenantId,
      bookingId: req.params.id,
      startTime: new Date(body.startTime),
      endTime: new Date(body.endTime),
    });

    await dispatchBookingEvent('booking.rescheduled', booking);
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

router.delete('/bookings/:id', async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user!;
    const booking = await cancelBooking(req.params.id, tenantId, userId);
    await dispatchBookingEvent('booking.cancelled', booking);
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

export { router as bookingsRouter };
