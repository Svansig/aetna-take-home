import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { z } from 'zod';
import { DataIntegrityError } from '../db/sqlite.js';
import type { PageWindow } from '../http/pagination.js';
import type { MovieFilter, MovieRepository, MovieSort } from './repository.js';
import {
  MovieRecordSchema,
  MovieSummaryRecordSchema,
  type GenreRef,
  type MovieRecord,
  type MovieSummaryRecord,
  type SortOrder,
} from './schemas.js';

/** Raw column types as stored in the `movies` table (listing columns). */
const MovieRowSchema = z.object({
  movieId: z.int(),
  imdbId: z.string(),
  title: z.string(),
  genres: z.string(),
  releaseDate: z.string().nullable(),
  budget: z.int(),
});

/** Listing columns plus the detail-only columns. */
const MovieDetailsRowSchema = MovieRowSchema.extend({
  overview: z.string().nullable(),
  // REAL minutes; 257 source rows store '' instead.
  runtime: z.union([z.number(), z.literal('')]).nullable(),
  language: z.string().nullable(),
  productionCompanies: z.string(),
});

type MovieRow = z.infer<typeof MovieRowSchema>;

const SUMMARY_COLUMNS = 'movieId, imdbId, title, genres, releaseDate, budget';

/**
 * The one movie filter, shared by the count, the listing and the genre check so
 * they always agree. Each condition is switched off by binding NULL to its
 * parameters, so every filter combination uses the same prepared statements.
 *
 * - Year: `releaseDate` is stored as `YYYY-MM-DD` text, so the inclusive string
 *   range `YYYY-01-01`..`YYYY-12-31` selects exactly that year with no date
 *   function, and year 9999 needs no year 10000. Missing dates never match.
 * - Genre: `genres` is a JSON array of `{ id, name }`. `json_each` matches the
 *   `id` field, or the `name` field with ASCII case-insensitive `NOCASE` (all
 *   genre names are ASCII). `EXISTS` returns each movie at most once, even if its
 *   array lists a genre twice, and needs no join.
 */
const FILTER_CONDITION = `
  (:yearStart IS NULL OR releaseDate BETWEEN :yearStart AND :yearEnd)
  AND ((:genreId IS NULL AND :genreName IS NULL) OR EXISTS (
    SELECT 1 FROM json_each(movies.genres) AS genre
     WHERE genre.value ->> 'id' = :genreId
        OR genre.value ->> 'name' = :genreName COLLATE NOCASE
  ))`;

/** The only ORDER BY clauses a sort can produce; nothing from the request reaches SQL. */
const ORDER_BY = {
  movieId: { asc: 'movieId ASC', desc: 'movieId DESC' },
  releaseDate: { asc: 'releaseDate ASC, movieId ASC', desc: 'releaseDate DESC, movieId DESC' },
} as const satisfies Record<MovieSort['by'], Record<SortOrder, string>>;

/**
 * Movie repository over the original supplied `movies.db`.
 *
 * Statements are prepared once per connection. `movieId` is the table's INTEGER
 * PRIMARY KEY (the rowid), so ordering by it, LIMIT/OFFSET and lookup by id use
 * the table's own b-tree and need no extra index.
 */
export class SqliteMovieRepository implements MovieRepository {
  private readonly countStatement: StatementSync;
  private readonly listStatements: Record<MovieSort['by'], Record<SortOrder, StatementSync>>;
  private readonly genreExistsStatement: StatementSync;
  private readonly findStatement: StatementSync;

  constructor(db: DatabaseSync) {
    this.countStatement = db.prepare(
      `SELECT COUNT(*) AS total FROM movies WHERE ${FILTER_CONDITION}`,
    );
    const list = (by: MovieSort['by'], order: SortOrder) =>
      db.prepare(
        `SELECT ${SUMMARY_COLUMNS}
           FROM movies
          WHERE ${FILTER_CONDITION}
          ORDER BY ${ORDER_BY[by][order]}
          LIMIT :limit OFFSET :offset`,
      );
    this.listStatements = {
      movieId: { asc: list('movieId', 'asc'), desc: list('movieId', 'desc') },
      releaseDate: { asc: list('releaseDate', 'asc'), desc: list('releaseDate', 'desc') },
    };
    this.genreExistsStatement = db.prepare(
      `SELECT EXISTS (SELECT 1 FROM movies WHERE ${FILTER_CONDITION}) AS found`,
    );
    this.findStatement = db.prepare(
      `SELECT ${SUMMARY_COLUMNS}, overview, runtime, language, productionCompanies
         FROM movies
        WHERE movieId = :movieId`,
    );
  }

