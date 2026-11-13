# Movie Services API

## 1. Project overview

A read-only TypeScript/Express API over the two supplied SQLite databases,
`db/movies.db` and `db/ratings.db`, which are used unmodified. The original brief
is in [ASSIGNMENT.md](ASSIGNMENT.md). Every interpretation of it is recorded
in [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md), and every other engineering
decision (technology, architecture, security posture, release) in
[docs/DECISIONS.md](docs/DECISIONS.md).

All four user stories are implemented under `/api/v1`:

| User story              | Endpoint                                                            |
| ----------------------- | ------------------------------------------------------------------- |
| **US1 List All Movies** | `GET /api/v1/movies`                                                |
| **US2 Movie Details**   | `GET /api/v1/movies/{movieId}`                                      |
| **US3 Movies By Year**  | `GET /api/v1/movies/year/{year}` (or `GET /api/v1/movies?year=`)    |
| **US4 Movies By Genre** | `GET /api/v1/movies/genre/{genre}` (or `GET /api/v1/movies?genre=`) |

`GET /api/v1/movies` also accepts `year` and `genre` together (AND), and every
listing accepts `sortOrder`.

> ⚠️ **Average ratings may belong to a different movie.** The two databases use
> different movie id systems. See [Known data limitations](#11-known-data-limitations).

## 2. Technology stack

- **Node.js 26**, **TypeScript 6.0** (strict), ESM
- **Express 5**, **Zod 4** (config, request and response schemas)
- **@asteasolutions/zod-to-openapi** (OpenAPI 3.1 from the Zod schemas) and **swagger-ui-express**
- **SQLite** through Node's built-in `node:sqlite`, opened read-only
- **pino / pino-http** structured JSON logging
- **Vitest + Supertest**, **ESLint** (typescript-eslint strict) and **Prettier**
- **Docker** (multi-stage) and **Docker Compose**

## 3. Getting started

Requires Node.js ≥ 26 (`.nvmrc`) and npm. The databases are already in `db/`.

```sh
npm ci
npm run dev        # tsx watch, logs pretty-printed through pino-pretty
```

npm may report blocked install scripts for `esbuild` and `@scarf/scarf`; neither
is needed. Then open <http://127.0.0.1:3000/> for the landing page, or
<http://127.0.0.1:3000/docs> for Swagger UI.

| Script                  | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `npm run dev`           | Development server with auto-reload        |
| `npm run build`         | Compile `src/` to `dist/`                  |
| `npm start`             | Run the compiled server                    |
| `npm run typecheck`     | Type-check sources and tests               |
| `npm run lint`          | ESLint                                     |
| `npm run format:check`  | Prettier check (`npm run format` to write) |
| `npm test`              | Run all tests once                         |
| `npm run test:coverage` | Tests with V8 coverage (`coverage/`)       |

## 4. Configuration

Settings come from environment variables, validated with Zod at startup. An
invalid value stops the process with a message naming the variable (never its
value). Every variable has a working default, so no `.env` file is needed;
`npm run dev` and `npm start` load one if present (`cp .env.example .env`).

| Variable          | Default         | Notes                                                         |
| ----------------- | --------------- | ------------------------------------------------------------- |
| `NODE_ENV`        | `development`   | `development` \| `test` \| `production`                       |
| `HOST`            | `127.0.0.1`     | Bind address. The Docker image sets `0.0.0.0`.                |
| `PORT`            | `3000`          |                                                               |
| `LOG_LEVEL`       | `info`          | `fatal` `error` `warn` `info` `debug` `trace` `silent`        |
| `MOVIES_DB_PATH`  | `db/movies.db`  | Relative paths resolve against the project root, not the CWD. |
| `RATINGS_DB_PATH` | `db/ratings.db` |                                                               |
| `HOST_PORT`       | `3000`          | Docker Compose only: the loopback port published on the host. |

There are no secrets.

## 5. Available endpoints

| Method and path                    | Purpose                                     |
| ---------------------------------- | ------------------------------------------- |
| `GET /api/v1/movies`               | Every movie, optionally filtered and sorted |
| `GET /api/v1/movies/{movieId}`     | One movie's details with its average rating |
| `GET /api/v1/movies/year/{year}`   | Movies released in a year, chronologically  |
| `GET /api/v1/movies/genre/{genre}` | Movies in a genre                           |
| `GET /`                            | Landing page (static, from `public/`)       |
| `GET /health`                      | Liveness (does not touch the databases)     |
| `GET /docs`, `GET /openapi.json`   | Swagger UI and the OpenAPI 3.1 document     |

**Listing item** (`MovieSummary`): `movieId` (the TMDB id used by the details
path), `imdbId`, `title`, `genres` (`{ id, name }[]`), `releaseDate`
(`YYYY-MM-DD` or `null`) and `budget` (whole US dollars as a string, `"$4,000,000"`).

```json
{
  "data": [
    {
      "movieId": 5,
      "imdbId": "tt0113101",
      "title": "Four Rooms",
      "genres": [
        { "id": 80, "name": "Crime" },
        { "id": 35, "name": "Comedy" }
      ],
      "releaseDate": "1995-12-09",
      "budget": "$4,000,000"
    }
  ],
  "pagination": { "page": 1, "pageSize": 50, "totalItems": 45430, "totalPages": 909 }
}
```

**Movie details** (`MovieDetails`, not wrapped): the listing fields plus
`description`, `runtime` (minutes or `null`), `averageRating` (mean on a 0.5–5.0
scale rounded half-up to 2 decimals, `null` with no ratings), `originalLanguage`
and `productionCompanies` (`{ id, name }[]`).

| Status | Code               | When                                                                      |
| ------ | ------------------ | ------------------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR` | An invalid or repeated parameter; all are validated before any lookup.    |
| `4xx`  | `BAD_REQUEST`      | A request Express itself rejects, such as a malformed `%` escape.         |
| `404`  | `MOVIE_NOT_FOUND`  | A valid `movieId` that no movie has.                                      |
| `404`  | `GENRE_NOT_FOUND`  | A valid genre that no movie has.                                          |
| `404`  | `NOT_FOUND`        | Any unregistered route.                                                   |
| `500`  | `INTERNAL_ERROR`   | Unexpected error; details are logged with the request id, never returned. |

Every error uses one envelope: `{ "error": { code, message, details?, requestId } }`.

```sh
curl 'http://127.0.0.1:3000/api/v1/movies?page=2'
curl 'http://127.0.0.1:3000/api/v1/movies/11'                          # Star Wars
curl 'http://127.0.0.1:3000/api/v1/movies/year/1999?sortOrder=desc'
curl 'http://127.0.0.1:3000/api/v1/movies/genre/science%20fiction'
curl 'http://127.0.0.1:3000/api/v1/movies?year=1999&genre=Action'      # 100 movies
```

## 6. Pagination and filtering

**Pagination** (every listing)

- 50 items per page, fixed. `page` is 1-indexed, defaults to `1`, and must be
  plain base-10 digits from 1 to 2^53−1; anything else is a `400`.
- `pagination` holds numeric `page`, `pageSize`, `totalItems` and `totalPages`,
  counting only the matching movies.
- A page past the end, or a filter with no matches, returns `200` with
  `data: []` and accurate metadata (`totalPages: 0` when nothing matches).
- Unknown query parameters are ignored. A repeated `page`, `year`, `genre` or
  `sortOrder` is a `400`.

**Filters**

- `year`: exactly four digits, `0001`–`9999`. Matches `releaseDate` between
  `YYYY-01-01` and `YYYY-12-31`. A valid year with no movies is an empty `200`.
- `genre`: all digits is a genre id (`28`); anything else is a name matched
  exactly but ASCII case-insensitively (`Action`, `action`; not `Act`). A genre
  no movie has is a `404 GENRE_NOT_FOUND`; an empty value is a `400`.
- `GET /api/v1/movies?year=1999&genre=Action` combines both with AND.
  `?year=Y` and `?genre=G` alone return exactly what `/movies/year/Y` and
  `/movies/genre/G` return. The dedicated routes accept only `page` and `sortOrder`.

**Sorting** (`sortOrder=asc`, the default, or `desc`; case-sensitive)

| Listing                                 | `asc`                             | `desc`                            |
| --------------------------------------- | --------------------------------- | --------------------------------- |
| No filter, or `genre` only              | `movieId` ascending               | `movieId` descending              |
| Any `year` (path, query, or with genre) | `releaseDate` ↑, then `movieId` ↑ | `releaseDate` ↓, then `movieId` ↓ |

The `movieId` tie-break makes every order total, so pages never overlap or skip.

## 7. API documentation

- **Swagger UI:** <http://127.0.0.1:3000/docs>. Every operation is under the
  **Movies** tag (`/health` is under **Operations**), with real response examples (checked against the database by
  tests). Use **Try it out** to call the running server; the filter fields start
  empty, so leaving them blank lists every movie.
- **OpenAPI 3.1:** <http://127.0.0.1:3000/openapi.json>, generated from the same
  Zod schemas that validate requests and responses. It uses the relative server
  URL `/`, so it works behind a reverse proxy, and it repeats the rating warning
  from [Known data limitations](#11-known-data-limitations).

## 8. Testing

```sh
npm test                 # all tests
npm run test:coverage    # with V8 coverage
```

- Tests build the app with `createApp({ logger, apiRouter })` and drive it with
  Supertest, so no port is opened. Config tests pass explicit env objects.
- **Supplied databases, opened read-only:** every movie is mapped through the
  listing and details schemas, and pages, totals, ordering, year and genre
  results and naive rating averages are compared with independent SQL or
  JavaScript oracles. A test checks that the database SHA-256 hashes don't change.
- **In-memory SQLite fixtures** cover edge cases the real data lacks: malformed
  JSON, empty values, year boundaries, same-date ties across pages, rating rounding.
- **Infrastructure:** health, 404s and the error envelope, request logging,
  config validation, OpenAPI 3.1 validity (`@seriousme/openapi-schema-validator`),
  Swagger UI, and a process-level test that starts `src/server.ts` against both
  databases and checks that SIGTERM closes both connections.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs format check,
lint, typecheck, tests and build on every pull request and push to `main`.

## 9. Docker deployment

```sh
docker compose up -d --build
curl http://127.0.0.1:3000/health
docker compose logs -f api
docker compose down
```

- The image is a multi-stage build on `node:26.13.0-slim` with production
  dependencies only, plus the compiled `dist/` and the static landing page in
  `public/`. It runs as the non-root `node` user, has a `/health`
  `HEALTHCHECK`, and starts `node` directly so SIGTERM triggers graceful shutdown.
- Databases are not baked in. Compose mounts `db/movies.db` and `db/ratings.db`
  **read-only**, runs with a read-only root filesystem, all capabilities dropped,
  `no-new-privileges`, `init: true` and `restart: unless-stopped`, and publishes
  the port **only on `127.0.0.1`**.

**Production.** After CI passes on `main`,
[`.github/workflows/publish.yml`](.github/workflows/publish.yml) builds, checks and
smoke-tests the image, then publishes it to `ghcr.io/svansig/aetna-take-home`.
A pull-based updater on the host deploys it by digest behind a Cloudflare Tunnel,
with automatic rollback. The runbook is [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md),
and the host files are in [`deploy/`](deploy/).

## 10. Architecture

```
src/
  server.ts       Entry point: config → logger → open DBs read-only → listen; graceful shutdown
  app.ts          createApp({ logger, apiRouter }) mounts the API at /api/v1;
                  createMoviesApi({ moviesDb, ratingsDb }) is the composition root
  config.ts       Zod env schema and loadConfig(env)
  docs/openapi.ts OpenAPI document builder; /docs and /openapi.json
  http/           Error envelope and handlers, /health, pagination, parameter parsing, request logging
  db/sqlite.ts    Read-only connection helper; DataIntegrityError
  movies/
    routes.ts                      Express routes (validate, call the service) and OpenAPI registration
    schemas.ts                     Zod request/response schemas
    service.ts                     MovieService: filtering, sorting, pagination, ratings, budget formatting
    repository.ts                  MovieRepository and RatingSource interfaces
    sqlite-movie-repository.ts     MovieRepository over movies.db
    naive-sqlite-rating-source.ts  RatingSource over ratings.db
```

- **Layers.** Routes only validate parameters and call `MovieService`. The
  service coordinates a `MovieRepository` (movies) and a `RatingSource`
  (ratings), and builds responses. SQL lives only in the two SQLite
  implementations. Each layer is tested on its own and end to end.
- **`RatingSource` separate from `MovieRepository`.** Ratings live in a different
  database with a different id system, so they get their own small interface and
  their own connection (no `ATTACH`). Tests can pair real movies with fixture ratings.
- **Dependency injection by factory parameters.** `createApp` receives its logger
  and API router; `server.ts` is the only module that reads `process.env`, opens
  databases or listens.
- **`node:sqlite`, one read-only connection per database.** It is synchronous and
  in-process, which suits a read-only single-process API, and needs no native
  build. Statements are prepared once.
- **One listing query behind every listing URL.** `/movies`, `/movies/year/{y}`
  and `/movies/genre/{g}` all call `MovieService.listMovies`. The count and the
  page share one `WHERE` clause whose conditions are switched off by binding
  NULL; `ORDER BY` comes only from a fixed map. Pagination is `LIMIT/OFFSET` in
  SQLite, and pages past the end skip the data query.
- **Stored data is validated, never repaired.** Rows are checked with Zod; any
  mismatch is a `DataIntegrityError`, logged with the row id and answered with a
  generic 500. The one agreed exception is malformed production-company JSON.
- **No indexes, no caching.** The databases are not modified. Genre filters scan
  the table (up to ~90 ms) and a rating lookup scans `ratings` (~2 ms), which
  was measured and judged acceptable.

## 11. Known data limitations

These were found by investigating the supplied datasets. The API returns the data
as-is and documents the issues rather than correcting them. Correcting them would
need additional data preparation or an authoritative identifier mapping, which
is outside the supplied data.

- **Rating identifier mismatch.** `movies.movieId` is a TMDB id, while
  `ratings.movieId` is a MovieLens id. The supplied data has no mapping between
  them, and `NaiveSqliteRatingSource` deliberately matches them by the raw
  number. Many averages therefore come from an unrelated film. For example, Star
  Wars (`movieId` 11) reports **3.69**, the average for MovieLens movie 11, while
  Star Wars' MovieLens id is 260 (average 4.22). **Do not treat `averageRating` as
  correct.** The warning is in this README and in the OpenAPI document, not in
  responses, so the response contract is unchanged.
- **Production companies.** 483 movies store malformed JSON (mostly unescaped
  quotes in company names). They return `productionCompanies: []` and the
  request still succeeds.
- **Original language.** `movies.language` is empty for every movie, so
  `originalLanguage` is always `null`.
- **Budget.** 36,550 movies (about 80%) store a budget of 0, which usually means
  "not recorded". It is returned as `"$0"`, never reinterpreted as missing.
- **Other gaps, returned as stored:** 17 empty `imdbId` values (`""`), 84 missing
  release dates (`null`), 257 empty runtimes (`null`; another 1,558 are `0`),
  and 959 empty overviews (`description: null`).
