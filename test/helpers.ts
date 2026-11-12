import { DatabaseSync } from 'node:sqlite';
import { Writable } from 'node:stream';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openReadOnlyDatabase } from '../src/db/sqlite.js';
import { createLogger } from '../src/logger.js';
import { createApiVersions, type ApiVersion } from '../src/versions.js';

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

let suppliedDb: DatabaseSync | undefined;

/**
 * Shared read-only connection to the supplied `db/movies.db`, resolved the same way
 * as in production. Read-only mode guarantees tests can't modify it.
 */
export function suppliedMoviesDb(): DatabaseSync {
  suppliedDb ??= openReadOnlyDatabase(loadConfig({}).V1_MOVIES_DB_PATH);
  return suppliedDb;
}

/** The production version wiring, backed by the supplied database. */
export function createTestVersions(db: DatabaseSync = suppliedMoviesDb()): ApiVersion[] {
  return createApiVersions({ v1MoviesDb: db });
}

/** Build the app with injected test dependencies. No network listener is opened. */
export function createTestApp(options: { versions?: ApiVersion[] } = {}) {
  const logs = createLogCapture();
  const app = createApp({
    logger: logs.logger,
    versions: options.versions ?? createTestVersions(),
  });
  return { app, logs: logs.lines };
}

export interface FixtureMovie {
  movieId: number;
  imdbId?: string;
  title?: string;
  genres?: string | null;
  releaseDate?: string | null;
  budget?: number | null;
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
    `INSERT INTO movies (movieId, imdbId, title, genres, releaseDate, budget)
     VALUES (:movieId, :imdbId, :title, :genres, :releaseDate, :budget)`,
  );
  for (const m of movies) {
    insert.run({
      movieId: m.movieId,
      imdbId: m.imdbId ?? `tt${String(m.movieId).padStart(7, '0')}`,
      title: m.title ?? `Fixture ${String(m.movieId)}`,
      genres: m.genres === undefined ? '[]' : m.genres,
      releaseDate: m.releaseDate === undefined ? '2000-01-01' : m.releaseDate,
      budget: m.budget === undefined ? 0 : m.budget,
    });
  }
  return db;
}
