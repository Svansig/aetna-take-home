import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { V1_GENRE_EXAMPLES } from '../../src/movies/routes.js';
import {
  MovieListResponseSchema,
  type MovieListResponse,
  type MovieSummary,
} from '../../src/movies/schemas.js';
import {
  createFixtureMoviesDb,
  createTestApp,
  createTestVersions,
  suppliedMoviesDb,
} from '../helpers.js';

const { app } = createTestApp();

/** The two equivalent ways to ask for one genre. */
const STYLES = {
  path: (genre: string, query = '') =>
    `/api/v1/movies/genre/${encodeURIComponent(genre)}${query ? `?${query}` : ''}`,
  query: (genre: string, query = '') =>
    `/api/v1/movies?genre=${encodeURIComponent(genre)}${query ? `&${query}` : ''}`,
};

async function getList(url: string, testApp = app): Promise<MovieListResponse> {
  const res = await request(testApp).get(url);
  expect(res.status, url).toBe(200);
  for (const movie of res.body.data as object[]) {
    expect(Object.keys(movie).sort()).toEqual(
      ['budget', 'genres', 'imdbId', 'releaseDate', 'title'].sort(),
    );
  }
  // The shared strict MovieSummarySchema rejects any extra field.
  return MovieListResponseSchema.parse(res.body);
}

async function getAllPages(url: (page: number) => string, testApp = app) {
  const first = await getList(url(1), testApp);
  const pages = [first];
  for (let page = 2; page <= first.pagination.totalPages; page++) {
    const body = await getList(url(page), testApp);
    expect(body.pagination).toEqual({ ...first.pagination, page });
    pages.push(body);
  }
  return pages;
}

async function expectError(url: string, status: number, code: string, path?: string) {
  const res = await request(app).get(url);
  expect(res.status, url).toBe(status);
  expect(res.body.error.code).toBe(code);
  if (path !== undefined)
    expect(res.body.error.details).toEqual([{ path, message: expect.any(String) }]);
  return res.body.error as { message: string };
}

/**
 * Independent oracle: movies with a genre id, parsed in JavaScript from every row
 * (not with SQLite's JSON functions), in the given order.
 */
const allRows = (
  suppliedMoviesDb()
    .prepare('SELECT movieId, imdbId, title, genres, releaseDate, budget FROM movies')
    .all() as {
    movieId: number;
    imdbId: string;
    title: string;
    genres: string;
    releaseDate: string;
    budget: number;
  }[]
).map((row) => ({ ...row, genres: JSON.parse(row.genres) as MovieSummary['genres'] }));

function oracle(
  genreId: number,
  { year, by, order }: { year?: string; by: 'movieId' | 'releaseDate'; order: 'asc' | 'desc' },
): MovieSummary[] {
  const sign = order === 'asc' ? 1 : -1;
  return allRows
    .filter((r) => r.genres.some((g) => g.id === genreId))
    .filter((r) => year === undefined || r.releaseDate.startsWith(`${year}-`))
    .sort((a, b) =>
      by === 'releaseDate' && a.releaseDate !== b.releaseDate
        ? sign * (a.releaseDate < b.releaseDate ? -1 : 1)
        : sign * (a.movieId - b.movieId),
    )
    .map(({ imdbId, title, genres, releaseDate, budget }) => ({
      imdbId,
      title,
      genres,
      releaseDate: releaseDate === '' ? null : releaseDate,
      budget,
    }));
}

