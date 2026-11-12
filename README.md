# Movie Services API

A read-only TypeScript/Express API over a movie metadata dataset and a user ratings
dataset. The original brief and user stories are in [ASSIGNMENT.md](ASSIGNMENT.md).

> **Status: Phase 0 (foundation) only.** The project infrastructure is in place.
> **None of the four movie user stories is implemented yet:** no listing, details,
> by-year or by-genre endpoints.

## Implemented vs. planned

| Area                                                  | Status                                      |
| ----------------------------------------------------- | ------------------------------------------- |
| App factory, server bootstrap, graceful shutdown      | ✅ Implemented                              |
| Zod-validated environment configuration               | ✅ Implemented                              |
| Structured logging (pino), per-request ids            | ✅ Implemented                              |
| Centralised error handling (400 / 404 / 500 envelope) | ✅ Implemented                              |
| `GET /health`                                         | ✅ Implemented                              |
| OpenAPI 3.1 at `/openapi.json`, Swagger UI at `/docs` | ✅ Implemented                              |
| `/api/v1` and `/api/v2` mount points                  | ✅ Mounted, with no operations (return 404) |
| Docker image and Compose deployment                   | ✅ Implemented                              |
| Movie list / details / by year / by genre             | ⏳ Planned (Phase 1+)                       |
| Pagination, genre filtering, rating aggregation       | ⏳ Planned                                  |
| V2 dataset rebuilt from Kaggle sources                | ⏳ Planned                                  |
| Cloudflare Tunnel deployment                          | ⏳ Planned                                  |

## Technology stack

- **Node.js 26** (current LTS), **TypeScript 6.0** (strict), ESM
- **Express 5**: HTTP
- **Zod 4**: runtime validation for config and requests, with inferred types
- **@asteasolutions/zod-to-openapi**: OpenAPI 3.1 generated from the Zod schemas
- **swagger-ui-express**: interactive docs
- **pino / pino-http**: structured JSON logs to stdout
- **SQLite** through Node's built-in `node:sqlite` (see [decisions](#architectural-decisions))
- **Vitest + Supertest**: unit and HTTP integration tests
- **ESLint** (typescript-eslint, strict type-checked) and **Prettier**
- **Docker** (multi-stage build) and **Docker Compose**

## Requirements

- Node.js ≥ 26 (`.nvmrc` provided) and npm
- Docker with the Compose plugin (for container runs)
- The supplied databases at `db/movies.db` and `db/ratings.db` (already in the repo)

## Installation

```sh
npm ci
```

npm may report blocked install scripts for `esbuild` (used by `tsx`, which works
without it) and `@scarf/scarf` (analytics from swagger-ui). Neither is needed.

## Configuration

Settings come from environment variables (12-factor) and are validated with
Zod at startup. Invalid values stop the process with a message that names the
variable without printing its value. For local development, copy the example
file. `npm run dev` and `npm start` load `.env` automatically if it exists.

```sh
cp .env.example .env
```

| Variable             | Default             | Notes                                                          |
| -------------------- | ------------------- | -------------------------------------------------------------- |
| `NODE_ENV`           | `development`       | `development` \| `test` \| `production`                        |
| `HOST`               | `127.0.0.1`         | Bind address. The Docker image sets `0.0.0.0`.                 |
| `PORT`               | `3000`              |                                                                |
| `LOG_LEVEL`          | `info`              | `fatal` `error` `warn` `info` `debug` `trace` `silent`         |
| `V1_MOVIES_DB_PATH`  | `db/movies.db`      | Relative paths resolve against the project root, not the CWD.  |
| `V1_RATINGS_DB_PATH` | `db/ratings.db`     |                                                                |
| `V2_DB_PATH`         | `data/v2/movies.db` | This file doesn't exist yet and isn't needed to start the app. |
| `HOST_PORT`          | `3000`              | Compose only: the loopback port published on the host.         |

There are no secrets.

## Local development

```sh
npm run dev        # tsx watch with auto-reload; logs pretty-printed through pino-pretty
```

Then open:

- Swagger UI: <http://127.0.0.1:3000/docs>
- OpenAPI document: <http://127.0.0.1:3000/openapi.json>
- Health: <http://127.0.0.1:3000/health>

## Scripts

| Script                  | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `npm run dev`           | Development server with auto-reload        |
| `npm run build`         | Compile `src/` to `dist/`                  |
| `npm start`             | Run the compiled server                    |
| `npm run typecheck`     | Type-check sources and tests (no emit)     |
| `npm run lint`          | ESLint                                     |
| `npm run format`        | Prettier (write); `format:check` to verify |
| `npm test`              | Run all tests once                         |
| `npm run test:watch`    | Run tests in watch mode                    |
| `npm run test:coverage` | Run tests with V8 coverage (`coverage/`)   |

## Testing

```sh
npm test
```

Tests build the app with `createApp(...)` using injected dependencies: a logger
that writes to an in-memory stream, plus test-only API version routers. Supertest
then sends requests to the app in memory, so no port is opened. Configuration
tests call `loadConfig(env)` with explicit objects and never read `process.env`.

Current coverage:

- App construction
- `/health`
- OpenAPI 3.1 validity, checked with `@seriousme/openapi-schema-validator`
- Swagger UI loading
- 404s, including requests under the empty version prefixes
- Error handling for sync and async 500s (no internal detail leaked), Zod 400s and `HttpError` statuses
- Request logging
- Rejection of invalid configuration

## Docker

```sh
docker compose up -d --build
curl http://127.0.0.1:3000/health
docker compose logs -f api
docker compose down
```

