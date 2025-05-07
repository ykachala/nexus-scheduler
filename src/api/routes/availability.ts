import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '@/api/middleware/auth';
import { getAvailableSlots } from '@/booking/availabilityService';

const router = Router();
router.use(requireAuth);

router.get('/availability', async (req, res, next) => {
  try {
    const query = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      organizerId: z.string().uuid().optional(),
      slotDurationMinutes: z.coerce.number().min(15).max(480).default(30),
    }).parse(req.query);

    const { tenantId, userId } = req.user!;
    const date = new Date(query.date + 'T00:00:00Z');

    const slots = await getAvailableSlots({
      tenantId,
      organizerId: query.organizerId ?? userId,
      date,
      slotDurationMinutes: query.slotDurationMinutes,
    });

    res.json({ date: query.date, slots });
  } catch (err) {
    next(err);
  }
});

export { router as availabilityRouter };
