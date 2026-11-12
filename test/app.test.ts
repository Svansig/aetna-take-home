import { Validator } from '@seriousme/openapi-schema-validator';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { createTestApp, createTestVersions } from './helpers.js';

describe('createApp', () => {
  it('constructs an Express application from injected dependencies', () => {
    const { app } = createTestApp();
    expect(typeof app).toBe('function');
    expect(typeof app.listen).toBe('function');
  });

  it('rejects duplicate API version ids', () => {
    const [v1] = createTestVersions();
    expect(() => createApp({ logger: createLogger('silent'), versions: [v1!, v1!] })).toThrow(
      /Duplicate API version/,
    );
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

  it('documents only operations that exist (V1 movies; nothing under V2)', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/openapi.json');
    expect(Object.keys(res.body.paths as object)).toEqual([
      '/health',
      '/api/v1/movies',
      '/api/v1/movies/{movieId}',
    ]);
  });

  it('includes operations registered by an API version under its prefix', async () => {
    const [v1, v2] = createTestVersions();
    const { app } = createTestApp({
      versions: [
        {
          ...v1!,
          registerDocs: (registry, basePath) => {
            registry.registerPath({
              method: 'get',
              path: `${basePath}/example`,
              responses: { 204: { description: 'Test-only operation' } },
            });
          },
        },
        v2!,
      ],
    });
    const res = await request(app).get('/openapi.json');
    expect(Object.keys(res.body.paths as object)).toContain('/api/v1/example');
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
