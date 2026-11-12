import express, { type Express } from 'express';
import { buildOpenApiDocument, docsRouter } from './docs/openapi.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { healthRouter } from './http/health.js';
import { requestLogger } from './http/request-logger.js';
import type { Logger } from './logger.js';
import { apiBasePath, type ApiVersion } from './versions.js';

export interface AppDependencies {
  readonly logger: Logger;
  readonly versions: readonly ApiVersion[];
}

/**
 * Build the Express application. It doesn't listen on a port or read
 * `process.env`, so tests can construct it with their own dependencies and drive
 * it with Supertest.
 */
export function createApp({ logger, versions }: AppDependencies): Express {
  const ids = versions.map((v) => v.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Duplicate API version ids: ${ids.join(', ')}`);
  }

  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger(logger));
  app.use(healthRouter());
  app.use(docsRouter(buildOpenApiDocument(versions)));

  for (const version of versions) {
    app.use(apiBasePath(version.id), version.router);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
