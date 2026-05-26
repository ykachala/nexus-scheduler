import { getRedis } from '@/booking/lockService';
import { queryBookings } from '@/db/bookingRepository';

const CACHE_TTL_SECONDS = 30;

export interface TimeSlot {
  startTime: Date;
  endTime: Date;
  available: boolean;
}

export interface AvailabilityQuery {
  tenantId: string;
  organizerId: string;
  date: Date;
  slotDurationMinutes?: number;
  workdayStartHour?: number;
  workdayEndHour?: number;
}

function getCacheKey(tenantId: string, organizerId: string, date: string): string {
  return `availability:${tenantId}:${organizerId}:${date}`;
}

export async function getAvailableSlots(query: AvailabilityQuery): Promise<TimeSlot[]> {
  const {
    tenantId,
    organizerId,
    date,
    slotDurationMinutes = 30,
    workdayStartHour = 8,
    workdayEndHour = 18,
  } = query;

  const dateStr = date.toISOString().split('T')[0];
  const cacheKey = getCacheKey(tenantId, organizerId, dateStr);
  const redis = getRedis();

  const cached = await redis.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached) as TimeSlot[];
    return parsed.map(s => ({
      ...s,
      startTime: new Date(s.startTime),
      endTime: new Date(s.endTime),
    }));
  }

  const dayStart = new Date(date);
  dayStart.setUTCHours(workdayStartHour, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setUTCHours(workdayEndHour, 0, 0, 0);

  const [existingBookings] = await queryBookings({
    tenantId,
    organizerId,
    startAfter: dayStart,
    startBefore: dayEnd,
  });

  const slots: TimeSlot[] = [];
  const slotMs = slotDurationMinutes * 60 * 1000;
  let cursor = dayStart.getTime();

  while (cursor + slotMs <= dayEnd.getTime()) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(cursor + slotMs);

    const conflict = existingBookings.some(b => {
      const bStart = new Date(b.startTime).getTime();
      const bEnd = new Date(b.endTime).getTime();
      return bStart < slotEnd.getTime() && bEnd > cursor;
    });

    slots.push({ startTime: slotStart, endTime: slotEnd, available: !conflict });
    cursor += slotMs;
  }

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(slots));
  return slots;
}

export async function invalidateAvailabilityCache(
  tenantId: string,
  organizerId: string,
  date: Date,
): Promise<void> {
  const dateStr = date.toISOString().split('T')[0];
  const cacheKey = getCacheKey(tenantId, organizerId, dateStr);
  await getRedis().del(cacheKey);
}
