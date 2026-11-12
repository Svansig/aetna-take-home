import { Validator } from '@seriousme/openapi-schema-validator';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '../src/app.js';
import { MovieListResponseSchema } from '../src/movies/schemas.js';
import { createTestApp } from './helpers.js';

describe('createApp', () => {
  it('constructs an Express application from injected dependencies', () => {
    const { app } = createTestApp();
    expect(typeof app).toBe('function');
    expect(typeof app.listen).toBe('function');
  });

  it('mounts the API under /api/v1', () => {
    expect(API_BASE_PATH).toBe('/api/v1');
  });
});

describe('API routes', () => {
  const { app } = createTestApp();

  it.each([
    ['/api/v1/movies', 45430],
    ['/api/v1/movies/year/1999', 723],
    ['/api/v1/movies/genre/Action', 6590],
    ['/api/v1/movies?year=1999&genre=Action', 100],
    ['/api/v1/movies?year=1999&genre=28&sortOrder=desc', 100],
  ])('serves the listing %s', async (url, totalItems) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({
      page: 1,
      pageSize: 50,
      totalItems,
      totalPages: Math.ceil(totalItems / 50),
    });
    expect(res.body.data).toHaveLength(50);
  });

  it('serves movie details at /api/v1/movies/:movieId', async () => {
    const res = await request(app).get('/api/v1/movies/11');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ movieId: 11, title: 'Star Wars', averageRating: 3.69 });
  });

  it('reverses the default movieId order with sortOrder=desc', async () => {
    const asc = await request(app).get('/api/v1/movies');
    const desc = await request(app).get('/api/v1/movies?sortOrder=desc');
    const ids = (body: unknown) =>
      MovieListResponseSchema.parse(body).data.map((movie) => movie.movieId);
    expect(ids(asc.body)).toEqual([...ids(asc.body)].sort((a, b) => a - b));
    expect(ids(desc.body)).toEqual([...ids(desc.body)].sort((a, b) => b - a));
  });

  it.each(['/api/v2', '/api/v2/movies', '/api/v2/movies/11', '/api/v2/movies/year/1999'])(
    'does not register a second API version: %s is 404',
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    },
  );

  it('does not serve the movie routes outside /api/v1', async () => {
    const res = await request(app).get('/movies');
    expect(res.status).toBe(404);
  });
});

describe('GET /health', () => {
  it('returns 200 with a minimal JSON body', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not advertise the framework', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('API documentation', () => {
  it('serves a valid OpenAPI 3.1 document', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);

    const result = await new Validator().validate(res.body as Record<string, unknown>);
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);

    expect(res.body).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'Movie Services API' },
      servers: [{ url: '/' }],
      components: { schemas: { ErrorResponse: expect.any(Object) } },
    });
  });

  it('documents exactly the implemented operations', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/openapi.json');
    const paths = res.body.paths as Record<string, Record<string, { operationId?: string }>>;
    const operations = Object.entries(paths).flatMap(([path, item]) =>
      Object.entries(item).map(([method, op]) => [method, path, op.operationId]),
    );
    expect(operations).toEqual([
      ['get', '/health', undefined],
      ['get', '/api/v1/movies', 'listMovies'],
      ['get', '/api/v1/movies/year/{year}', 'listMoviesByYear'],
      ['get', '/api/v1/movies/genre/{genre}', 'listMoviesByGenre'],
      ['get', '/api/v1/movies/{movieId}', 'getMovieDetails'],
    ]);
    const tags = res.body.tags as { name: string }[];
    expect(tags.map((t) => t.name)).toEqual(['Movies', 'Operations']);
  });

  it('describes a single API version and keeps the rating-integrity warning', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/openapi.json');
    expect(res.text).not.toMatch(/v2|kaggle|rebuilt/i);
    expect(res.body.info.description).toMatch(/may belong to a different movie/);
    expect(res.body.paths['/api/v1/movies/{movieId}'].get.description).toMatch(
      /ratings may belong to a different movie/,
    );
  });

  it('serves Swagger UI at /docs', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('swagger-ui');

    const init = await request(app).get('/docs/swagger-ui-init.js');
    expect(init.status).toBe(200);
    expect(init.text).toContain('Movie Services API');
  });

  it('redirects /docs to /docs/ so relative assets resolve', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/docs');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/docs/');
  });
});
