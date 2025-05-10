jest.mock('@/booking/lockService', () => ({
  getRedis: jest.fn(() => ({
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn(),
    del: jest.fn(),
  })),
}));
jest.mock('@/db/bookingRepository');

import { getAvailableSlots } from '@/booking/availabilityService';
import * as repo from '@/db/bookingRepository';

const mockRepo = repo as jest.Mocked<typeof repo>;

describe('getAvailableSlots', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns slots for a full workday with no bookings', async () => {
    mockRepo.queryBookings.mockResolvedValueOnce([[], 0]);

    const slots = await getAvailableSlots({
      tenantId: 'tenant-1',
      organizerId: 'user-1',
      date: new Date('2025-06-10T00:00:00Z'),
      slotDurationMinutes: 30,
      workdayStartHour: 8,
      workdayEndHour: 10,
    });

    // 8am-10am in 30-min slots = 4 slots
    expect(slots).toHaveLength(4);
    expect(slots.every(s => s.available)).toBe(true);
  });

  it('marks conflicting slots as unavailable', async () => {
    const existingBooking = {
      id: 'b1',
      startTime: new Date('2025-06-10T08:00:00Z'),
      endTime: new Date('2025-06-10T09:00:00Z'),
      status: 'CONFIRMED' as const,
    } as import('@prisma/client').Booking;

    mockRepo.queryBookings.mockResolvedValueOnce([[existingBooking], 1]);

    const slots = await getAvailableSlots({
      tenantId: 'tenant-1',
      organizerId: 'user-1',
      date: new Date('2025-06-10T00:00:00Z'),
      slotDurationMinutes: 30,
      workdayStartHour: 8,
      workdayEndHour: 10,
    });

    const unavailable = slots.filter(s => !s.available);
    expect(unavailable).toHaveLength(2); // 08:00 and 08:30 blocked
    expect(slots[2].available).toBe(true); // 09:00 free
    expect(slots[3].available).toBe(true); // 09:30 free
  });
});
