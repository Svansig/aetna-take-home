import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_YEAR_EXAMPLE,
  FIRST_PAGE_EXAMPLE,
  YEAR_1999_EXAMPLES,
} from '../../src/openapi/movie-examples.js';
import {
  MovieListResponseSchema,
  MovieSummarySchema,
  type MovieListResponse,
  type MovieSummary,
} from '../../src/movies/schemas.js';
import {
  createFixtureMoviesDb,
  createTestApp,
  createTestApiRouter,
  suppliedMoviesDb,
  usd,
} from '../helpers.js';

const { app } = createTestApp();

/** The two equivalent ways to ask for one year. */
const STYLES = {
  path: (year: string, query = '') => `/api/v1/movies/year/${year}${query ? `?${query}` : ''}`,
  query: (year: string, query = '') => `/api/v1/movies?year=${year}${query ? `&${query}` : ''}`,
};

async function getList(url: string, testApp = app): Promise<MovieListResponse> {
  const res = await request(testApp).get(url);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  for (const movie of res.body.data as object[]) {
    expect(Object.keys(movie).sort()).toEqual(
      ['budget', 'genres', 'imdbId', 'movieId', 'releaseDate', 'title'].sort(),
    );
  }
  // Strict schemas: the shared MovieSummarySchema rejects any extra field.
  return MovieListResponseSchema.parse(res.body);
}

/** Every page of a year listing, in order, checking the metadata on each. */
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

/**
 * Independent oracle: the year's movies straight from SQLite, matched by
 * extracting the year (not by the date range the repository uses).
 */
function oracle(year: string, direction: 'ASC' | 'DESC') {
  return suppliedMoviesDb()
    .prepare(
      `SELECT movieId, imdbId, title, genres, releaseDate, budget FROM movies
        WHERE substr(releaseDate, 1, 4) = ?
        ORDER BY releaseDate ${direction}, movieId ${direction}`,
    )
    .all(year) as {
    movieId: number;
    imdbId: string;
    title: string;
    genres: string;
    releaseDate: string;
    budget: number;
  }[];
}

const asSummary = (row: ReturnType<typeof oracle>[number]): MovieSummary => ({
  movieId: row.movieId,
  imdbId: row.imdbId,
  title: row.title,
  genres: JSON.parse(row.genres) as MovieSummary['genres'],
  releaseDate: row.releaseDate,
  budget: usd(row.budget),
});

