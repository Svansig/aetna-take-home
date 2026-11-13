import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { HealthResponseSchema } from '../http/health.js';

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
