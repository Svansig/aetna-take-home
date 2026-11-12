import express, { type Express, type Router } from 'express';
import type { DatabaseSync } from './db/sqlite.js';
import { buildOpenApiDocument, docsRouter } from './docs/openapi.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { healthRouter } from './http/health.js';
import { requestLogger } from './http/request-logger.js';
import type { Logger } from './logger.js';
import { NaiveSqliteRatingSource } from './movies/naive-sqlite-rating-source.js';
import { createMoviesRouter } from './movies/routes.js';
import { MovieService } from './movies/service.js';
import { SqliteMovieRepository } from './movies/sqlite-movie-repository.js';

/** URL prefix of every API operation. */
export const API_BASE_PATH = '/api/v1';

export interface AppDependencies {
  readonly logger: Logger;
  /** Mounted at `API_BASE_PATH`; normally `createMoviesApi(...)`. */
  readonly apiRouter: Router;
}

/** Open connections owned by the caller (opened at startup, closed at shutdown). */
export interface MoviesApiDatabases {
  readonly moviesDb: DatabaseSync;
  readonly ratingsDb: DatabaseSync;
}

/**
 * Composition root for the movie API: `GET /movies` (optional `year`, `genre`,
 * `sortOrder`), `GET /movies/year/:year`, `GET /movies/genre/:genre` and
 * `GET /movies/:movieId` over the supplied `movies.db`, with ratings from
 * `ratings.db` matched by the naive numeric id association (see
 * `NaiveSqliteRatingSource`).
 */
export function createMoviesApi({ moviesDb, ratingsDb }: MoviesApiDatabases): Router {
  return createMoviesRouter(
    new MovieService(new SqliteMovieRepository(moviesDb), new NaiveSqliteRatingSource(ratingsDb)),
  );
}

/**
 * Build the Express application. It doesn't listen on a port or read
 * `process.env`, so tests can construct it with their own dependencies and drive
 * it with Supertest.
 */
export function createApp({ logger, apiRouter }: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger(logger));
  app.use(healthRouter());
  app.use(docsRouter(buildOpenApiDocument(API_BASE_PATH)));
  app.use(API_BASE_PATH, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
