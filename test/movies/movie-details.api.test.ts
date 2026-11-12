import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { DETAILS_EXAMPLES } from '../../src/movies/routes.js';
import { MovieDetailsSchema, type MovieDetails } from '../../src/movies/schemas.js';
import {
  createFixtureMoviesDb,
  createFixtureRatingsDb,
  createTestApp,
  createTestApiRouter,
  suppliedMoviesDb,
  suppliedRatingsDb,
} from '../helpers.js';

const DETAIL_FIELDS = [
  'movieId',
  'imdbId',
  'title',
  'description',
  'releaseDate',
  'budget',
  'runtime',
  'averageRating',
  'genres',
  'originalLanguage',
  'productionCompanies',
];

const { app } = createTestApp();

async function getDetails(movieId: number | string, testApp = app): Promise<MovieDetails> {
  const res = await request(testApp).get(`/api/v1/movies/${String(movieId)}`);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(Object.keys(res.body as object).sort()).toEqual([...DETAIL_FIELDS].sort());
  // Strict schema: also fails on any extra field.
  return MovieDetailsSchema.parse(res.body);
}

/** Independent oracle: the naive average straight from ratings.db. */
function oracleAverage(movieId: number): number | null {
  const row = suppliedRatingsDb()
    .prepare('SELECT COUNT(*) AS n, ROUND(AVG(rating), 6) AS avg FROM ratings WHERE movieId = ?')
    .get(movieId) as { n: number; avg: number | null };
  return row.n === 0 ? null : Math.round(row.avg! * 100) / 100;
}

const firstId = (where: string): number =>
  (
    suppliedMoviesDb()
      .prepare(`SELECT movieId FROM movies WHERE ${where} ORDER BY movieId LIMIT 1`)
      .get() as { movieId: number }
  ).movieId;

describe('GET /api/v1/movies/:movieId (supplied databases)', () => {
  const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const config = loadConfig({});
  const paths = [config.MOVIES_DB_PATH, config.RATINGS_DB_PATH];
  let hashesBefore: string[];
  beforeAll(() => {
    hashesBefore = paths.map(sha256);
  });
  afterAll(() => {
    // Requests (including rating aggregation) never modify either database.
    expect(paths.map(sha256)).toEqual(hashesBefore);
  });

  it('returns Star Wars (movieId 11) with the naive rating of 3.69', async () => {
    const movie = await getDetails(11);
    expect(movie).toEqual(DETAILS_EXAMPLES[11]);
    expect(movie.averageRating).toBe(3.69);
    // Its correctly mapped MovieLens id (260) would give 4.22. The API must not use it.
    expect(oracleAverage(260)).toBe(4.22);
  });

  it('returns Capote (movieId 398): no matching ratings and malformed company JSON', async () => {
    const movie = await getDetails(398);
    expect(movie).toEqual(DETAILS_EXAMPLES[398]);
    expect(movie.averageRating).toBeNull();
    expect(movie.productionCompanies).toEqual([]);
  });

  it('maps description, runtime, budget and genres from movies.db', async () => {
    const id = 5; // Four Rooms
    const raw = suppliedMoviesDb()
      .prepare('SELECT overview, runtime, budget, genres FROM movies WHERE movieId = ?')
      .get(id) as { overview: string; runtime: number; budget: number; genres: string };
    const movie = await getDetails(id);
    expect(movie.description).toBe(raw.overview);
    expect(movie.runtime).toBe(raw.runtime);
    expect(movie.runtime).toBeTypeOf('number');
    expect(movie.budget).toBe('$4,000,000');
    expect(movie.genres).toEqual(JSON.parse(raw.genres));
  });

  it('formats a zero budget as $0 and keeps the release date verbatim (Ariel, movieId 2)', async () => {
    const movie = await getDetails(2);
    expect(movie.movieId).toBe(2);
    expect(movie.budget).toBe('$0');
    expect(movie.releaseDate).toBe('1988-10-21');
    expect(movie.originalLanguage).toBeNull();
  });

  it.each([
    ["overview = ''", 'description'],
    ["runtime = ''", 'runtime'],
    ["releaseDate = ''", 'releaseDate'],
  ] as const)('returns null when %s', async (where, field) => {
    const movie = await getDetails(firstId(where));
    expect(movie[field]).toBeNull();
  });

  it('returns [] for malformed production companies without failing', async () => {
    const movie = await getDetails(firstId('NOT json_valid(productionCompanies)'));
    expect(movie.productionCompanies).toEqual([]);
  });

  it('matches the naive SQL average for the first 200 movies', async () => {
    const ids = (
      suppliedMoviesDb().prepare('SELECT movieId FROM movies ORDER BY movieId LIMIT 200').all() as {
        movieId: number;
      }[]
    ).map((r) => r.movieId);
    let rated = 0;
    for (const id of ids) {
      const { averageRating } = await getDetails(id);
      expect(averageRating).toBe(oracleAverage(id));
      if (averageRating !== null) {
        rated++;
        expect(averageRating).toBeTypeOf('number');
        expect(Number.isInteger(Math.round(averageRating * 100))).toBe(true);
      }
    }
    expect(rated).toBeGreaterThan(0);
  });

  it('accepts leading zeros like the page parameter', async () => {
    expect(await getDetails('011')).toEqual(DETAILS_EXAMPLES[11]);
  });

  it('returns 404 MOVIE_NOT_FOUND for a valid id with no movie', async () => {
    for (const id of [1, 4, Number.MAX_SAFE_INTEGER]) {
      const res = await request(app).get(`/api/v1/movies/${String(id)}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: {
          code: 'MOVIE_NOT_FOUND',
          message: `Movie ${String(id)} not found`,
          requestId: res.headers['x-request-id'],
        },
      });
    }
  });

  it.each([
    '0',
    '00',
    '-1',
    '+1',
    '1.5',
    '1e2',
    '0x10',
    'abc',
    'tt0076759',
    '%201',
    String(Number.MAX_SAFE_INTEGER + 1),
    '99999999999999999999999',
  ])('returns 400 for movieId %j', async (movieId) => {
    const res = await request(app).get(`/api/v1/movies/${movieId}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'movieId', message: expect.any(String) }],
    });
  });

  it('shares its listing fields with the listing (six fields)', async () => {
    const res = await request(app).get('/api/v1/movies');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data[0] as object).sort()).toEqual(
      ['budget', 'genres', 'imdbId', 'movieId', 'releaseDate', 'title'].sort(),
    );
  });
});

