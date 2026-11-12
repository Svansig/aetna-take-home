// Functional smoke test for a running Movie Services API (V1 dataset).
//
// Dependency-free: needs only Node.js >= 18 (global fetch). Used by
//   - the publish workflow, against the freshly built image before it is pushed;
//   - the host updater, inside the candidate container (the LXC has no Node.js):
//       docker exec -i -e SMOKE_BASE_URL=http://127.0.0.1:3000 aetna-api \
//         node --input-type=module < smoke-test.js
//   - operators, against the public hostname:
//       node deploy/smoke-test.js https://aetna-test.budarz.dev
//
// Exits 0 when every check passes, 1 otherwise. Prints one line per check.

const baseUrl = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000').replace(
  /\/+$/,
  '',
);
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 15_000);

async function get(path) {
  const res = await fetch(baseUrl + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'movie-services-smoke-test' },
  });
  const body = await res.text();
  return { status: res.status, headers: res.headers, body };
}

function json(res) {
  try {
    return JSON.parse(res.body);
  } catch {
    throw new Error(`response is not JSON (status ${String(res.status)})`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function expectStatus(res, status) {
  expect(res.status === status, `expected HTTP ${String(status)}, got ${String(res.status)}`);
}

function expectPage(body) {
  expect(Array.isArray(body.data) && body.data.length > 0, 'expected a non-empty data array');
  expect(typeof body.pagination === 'object' && body.pagination !== null, 'missing pagination');
}

const checks = [
  [
    'GET /health',
    async () => {
      const res = await get('/health');
      expectStatus(res, 200);
      expect(json(res).status === 'ok', 'expected {"status":"ok"}');
    },
  ],
  [
    'GET /openapi.json',
    async () => {
      const res = await get('/openapi.json');
      expectStatus(res, 200);
      const doc = json(res);
      expect(String(doc.openapi).startsWith('3.1'), 'expected an OpenAPI 3.1 document');
      expect(doc.paths?.['/api/v1/movies'] !== undefined, 'missing /api/v1/movies path');
      // Swagger UI sends "Try it out" requests to this server; a relative URL
      // means the page's own origin (works behind the tunnel).
      expect(doc.servers?.[0]?.url === '/', 'expected the relative server URL "/"');
    },
  ],
  [
    'GET /docs/ (Swagger UI and assets)',
    async () => {
      const page = await get('/docs/');
      expectStatus(page, 200);
      expect(page.body.includes('swagger-ui'), 'expected the Swagger UI page');
      for (const asset of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-init.js']) {
        const res = await get(`/docs/${asset}`);
        expect(res.status === 200, `asset ${asset}: HTTP ${String(res.status)}`);
      }
    },
  ],
  [
    'GET /api/v1/movies',
    async () => {
      const res = await get('/api/v1/movies');
      expectStatus(res, 200);
      expectPage(json(res));
    },
  ],
  [
    'GET /api/v1/movies/11',
    async () => {
      const res = await get('/api/v1/movies/11');
      expectStatus(res, 200);
      const body = json(res);
      expect(body.imdbId === 'tt0076759', `expected imdbId tt0076759, got ${String(body.imdbId)}`);
    },
  ],
  [
    'GET /api/v1/movies/year/1999',
    async () => {
      const res = await get('/api/v1/movies/year/1999');
      expectStatus(res, 200);
      const body = json(res);
      expectPage(body);
      const wrong = body.data.filter((m) => !String(m.releaseDate).startsWith('1999-'));
      expect(wrong.length === 0, 'found movies not released in 1999');
    },
  ],
  [
    'GET /api/v1/movies/genre/28',
    async () => {
      const res = await get('/api/v1/movies/genre/28');
      expectStatus(res, 200);
      const body = json(res);
      expectPage(body);
      const wrong = body.data.filter((m) => !m.genres?.some((g) => g.id === 28));
      expect(wrong.length === 0, 'found movies without genre 28');
    },
  ],
  [
    'GET /api/v1/movies/999999999 returns 404',
    async () => {
      const res = await get('/api/v1/movies/999999999');
      expect(res.status === 404, `expected HTTP 404, got ${String(res.status)}`);
    },
  ],
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    await check();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(
  `smoke-test ${baseUrl}: ${String(checks.length - failed)}/${String(checks.length)} passed`,
);
process.exit(failed === 0 ? 0 : 1);
