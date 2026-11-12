import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const REPO_URL = 'https://github.com/Svansig/aetna-take-home';

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => (m[1] ?? '').replaceAll('&amp;', '&'));
}

describe('landing page', () => {
  const { app } = createTestApp();

  it('serves HTML at / with a restrictive content security policy', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(res.headers['content-security-policy']).toMatch(/style-src 'self'/);
    expect(res.headers['content-security-policy']).not.toMatch(/script-src/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.text).toContain('<title>Movie Services API</title>');
    expect(res.text).not.toMatch(/<script/i);
  });

  it('answers HEAD /', async () => {
    const res = await request(app).head('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('serves the stylesheet', async () => {
    const res = await request(app).get('/styles.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
  });

  it('links to the GitHub repository and its documentation', async () => {
    const links = hrefs((await request(app).get('/')).text);
    expect(links).toEqual(
      expect.arrayContaining([
        REPO_URL,
        `${REPO_URL}/blob/main/README.md`,
        `${REPO_URL}/blob/main/ASSIGNMENT.md`,
        `${REPO_URL}/blob/main/docs/ASSUMPTIONS.md`,
        `${REPO_URL}/blob/main/docs/DEPLOYMENT.md`,
      ]),
    );
  });

  it('links to every user story endpoint and the docs', async () => {
    const links = hrefs((await request(app).get('/')).text);
    expect(links).toEqual(
      expect.arrayContaining([
        '/docs/',
        '/openapi.json',
        '/health',
        '/api/v1/movies',
        '/api/v1/movies/11',
        '/api/v1/movies/year/1999',
        '/api/v1/movies/genre/Action',
      ]),
    );
  });

  it('has no broken internal links', async () => {
    const internal = [...new Set(hrefs((await request(app).get('/')).text))].filter((href) =>
      href.startsWith('/'),
    );
    expect(internal.length).toBeGreaterThan(0);
    for (const href of internal) {
      const res = await request(app).get(href);
      expect(res.status, href).toBe(200);
    }
  });

  it.each(['/foo', '/index.htm', '/.gitkeep', '/public/index.html'])(
    'leaves other paths to the JSON 404 handler: %s',
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    },
  );

  it('does not add the page headers to API responses', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});
