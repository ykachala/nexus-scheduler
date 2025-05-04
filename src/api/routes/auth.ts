import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '@/db/client';
import {
  getUserByEmail,
  createUser,
  createRefreshToken,
  getRefreshToken,
  deleteRefreshToken,
  deleteUserRefreshTokens,
} from '@/db/userRepository';
import { signAccessToken, signRefreshToken, verifyToken, requireAuth } from '@/api/middleware/auth';
import { AppError } from '@/api/middleware/errorHandler';
import { config } from '@/config';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  tenantName: z.string().min(1).optional(),
  timezone: z.string().default('UTC'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post('/auth/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const existing = await getUserByEmail(body.email);
    if (existing) throw new AppError(409, 'Email already registered');

    const tenant = await prisma.tenant.create({
      data: { name: body.tenantName ?? body.email.split('@')[0] },
    });

    const passwordHash = await bcrypt.hash(body.password, config.BCRYPT_ROUNDS);
    const user = await createUser({
      tenantId: tenant.id,
      email: body.email,
      passwordHash,
      timezone: body.timezone,
      role: 'admin',
    });

    const accessToken = signAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });
    const refreshToken = signRefreshToken({ userId: user.id });
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await createRefreshToken(user.id, refreshToken, expiresAt);

    res.status(201).json({ accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await getUserByEmail(body.email);
    if (!user) throw new AppError(401, 'Invalid credentials');

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) throw new AppError(401, 'Invalid credentials');

    const accessToken = signAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });
    const refreshToken = signRefreshToken({ userId: user.id });
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await createRefreshToken(user.id, refreshToken, expiresAt);

    res.json({ accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    const stored = await getRefreshToken(refreshToken);
    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError(401, 'Invalid or expired refresh token');
    }

    const { user } = stored;
    await deleteRefreshToken(refreshToken);

    const newAccess = signAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });
    const newRefresh = signRefreshToken({ userId: user.id });
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await createRefreshToken(user.id, newRefresh, expiresAt);

    res.json({ accessToken: newAccess, refreshToken: newRefresh });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/logout', requireAuth, async (req, res, next) => {
  try {
    await deleteUserRefreshTokens(req.user!.userId);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

export { router as authRouter };
