import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { PROJECT_ROOT } from '../config.js';
import { ErrorResponseSchema } from '../http/errors.js';
import { registerHealthDocs } from '../http/health.js';
import { registerMoviesDocs } from '../movies/routes.js';

export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

const DESCRIPTION = `
Read-only API over the supplied movie metadata and user ratings SQLite
databases, which are used unmodified.

## Operations

* \`GET /api/v1/movies\`: every movie, 50 per page, optionally filtered by
  \`year\` and/or \`genre\` (combined with AND).
* \`GET /api/v1/movies/{movieId}\`: one movie with its average rating.
* \`GET /api/v1/movies/year/{year}\`: movies released in a year, chronologically.
* \`GET /api/v1/movies/genre/{genre}\`: movies in a genre, by name or id.

## Known source-data limitations

The supplied data is served as-is, without repair:

* **Average ratings may belong to a different movie.** The movies database uses
  TMDB ids and the ratings database uses MovieLens ids, and ratings are matched by
  the raw number (see \`GET /api/v1/movies/{movieId}\`).
* \`originalLanguage\` is always \`null\`: the supplied database has no values.
* \`productionCompanies\` is \`[]\` for the 483 movies whose stored JSON is malformed.
* A stored budget of \`0\` is returned as \`$0\`.

## Conventions

* Every error response uses the \`ErrorResponse\` schema.
* Movie operations use the \`Movies\` tag; \`/health\` uses \`Operations\`.
`.trim();

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

/**
 * Build the OpenAPI 3.1 document from the Zod schemas of `/health` and of the
 * movie operations mounted under `apiBasePath`.
 */
export function buildOpenApiDocument(apiBasePath: string): OpenApiDocument {
  const registry = new OpenAPIRegistry();
  registerHealthDocs(registry);
  registerMoviesDocs(registry, apiBasePath);

  // Schemas named via `.meta({ id })` become components automatically when an
  // operation references them. ErrorResponse is passed explicitly so the shared
  // error contract is always published as a named component.
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
    tags: [
      { name: 'Movies', description: 'Movie listings, filters and details.' },
      { name: 'Operations', description: 'Operational endpoints.' },
    ],
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