describe('movies by genre (supplied database)', () => {
  // Science Fiction: 3,042 movies, 61 pages, multiword name.
  const scifi = { asc: oracle(878, { by: 'movieId', order: 'asc' }) };

  it.each(Object.entries(STYLES))(
    'pages through all of Science Fiction by movieId (%s style)',
    async (_style, url) => {
      const pages = await getAllPages((page) => url('Science Fiction', `page=${String(page)}`));
      expect(pages[0]!.pagination).toEqual({
        page: 1,
        pageSize: 50,
        totalItems: 3042,
        totalPages: 61,
      });
      expect(pages.slice(0, -1).every((p) => p.data.length === 50)).toBe(true);
      expect(pages.at(-1)!.data).toHaveLength(42);
      const movies = pages.flatMap((p) => p.data);
      expect(movies).toEqual(scifi.asc);
      // Every movie has the genre, with the stored name; none appears twice.
      expect(
        movies.every((m) => m.genres.some((g) => g.id === 878 && g.name === 'Science Fiction')),
      ).toBe(true);
      expect(new Set(movies.map((m) => `${m.imdbId}|${m.title}`)).size).toBe(3042);
    },
  );

  it('lists the same movies by id, by name in any case, in both styles', async () => {
    const reference = await getList(STYLES.path('28', 'page=2'));
    expect(reference.pagination).toEqual({
      page: 2,
      pageSize: 50,
      totalItems: 6590,
      totalPages: 132,
    });
    for (const genre of ['28', '028', 'Action', 'action', 'ACTION', 'aCtIoN']) {
      for (const url of Object.values(STYLES)) {
        expect(await getList(url(genre, 'page=2'))).toEqual(reference);
      }
    }
  });

  it('sorts by movieId descending with sortOrder=desc, identically in both styles', async () => {
    const expected = oracle(28, { by: 'movieId', order: 'desc' });
    for (const url of Object.values(STYLES)) {
      const [p1, p2] = await Promise.all([
        getList(url('Action', 'sortOrder=desc')),
        getList(url('Action', 'sortOrder=desc&page=2')),
      ]);
      expect([...p1.data, ...p2.data]).toEqual(expected.slice(0, 100));
    }
    const last = await getList(STYLES.path('action', 'sortOrder=desc&page=132'));
    expect(last.data).toEqual(expected.slice(6550));
    expect(last.data).toHaveLength(40);
  });

  it('preserves stored genre names, zero budgets and null release dates', async () => {
    const movies = (
      await getAllPages((page) => STYLES.query('tv movie', `page=${String(page)}`))
    ).flatMap((p) => p.data);
    expect(movies).toEqual(oracle(10770, { by: 'movieId', order: 'asc' }));
    expect(movies.flatMap((m) => m.genres).some((g) => g.name === 'TV Movie')).toBe(true);
    expect(movies.flatMap((m) => m.genres).some((g) => g.name === 'tv movie')).toBe(false);
    expect(movies.some((m) => m.budget === 0)).toBe(true);
  });

  it('returns 200 with an empty page past the end', async () => {
    for (const url of Object.values(STYLES)) {
      expect(await getList(url('Action', 'page=133'))).toEqual({
        data: [],
        pagination: { page: 133, pageSize: 50, totalItems: 6590, totalPages: 132 },
      });
    }
  });

  it('matches the documented examples', async () => {
    const action = await getList(STYLES.path('Action'));
    expect({ ...action, data: action.data.slice(0, 3) }).toEqual(V1_GENRE_EXAMPLES.action);
    const combined = await getList('/api/v1/movies?year=1999&genre=Action');
    expect({ ...combined, data: combined.data.slice(0, 3) }).toEqual(V1_GENRE_EXAMPLES.action1999);
  });

  it('ignores unknown parameters and a year on the dedicated genre route', async () => {
    expect(await getList(STYLES.path('Action', 'year=1999&color=red'))).toEqual(
      await getList(STYLES.path('Action')),
    );
  });
});

