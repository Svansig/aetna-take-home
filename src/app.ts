import express, { type Express, type Router } from 'express';
import type { DatabaseSync } from './db/sqlite.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { healthRouter } from './http/health.js';
import { landingPage } from './http/landing.js';
import { requestLogger } from './http/request-logger.js';
import type { Logger } from './logger.js';
import { NaiveSqliteRatingSource } from './movies/naive-sqlite-rating-source.js';
import { createMoviesRouter } from './movies/routes.js';
import { MovieService } from './movies/service.js';
import { SqliteMovieRepository } from './movies/sqlite-movie-repository.js';
import { buildOpenApiDocument } from './openapi/document.js';
import { docsRouter } from './openapi/router.js';

/** URL prefix of every API operation. */
export const API_BASE_PATH = '/api/v1';

export interface AppDependencies {
  /** Root logger; each request gets a child logger. */
  readonly logger: Logger;
  /** Mounted at `API_BASE_PATH`; normally `createMoviesApi(...)`. */
  readonly apiRouter: Router;
}

/** Open connections; the caller owns their lifecycle. */
export interface MoviesApiDatabases {
  /** Connection to `movies.db`. */
  readonly moviesDb: DatabaseSync;
  /** Connection to `ratings.db`. */
  readonly ratingsDb: DatabaseSync;
}

/** Wires the movie routes to the SQLite-backed service. */
export function createMoviesApi({ moviesDb, ratingsDb }: MoviesApiDatabases): Router {
  return createMoviesRouter(
    new MovieService(new SqliteMovieRepository(moviesDb), new NaiveSqliteRatingSource(ratingsDb)),
  );
}

/** Builds the Express app. Doesn't listen or read `process.env`, so tests can inject dependencies. */
export function createApp({ logger, apiRouter }: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger(logger));
  app.use(landingPage());
  app.use(healthRouter());
  app.use(docsRouter(buildOpenApiDocument(API_BASE_PATH)));
  app.use(API_BASE_PATH, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
