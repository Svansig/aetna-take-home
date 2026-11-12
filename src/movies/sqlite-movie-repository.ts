import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { z } from 'zod';
import { DataIntegrityError } from '../db/sqlite.js';
import type { MovieRepository } from './repository.js';
import { MovieSummarySchema, type MovieSummary } from './schemas.js';

/** Raw column types as stored in the V1 `movies` table. */
const MovieRowSchema = z.object({
  movieId: z.int(),
  imdbId: z.string(),
  title: z.string(),
  genres: z.string(),
  releaseDate: z.string().nullable(),
  budget: z.int(),
});

type MovieRow = z.infer<typeof MovieRowSchema>;

/**
 * V1 movie repository over the original supplied `movies.db`.
 *
 * Statements are prepared once per connection. `movieId` is the table's INTEGER
 * PRIMARY KEY (the rowid), so `ORDER BY movieId` with LIMIT/OFFSET runs on the
 * table's own b-tree and needs no extra index. `movieId` is selected only to
 * identify rows in integrity errors; it isn't part of the public record.
 */
export class SqliteMovieRepository implements MovieRepository {
  private readonly countStatement: StatementSync;
  private readonly listStatement: StatementSync;

  constructor(db: DatabaseSync) {
    this.countStatement = db.prepare('SELECT COUNT(*) AS total FROM movies');
    this.listStatement = db.prepare(
      `SELECT movieId, imdbId, title, genres, releaseDate, budget
         FROM movies
        ORDER BY movieId ASC
        LIMIT :limit OFFSET :offset`,
    );
  }

  countMovies(): number {
    const row = this.countStatement.get() as { total: number } | undefined;
    return row?.total ?? 0;
  }

  listMovies({ limit, offset }: { limit: number; offset: number }): MovieSummary[] {
    if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset) || limit < 0 || offset < 0) {
      throw new RangeError('limit and offset must be non-negative safe integers');
    }
    return this.listStatement.all({ limit, offset }).map(toMovieSummary);
  }
}

function integrityError(rowId: unknown, issues: string[]): DataIntegrityError {
  return new DataIntegrityError('movies row does not match the expected shape', {
    table: 'movies',
    rowId,
    issues,
  });
}

const describeIssues = (error: z.ZodError): string[] =>
  error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`);

/** Map a stored row to the public record, refusing anything malformed. */
export function toMovieSummary(raw: unknown): MovieSummary {
  const parsedRow = MovieRowSchema.safeParse(raw);
  if (!parsedRow.success) {
    throw integrityError((raw as { movieId?: unknown }).movieId, describeIssues(parsedRow.error));
  }
  const row: MovieRow = parsedRow.data;

  let genres: unknown;
  try {
    genres = JSON.parse(row.genres);
  } catch {
    throw integrityError(row.movieId, ['genres: not valid JSON']);
  }

  const summary = MovieSummarySchema.safeParse({
    imdbId: row.imdbId,
    title: row.title,
    genres,
    // The source stores missing dates as '' (and NULL is allowed by the schema).
    releaseDate: row.releaseDate === '' ? null : row.releaseDate,
    budget: row.budget,
  });
  if (!summary.success) {
    throw integrityError(row.movieId, describeIssues(summary.error));
  }
  return summary.data;
}
