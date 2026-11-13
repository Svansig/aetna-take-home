import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { OpenApiDocument } from './document.js';

/** Serves the machine-readable document and Swagger UI. */
export function docsRouter(document: OpenApiDocument): Router {
  const router = Router();
  router.get('/openapi.json', (_req, res) => {
    res.json(document);
  });
  // serveFiles (not `serve`) keeps the document scoped to this router instance.
  router.use(
    '/docs',
    swaggerUi.serveFiles(document),
    swaggerUi.setup(document, { customSiteTitle: 'Movie Services API' }),
  );
  return router;
}
