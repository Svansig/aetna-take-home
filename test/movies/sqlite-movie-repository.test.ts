import { describe, expect, it } from 'vitest';
import { DataIntegrityError } from '../../src/db/sqlite.js';
import { MovieSummarySchema } from '../../src/movies/schemas.js';
import { SqliteMovieRepository } from '../../src/movies/sqlite-movie-repository.js';
import { createFixtureMoviesDb, suppliedMoviesDb } from '../helpers.js';

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
