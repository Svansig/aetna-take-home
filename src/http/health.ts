import { Router } from 'express';
import { z } from 'zod';

export const HealthResponseSchema = z
  .object({ status: z.literal('ok') })
  .meta({ id: 'HealthResponse', description: 'Process liveness.' });

/**
 * Liveness only: answers 200 whenever the process can serve HTTP. It deliberately
 * does not touch databases or reveal configuration, so it stays cheap and safe to
 * expose.
 */
export function healthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' } satisfies z.infer<typeof HealthResponseSchema>);
  });
  return router;
}
