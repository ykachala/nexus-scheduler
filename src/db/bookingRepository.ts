import { Booking, BookingStatus, Prisma } from '@prisma/client';
import { prisma } from '@/db/client';

export interface CreateBookingInput {
  tenantId: string;
  organizerId: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  idempotencyKey: string;
  confirmationCode: string;
  isRecurring?: boolean;
  recurrenceRule?: string;
  metadata?: Record<string, unknown>;
  participantIds?: string[];
}

export interface BookingQueryFilters {
  tenantId: string;
  organizerId?: string;
  status?: BookingStatus;
  startAfter?: Date;
  startBefore?: Date;
  limit?: number;
  offset?: number;
}

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  const { participantIds, ...data } = input;
  return prisma.booking.create({
    data: {
      ...data,
      participants: participantIds?.length
        ? {
            create: participantIds.map(userId => ({ userId })),
          }
        : undefined,
    },
    include: { participants: true },
  });
}

export async function getBookingById(id: string, tenantId: string): Promise<Booking | null> {
  return prisma.booking.findFirst({
    where: { id, tenantId },
    include: { participants: { include: { user: true } }, organizer: true },
  });
}

export async function getBookingByIdempotencyKey(key: string): Promise<Booking | null> {
  return prisma.booking.findUnique({ where: { idempotencyKey: key } });
}

export async function updateBooking(
  id: string,
  tenantId: string,
  data: Prisma.BookingUpdateInput,
): Promise<Booking> {
  return prisma.booking.update({ where: { id }, data });
}

export async function queryBookings(filters: BookingQueryFilters): Promise<[Booking[], number]> {
  const where: Prisma.BookingWhereInput = {
    tenantId: filters.tenantId,
    ...(filters.organizerId && { organizerId: filters.organizerId }),
    ...(filters.status && { status: filters.status }),
    ...(filters.startAfter || filters.startBefore
      ? {
          startTime: {
            ...(filters.startAfter && { gte: filters.startAfter }),
            ...(filters.startBefore && { lte: filters.startBefore }),
          },
        }
      : {}),
  };

  const [bookings, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      include: { participants: true },
      orderBy: { startTime: 'asc' },
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
    }),
    prisma.booking.count({ where }),
  ]);

  return [bookings, total];
}

export async function getConflictingBookings(
  tenantId: string,
  organizerId: string,
  startTime: Date,
  endTime: Date,
  excludeId?: string,
): Promise<Booking[]> {
  return prisma.booking.findMany({
    where: {
      tenantId,
      organizerId,
      status: { not: BookingStatus.CANCELLED },
      id: excludeId ? { not: excludeId } : undefined,
      OR: [
        { startTime: { lt: endTime }, endTime: { gt: startTime } },
      ],
    },
  });
}
