import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { PROJECT_ROOT } from '../config.js';
import { ErrorResponseSchema } from '../http/errors.js';
import { registerHealthDocs } from '../http/health.js';
import { apiBasePath, type ApiVersion } from '../versions.js';

export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

const DESCRIPTION = `
Read-only API over a movie metadata dataset and a user ratings dataset.

## Versions

| Prefix | Dataset | Notes |
| --- | --- | --- |
| \`/api/v1\` | The original supplied SQLite databases, used unmodified. | Preserves known source-data limitations (for example, the movies and ratings databases use different movie identifier systems). |
| \`/api/v2\` | A dataset rebuilt from the original Kaggle source files. | Planned: corrected identifier mappings and data transformations. |

Both versions share request validation, response schemas, pagination and error
conventions. Only the data behind them differs.

## Status

\`/api/v1\` implements every movie operation listed below. Its average ratings
are matched to movies by a mismatched id and may belong to a different movie
(see \`GET /api/v1/movies/{movieId}\`). \`/api/v2\` is mounted but has no
operations yet, so its requests return 404.

## Conventions

* Every error response uses the \`ErrorResponse\` schema.
* Operations are tagged \`<Resource> (<version>)\`, for example \`Movies (v1)\`.
  Version-independent endpoints use the \`Operations\` tag.
`.trim();

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

/**
 * Build the OpenAPI 3.1 document from Zod schemas registered by shared
 * infrastructure and by each mounted API version.
 */
export function buildOpenApiDocument(versions: readonly ApiVersion[]): OpenApiDocument {
  const registry = new OpenAPIRegistry();
  registerHealthDocs(registry);
  for (const version of versions) {
    version.registerDocs?.(registry, apiBasePath(version.id));
  }

  // Schemas named via `.meta({ id })` become components automatically when an
  // operation references them. ErrorResponse is passed explicitly so the shared
  // error contract is published even before any operation can return it.
  // (A schema definition entry is used rather than `registry.register`, which
  // requires the global `extendZodWithOpenApi` patch.)
  const definitions = [
    ...registry.definitions,
    { type: 'schema' as const, schema: ErrorResponseSchema },
  ];

  return new OpenApiGeneratorV31(definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Movie Services API',
      version: readPackageVersion(),
      description: DESCRIPTION,
    },
    // Relative URL: works unchanged behind a reverse proxy or Cloudflare Tunnel.
    servers: [{ url: '/', description: 'This server' }],
    tags: [{ name: 'Operations', description: 'Version-independent operational endpoints.' }],
  });
}

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
