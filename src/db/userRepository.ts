import { User } from '@prisma/client';
import { prisma } from '@/db/client';

export async function createUser(data: {
  tenantId: string;
  email: string;
  passwordHash: string;
  timezone?: string;
  role?: string;
}): Promise<User> {
  return prisma.user.create({ data });
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } });
}

export async function getUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export async function createRefreshToken(
  userId: string,
  token: string,
  expiresAt: Date,
): Promise<void> {
  await prisma.refreshToken.create({ data: { userId, token, expiresAt } });
}

export async function getRefreshToken(token: string) {
  return prisma.refreshToken.findUnique({
    where: { token },
    include: { user: true },
  });
}

export async function deleteRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { token } });
}

export async function deleteUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}