describe('movies by year (supplied database)', () => {
  const expected = {
    asc: oracle('1999', 'ASC').map(asSummary),
    desc: oracle('1999', 'DESC').map(asSummary),
  };

  it('has the known shape of 1999: 723 movies, 67 on 1999-01-01', () => {
    expect(expected.asc).toHaveLength(723);
    expect(expected.asc.filter((m) => m.releaseDate === '1999-01-01')).toHaveLength(67);
  });

  describe.each(Object.entries(STYLES))('%s style', (_style, url) => {
    it.each(['asc', 'desc'] as const)(
      'pages through all of 1999 in %s order with exact metadata',
      async (sortOrder) => {
        const pages = await getAllPages((page) =>
          url('1999', `page=${String(page)}&sortOrder=${sortOrder}`),
        );

        expect(pages[0]!.pagination).toEqual({
          page: 1,
          pageSize: 50,
          totalItems: 723,
          totalPages: 15,
        });
        expect(pages.slice(0, -1).every((p) => p.data.length === 50)).toBe(true);
        expect(pages.at(-1)!.data).toHaveLength(23);

        const movies = pages.flatMap((p) => p.data);
        expect(movies).toEqual(expected[sortOrder]);
        // Only 1999, nothing from adjacent years, no missing dates.
        expect(movies.every((m) => m.releaseDate?.startsWith('1999-'))).toBe(true);
        // No record appears on two pages.
        expect(new Set(movies.map((m) => `${m.imdbId}|${m.title}`)).size).toBe(723);
        // Chronological in the requested direction.
        const dates = movies.map((m) => m.releaseDate!);
        const sorted = [...dates].sort();
        expect(dates).toEqual(sortOrder === 'asc' ? sorted : sorted.reverse());
      },
    );

    it('defaults to ascending order and page 1', async () => {
      expect(await getList(url('1999'))).toEqual(
        await getList(url('1999', 'page=1&sortOrder=asc')),
      );
    });

    it('breaks the 1999-01-01 tie by movieId across the page 1/2 boundary', async () => {
      const [p1, p2] = await Promise.all([getList(url('1999')), getList(url('1999', 'page=2'))]);
      expect(p1.data.at(-1)?.releaseDate).toBe('1999-01-01');
      expect(p2.data[0]?.releaseDate).toBe('1999-01-01');
      expect([...p1.data, ...p2.data]).toEqual(expected.asc.slice(0, 100));
      // Repeated requests return the same order.
      expect(await getList(url('1999', 'page=2'))).toEqual(p2);
    });

    it('returns 200 with an empty page past the end, keeping the page number', async () => {
      for (const page of ['16', String(Number.MAX_SAFE_INTEGER)]) {
        expect(await getList(url('1999', `page=${page}`))).toEqual({
          data: [],
          pagination: { page: Number(page), pageSize: 50, totalItems: 723, totalPages: 15 },
        });
      }
    });

    it.each(['0001', '1850', '9999'])(
      'returns 200 with totals of 0 for %s, a valid year with no movies',
      async (year) => {
        expect(await getList(url(year, 'page=3&sortOrder=desc'))).toEqual({
          data: [],
          pagination: { page: 3, pageSize: 50, totalItems: 0, totalPages: 0 },
        });
      },
    );

    it('accepts leading-zero pages and ignores unknown parameters', async () => {
      expect(await getList(url('1999', 'page=02&color=red&sort=title'))).toEqual(
        await getList(url('1999', 'page=2')),
      );
    });

    it('preserves zero budgets, structured genres and YYYY-MM-DD dates', async () => {
      const movies = (await getAllPages((page) => url('1999', `page=${String(page)}`))).flatMap(
        (p) => p.data,
      );
      expect(movies.filter((m) => m.budget === '$0')).toHaveLength(536);
      expect(movies.filter((m) => m.budget !== '$0').length).toBeGreaterThan(0);
      expect(movies.every((m) => MovieSummarySchema.safeParse(m).success)).toBe(true);
      expect(movies.every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.releaseDate!))).toBe(true);
      expect(movies.flatMap((m) => m.genres)[0]).toEqual({
        id: expect.any(Number),
        name: expect.any(String),
      });
    });
  });

  it('gives identical responses from both styles for the same year, page and sortOrder', async () => {
    for (const query of ['', 'page=2', 'sortOrder=desc', 'page=15&sortOrder=desc', 'page=99']) {
      expect(await getList(STYLES.query('1999', query))).toEqual(
        await getList(STYLES.path('1999', query)),
      );
    }
  });

  it('matches the documented examples', async () => {
    for (const sortOrder of ['asc', 'desc'] as const) {
      const body = await getList(STYLES.path('1999', `sortOrder=${sortOrder}`));
      expect({ ...body, data: body.data.slice(0, 3) }).toEqual(YEAR_1999_EXAMPLES[sortOrder]);
    }
    expect(await getList(STYLES.path(String(EMPTY_YEAR_EXAMPLE.year)))).toEqual(
      EMPTY_YEAR_EXAMPLE.response,
    );
  });

  it('uses the path year on the dedicated endpoint, ignoring a year query parameter', async () => {
    expect(await getList('/api/v1/movies/year/1999?year=2000')).toEqual(
      await getList(STYLES.path('1999')),
    );
  });
});

describe('movies by year: validation', () => {
  const INVALID_YEARS = [
    '0',
    '99',
    '999',
    '0000',
    '10000',
    '01999',
    '-1999',
    '+1999',
    '1999.5',
    '1999.0',
    'abc',
    '1e3',
    '0x7CF',
    '%201999',
    '1999%20',
    '',
  ];

  async function expect400(url: string, path: string, message?: string) {
    const res = await request(app).get(url);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path, message: message ?? expect.any(String) }],
    });
  }

  it.each(INVALID_YEARS)('rejects year %j with 400 (query style)', async (year) => {
    await expect400(STYLES.query(year), 'year', 'year must be a four-digit year from 0001 to 9999');
  });

  it.each(INVALID_YEARS)('rejects year %j with 400 (path style)', async (year) => {
    await expect400(STYLES.path(year), 'year', 'year must be a four-digit year from 0001 to 9999');
  });

  it('rejects a missing path year as a year error, not a movieId error', async () => {
    await expect400('/api/v1/movies/year', 'year');
  });

  it.each(['random', 'ascending', 'descending', 'ASC', 'Desc', '1', '', ' asc'])(
    'rejects sortOrder %j with 400 in both styles',
    async (sortOrder) => {
      for (const url of Object.values(STYLES)) {
        await expect400(
          url('1999', `sortOrder=${encodeURIComponent(sortOrder)}`),
          'sortOrder',
          'sortOrder must be "asc" or "desc"',
        );
      }
    },
  );

  it.each([
    ['year (query style)', '/api/v1/movies?year=1999&year=2000', 'year'],
    ['page (query style)', '/api/v1/movies?year=1999&page=1&page=2', 'page'],
    [
      'sortOrder (query style)',
      '/api/v1/movies?year=1999&sortOrder=asc&sortOrder=desc',
      'sortOrder',
    ],
    ['page (path style)', '/api/v1/movies/year/1999?page=1&page=2', 'page'],
    ['sortOrder (path style)', '/api/v1/movies/year/1999?sortOrder=asc&sortOrder=asc', 'sortOrder'],
  ])('rejects a repeated %s', async (_label, url, path) => {
    await expect400(url, path, `${path} must not be repeated`);
  });

  it.each(['0', '-1', '1.5', 'abc', ''])(
    'rejects page %j with 400 in both styles',
    async (page) => {
      for (const url of Object.values(STYLES)) {
        await expect400(url('1999', `page=${page}`), 'page');
      }
    },
  );
});