describe('combined year and genre (supplied database)', () => {
  it.each(['asc', 'desc'] as const)(
    'returns exactly the 1999 Action movies, chronologically %s',
    async (order) => {
      for (const genre of ['Action', '28']) {
        const pages = await getAllPages(
          (page) =>
            `/api/v1/movies?year=1999&genre=${genre}&sortOrder=${order}&page=${String(page)}`,
        );
        expect(pages.map((p) => p.data.length)).toEqual([50, 50]);
        expect(pages[0]!.pagination).toMatchObject({ totalItems: 100, totalPages: 2 });
        const movies = pages.flatMap((p) => p.data);
        expect(movies).toEqual(oracle(28, { year: '1999', by: 'releaseDate', order }));
        expect(movies.every((m) => m.releaseDate?.startsWith('1999-'))).toBe(true);
        expect(movies.every((m) => m.genres.some((g) => g.id === 28))).toBe(true);
      }
    },
  );

  it('is a strict AND: fewer than either filter alone', async () => {
    const [both, year, genre] = await Promise.all([
      getList('/api/v1/movies?year=1999&genre=Action'),
      getList('/api/v1/movies?year=1999'),
      getList('/api/v1/movies?genre=Action'),
    ]);
    expect(both.pagination.totalItems).toBe(100);
    expect(year.pagination.totalItems).toBe(723);
    expect(genre.pagination.totalItems).toBe(6590);
  });

  it('leaves year-only listings chronological and identical to the year route', async () => {
    expect(await getList('/api/v1/movies?year=1999&sortOrder=desc&page=3')).toEqual(
      await getList('/api/v1/movies/year/1999?sortOrder=desc&page=3'),
    );
  });

  it('returns 200 with an empty page for a known genre with no movies that year', async () => {
    for (const query of ['year=1874&genre=Action', 'year=1850&genre=28&page=4&sortOrder=desc']) {
      const body = await getList(`/api/v1/movies?${query}`);
      expect(body.data).toEqual([]);
      expect(body.pagination).toMatchObject({ totalItems: 0, totalPages: 0 });
    }
  });
});

describe('genre errors', () => {
  it.each([
    'Space Western',
    'Act',
    'Actions',
    'Science',
    'Action ',
    '-28',
    '28.0',
    'Drama,Action',
    '%',
  ])(
    'returns 404 GENRE_NOT_FOUND for the unknown or partial name %j in both styles',
    async (genre) => {
      for (const url of Object.values(STYLES)) {
        const error = await expectError(url(genre), 404, 'GENRE_NOT_FOUND');
        expect(error.message).toBe(`Genre ${JSON.stringify(genre)} not found`);
      }
    },
  );

  it.each(['99999', '1', '29', String(Number.MAX_SAFE_INTEGER)])(
    'returns 404 GENRE_NOT_FOUND for the unknown id %s',
    async (genre) => {
      for (const url of Object.values(STYLES)) {
        const error = await expectError(url(genre), 404, 'GENRE_NOT_FOUND');
        expect(error.message).toBe(`Genre ${String(Number(genre))} not found`);
      }
    },
  );

  it('returns 404 for an unknown genre even with a year that has movies', async () => {
    await expectError('/api/v1/movies?year=1999&genre=Nope', 404, 'GENRE_NOT_FOUND');
  });

  it.each(['0', '00', String(Number.MAX_SAFE_INTEGER + 1), '99999999999999999999', ' ', '   '])(
    'returns 400 for the invalid genre %j in both styles',
    async (genre) => {
      for (const url of Object.values(STYLES)) {
        await expectError(url(genre), 400, 'VALIDATION_ERROR', 'genre');
      }
    },
  );

  it('returns 400 for an empty or missing genre', async () => {
    await expectError('/api/v1/movies?genre=', 400, 'VALIDATION_ERROR', 'genre');
    await expectError('/api/v1/movies/genre', 400, 'VALIDATION_ERROR', 'genre');
    await expectError('/api/v1/movies/genre/', 400, 'VALIDATION_ERROR', 'genre');
  });

  it.each([
    ['/api/v1/movies?year=99&genre=Action', 'year'],
    ['/api/v1/movies?year=1999&genre=0', 'genre'],
    // Validation happens before the genre lookup: 400, not 404.
    ['/api/v1/movies?year=99&genre=Nope', 'year'],
    ['/api/v1/movies?genre=Nope&page=0', 'page'],
    ['/api/v1/movies?genre=Nope&sortOrder=up', 'sortOrder'],
    ['/api/v1/movies/genre/Nope?page=abc', 'page'],
    ['/api/v1/movies?genre=Action&genre=Drama', 'genre'],
    ['/api/v1/movies?genre=Action&page=1&page=2', 'page'],
    ['/api/v1/movies?genre=Action&sortOrder=asc&sortOrder=desc', 'sortOrder'],
    ['/api/v1/movies/genre/Action?sortOrder=desc&sortOrder=desc', 'sortOrder'],
  ])('returns 400 for %s', async (url, path) => {
    await expectError(url, 400, 'VALIDATION_ERROR', path);
  });
});

