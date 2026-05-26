import { BookingStatus } from '@prisma/client';

jest.mock('@/db/bookingRepository');
jest.mock('@/booking/lockService', () => ({
  withLock: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
}));
jest.mock('@/booking/availabilityService', () => ({
  invalidateAvailabilityCache: jest.fn(),
}));

import {
  createBookingAtomic,
  cancelBooking,
} from '@/booking/bookingService';
import * as repo from '@/db/bookingRepository';

const mockRepo = repo as jest.Mocked<typeof repo>;

const baseBooking = {
  id: 'booking-1',
  tenantId: 'tenant-1',
  organizerId: 'user-1',
  title: 'Test Meeting',
  description: null,
  startTime: new Date('2025-06-10T10:00:00Z'),
  endTime: new Date('2025-06-10T11:00:00Z'),
  timezone: 'UTC',
  status: BookingStatus.CONFIRMED,
  idempotencyKey: 'idem-1',
  confirmationCode: 'ABCD1234',
  isRecurring: false,
  recurrenceRule: null,
  parentBookingId: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createBookingAtomic', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns existing booking on duplicate idempotency key', async () => {
    mockRepo.getBookingByIdempotencyKey.mockResolvedValueOnce(baseBooking);
    const result = await createBookingAtomic({
      tenantId: 'tenant-1',
      organizerId: 'user-1',
      title: 'Test',
      startTime: new Date('2025-06-10T10:00:00Z'),
      endTime: new Date('2025-06-10T11:00:00Z'),
      timezone: 'UTC',
      idempotencyKey: 'idem-1',
    });
    expect(result).toBe(baseBooking);
    expect(mockRepo.createBooking).not.toHaveBeenCalled();
  });

  it('throws 409 when conflicting booking exists', async () => {
    mockRepo.getBookingByIdempotencyKey.mockResolvedValueOnce(null);
    mockRepo.getConflictingBookings.mockResolvedValueOnce([baseBooking]);

    await expect(
      createBookingAtomic({
        tenantId: 'tenant-1',
        organizerId: 'user-1',
        title: 'Test',
        startTime: new Date('2025-06-10T10:00:00Z'),
        endTime: new Date('2025-06-10T11:00:00Z'),
        timezone: 'UTC',
        idempotencyKey: 'idem-new',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_CONFLICT' });
  });

  it('throws 422 when start is after end', async () => {
    mockRepo.getBookingByIdempotencyKey.mockResolvedValueOnce(null);

    await expect(
      createBookingAtomic({
        tenantId: 'tenant-1',
        organizerId: 'user-1',
        title: 'Test',
        startTime: new Date('2025-06-10T11:00:00Z'),
        endTime: new Date('2025-06-10T10:00:00Z'),
        timezone: 'UTC',
        idempotencyKey: 'idem-new',
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('cancelBooking', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 for unknown booking', async () => {
    mockRepo.getBookingById.mockResolvedValueOnce(null);
    await expect(cancelBooking('unknown', 'tenant-1', 'user-1')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 409 for already-cancelled booking', async () => {
    mockRepo.getBookingById.mockResolvedValueOnce({ ...baseBooking, status: BookingStatus.CANCELLED });
    await expect(cancelBooking('booking-1', 'tenant-1', 'user-1')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('throws 403 when user is not the organizer', async () => {
    mockRepo.getBookingById.mockResolvedValueOnce({ ...baseBooking, organizerId: 'other-user' });
    await expect(cancelBooking('booking-1', 'tenant-1', 'user-1')).rejects.toMatchObject({ statusCode: 403 });
  });
});
