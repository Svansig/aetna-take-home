import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { z } from 'zod';
import { DataIntegrityError } from '../db/sqlite.js';
import type { PageWindow } from '../http/pagination.js';
import type { MovieFilter, MovieRepository } from './repository.js';
import {
  MovieDetailsSchema,
  MovieSummarySchema,
  type MovieRecord,
  type MovieSummary,
  type SortOrder,
} from './schemas.js';

/** Raw column types as stored in the V1 `movies` table (listing columns). */
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
 * Release-year condition, shared by the filtered count and listing so they always
 * agree. `releaseDate` is stored as `YYYY-MM-DD` text, so an inclusive string range
 * from `YYYY-01-01` to `YYYY-12-31` selects exactly that year without applying a
 * date function to each row, and needs no year 10000 for 9999. Missing dates
 * (`''` or NULL) never fall inside the range.
 */
const RELEASE_YEAR_CONDITION = 'releaseDate BETWEEN :yearStart AND :yearEnd';

/** The only SQL text a sort order can produce; nothing from the request reaches SQL. */
const SQL_DIRECTION = { asc: 'ASC', desc: 'DESC' } as const satisfies Record<SortOrder, string>;

/**
 * V1 movie repository over the original supplied `movies.db`.
 *
 * Statements are prepared once per connection. `movieId` is the table's INTEGER
 * PRIMARY KEY (the rowid), so ordering, LIMIT/OFFSET and lookup by id use the
 * table's own b-tree and need no extra index. `movieId` is selected only to
 * identify rows in integrity errors; it isn't part of the public record.
 */
export class SqliteMovieRepository implements MovieRepository {
  private readonly countStatement: StatementSync;
  private readonly listStatement: StatementSync;
  private readonly findStatement: StatementSync;
  private readonly countByYearStatement: StatementSync;
  private readonly listByReleaseDateStatements: Record<SortOrder, StatementSync>;

  constructor(db: DatabaseSync) {
    this.countStatement = db.prepare('SELECT COUNT(*) AS total FROM movies');
    this.countByYearStatement = db.prepare(
      `SELECT COUNT(*) AS total FROM movies WHERE ${RELEASE_YEAR_CONDITION}`,
    );
    const listByReleaseDate = (sortOrder: SortOrder) => {
      const direction = SQL_DIRECTION[sortOrder];
      return db.prepare(
        `SELECT ${SUMMARY_COLUMNS}
           FROM movies
          WHERE ${RELEASE_YEAR_CONDITION}
          ORDER BY releaseDate ${direction}, movieId ${direction}
          LIMIT :limit OFFSET :offset`,
      );
    };
    this.listByReleaseDateStatements = {
      asc: listByReleaseDate('asc'),
      desc: listByReleaseDate('desc'),
    };
    this.listStatement = db.prepare(
      `SELECT ${SUMMARY_COLUMNS}
         FROM movies
        ORDER BY movieId ASC
        LIMIT :limit OFFSET :offset`,
    );
    this.findStatement = db.prepare(
      `SELECT ${SUMMARY_COLUMNS}, overview, runtime, language, productionCompanies
         FROM movies
        WHERE movieId = :movieId`,
    );
  }

  countMovies(filter?: MovieFilter): number {
    const row = (
      filter === undefined
        ? this.countStatement.get()
        : this.countByYearStatement.get(yearBounds(filter.releaseYear))
    ) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  listMovies(window: PageWindow): MovieSummary[] {
    return this.listStatement.all(checkedWindow(window)).map(toMovieSummary);
  }

  listMoviesByReleaseDate(
    filter: MovieFilter,
    sortOrder: SortOrder,
    window: PageWindow,
  ): MovieSummary[] {
    return this.listByReleaseDateStatements[sortOrder]
      .all({ ...yearBounds(filter.releaseYear), ...checkedWindow(window) })
      .map(toMovieSummary);
  }

  findMovieById(movieId: number): MovieRecord | undefined {
    if (!Number.isSafeInteger(movieId)) {
      throw new RangeError('movieId must be a safe integer');
    }
    const row = this.findStatement.get({ movieId });
    return row === undefined ? undefined : toMovieRecord(row);
  }
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
    imdbId: row.imdbId,
    title: row.title,
    genres,
    releaseDate: emptyToNull(row.releaseDate),
    budget: row.budget,
  };
}

/**
 * Agreed V1 fallback: 483 source rows hold production-company text that isn't
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

/** Map a stored listing row to the public summary, refusing anything malformed. */
export function toMovieSummary(raw: unknown): MovieSummary {
  const row = parseRow(MovieRowSchema, raw);
  const summary = MovieSummarySchema.safeParse(summaryFields(row));
  if (!summary.success) {
    throw integrityError(row.movieId, describeIssues(summary.error));
  }
  return summary.data;
}

/** Map a stored detail row to a movie record (all public fields except the rating). */
export function toMovieRecord(raw: unknown): MovieRecord {
  const row = parseRow(MovieDetailsRowSchema, raw);
  const record = MovieDetailsSchema.omit({ averageRating: true }).safeParse({
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
