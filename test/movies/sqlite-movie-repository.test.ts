import { describe, expect, it } from 'vitest';
import { DataIntegrityError } from '../../src/db/sqlite.js';
import { MovieSummarySchema } from '../../src/movies/schemas.js';
import { SqliteMovieRepository, toMovieRecord } from '../../src/movies/sqlite-movie-repository.js';
import { createFixtureMoviesDb, suppliedMoviesDb, type FixtureMovie } from '../helpers.js';

describe('SqliteMovieRepository (fixtures)', () => {
  it('orders by movieId ascending regardless of insertion order', () => {
    const db = createFixtureMoviesDb([{ movieId: 30 }, { movieId: 10 }, { movieId: 20 }]);
    const repo = new SqliteMovieRepository(db);
    expect(repo.listMovies({ limit: 10, offset: 0 }).map((m) => m.imdbId)).toEqual([
      'tt0000010',
      'tt0000020',
      'tt0000030',
    ]);
    expect(repo.listMovies({ limit: 1, offset: 1 }).map((m) => m.imdbId)).toEqual(['tt0000020']);
    expect(repo.countMovies()).toBe(3);
  });

  it('maps a row to exactly the five public fields', () => {
    const db = createFixtureMoviesDb([
      {
        movieId: 1,
        imdbId: 'tt1234567',
        title: 'A',
        genres: '[{"id": 18, "name": "Drama"}, {"id": 80, "name": "Crime"}]',
        releaseDate: '1999-12-31',
        budget: 4000000,
      },
    ]);
    expect(new SqliteMovieRepository(db).listMovies({ limit: 1, offset: 0 })).toEqual([
      {
        imdbId: 'tt1234567',
        title: 'A',
        genres: [
          { id: 18, name: 'Drama' },
          { id: 80, name: 'Crime' },
        ],
        releaseDate: '1999-12-31',
        budget: 4000000,
      },
    ]);
  });

  it('maps empty and NULL release dates to null, keeps zero budgets and empty genres', () => {
    const db = createFixtureMoviesDb([
      { movieId: 1, releaseDate: '', budget: 0, genres: '[]' },
      { movieId: 2, releaseDate: null },
    ]);
    const [a, b] = new SqliteMovieRepository(db).listMovies({ limit: 2, offset: 0 });
    expect(a).toMatchObject({ releaseDate: null, budget: 0, genres: [] });
    expect(b).toMatchObject({ releaseDate: null });
  });

  it('keeps an empty imdbId as stored', () => {
    const db = createFixtureMoviesDb([{ movieId: 1, imdbId: '' }]);
    expect(new SqliteMovieRepository(db).listMovies({ limit: 1, offset: 0 })[0]?.imdbId).toBe('');
  });

  it.each([
    ['genres not JSON', { genres: '[{"id": 18' }],
    ['genres NULL', { genres: null }],
    ['genres not an array', { genres: '{"id": 18, "name": "Drama"}' }],
    ['genre id not numeric', { genres: '[{"id": "18", "name": "Drama"}]' }],
    ['genre missing name', { genres: '[{"id": 18}]' }],
    ['genre with extra keys', { genres: '[{"id": 18, "name": "Drama", "x": 1}]' }],
    ['release date not YYYY-MM-DD', { releaseDate: '12/09/1995' }],
    ['release date impossible', { releaseDate: '1995-02-30' }],
    ['budget NULL', { budget: null }],
    ['budget negative', { budget: -1 }],
  ])('raises DataIntegrityError for %s instead of repairing it', (_label, overrides) => {
    const db = createFixtureMoviesDb([{ movieId: 7, ...overrides }]);
    const repo = new SqliteMovieRepository(db);
    let error: unknown;
    try {
      repo.listMovies({ limit: 1, offset: 0 });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(DataIntegrityError);
    expect((error as DataIntegrityError).context).toMatchObject({ table: 'movies', rowId: 7 });
  });

  it.each([
    { limit: 50, offset: Number.MAX_SAFE_INTEGER + 1 },
    { limit: 50, offset: -1 },
    { limit: 1.5, offset: 0 },
  ])('rejects unsafe window %o before reaching SQLite', (window) => {
    const repo = new SqliteMovieRepository(createFixtureMoviesDb([]));
    expect(() => repo.listMovies(window)).toThrow(RangeError);
  });
});

describe('SqliteMovieRepository (supplied movies.db)', () => {
  const db = suppliedMoviesDb();
  const repo = new SqliteMovieRepository(db);

  it('counts all 45,430 movies', () => {
    expect(repo.countMovies()).toBe(45430);
  });

  it('maps every stored row without integrity errors, matching the raw values', () => {
    const movies = repo.listMovies({ limit: 50_000, offset: 0 });
    const raw = db
      .prepare('SELECT imdbId, title, genres, releaseDate, budget FROM movies ORDER BY movieId')
      .all() as {
      imdbId: string;
      title: string;
      genres: string;
      releaseDate: string;
      budget: number;
    }[];

    expect(movies).toHaveLength(45430);
    movies.forEach((movie, i) => {
      const row = raw[i]!;
      expect(MovieSummarySchema.safeParse(movie).success).toBe(true);
      expect(movie.imdbId).toBe(row.imdbId);
      expect(movie.title).toBe(row.title);
      expect(movie.genres).toEqual(JSON.parse(row.genres));
      // Strings pass through untouched: no Date conversion, so no time-zone shift.
      expect(movie.releaseDate).toBe(row.releaseDate === '' ? null : row.releaseDate);
      expect(movie.budget).toBe(row.budget);
    });

    expect(movies.filter((m) => m.releaseDate === null)).toHaveLength(84);
    expect(movies.filter((m) => m.budget === 0)).toHaveLength(36550);
    expect(movies.filter((m) => m.imdbId === '')).toHaveLength(17);
  });
});

describe('SqliteMovieRepository.findMovieById (fixtures)', () => {
  const find = (overrides: Omit<FixtureMovie, 'movieId'> = {}) =>
    new SqliteMovieRepository(createFixtureMoviesDb([{ movieId: 7, ...overrides }])).findMovieById(
      7,
    );

  it('maps every detail field from its source column', () => {
    expect(
      find({
        imdbId: 'tt1234567',
        title: 'A',
        overview: 'Plot "with quotes" and\nnewlines.  ',
        releaseDate: '1999-12-31',
        budget: 4000000,
        runtime: 93.5,
        language: 'en',
        genres: '[{"id": 18, "name": "Drama"}]',
        productionCompanies: '[{"name": "Lucasfilm", "id": 1}, {"name": "Fox", "id": 306}]',
      }),
    ).toEqual({
      imdbId: 'tt1234567',
      title: 'A',
      description: 'Plot "with quotes" and\nnewlines.  ',
      releaseDate: '1999-12-31',
      budget: 4000000,
      runtime: 93.5,
      genres: [{ id: 18, name: 'Drama' }],
      originalLanguage: 'en',
      productionCompanies: [
        { id: 1, name: 'Lucasfilm' },
        { id: 306, name: 'Fox' },
      ],
    });
  });

  it('refuses an unsafe id before reaching SQLite', () => {
    const repo = new SqliteMovieRepository(createFixtureMoviesDb([]));
    expect(() => repo.findMovieById(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('returns undefined for an unknown id', () => {
    expect(find()).toBeDefined();
    expect(
      new SqliteMovieRepository(createFixtureMoviesDb([{ movieId: 7 }])).findMovieById(8),
    ).toBeUndefined();
  });

  it.each([
    ['empty overview', { overview: '' }, { description: null }],
    ['NULL overview', { overview: null }, { description: null }],
    ['empty release date', { releaseDate: '' }, { releaseDate: null }],
    ['empty runtime text', { runtime: '' }, { runtime: null }],
    ['NULL runtime', { runtime: null }, { runtime: null }],
    ['zero runtime', { runtime: 0 }, { runtime: 0 }],
    ['zero budget', { budget: 0 }, { budget: 0 }],
    ['NULL language', { language: null }, { originalLanguage: null }],
    ['empty language', { language: '' }, { originalLanguage: null }],
    ['empty genres', { genres: '[]' }, { genres: [] }],
    ['empty companies', { productionCompanies: '[]' }, { productionCompanies: [] }],
  ])('maps %s', (_label, overrides, expected) => {
    expect(find(overrides)).toMatchObject(expected);
  });

  it.each([
    // Shapes of the real malformed values: unescaped quotes inside company names.
    '[{"name": "Zespól Filmowy "X"", "id": 6804}]',
    '[{"name": "Cooper"s Town Productions", "id": 213}]',
    '[{"name": "Truncated',
    'not json',
    '',
  ])('falls back to [] for malformed production-company JSON %j', (productionCompanies) => {
    expect(find({ productionCompanies })).toMatchObject({ productionCompanies: [] });
  });

  it.each([
    ['companies valid JSON but not an array', { productionCompanies: '{"id": 1, "name": "A"}' }],
    ['company with a string id', { productionCompanies: '[{"id": "1", "name": "A"}]' }],
    ['company with extra keys', { productionCompanies: '[{"id": 1, "name": "A", "x": 0}]' }],
    ['companies NULL', { productionCompanies: null }],
    ['genres not JSON', { genres: '[{"id": 18' }],
    ['runtime non-numeric text', { runtime: 'ninety' }],
    ['runtime negative', { runtime: -1 }],
    ['release date impossible', { releaseDate: '1995-02-30' }],
    ['budget NULL', { budget: null }],
  ])('raises DataIntegrityError for %s', (_label, overrides) => {
    expect(() => find(overrides)).toThrow(DataIntegrityError);
  });
});

describe('SqliteMovieRepository.findMovieById (supplied movies.db)', () => {
  it('maps every stored row, applying the documented fallbacks', () => {
    const db = suppliedMoviesDb();
    // One bulk read through the repository's own row mapper (the same function
    // findMovieById uses), so all 45,430 rows are covered quickly.
    const records = db
      .prepare(
        `SELECT movieId, imdbId, title, genres, releaseDate, budget,
                overview, runtime, language, productionCompanies
           FROM movies ORDER BY movieId`,
      )
      .all()
      .map(toMovieRecord);
    expect(records).toHaveLength(45430);

    // Counts match the data inspection.
    expect(records.filter((r) => r.description === null)).toHaveLength(959);
    expect(records.filter((r) => r.runtime === null)).toHaveLength(257);
    expect(records.filter((r) => r.originalLanguage === null)).toHaveLength(45430);
    const { malformed } = db
      .prepare('SELECT COUNT(*) AS malformed FROM movies WHERE NOT json_valid(productionCompanies)')
      .get() as { malformed: number };
    expect(malformed).toBe(483);
    const emptyCompanies = records.filter((r) => r.productionCompanies.length === 0).length;
    expect(emptyCompanies).toBe(11868 + 483); // stored '[]' plus the malformed fallback
  });

  it('uses the same summary fields as the listing', () => {
    const repo = new SqliteMovieRepository(suppliedMoviesDb());
    const [listed] = repo.listMovies({ limit: 1, offset: 0 });
    const record = repo.findMovieById(2)!;
    expect({
      imdbId: record.imdbId,
      title: record.title,
      genres: record.genres,
      releaseDate: record.releaseDate,
      budget: record.budget,
    }).toEqual(listed);
  });
});
