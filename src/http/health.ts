import { Router } from 'express';
import { z } from 'zod';

export const HealthResponseSchema = z
  .object({
    /** Always `ok`; any other outcome is no response at all. */
    status: z.literal('ok'),
  })
  .meta({ id: 'HealthResponse', description: 'Process liveness.' });

/** Liveness only. It deliberately doesn't touch the databases, so it stays cheap and safe to expose. */
export function healthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' } satisfies z.infer<typeof HealthResponseSchema>);
  });
  return router;
}