describe('sortOrder on every listing', () => {
  it.each([
    '/api/v1/movies',
    '/api/v1/movies?year=1999',
    '/api/v1/movies?genre=Action',
    '/api/v1/movies/year/1999',
    '/api/v1/movies/genre/Action',
  ])('rejects invalid values on %s', async (base) => {
    const sep = base.includes('?') ? '&' : '?';
    for (const value of ['bogus', 'random', '', 'ASC', 'descending']) {
      await expectError(`${base}${sep}sortOrder=${value}`, 400, 'VALIDATION_ERROR', 'sortOrder');
    }
    await expectError(
      `${base}${sep}sortOrder=asc&sortOrder=asc`,
      400,
      'VALIDATION_ERROR',
      'sortOrder',
    );
  });

  it('orders the unfiltered listing by movieId in both directions', async () => {
    const ids = (
      suppliedMoviesDb()
        .prepare('SELECT imdbId FROM movies ORDER BY movieId DESC LIMIT 100')
        .all() as { imdbId: string }[]
    ).map((r) => r.imdbId);
    const [p1, p2] = await Promise.all([
      getList('/api/v1/movies?sortOrder=desc'),
      getList('/api/v1/movies?sortOrder=desc&page=2'),
    ]);
    expect([...p1.data, ...p2.data].map((m) => m.imdbId)).toEqual(ids);
    expect(p1.pagination).toEqual({ page: 1, pageSize: 50, totalItems: 45430, totalPages: 909 });
  });
});

describe('movies by genre (fixtures)', () => {
  const g = (...genres: [number, string][]) =>
    JSON.stringify(genres.map(([id, name]) => ({ id, name })));
  const fixtureApp = createTestApp({
    versions: createTestVersions(
      createFixtureMoviesDb([
        // Duplicate genre entry: listed once.
        { movieId: 3, releaseDate: '2001-01-01', genres: g([28, 'Action'], [28, 'Action']) },
        { movieId: 2, releaseDate: '2001-01-01', genres: g([28, 'Action']) },
        { movieId: 1, releaseDate: '2001-06-06', genres: g([28, 'Action'], [18, 'Drama']) },
        { movieId: 4, releaseDate: '2002-01-01', genres: g([18, 'Drama']) },
      ]),
    ),
  }).app;
  const imdbIds = (body: MovieListResponse) => body.data.map((m) => Number(m.imdbId.slice(2)));

  it('returns a movie with a duplicated genre entry once', async () => {
    const body = await getList(STYLES.path('action'), fixtureApp);
    expect(imdbIds(body)).toEqual([1, 2, 3]);
    expect(body.pagination.totalItems).toBe(3);
  });

  it('breaks same-date ties by movieId in combined listings', async () => {
    expect(imdbIds(await getList('/api/v1/movies?year=2001&genre=28', fixtureApp))).toEqual([
      2, 3, 1,
    ]);
    expect(
      imdbIds(await getList('/api/v1/movies?year=2001&genre=28&sortOrder=desc', fixtureApp)),
    ).toEqual([1, 3, 2]);
  });

  it('returns 200 empty for a genre that exists in the data but not in the year', async () => {
    const body = await getList('/api/v1/movies?year=2002&genre=Action', fixtureApp);
    expect(body).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
    });
  });

  it('returns a generic 500 when stored genre JSON breaks the genre query', async () => {
    const broken = createTestApp({
      versions: createTestVersions(
        createFixtureMoviesDb([{ movieId: 1, genres: '[{"id": 28, "name": ' }]),
      ),
    }).app;
    const res = await request(broken).get(STYLES.path('Action'));
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.text).not.toMatch(/json|SELECT|sqlite|\.db/i);
  });
});