  countMovies(filter: MovieFilter): number {
    const row = this.countStatement.get(filterParams(filter)) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  listMovies(filter: MovieFilter, sort: MovieSort, window: PageWindow): MovieSummaryRecord[] {
    return this.listStatements[sort.by][sort.order]
      .all({ ...filterParams(filter), ...checkedWindow(window) })
      .map(toMovieSummary);
  }

  hasGenre(genre: GenreRef): boolean {
    const row = this.genreExistsStatement.get(filterParams({ genre })) as { found: number };
    return row.found === 1;
  }

  findMovieById(movieId: number): MovieRecord | undefined {
    if (!Number.isSafeInteger(movieId)) {
      throw new RangeError('movieId must be a safe integer');
    }
    const row = this.findStatement.get({ movieId });
    return row === undefined ? undefined : toMovieRecord(row);
  }
}

/** Bind values for `FILTER_CONDITION`: every parameter is always bound, NULL when unused. */
function filterParams({ releaseYear, genre }: MovieFilter) {
  const year = releaseYear === undefined ? undefined : yearBounds(releaseYear);
  if (genre !== undefined && 'id' in genre && !Number.isSafeInteger(genre.id)) {
    throw new RangeError('genre id must be a safe integer');
  }
  return {
    yearStart: year?.yearStart ?? null,
    yearEnd: year?.yearEnd ?? null,
    genreId: genre !== undefined && 'id' in genre ? genre.id : null,
    genreName: genre !== undefined && 'name' in genre ? genre.name : null,
  };
}

/** `node:sqlite` silently accepts unsafe numbers, so windows are checked first. */
function checkedWindow({ limit, offset }: PageWindow): { limit: number; offset: number } {
  if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset) || limit < 0 || offset < 0) {
    throw new RangeError('limit and offset must be non-negative safe integers');
  }
  return { limit, offset };
}

/** Inclusive ISO date bounds of a calendar year, e.g. 1999 -> 1999-01-01..1999-12-31. */
export function yearBounds(year: number): { yearStart: string; yearEnd: string } {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError('year must be an integer from 1 to 9999');
  }
  const yyyy = String(year).padStart(4, '0');
  return { yearStart: `${yyyy}-01-01`, yearEnd: `${yyyy}-12-31` };
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

/** Validate raw column types, raising a DataIntegrityError on mismatch. */
function parseRow<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw integrityError((raw as { movieId?: unknown }).movieId, describeIssues(parsed.error));
  }
  return parsed.data;
}

/** The source stores missing text values as '' (NULL is also allowed by the schema). */
const emptyToNull = <T>(value: T | '' | null): T | null => (value === '' ? null : value);

/** Public summary fields, shared by listing and details. Genres must be valid JSON. */
function summaryFields(row: MovieRow) {
  let genres: unknown;
  try {
    genres = JSON.parse(row.genres);
  } catch {
    throw integrityError(row.movieId, ['genres: not valid JSON']);
  }
  return {
    movieId: row.movieId,
    imdbId: row.imdbId,
    title: row.title,
    genres,
    releaseDate: emptyToNull(row.releaseDate),
    budget: row.budget,
  };
}

/**
 * Agreed fallback: 483 source rows hold production-company text that isn't
 * valid JSON (mostly unescaped quotes in company names). Those return `[]` rather
 * than failing the request, and no repair is attempted. JSON that parses but has
 * the wrong shape is still rejected by the schema as an integrity error.
 */
function parseProductionCompanies(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

/** Map a stored listing row to a summary record, refusing anything malformed. */
export function toMovieSummary(raw: unknown): MovieSummaryRecord {
  const row = parseRow(MovieRowSchema, raw);
  const summary = MovieSummaryRecordSchema.safeParse(summaryFields(row));
  if (!summary.success) {
    throw integrityError(row.movieId, describeIssues(summary.error));
  }
  return summary.data;
}

/** Map a stored detail row to a movie record (every field except the rating; budget unformatted). */
export function toMovieRecord(raw: unknown): MovieRecord {
  const row = parseRow(MovieDetailsRowSchema, raw);
  const record = MovieRecordSchema.safeParse({
    ...summaryFields(row),
    description: emptyToNull(row.overview),
    runtime: emptyToNull(row.runtime),
    originalLanguage: emptyToNull(row.language),
    productionCompanies: parseProductionCompanies(row.productionCompanies),
  });
  if (!record.success) {
    throw integrityError(row.movieId, describeIssues(record.error));
  }
  return record.data;
}
