import { describe, expect, it } from 'vitest';
import { DataIntegrityError } from '../../src/db/sqlite.js';
import type { MovieFilter, MovieSort } from '../../src/movies/repository.js';
import { MovieSummarySchema } from '../../src/movies/schemas.js';
import {
  SqliteMovieRepository,
  toMovieRecord,
  yearBounds,
} from '../../src/movies/sqlite-movie-repository.js';
import { createFixtureMoviesDb, suppliedMoviesDb, type FixtureMovie } from '../helpers.js';

/** No filter, in the default movieId order. */
const ALL: MovieFilter = {};
const BY_ID: MovieSort = { by: 'movieId', order: 'asc' };

describe('SqliteMovieRepository (fixtures)', () => {
  it('orders by movieId ascending regardless of insertion order', () => {
    const db = createFixtureMoviesDb([{ movieId: 30 }, { movieId: 10 }, { movieId: 20 }]);
    const repo = new SqliteMovieRepository(db);
    expect(repo.listMovies(ALL, BY_ID, { limit: 10, offset: 0 }).map((m) => m.imdbId)).toEqual([
      'tt0000010',
      'tt0000020',
      'tt0000030',
    ]);
    expect(repo.listMovies(ALL, BY_ID, { limit: 1, offset: 1 }).map((m) => m.imdbId)).toEqual([
      'tt0000020',
    ]);
    expect(repo.countMovies(ALL)).toBe(3);
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
    expect(new SqliteMovieRepository(db).listMovies(ALL, BY_ID, { limit: 1, offset: 0 })).toEqual([
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
    const [a, b] = new SqliteMovieRepository(db).listMovies(ALL, BY_ID, { limit: 2, offset: 0 });
    expect(a).toMatchObject({ releaseDate: null, budget: 0, genres: [] });
    expect(b).toMatchObject({ releaseDate: null });
  });

  it('keeps an empty imdbId as stored', () => {
    const db = createFixtureMoviesDb([{ movieId: 1, imdbId: '' }]);
    expect(
      new SqliteMovieRepository(db).listMovies(ALL, BY_ID, { limit: 1, offset: 0 })[0]?.imdbId,
    ).toBe('');
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
      repo.listMovies(ALL, BY_ID, { limit: 1, offset: 0 });
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
    expect(() => repo.listMovies(ALL, BY_ID, window)).toThrow(RangeError);
  });
});

describe('SqliteMovieRepository (supplied movies.db)', () => {
  const db = suppliedMoviesDb();
  const repo = new SqliteMovieRepository(db);

  it('counts all 45,430 movies', () => {
    expect(repo.countMovies(ALL)).toBe(45430);
  });

  it('maps every stored row without integrity errors, matching the raw values', () => {
    const movies = repo.listMovies(ALL, BY_ID, { limit: 50_000, offset: 0 });
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
    const [listed] = repo.listMovies(ALL, BY_ID, { limit: 1, offset: 0 });
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

describe('yearBounds', () => {
  it.each([
    [1, '0001-01-01', '0001-12-31'],
    [999, '0999-01-01', '0999-12-31'],
    [1999, '1999-01-01', '1999-12-31'],
    [9999, '9999-01-01', '9999-12-31'],
  ])('%d -> %s..%s', (year, yearStart, yearEnd) => {
    expect(yearBounds(year)).toEqual({ yearStart, yearEnd });
  });

  it.each([0, -1, 10000, 1999.5, Number.NaN])('refuses %d', (year) => {
    expect(() => yearBounds(year)).toThrow(RangeError);
  });
});

describe('SqliteMovieRepository year filter (fixtures)', () => {
  const repo = new SqliteMovieRepository(
    createFixtureMoviesDb([
      { movieId: 5, releaseDate: '1999-06-15' },
      { movieId: 3, releaseDate: '1999-06-15' },
      { movieId: 4, releaseDate: '1999-01-01' },
      { movieId: 9, releaseDate: '1999-12-31' },
      { movieId: 1, releaseDate: '1998-12-31' },
      { movieId: 2, releaseDate: '2000-01-01' },
      { movieId: 6, releaseDate: '' },
      { movieId: 7, releaseDate: null },
    ]),
  );
  const filter = { releaseYear: 1999 };
  const ids = (movies: { imdbId: string }[]) => movies.map((m) => Number(m.imdbId.slice(2)));

  it('counts only the matching year, leaving the unfiltered count unchanged', () => {
    expect(repo.countMovies(filter)).toBe(4);
    expect(repo.countMovies({ releaseYear: 2000 })).toBe(1);
    expect(repo.countMovies({ releaseYear: 1850 })).toBe(0);
    expect(repo.countMovies(ALL)).toBe(8);
  });

  it('orders by release date, then movieId, in the requested direction', () => {
    const all = { limit: 50, offset: 0 };
    expect(ids(repo.listMovies(filter, { by: 'releaseDate', order: 'asc' }, all))).toEqual([
      4, 3, 5, 9,
    ]);
    expect(ids(repo.listMovies(filter, { by: 'releaseDate', order: 'desc' }, all))).toEqual([
      9, 5, 3, 4,
    ]);
  });

  it('applies LIMIT/OFFSET after ordering', () => {
    expect(
      ids(repo.listMovies(filter, { by: 'releaseDate', order: 'asc' }, { limit: 2, offset: 1 })),
    ).toEqual([3, 5]);
    expect(
      repo.listMovies(filter, { by: 'releaseDate', order: 'desc' }, { limit: 2, offset: 4 }),
    ).toEqual([]);
  });

  it('refuses unsafe years and windows before reaching SQLite', () => {
    expect(() => repo.countMovies({ releaseYear: 10000 })).toThrow(RangeError);
    expect(() =>
      repo.listMovies(
        { releaseYear: 0 },
        { by: 'releaseDate', order: 'asc' },
        { limit: 1, offset: 0 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      repo.listMovies(
        filter,
        { by: 'releaseDate', order: 'asc' },
        {
          limit: 50,
          offset: Number.MAX_SAFE_INTEGER + 1,
        },
      ),
    ).toThrow(RangeError);
  });

  it('maps rows with the shared listing mapper (integrity errors included)', () => {
    const broken = new SqliteMovieRepository(
      createFixtureMoviesDb([{ movieId: 8, releaseDate: '1999-02-02', genres: '[' }]),
    );
    expect(() =>
      broken.listMovies(filter, { by: 'releaseDate', order: 'asc' }, { limit: 1, offset: 0 }),
    ).toThrow(DataIntegrityError);
  });
});

describe('SqliteMovieRepository year filter (supplied movies.db)', () => {
  it('counts every year exactly like an independent year extraction', () => {
    const db = suppliedMoviesDb();
    const repo = new SqliteMovieRepository(db);
    const years = db
      .prepare(
        `SELECT CAST(substr(releaseDate, 1, 4) AS INTEGER) AS year, COUNT(*) AS total
           FROM movies WHERE releaseDate <> '' GROUP BY year`,
      )
      .all() as { year: number; total: number }[];
    for (const { year, total } of years) {
      expect(repo.countMovies({ releaseYear: year })).toBe(total);
    }
    // Every dated movie is in exactly one year; the 84 undated ones in none.
    expect(years.reduce((n, y) => n + y.total, 0)).toBe(45430 - 84);
  });
});

describe('SqliteMovieRepository genre filter and sorting (fixtures)', () => {
  const g = (...genres: [number, string][]) =>
    JSON.stringify(genres.map(([id, name]) => ({ id, name })));
  const repo = new SqliteMovieRepository(
    createFixtureMoviesDb([
      { movieId: 4, releaseDate: '1999-05-05', genres: g([28, 'Action']) },
      { movieId: 1, releaseDate: '1999-05-05', genres: g([28, 'Action'], [18, 'Drama']) },
      // Duplicate entry for the same genre: still one result.
      { movieId: 3, releaseDate: '2000-01-01', genres: g([28, 'Action'], [28, 'Action']) },
      { movieId: 2, releaseDate: '1999-02-02', genres: g([878, 'Science Fiction']) },
      { movieId: 5, releaseDate: '1999-03-03', genres: g([10769, 'Foreign'], [18, 'Drama']) },
      { movieId: 6, releaseDate: '', genres: '[]' },
    ]),
  );
  const all = { limit: 50, offset: 0 };
  const ids = (movies: { imdbId: string }[]) => movies.map((m) => Number(m.imdbId.slice(2)));
  const list = (filter: MovieFilter, sort: MovieSort = BY_ID) =>
    ids(repo.listMovies(filter, sort, all));

  it('lists all movies by movieId in either direction', () => {
    expect(list(ALL)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(list(ALL, { by: 'movieId', order: 'desc' })).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('matches a genre by id, once per movie even with duplicate entries', () => {
    expect(list({ genre: { id: 28 } })).toEqual([1, 3, 4]);
    expect(repo.countMovies({ genre: { id: 28 } })).toBe(3);
    expect(list({ genre: { id: 28 } }, { by: 'movieId', order: 'desc' })).toEqual([4, 3, 1]);
  });

  it.each(['Action', 'action', 'ACTION', 'aCtIoN'])(
    'matches the name %j case-insensitively',
    (name) => {
      expect(list({ genre: { name } })).toEqual([1, 3, 4]);
    },
  );

  it('matches multiword names exactly', () => {
    expect(list({ genre: { name: 'science fiction' } })).toEqual([2]);
    expect(list({ genre: { name: 'Science' } })).toEqual([]);
  });

  it.each(['Act', 'Actio', 'Actions', ' Action', 'Action ', 'ction', '%', '_ction', 'Act%'])(
    'does no partial or pattern matching: %j matches nothing',
    (name) => {
      expect(repo.countMovies({ genre: { name } })).toBe(0);
      expect(repo.hasGenre({ name })).toBe(false);
    },
  );

  it('does not match a genre id against names or a name against ids', () => {
    expect(list({ genre: { name: '28' } })).toEqual([]);
    expect(list({ genre: { id: 1 } })).toEqual([]);
  });

  it('combines year and genre with AND, chronologically with movieId tie-break', () => {
    const filter = { releaseYear: 1999, genre: { name: 'action' } };
    expect(repo.countMovies(filter)).toBe(2);
    expect(list(filter, { by: 'releaseDate', order: 'asc' })).toEqual([1, 4]);
    expect(list(filter, { by: 'releaseDate', order: 'desc' })).toEqual([4, 1]);
    expect(
      list({ releaseYear: 1999, genre: { id: 18 } }, { by: 'releaseDate', order: 'asc' }),
    ).toEqual([5, 1]);
    expect(repo.countMovies({ releaseYear: 2001, genre: { id: 28 } })).toBe(0);
  });

  it('reports genre existence from the data', () => {
    expect(repo.hasGenre({ id: 878 })).toBe(true);
    expect(repo.hasGenre({ name: 'FOREIGN' })).toBe(true);
    expect(repo.hasGenre({ id: 99 })).toBe(false);
    expect(repo.hasGenre({ name: 'Western' })).toBe(false);
  });

  it('refuses an unsafe genre id before reaching SQLite', () => {
    expect(() => repo.countMovies({ genre: { id: Number.MAX_SAFE_INTEGER + 1 } })).toThrow(
      RangeError,
    );
    expect(() => repo.hasGenre({ id: 1.5 })).toThrow(RangeError);
  });
});

describe('SqliteMovieRepository genre filter (supplied movies.db)', () => {
  const db = suppliedMoviesDb();
  const repo = new SqliteMovieRepository(db);
  // Independent oracle: genre membership from parsing every row's JSON in JavaScript.
  const rows = db.prepare('SELECT movieId, genres, releaseDate FROM movies').all() as {
    movieId: number;
    genres: string;
    releaseDate: string;
  }[];
  const genres = new Map<number, string>();
  const parsed = rows.map((row) => {
    const list = JSON.parse(row.genres) as { id: number; name: string }[];
    for (const genre of list) genres.set(genre.id, genre.name);
    return { ...row, ids: new Set(list.map((genre) => genre.id)) };
  });

  it('has the 20 known V1 genres', () => {
    expect(genres.size).toBe(20);
    expect(genres.get(28)).toBe('Action');
  });

  it('counts every genre by id, by name and by upper-case name like the oracle', () => {
    for (const [id, name] of genres) {
      const expected = parsed.filter((row) => row.ids.has(id)).length;
      expect(repo.countMovies({ genre: { id } })).toBe(expected);
      expect(repo.countMovies({ genre: { name } })).toBe(expected);
      expect(repo.countMovies({ genre: { name: name.toUpperCase() } })).toBe(expected);
      expect(repo.hasGenre({ id })).toBe(true);
    }
  });

  it('counts year-and-genre combinations like the oracle', () => {
    for (const year of [1977, 1999, 2014]) {
      for (const id of [18, 28, 878, 10770]) {
        const expected = parsed.filter(
          (row) => row.ids.has(id) && row.releaseDate.startsWith(`${String(year)}-`),
        ).length;
        expect(repo.countMovies({ releaseYear: year, genre: { id } })).toBe(expected);
      }
    }
  });
});
