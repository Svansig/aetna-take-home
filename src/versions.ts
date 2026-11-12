import { Router } from 'express';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { DatabaseSync } from './db/sqlite.js';
import { NaiveSqliteRatingSource } from './movies/naive-sqlite-rating-source.js';
import { registerMoviesDocs, createMoviesRouter } from './movies/routes.js';
import { MovieService } from './movies/service.js';
import { SqliteMovieRepository } from './movies/sqlite-movie-repository.js';

export type ApiVersionId = 'v1' | 'v2';

/**
 * A mountable API version. Shared HTTP infrastructure (logging, docs, errors,
 * 404s) lives in `createApp`; a version only contributes its router and the
 * OpenAPI paths for the routes it serves.
 *
 * Both versions are intended to share route handlers, public schemas and
 * business logic, differing only in the data-access dependencies they are
 * constructed with (V1: original supplied databases; V2: rebuilt dataset).
 */
export interface ApiVersion {
  readonly id: ApiVersionId;
  readonly router: Router;
  /** Register this version's operations; `basePath` is e.g. `/api/v1`. */
  readonly registerDocs?: (registry: OpenAPIRegistry, basePath: string) => void;
}

export const apiBasePath = (id: ApiVersionId): string => `/api/${id}`;

/** Open connections owned by the caller (opened at startup, closed at shutdown). */
export interface ApiVersionDependencies {
  readonly v1MoviesDb: DatabaseSync;
  readonly v1RatingsDb: DatabaseSync;
}

/**
 * Composition root for the versioned APIs: wires each version's data access into
 * the shared service and router factories.
 *
 * - v1: `GET /movies` and `GET /movies/:movieId` over the original supplied
 *   `movies.db`, with ratings from `ratings.db` matched by the naive numeric id
 *   association (see `NaiveSqliteRatingSource`).
 * - v2: mounted with no operations yet, so its requests reach the shared 404.
 */
export function createApiVersions({
  v1MoviesDb,
  v1RatingsDb,
}: ApiVersionDependencies): ApiVersion[] {
  const v1Movies = new MovieService(
    new SqliteMovieRepository(v1MoviesDb),
    new NaiveSqliteRatingSource(v1RatingsDb),
  );

  return [
    {
      id: 'v1',
      router: createMoviesRouter(v1Movies),
      registerDocs: (registry, basePath) => {
        registerMoviesDocs(registry, { basePath, version: 'v1' });
      },
    },
    { id: 'v2', router: Router() },
  ];
}
