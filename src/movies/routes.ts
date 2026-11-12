import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { Router } from 'express';
import { ErrorResponseSchema } from '../http/errors.js';
import { PAGE_SIZE, PageQuerySchema } from '../http/pagination.js';
import type { ApiVersionId } from '../versions.js';
import { MovieListResponseSchema, type MovieListResponse } from './schemas.js';
import type { MovieService } from './service.js';

/** Movie routes, shared by every API version; only the injected service differs. */
export function createMoviesRouter(service: MovieService): Router {
  const router = Router();

  router.get('/movies', (req, res) => {
    // A ZodError here becomes a 400 in the central error handler.
    const { page } = PageQuerySchema.parse(req.query);
    res.json(service.listMovies(page));
  });

  return router;
}

/**
 * The first three movies of page 1 in the supplied V1 database, verbatim. A test
 * checks them against the database so the documentation can't drift.
 */
export const V1_FIRST_PAGE_EXAMPLE: MovieListResponse = {
  data: [
    {
      imdbId: 'tt0094675',
      title: 'Ariel',
      genres: [
        { id: 18, name: 'Drama' },
        { id: 80, name: 'Crime' },
      ],
      releaseDate: '1988-10-21',
      budget: 0,
    },
    {
      imdbId: 'tt0092149',
      title: 'Shadows in Paradise',
      genres: [
        { id: 18, name: 'Drama' },
        { id: 35, name: 'Comedy' },
      ],
      releaseDate: '1986-10-16',
      budget: 0,
    },
    {
      imdbId: 'tt0113101',
      title: 'Four Rooms',
      genres: [
        { id: 80, name: 'Crime' },
        { id: 35, name: 'Comedy' },
      ],
      releaseDate: '1995-12-09',
      budget: 4000000,
    },
  ],
  pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 45430, totalPages: 909 },
};

export function registerMoviesDocs(
  registry: OpenAPIRegistry,
  { basePath, version }: { basePath: string; version: ApiVersionId },
): void {
  const totals = V1_FIRST_PAGE_EXAMPLE.pagination;

  registry.registerPath({
    method: 'get',
    path: `${basePath}/movies`,
    operationId: `listMovies${version.toUpperCase()}`,
    tags: [`Movies (${version})`],
    summary: 'List all movies',
    description: [
      `Returns every movie, ${String(PAGE_SIZE)} per page, ordered by the internal movie id`,
      '(ascending). The order is stable but has no meaning to clients.',
      '',
      '* `page` is 1-indexed and defaults to 1. The page size is fixed.',
      '* A page past the end returns `200` with `data: []` and accurate `pagination`.',
      '* `budget` is in whole US dollars. `releaseDate` is a `YYYY-MM-DD` date or `null`.',
      '* Unknown query parameters are ignored. A repeated `page` is rejected.',
    ].join('\n'),
    request: { query: PageQuerySchema },
    responses: {
      200: {
        description: 'One page of movies.',
        content: {
          'application/json': {
            schema: MovieListResponseSchema,
            examples: {
              firstPage: {
                summary: 'Page 1 (truncated here to its first 3 of 50 movies)',
                value: V1_FIRST_PAGE_EXAMPLE,
              },
              pastTheEnd: {
                summary: 'A page past the end',
                value: { data: [], pagination: { ...totals, page: 1000 } },
              },
            },
          },
        },
      },
      400: {
        description: 'Invalid `page` parameter.',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
            example: {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Request validation failed',
                details: [{ path: 'page', message: 'page must be at least 1' }],
                requestId: '6f1c1c3e-2b8e-4d55-9b0c-2f1f5a3c9e21',
              },
            },
          },
        },
      },
      500: {
        description: 'Unexpected error. Details are logged server-side, never returned.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });
}
