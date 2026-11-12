import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { V1_FIRST_PAGE_EXAMPLE } from '../../src/movies/routes.js';
import {
  MovieListResponseSchema,
  USD_PATTERN,
  type MovieListResponse,
} from '../../src/movies/schemas.js';
import {
  createFixtureMoviesDb,
  createTestApp,
  createTestVersions,
  suppliedMoviesDb,
} from '../helpers.js';

/** Independent oracle: imdbIds for a page, straight from SQLite. */
function expectedImdbIds(page: number): string[] {
  return (
    suppliedMoviesDb()
      .prepare('SELECT imdbId FROM movies ORDER BY movieId LIMIT 50 OFFSET ?')
      .all((page - 1) * 50) as { imdbId: string }[]
  ).map((r) => r.imdbId);
}

const { app } = createTestApp();

async function getPage(query = ''): Promise<MovieListResponse> {
  const res = await request(app).get(`/api/v1/movies${query}`);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  // Strict schemas: also fails on any extra field, in movies or in pagination.
  return MovieListResponseSchema.parse(res.body);
}

describe('GET /api/v1/movies: pagination (supplied database)', () => {
  it('defaults to page 1 with 50 movies', async () => {
    const body = await getPage();
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 50,
      totalItems: 45430,
      totalPages: 909,
    });
    expect(body.data).toHaveLength(50);
    expect(body).toEqual(await getPage('?page=1'));
  });

  it('orders by movieId ascending', async () => {
    const body = await getPage('?page=1');
    expect(body.data.map((m) => m.imdbId)).toEqual(expectedImdbIds(1));
  });

  it('returns the next 50 movies on page 2 with no overlap', async () => {
    const [p1, p2] = await Promise.all([getPage('?page=1'), getPage('?page=2')]);
    expect(p2.data).toHaveLength(50);
    expect(p2.data.map((m) => m.imdbId)).toEqual(expectedImdbIds(2));
    const titles1 = new Set(p1.data.map((m) => `${m.imdbId}|${m.title}`));
    expect(p2.data.some((m) => titles1.has(`${m.imdbId}|${m.title}`))).toBe(false);
  });

  it('returns the 30 remaining movies on the final page (909)', async () => {
    const body = await getPage('?page=909');
    expect(body.data).toHaveLength(30);
    expect(body.data.map((m) => m.imdbId)).toEqual(expectedImdbIds(909));
  });

  it.each(['?page=910', '?page=100000', `?page=${String(Number.MAX_SAFE_INTEGER)}`])(
    'returns 200 with an empty page past the end (%s)',
    async (query) => {
      const body = await getPage(query);
      expect(body.data).toEqual([]);
      expect(body.pagination).toEqual({
        page: Number(query.slice('?page='.length)),
        pageSize: 50,
        totalItems: 45430,
        totalPages: 909,
      });
    },
  );

  it('ignores unknown query parameters', async () => {
    const body = await getPage('?page=2&sort=title&pageSize=10&foo[bar]=1');
    expect(body.pagination.page).toBe(2);
    expect(body.data).toHaveLength(50);
  });
});