describe('existing endpoints are unchanged', () => {
  // Phase 4 changed this deliberately: sortOrder is now validated and applied
  // (by movieId) on unfiltered listings too.
  it('keeps the unfiltered listing in movieId order, with sortOrder=desc reversing it', async () => {
    const plain = await getList('/api/v1/movies');
    expect({ ...plain, data: plain.data.slice(0, 3) }).toEqual(FIRST_PAGE_EXAMPLE);
    expect(await getList('/api/v1/movies?sortOrder=asc')).toEqual(plain);
    const last = await getList('/api/v1/movies?page=909&sortOrder=desc');
    expect(last.data.map((m) => m.imdbId).reverse()).toEqual(
      plain.data.map((m) => m.imdbId).slice(0, 30),
    );
  });

  it('still routes numeric ids to movie details', async () => {
    const res = await request(app).get('/api/v1/movies/1999');
    expect(res.body).not.toHaveProperty('pagination');
    expect((await request(app).get('/api/v1/movies/11')).body.title).toBe('Star Wars');
  });
});

describe('movies by year (fixtures)', () => {
  // Inserted out of order so ordering can't come from insertion order.
  const db = createFixtureMoviesDb([
    { movieId: 22, releaseDate: '1999-06-15', budget: 0 },
    { movieId: 13, releaseDate: '1999-12-31' },
    { movieId: 10, releaseDate: '1998-12-31' },
    { movieId: 20, releaseDate: '1999-06-15' },
    { movieId: 14, releaseDate: '2000-01-01' },
    { movieId: 11, releaseDate: '1999-01-01' },
    { movieId: 21, releaseDate: '1999-06-15' },
    { movieId: 15, releaseDate: '' },
    { movieId: 16, releaseDate: null },
    { movieId: 12, releaseDate: '1999-03-01' },
    { movieId: 1, releaseDate: '0001-01-01' },
    { movieId: 2, releaseDate: '0001-12-31' },
    { movieId: 3, releaseDate: '0002-01-01' },
    { movieId: 4, releaseDate: '9998-12-31' },
    { movieId: 5, releaseDate: '9999-01-01' },
    { movieId: 6, releaseDate: '9999-12-31' },
  ]);
  const fixtureApp = createTestApp({ apiRouter: createTestApiRouter(db) }).app;
  const ids = (body: MovieListResponse) => body.data.map((m) => m.movieId);

  it.each(Object.entries(STYLES))(
    'includes both year boundaries, excludes adjacent years and missing dates (%s style)',
    async (_style, url) => {
      const asc = await getList(url('1999'), fixtureApp);
      expect(ids(asc)).toEqual([11, 12, 20, 21, 22, 13]);
      expect(asc.pagination).toMatchObject({ totalItems: 6, totalPages: 1 });
      const desc = await getList(url('1999', 'sortOrder=desc'), fixtureApp);
      expect(ids(desc)).toEqual([13, 22, 21, 20, 12, 11]);
    },
  );

  it.each([
    ['0001', [1, 2]],
    ['0002', [3]],
    ['9998', [4]],
    ['9999', [5, 6]],
  ])('handles the extreme year %s', async (year, expected) => {
    expect(ids(await getList(STYLES.path(year), fixtureApp))).toEqual(expected);
  });

  it('formats a zero budget as $0', async () => {
    const body = await getList(STYLES.path('1999'), fixtureApp);
    expect(body.data.find((m) => m.movieId === 22)?.budget).toBe('$0');
  });

  it('pages a large same-date tie without overlap or gaps, in both directions', async () => {
    // 120 movies on one date, inserted in descending id order.
    const tied = createFixtureMoviesDb(
      Array.from({ length: 120 }, (_, i) => ({ movieId: 120 - i, releaseDate: '2001-09-09' })),
    );
    const tiedApp = createTestApp({ apiRouter: createTestApiRouter(tied) }).app;
    const all = Array.from({ length: 120 }, (_, i) => i + 1);
    for (const [sortOrder, order] of [
      ['asc', all],
      ['desc', [...all].reverse()],
    ] as const) {
      const pages = await getAllPages(
        (page) => STYLES.query('2001', `page=${String(page)}&sortOrder=${sortOrder}`),
        tiedApp,
      );
      expect(pages.map((p) => p.data.length)).toEqual([50, 50, 20]);
      expect(pages.flatMap(ids)).toEqual(order);
    }
  });

  it('turns a malformed row in the year into a generic 500, like the listing', async () => {
    const broken = createFixtureMoviesDb([{ movieId: 7, releaseDate: '1999-05-05', genres: '[' }]);
    const res = await request(createTestApp({ apiRouter: createTestApiRouter(broken) }).app).get(
      STYLES.path('1999'),
    );
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