describe('GET /api/v1/movies/:movieId (fixtures)', () => {
  const moviesDb = createFixtureMoviesDb([
    { movieId: 7, productionCompanies: '[{"name": "Bad "Quote"", "id": 1}]' },
    { movieId: 8 },
    { movieId: 9, genres: '[{"id": 18, "name": ' },
  ]);
  const ratingsDb = createFixtureRatingsDb([
    [7, 3],
    [7, 4],
    [7, 4],
    [8, 0.5],
    [8, 1.5],
  ]);
  const { app: fixtureApp, logs } = createTestApp({
    apiRouter: createTestApiRouter(moviesDb, ratingsDb),
  });

  it('averages the matching ratings and rounds to 2 decimals', async () => {
    expect((await getDetails(7, fixtureApp)).averageRating).toBe(3.67); // 11 / 3
    expect((await getDetails(8, fixtureApp)).averageRating).toBe(1);
  });

  it('serves malformed company JSON as [] with 200', async () => {
    expect((await getDetails(7, fixtureApp)).productionCompanies).toEqual([]);
  });

  it('returns averageRating null for a movie with no ratings', async () => {
    const empty = createTestApp({
      apiRouter: createTestApiRouter(createFixtureMoviesDb([{ movieId: 3 }]), ratingsDb),
    }).app;
    expect((await getDetails(3, empty)).averageRating).toBeNull();
  });

  it('turns malformed stored genres into a generic 500', async () => {
    const res = await request(fixtureApp).get('/api/v1/movies/9');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.text).not.toMatch(/genres|SELECT|\.db/);
    const log = logs.find((l) => l.msg === 'Unhandled error while processing request');
    expect(log?.err).toMatchObject({ type: 'DataIntegrityError', context: { rowId: 9 } });
  });

  it('returns a generic 500 when the ratings database is unavailable', async () => {
    const closedRatings = createFixtureRatingsDb([]);
    const broken = createTestApp({
      apiRouter: createTestApiRouter(createFixtureMoviesDb([{ movieId: 1 }]), closedRatings),
    }).app;
    closedRatings.close();
    const res = await request(broken).get('/api/v1/movies/1');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.text).not.toMatch(/database|SQL|ratings/i);
  });
});
