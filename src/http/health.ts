import { Router } from 'express';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

export const HealthResponseSchema = z
  .object({ status: z.literal('ok') })
  .meta({ id: 'HealthResponse', description: 'Process liveness.' });

/**
 * Liveness only: answers 200 whenever the process can serve HTTP. It deliberately
 * does not touch databases or reveal configuration, so it stays cheap and safe to
 * expose and works before the V2 dataset exists.
 */
export function healthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' } satisfies z.infer<typeof HealthResponseSchema>);
  });
  return router;
}

export function registerHealthDocs(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['Operations'],
    summary: 'Liveness check',
    responses: {
      200: {
        description: 'The process is up.',
        content: { 'application/json': { schema: HealthResponseSchema } },
      },
    },
  });
}
