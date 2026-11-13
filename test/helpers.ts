import { DatabaseSync } from 'node:sqlite';
import { Writable } from 'node:stream';
import type { Router } from 'express';
import { createApp, createMoviesApi } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openReadOnlyDatabase } from '../src/db/sqlite.js';
import { createLogger } from '../src/logger.js';

/** Captures structured log lines emitted during a test. */
export function createLogCapture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, callback) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  return { lines, logger: createLogger('info', stream) };
}

let suppliedMovies: DatabaseSync | undefined;
let suppliedRatings: DatabaseSync | undefined;

/**
 * Shared read-only connections to the supplied `db/movies.db` and `db/ratings.db`,
 * resolved the same way as in production. Read-only mode guarantees tests can't
 * modify them.
 */
export function suppliedMoviesDb(): DatabaseSync {
  suppliedMovies ??= openReadOnlyDatabase(loadConfig({}).MOVIES_DB_PATH);
  return suppliedMovies;
}

export function suppliedRatingsDb(): DatabaseSync {
  suppliedRatings ??= openReadOnlyDatabase(loadConfig({}).RATINGS_DB_PATH);
  return suppliedRatings;
}

/** The production movie API wiring, backed by the supplied databases by default. */
export function createTestApiRouter(
  moviesDb: DatabaseSync = suppliedMoviesDb(),
  ratingsDb: DatabaseSync = suppliedRatingsDb(),
): Router {
  return createMoviesApi({ moviesDb, ratingsDb });
}

/** Build the app with injected test dependencies. No network listener is opened. */
export function createTestApp(options: { apiRouter?: Router } = {}) {
  const logs = createLogCapture();
  const app = createApp({
    logger: logs.logger,
    apiRouter: options.apiRouter ?? createTestApiRouter(),
  });
  return { app, logs: logs.lines };
}

/** One `movies` row. Omitted columns get a valid default; pass `null` to store NULL. */
export interface FixtureMovie {
  /** Primary key. */
  movieId: number;
  /** Defaults to `tt` plus the zero-padded `movieId`. */
  imdbId?: string;
  /** Defaults to `Fixture <movieId>`. */
  title?: string;
  /** Raw JSON text; defaults to `[]`. */
  genres?: string | null;
  /** Raw text; defaults to `2000-01-01`. */
  releaseDate?: string | null;
  /** Defaults to 0. */
  budget?: number | null;
  /** Defaults to `An overview.` */
  overview?: string | null;
  /** Minutes, or a string to reproduce the source's `''`; defaults to 90. */
  runtime?: number | string | null;
  /** Defaults to NULL. */
  language?: string | null;
  /** Raw JSON text; defaults to `[]`. */
  productionCompanies?: string | null;
}

/**
 * In-memory database with the same `movies` schema as the supplied file, for
 * edge cases the real data doesn't contain. Values are deliberately synthetic.
 */
export function createFixtureMoviesDb(movies: FixtureMovie[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE movies (movieId INTEGER PRIMARY KEY, imdbId TEXT NOT NULL,
    title TEXT NOT NULL, overview TEXT, productionCompanies TEXT, releaseDate TEXT,
    budget INTEGER, revenue INTEGER, runtime REAL, language TEXT, genres TEXT, status TEXT)`);
  const insert = db.prepare(
    `INSERT INTO movies (movieId, imdbId, title, genres, releaseDate, budget,
                         overview, runtime, language, productionCompanies)
     VALUES (:movieId, :imdbId, :title, :genres, :releaseDate, :budget,
             :overview, :runtime, :language, :productionCompanies)`,
  );
  for (const m of movies) {
    insert.run({
      movieId: m.movieId,
      imdbId: m.imdbId ?? `tt${String(m.movieId).padStart(7, '0')}`,
      title: m.title ?? `Fixture ${String(m.movieId)}`,
      genres: m.genres === undefined ? '[]' : m.genres,
      releaseDate: m.releaseDate === undefined ? '2000-01-01' : m.releaseDate,
      budget: m.budget === undefined ? 0 : m.budget,
      overview: m.overview === undefined ? 'An overview.' : m.overview,
      runtime: m.runtime === undefined ? 90 : m.runtime,
      language: m.language === undefined ? null : m.language,
      productionCompanies: m.productionCompanies === undefined ? '[]' : m.productionCompanies,
    });
  }
  return db;
}

/**
 * In-memory database with the same `ratings` schema as the supplied file. Each
 * entry is `[movieId, rating]`; users and timestamps are synthetic.
 */
export function createFixtureRatingsDb(ratings: [movieId: number, rating: number][]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ratings (ratingId INTEGER PRIMARY KEY, userId INTEGER NOT NULL,
    movieId INTEGER NOT NULL, rating REAL NOT NULL, timestamp INTEGER NOT NULL)`);
  const insert = db.prepare(
    'INSERT INTO ratings (userId, movieId, rating, timestamp) VALUES (?, ?, ?, 0)',
  );
  ratings.forEach(([movieId, rating], i) => insert.run(i + 1, movieId, rating));
  return db;
}

/**
 * Test oracle for budgets: whole dollars as `$1,234,567`. Deliberately built
 * with a regex rather than `Intl.NumberFormat`, so it is independent of `formatUsd`.
 */
export function usd(dollars: number): string {
  return `$${String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