describe('GET /api/v1/movies: invalid page (400)', () => {
  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=abc',
    'page=',
    'page=1e2',
    'page=%201',
    `page=${String(Number.MAX_SAFE_INTEGER + 1)}`,
    'page=99999999999999999999999999',
    'page=2&page=3',
    'page=2&page=2',
  ])('rejects ?%s', async (query) => {
    const res = await request(app).get(`/api/v1/movies?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'page', message: expect.any(String) }],
    });
  });
});

describe('GET /api/v1/movies: response shape (supplied database)', () => {
  it('returns exactly the six fields per movie, with structured genres', async () => {
    const res = await request(app).get('/api/v1/movies?page=1');
    for (const movie of res.body.data as Record<string, unknown>[]) {
      expect(Object.keys(movie)).toEqual([
        'movieId',
        'imdbId',
        'title',
        'genres',
        'releaseDate',
        'budget',
      ]);
      expect(Array.isArray(movie.genres)).toBe(true);
      for (const genre of movie.genres as Record<string, unknown>[]) {
        expect(Object.keys(genre).sort()).toEqual(['id', 'name']);
        expect(genre.id).toBeTypeOf('number');
        expect(genre.name).toBeTypeOf('string');
      }
      expect(movie.movieId).toBeTypeOf('number');
      expect(movie.budget).toMatch(USD_PATTERN);
    }
  });

  it('returns the stored movieId, which fetches the same movie from the details endpoint', async () => {
    const page = await getPage('?page=3');
    const expectedIds = (
      suppliedMoviesDb()
        .prepare('SELECT movieId FROM movies ORDER BY movieId LIMIT 50 OFFSET 100')
        .all() as { movieId: number }[]
    ).map((r) => r.movieId);
    expect(page.data.map((m) => m.movieId)).toEqual(expectedIds);

    for (const movie of page.data.slice(0, 5)) {
      const res = await request(app).get(`/api/v1/movies/${String(movie.movieId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject(movie);
    }
  });

  it('matches the documented page-1 example (real records, verbatim)', async () => {
    const body = await getPage('?page=1');
    expect(body.data.slice(0, 3)).toEqual(V1_FIRST_PAGE_EXAMPLE.data);
    expect(body.pagination).toEqual(V1_FIRST_PAGE_EXAMPLE.pagination);
  });

  it('formats budgets as US dollars, with a zero budget as $0', async () => {
    const [ariel, , fourRooms] = (await getPage('?page=1')).data;
    expect(ariel?.budget).toBe('$0');
    expect(fourRooms?.budget).toBe('$4,000,000');
  });

  it('returns null for a missing release date and the stored string otherwise', async () => {
    // movieId 38061 ("Anybody's Son Will Do") has releaseDate ''.
    const { position } = suppliedMoviesDb()
      .prepare('SELECT COUNT(*) AS position FROM movies WHERE movieId < 38061')
      .get() as { position: number };
    const page = Math.floor(position / 50) + 1;
    const movie = (await getPage(`?page=${String(page)}`)).data[position % 50];
    expect(movie).toEqual({
      movieId: 38061,
      imdbId: 'tt0222730',
      title: "Anybody's Son Will Do",
      genres: [],
      releaseDate: null,
      budget: '$0',
    });

    // Date-only values are not shifted by the process time zone.
    expect((await getPage('?page=1')).data[0]?.releaseDate).toBe('1988-10-21');
  });
});

describe('GET /api/v1/movies: failures reach the central error handler', () => {
  it('returns a generic 500 for malformed stored genres, logging the row id', async () => {
    const db = createFixtureMoviesDb([{ movieId: 42, genres: '[{"id": 18, "name": ' }]);
    const { app: fixtureApp, logs } = createTestApp({ versions: createTestVersions(db) });

    const res = await request(fixtureApp).get('/api/v1/movies');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(res.text).not.toMatch(/genres|SELECT|movies\.db|DataIntegrity/);

    const log = logs.find((l) => l.msg === 'Unhandled error while processing request');
    expect(log?.err).toMatchObject({
      type: 'DataIntegrityError',
      context: { table: 'movies', rowId: 42 },
    });
  });

  it('returns a generic 500 when the database is unavailable', async () => {
    const db = createFixtureMoviesDb([{ movieId: 1 }]);
    const { app: fixtureApp } = createTestApp({ versions: createTestVersions(db) });
    db.close();

    const res = await request(fixtureApp).get('/api/v1/movies');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.text).not.toMatch(/database|SQL/i);
  });

  it('reports an empty collection with totalPages 0', async () => {
    const { app: fixtureApp } = createTestApp({
      versions: createTestVersions(createFixtureMoviesDb([])),
    });
    const res = await request(fixtureApp).get('/api/v1/movies');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
    });
  });
});

describe('V2 movie listing', () => {
  it('is not implemented', async () => {
    const res = await request(app).get('/api/v2/movies');
    expect(res.status).toBe(404);
  });
});