The image:

- Uses a multi-stage build on `node:26.13.0-slim` and installs from the lockfile with `npm ci`.
- Contains only production dependencies.
- Runs as the non-root `node` user.
- Has a `HEALTHCHECK` that calls `/health` using Node's built-in `fetch`.
- Starts with `node` directly so the app's SIGTERM handler runs.

Compose:

- Mounts `db/*.db` **read-only**.
- Runs the container with a read-only root filesystem, all capabilities dropped and `no-new-privileges`.
- Uses `init: true` for signal forwarding.
- Sets `restart: unless-stopped`.
- Publishes the port **only on `127.0.0.1`**.

The Compose setup is meant for a Docker-enabled Proxmox LXC. A `cloudflared`
connector running on the same host reaches the API at `http://127.0.0.1:${HOST_PORT}`,
and nothing is exposed on a public interface. If `cloudflared` runs in a container
instead, attach it to this project's Compose network and target `http://api:3000`.
Tunnel configuration itself comes in a later phase. Cloudflare isn't needed to run
the app.

## Project structure

```
src/
  server.ts            Process entry point: config → logger → app → listen; graceful shutdown
  app.ts               createApp(deps): Express factory (no listen, no process.env)
  config.ts            Zod env schema; loadConfig(env); project-root path resolution
  logger.ts            pino logger factory
  versions.ts          ApiVersion contract and composition root for /api/v1, /api/v2
  http/
    errors.ts          ErrorResponse schema, HttpError, 404 + central error handlers
    health.ts          GET /health and its OpenAPI registration
    request-logger.ts  pino-http: request ids, per-request logging
  docs/
    openapi.ts         OpenAPI 3.1 document builder and /docs, /openapi.json router
test/                  Vitest + Supertest suites and helpers
db/                    Supplied SQLite databases (read-only, never modified)
kaggle/                Kaggle source CSVs for the future V2 rebuild (git- and docker-ignored)
```

## API versions (planned behaviour)

- **`/api/v1`** will serve the **original supplied databases, unchanged**, and
  keep their known limitations. One example: `movies.movieId` holds TMDB ids,
  while `ratings.movieId` holds MovieLens ids, so the two columns aren't directly
  comparable even though they share a name.
- **`/api/v2`** will serve a dataset **rebuilt from the Kaggle source files**,
  with corrected identifier mappings and data transformations.

Both versions share the HTTP layer: request validation, public response schemas,
pagination, error handling, documentation conventions, and business logic where
behaviour is the same. Only data access differs. Each version is an `ApiVersion`
(`{ id, router, registerDocs? }`) built in `createApiVersions()` and passed to
`createApp`. Adding version-specific data access later only changes that
composition root, not the shared infrastructure.

**OpenAPI conventions:**

- Schemas are named with Zod's `.meta({ id })` and become components when an operation references them.
- Every error uses the `ErrorResponse` schema.
- Operations are tagged `<Resource> (<version>)`, for example `Movies (v1)`. Version-independent endpoints use `Operations`.
- The document uses the relative server URL `/`, so it works behind a reverse proxy or tunnel.

## Architectural decisions

- **`node:sqlite` rather than `better-sqlite3`.** Both are synchronous in-process
  drivers, which suits a read-heavy, single-process API: SQLite reads are
  microseconds and need no connection pool. The built-in module needs no native
  compile or prebuilt-binary download, so the Docker build stays simple and
  reproducible. It opens the supplied database read-only on Node 26 with no
  experimental warning. The tradeoff is that `better-sqlite3` is more battle-tested
  and has a slightly richer API. Phase 0 doesn't open the databases yet.
- **No ORM or framework.** The data is two read-only tables, so plain SQL in
  version-specific repositories (from Phase 1) is simpler and easier to read.
- **Dependency injection through factory parameters, not a container.** `createApp`
  receives its logger and API versions explicitly. `server.ts` is the only module
  that reads `process.env` or opens a port.
- **The app always logs JSON.** In development the output is piped through
  `pino-pretty`, so the code has no development-only logging branches.
- **500s are always generic.** The full error, including its stack, goes to the
  log with a request id. The response contains only that id, so no development
  mode can leak internals.
- **`/health` is a liveness check only.** It doesn't touch the databases, so it
  stays cheap, reveals nothing about the setup, and works before the V2 data exists.
- **TypeScript is pinned to 6.0.x** because typescript-eslint doesn't support
  TypeScript 7 yet.

## Known limitations

- There are no movie endpoints. `/api/v1/*` and `/api/v2/*` return 404.
- The databases aren't opened yet, so configured paths are validated for shape
  but not checked for existence. Phase 1 will open V1 read-only and fail fast at
  startup if a file is missing.
- The supplied data has known quality issues, including the TMDB/MovieLens id
  mismatch. Later phases will handle or document them.
- The Docker base image is pinned by tag, not digest.
- Swagger UI loads its assets from the app, so it doesn't depend on a CDN. The
  `/docs` → `/docs/` redirect assumes the app is served at the host root.

## Remaining work

1. **Phase 1:** paginated movie listing against the V1 database.
2. Movie details, including the average rating from the ratings database.
3. Movies by year (with sort direction) and movies by genre.
4. Build the V2 dataset from `kaggle/` and implement V2 data access.
5. Deploy through a Cloudflare Tunnel.

## Source data

`kaggle/` (~920 MB, from the Kaggle "The Movies Dataset") is excluded from git
and from the Docker build context. Place the CSVs there before running the
future V2 import.
