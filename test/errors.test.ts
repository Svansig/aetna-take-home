import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorResponseSchema, HttpError } from '../src/http/errors.js';
import type { ApiVersion } from '../src/versions.js';
import { createTestApp } from './helpers.js';

/** A v1 router with routes that fail in controlled ways, to exercise the shared handler. */
function failingVersion(): ApiVersion {
  const router = Router();
  router.get('/boom', () => {
    throw new Error('SELECT * FROM secret_table at /srv/app/db/movies.db');
  });
  router.get('/async-boom', async () => {
    await Promise.resolve();
    throw new Error('async failure at /srv/app/src/thing.ts');
  });
  router.get('/validate', (req, res) => {
    const query = z.object({ page: z.coerce.number().int().positive() }).parse(req.query);
    res.json(query);
  });
  router.get('/items/:id', (req, res) => {
    res.json({ id: req.params.id });
  });
  router.get('/teapot', () => {
    throw new HttpError(418, 'TEAPOT', 'Short and stout');
  });
  return { id: 'v1', router };
}

describe('error handling', () => {
  it('returns 404 with the standard envelope for unknown routes', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/no/such/route');
    expect(res.status).toBe(404);
    expect(ErrorResponseSchema.parse(res.body)).toBeTruthy();
    expect(res.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Route GET /no/such/route not found',
    });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it.each(['/api/v1', '/api/v1/movies', '/api/v2/movies'])(
    'returns 404 under mounted-but-empty version prefix %s',
    async (url) => {
      const { app } = createTestApp();
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    },
  );

  it.each(['/api/v1/boom', '/api/v1/async-boom'])(
    'returns a generic 500 and logs the real error for %s',
    async (url) => {
      const { app, logs } = createTestApp({ versions: [failingVersion()] });
      const res = await request(app).get(url);

      expect(res.status).toBe(500);
      expect(ErrorResponseSchema.parse(res.body)).toBeTruthy();
      expect(res.body.error).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
      // No stack traces, SQL or filesystem paths in the response.
      expect(res.text).not.toMatch(/stack|SELECT|\/srv\/app|\.ts|\.db/);

      const errorLog = logs.find((l) => l.msg === 'Unhandled error while processing request');
      expect(errorLog).toBeDefined();
      expect(errorLog).toMatchObject({ level: 50, err: { message: expect.any(String) } });
      expect((errorLog!.err as { stack?: string }).stack).toBeTypeOf('string');
    },
  );

  it('maps Zod validation errors to 400 with field details', async () => {
    const { app } = createTestApp({ versions: [failingVersion()] });
    const res = await request(app).get('/api/v1/validate?page=abc');
    expect(res.status).toBe(400);
    expect(ErrorResponseSchema.parse(res.body)).toBeTruthy();
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'page', message: expect.any(String) }],
    });
  });

  it('passes through HttpError status and code', async () => {
    const { app } = createTestApp({ versions: [failingVersion()] });
    const res = await request(app).get('/api/v1/teapot');
    expect(res.status).toBe(418);
    expect(res.body.error).toMatchObject({ code: 'TEAPOT', message: 'Short and stout' });
  });

  it('maps Express client errors (malformed path parameter encoding) to 400', async () => {
    const { app } = createTestApp({ versions: [failingVersion()] });
    const res = await request(app).get('/api/v1/items/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('logs one structured line per request with id, method, url and status', async () => {
    const { app, logs } = createTestApp();
    const res = await request(app).get('/no/such/route');
    const line = logs.find((l) => l.msg === 'request completed');
    expect(line).toMatchObject({
      level: 40,
      req: { id: res.headers['x-request-id'], method: 'GET', url: '/no/such/route' },
      res: { statusCode: 404 },
    });
  });
});
