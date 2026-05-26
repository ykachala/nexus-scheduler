import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { requireAuth } from '@/api/middleware/auth';
import { prisma } from '@/db/client';

const router = Router();
router.use(requireAuth);

const VALID_EVENTS = ['booking.created', 'booking.cancelled', 'booking.rescheduled'] as const;

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
});

router.post('/webhooks', async (req, res, next) => {
  try {
    const body = createWebhookSchema.parse(req.body);
    const { tenantId } = req.user!;
    const secret = crypto.randomBytes(32).toString('hex');

    const webhook = await prisma.webhook.create({
      data: {
        tenantId,
        url: body.url,
        events: body.events,
        secret,
      },
    });

    res.status(201).json({ webhook: { ...webhook, secret } });
  } catch (err) {
    next(err);
  }
});

router.get('/webhooks', async (req, res, next) => {
  try {
    const { tenantId } = req.user!;
    const webhooks = await prisma.webhook.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, url: true, events: true, isActive: true, createdAt: true },
    });
    res.json({ webhooks });
  } catch (err) {
    next(err);
  }
});

router.delete('/webhooks/:id', async (req, res, next) => {
  try {
    const { tenantId } = req.user!;
    await prisma.webhook.updateMany({
      where: { id: req.params.id, tenantId },
      data: { isActive: false },
    });
    res.json({ message: 'Webhook deregistered' });
  } catch (err) {
    next(err);
  }
});

export { router as webhooksRouter };
