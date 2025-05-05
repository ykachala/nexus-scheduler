import crypto from 'crypto';
import { Booking, BookingStatus } from '@prisma/client';
import {
  createBooking,
  getBookingById,
  getBookingByIdempotencyKey,
  updateBooking,
  getConflictingBookings,
} from '@/db/bookingRepository';
import { withLock } from '@/booking/lockService';
import { invalidateAvailabilityCache } from '@/booking/availabilityService';
import { AppError } from '@/api/middleware/errorHandler';

export interface CreateBookingParams {
  tenantId: string;
  organizerId: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  idempotencyKey: string;
  participantIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface RescheduleParams {
  tenantId: string;
  bookingId: string;
  startTime: Date;
  endTime: Date;
  idempotencyKey?: string;
}

function generateConfirmationCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function lockKey(tenantId: string, organizerId: string, startTime: Date): string {
  return `${tenantId}:${organizerId}:${startTime.toISOString()}`;
}

export async function createBookingAtomic(params: CreateBookingParams): Promise<Booking> {
  const existing = await getBookingByIdempotencyKey(params.idempotencyKey);
  if (existing) return existing;

  if (params.startTime >= params.endTime) {
    throw new AppError(422, 'Start time must be before end time');
  }

  return withLock(lockKey(params.tenantId, params.organizerId, params.startTime), async () => {
    const conflicts = await getConflictingBookings(
      params.tenantId,
      params.organizerId,
      params.startTime,
      params.endTime,
    );

    if (conflicts.length > 0) {
      throw new AppError(409, 'Time slot is no longer available', 'SLOT_CONFLICT');
    }

    const booking = await createBooking({
      ...params,
      confirmationCode: generateConfirmationCode(),
    });

    await invalidateAvailabilityCache(params.tenantId, params.organizerId, params.startTime);
    return booking;
  });
}

export async function cancelBooking(
  bookingId: string,
  tenantId: string,
  userId: string,
): Promise<Booking> {
  const booking = await getBookingById(bookingId, tenantId);
  if (!booking) throw new AppError(404, 'Booking not found');
  if (booking.organizerId !== userId) throw new AppError(403, 'Not authorized to cancel this booking');
  if (booking.status === BookingStatus.CANCELLED) throw new AppError(409, 'Booking already cancelled');

  const updated = await updateBooking(bookingId, tenantId, { status: BookingStatus.CANCELLED });
  await invalidateAvailabilityCache(tenantId, userId, new Date(booking.startTime));
  return updated;
}

export async function rescheduleBooking(params: RescheduleParams): Promise<Booking> {
  const booking = await getBookingById(params.bookingId, params.tenantId);
  if (!booking) throw new AppError(404, 'Booking not found');
  if (booking.status === BookingStatus.CANCELLED) throw new AppError(409, 'Cannot reschedule a cancelled booking');

  if (params.startTime >= params.endTime) {
    throw new AppError(422, 'Start time must be before end time');
  }

  return withLock(
    lockKey(params.tenantId, booking.organizerId, params.startTime),
    async () => {
      const conflicts = await getConflictingBookings(
        params.tenantId,
        booking.organizerId,
        params.startTime,
        params.endTime,
        params.bookingId,
      );

      if (conflicts.length > 0) {
        throw new AppError(409, 'New time slot is not available', 'SLOT_CONFLICT');
      }

      const updated = await updateBooking(params.bookingId, params.tenantId, {
        startTime: params.startTime,
        endTime: params.endTime,
        status: BookingStatus.RESCHEDULED,
      });

      await invalidateAvailabilityCache(
        params.tenantId,
        booking.organizerId,
        new Date(booking.startTime),
      );
      await invalidateAvailabilityCache(params.tenantId, booking.organizerId, params.startTime);

      return updated;
    },
  );
}
