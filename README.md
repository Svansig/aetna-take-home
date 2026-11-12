# Movie Services API

A read-only TypeScript/Express API over a movie metadata dataset and a user ratings
dataset. The original brief and user stories are in [ASSIGNMENT.md](ASSIGNMENT.md).

> **Status: Phase 2.** User Story 1 (**List All Movies**, `GET /api/v1/movies`)
> and User Story 2 (**Movie Details**, `GET /api/v1/movies/{movieId}`) are
> implemented. Movies By Year and Movies By Genre are **not implemented yet**, and
> V2 isn't operational.
>
> ⚠️ **V1 average ratings may belong to a different movie.** The supplied movies
> and ratings databases use different movie id systems (TMDB vs MovieLens), and V1
> deliberately matches them by the raw number. See
> [V1 ratings: the identifier mismatch](#v1-ratings-the-identifier-mismatch).

## Implemented vs. planned

| Area                                                  | Status                                       |
| ----------------------------------------------------- | -------------------------------------------- |
| App factory, server bootstrap, graceful shutdown      | ✅ Implemented                               |
| Zod-validated environment configuration               | ✅ Implemented                               |
| Structured logging (pino), per-request ids            | ✅ Implemented                               |
| Centralised error handling (400 / 404 / 500 envelope) | ✅ Implemented                               |
| `GET /health`                                         | ✅ Implemented                               |
| OpenAPI 3.1 at `/openapi.json`, Swagger UI at `/docs` | ✅ Implemented                               |
| Docker image and Compose deployment                   | ✅ Implemented                               |
| **US1 List All Movies:** `GET /api/v1/movies`         | ✅ Implemented (V1 only)                     |
| **US2 Movie Details:** `GET /api/v1/movies/{movieId}` | ✅ Implemented (V1 only, naive ratings join) |
| Correct movie ↔ rating id mapping                     | ⏳ Planned for V2                            |
| US3 Movies By Year                                    | ⏳ Planned                                   |
| US4 Movies By Genre                                   | ⏳ Planned                                   |
| `/api/v2` (rebuilt dataset)                           | ⏳ Mounted, with no operations (returns 404) |
| V2 dataset rebuilt from Kaggle sources                | ⏳ Planned                                   |
| Cloudflare Tunnel deployment                          | ⏳ Planned                                   |

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
- Movies: <http://127.0.0.1:3000/api/v1/movies?page=2>
- Movie details: <http://127.0.0.1:3000/api/v1/movies/11>

## Endpoints

### `GET /api/v1/movies`: list all movies (User Story 1)

Lists every movie in the original supplied `db/movies.db`, 50 per page.

| Query parameter | Required | Default | Rules                                                                          |
| --------------- | -------- | ------- | ------------------------------------------------------------------------------ |
| `page`          | no       | `1`     | 1-indexed, plain base-10 digits, from 1 to 2^53−1 (`Number.MAX_SAFE_INTEGER`). |

**Pagination**

- The page size is fixed at 50 and can't be changed by clients.
- Results are ordered by the internal `movieId` (TMDB id), ascending. The order
  is deterministic, which offset pagination needs, but has no meaning to clients.
- A page past the end returns `200` with `data: []`. The requested `page` is kept
  and `totalItems` and `totalPages` stay accurate. An empty collection has
  `totalPages: 0`.
- `400 VALIDATION_ERROR` covers:
  - `page=0`, `-1`, `1.5`, `abc`, an empty value, `1e2`, or anything with spaces or a sign
  - values above 2^53−1
  - a repeated `page` (`?page=2&page=3`)
- Unknown query parameters are ignored.

**Response**

```json
{
  "data": [
    {
      "imdbId": "tt0113101",
      "title": "Four Rooms",
      "genres": [
        { "id": 80, "name": "Crime" },
        { "id": 35, "name": "Comedy" }
      ],
      "releaseDate": "1995-12-09",
      "budget": 4000000
    }
  ],
  "pagination": { "page": 1, "pageSize": 50, "totalItems": 45430, "totalPages": 909 }
}
```

(This is a real record from the supplied database. A real page has 50 entries.)

| Field         | Type                             | Notes                                                                                            |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `imdbId`      | string                           | As stored. 17 source records have an empty string (see limitations).                             |
| `title`       | string                           |                                                                                                  |
| `genres`      | `{ id: number, name: string }[]` | Parsed from the stored JSON. May be empty (2,442 movies).                                        |
| `releaseDate` | string \| null                   | `YYYY-MM-DD` exactly as stored, never converted to a timestamp. `null` when missing (84 movies). |
| `budget`      | integer                          | Whole **US dollars**, as stored, with no scaling or formatting. `0` stays `0`.                   |

Each movie has exactly these five fields, and `pagination` has exactly the four
shown. Both are enforced by strict Zod schemas, which also generate the OpenAPI
components `MovieSummary`, `Genre`, `PaginationMeta` and `MovieListResponse`.

**Try it**

```sh
curl 'http://127.0.0.1:3000/api/v1/movies'
curl 'http://127.0.0.1:3000/api/v1/movies?page=909'   # final page: 30 movies
curl 'http://127.0.0.1:3000/api/v1/movies?page=0'     # 400
```

In Swagger UI (`/docs`), open **Movies (v1) → GET /api/v1/movies**, choose
**Try it out**, enter a `page` and click **Execute**. Swagger validates
`page ≥ 1` in the browser, so use curl to see the server's 400 response.

### `GET /api/v1/movies/{movieId}`: movie details (User Story 2)

Returns one movie from `db/movies.db`, with its average rating from `db/ratings.db`.

**`movieId`** is the numeric `movieId` from the movies database (a TMDB id), not an
IMDb id. It follows the same rules as `page`: a positive base-10 integer of plain
digits, at most 2^53−1, with leading zeros allowed (`011` means 11).

| Status | When                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| `200`  | The movie exists, whether or not it has ratings.                                                           |
| `400`  | `VALIDATION_ERROR`: `movieId` is `0`, negative, decimal, exponential, alphabetic, an IMDb id or too large. |
| `404`  | `MOVIE_NOT_FOUND`: the id is valid but no movie has it (for example, `1`).                                 |
| `500`  | `INTERNAL_ERROR`: an unexpected error, such as malformed stored genres. Details are only logged.           |

**Response:** exactly these ten fields, not wrapped in the pagination envelope.

| Field                 | Type             | Source                       | Notes                                                                                                                  |
| --------------------- | ---------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `imdbId`              | string           | `movies.imdbId`              | Same as the listing. `""` for 17 source records.                                                                       |
| `title`               | string           | `movies.title`               |                                                                                                                        |
| `description`         | string \| null   | `movies.overview`            | Verbatim. `null` when the source is empty (959 movies).                                                                |
| `releaseDate`         | string \| null   | `movies.releaseDate`         | Same as the listing: `YYYY-MM-DD` or `null`.                                                                           |
| `budget`              | integer          | `movies.budget`              | Whole US dollars, as stored. `0` stays `0` and often means "not recorded".                                             |
| `runtime`             | number \| null   | `movies.runtime`             | Minutes, as stored (not rounded). `null` for the 257 movies stored with an empty value.                                |
| `averageRating`       | number \| null   | `ratings.db`                 | Mean on a 0.5–5.0 scale, rounded to 2 decimals. `null` (never `0`) when no ratings match. **See the V1 caveat below.** |
| `genres`              | `{ id, name }[]` | `movies.genres`              | Same parsing as the listing.                                                                                           |
| `originalLanguage`    | string \| null   | `movies.language`            | Always `null` in V1: the column is empty for all 45,430 movies.                                                        |
| `productionCompanies` | `{ id, name }[]` | `movies.productionCompanies` | `[]` for the 483 movies whose stored JSON is malformed (see below).                                                    |

The five fields shared with the listing come from the same Zod schema
(`MovieDetailsSchema = MovieSummarySchema.extend(...)`), so the two contracts
can't drift.

```sh
curl 'http://127.0.0.1:3000/api/v1/movies/11'    # Star Wars, naive averageRating 3.69
curl 'http://127.0.0.1:3000/api/v1/movies/398'   # Capote: averageRating null, productionCompanies []
curl 'http://127.0.0.1:3000/api/v1/movies/1'     # 404
curl 'http://127.0.0.1:3000/api/v1/movies/abc'   # 400
```

In Swagger UI, open **Movies (v1) → GET /api/v1/movies/{movieId}**, choose
**Try it out**, enter a `movieId` (for example `11`) and click **Execute**.

**Malformed production companies.** 483 movies store production-company text
that isn't valid JSON, mostly because of unescaped quotes in company names (for
example, `"Cooper"s Town Productions"` for Capote). V1 returns `[]` for these and
the request still succeeds. Nothing is repaired or guessed. Recovering these
names is follow-on work. Company JSON that parses but has an unexpected shape is
still treated as a data-integrity error (500), as genres are. No current record
does this.

#### V1 ratings: the identifier mismatch

The two supplied databases use **different movie identifier systems**:
`movies.movieId` is a **TMDB** id and `ratings.movieId` is a **MovieLens** id.
Checked against the original Kaggle files, `ratings.db` matches `ratings_small.csv`,
and the TMDB↔MovieLens mapping lives in `links_small.csv`, which isn't part of
the supplied data.

**V1 deliberately uses the naive association `movies.movieId = ratings.movieId`**
(`NaiveSqliteRatingSource`). This is a baseline built from only the supplied
databases. Many V1 averages therefore come from an unrelated movie, and movies
can get a rating, or `null`, by numeric coincidence. For example:

| Movie            | movies.db id | V1 (naive) uses | V1 `averageRating`    | Correct MovieLens id | Correct average    |
| ---------------- | ------------ | --------------- | --------------------- | -------------------- | ------------------ |
| Star Wars (1977) | 11           | MovieLens 11    | **3.69** (82 ratings) | 260                  | 4.22 (291 ratings) |

**Do not treat V1 `averageRating` values as correct.** The warning is in this
README and in the OpenAPI description, not in each JSON response, so the
response contract stays unchanged. **V2 (planned, not implemented)** will rebuild
the data from the Kaggle sources with the correct id mapping and plug in its own
`RatingSource`, with no change to the HTTP layer.

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
that writes to an in-memory stream, plus API versions wired to a chosen database.
Supertest then sends requests to the app in memory, so no port is opened.
Configuration tests call `loadConfig(env)` with explicit objects and never read
`process.env`.

The movie tests use three kinds of data:

- **The supplied `db/movies.db` and `db/ratings.db`, opened read-only.**
  - End-to-end requests run through Express, validation, the service, the
    repository and SQLite. Results are checked against independent SQL queries
    for ordering, page contents, totals and naive rating averages.
  - Every one of the 45,430 movies is mapped for both the listing and the
    details, and the documented null and `[]` counts are checked.
  - The Star Wars (3.69) and Capote examples are checked verbatim.
  - A test confirms the SHA-256 hashes of both databases don't change during
    the detail requests.
- **In-memory SQLite fixtures** for edge cases and exact arithmetic:
  - malformed genre and company JSON, empty or non-numeric runtimes, impossible
    dates, NULL budgets
  - rating averages and rounding, movies with no ratings
  - an empty table and closed connections
- **Injected fakes** for service rules: never computing an offset for a page
  past the end, 404 for unknown ids, and half-up rounding (1.005 → 1.01).

Infrastructure coverage:

- App construction and version mounting
- `/health`
- OpenAPI 3.1 validity, checked with `@seriousme/openapi-schema-validator`
- Swagger UI loading
- 404s
- Error handling for 400 / 404 / 500 (no internal detail leaked)
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
  db/
    sqlite.ts          Read-only connection helper; DataIntegrityError
  http/
    errors.ts          ErrorResponse schema, HttpError, 404 + central error handlers
    health.ts          GET /health and its OpenAPI registration
    pagination.ts      PAGE_SIZE, page query schema, pagination metadata, page → LIMIT/OFFSET
    params.ts          Shared positive-integer parameter validation (page, movieId)
    request-logger.ts  pino-http: request ids, per-request logging
  movies/
    schemas.ts         Genre, MovieSummary, MovieListResponse, ProductionCompany, MovieDetails, movieId param
    repository.ts      MovieRepository and RatingSource interfaces (implemented per version)
    sqlite-movie-repository.ts  V1 movies: prepared SQL, row validation, JSON parsing, fallbacks
    naive-sqlite-rating-source.ts  V1 ratings: naive numeric-id aggregate over ratings.db
    service.ts         MovieService: pagination, details, 404, rating rounding (no Express)
    routes.ts          Shared router factory and OpenAPI registration for /movies, /movies/{movieId}
  docs/
    openapi.ts         OpenAPI 3.1 document builder and /docs, /openapi.json router
test/                  Vitest + Supertest suites and helpers
db/                    Supplied SQLite databases (read-only, never modified)
kaggle/                Kaggle source CSVs for the future V2 rebuild (git- and docker-ignored)
```

## API versions

- **`/api/v1`** serves the **original supplied databases, unchanged**, and keeps
  their known limitations. Today that means `GET /api/v1/movies` and
  `GET /api/v1/movies/{movieId}`. Most importantly, `movies.movieId` holds TMDB
  ids while `ratings.movieId` holds MovieLens ids, and V1 deliberately matches
  them by the raw number, so its average ratings are unreliable.
- **`/api/v2`** (planned, not operational) will serve a dataset **rebuilt from
  the Kaggle source files**, with corrected identifier mappings and data
  transformations. It's mounted but has no operations, so it returns 404.

Both versions share the HTTP layer: request validation, public response schemas,
pagination, error handling, documentation conventions, and business logic where
behaviour is the same. Only data access differs. Each version is an `ApiVersion`
(`{ id, router, registerDocs? }`) built in `createApiVersions()` and passed to
`createApp`. The movie router, schemas and `MovieService` are shared. V1 injects
`SqliteMovieRepository` over `movies.db` and `NaiveSqliteRatingSource` over
`ratings.db`. V2 will provide its own `MovieRepository` and a correctly mapped
`RatingSource` in the same composition root, without changing the shared HTTP code.

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
  and has a slightly richer API.
- **One read-only connection per database for the process.** `server.ts` opens
  `movies.db` and `ratings.db` at startup with `readOnly: true` and passes both
  into the composition root. If either can't be opened, it logs which one and
  exits. It closes both after in-flight requests finish at shutdown. Each
  repository prepares its statements once. A synchronous driver in a
  single-threaded process needs no pool.
- **Separate connections rather than `ATTACH`.** Each database stays
  independently injectable, so tests can pair real movies with fixture ratings.
  It also keeps the naive cross-database association out of SQL joins.
- **`RatingSource`, separate from `MovieRepository`.** Ratings live in a
  different database, and the movie↔rating association is exactly what changes
  between V1 (naive) and V2 (planned corrected mapping). The service combines the
  two, so neither the route nor the shared business logic needs to know which is
  used.
- **Rating aggregation in SQL, rounding in the service.** The source returns
  `COUNT` and `TOTAL(rating)` for one id. The service computes the mean and rounds
  it half-up to 2 decimals as `round(sum × 100 / count) / 100`, which avoids
  floating-point errors at exact halves (1.005 → 1.01). `ratings.movieId` has no
  index and the schema must not change, so each lookup scans 100,004 rows (about
  2 ms). That's acceptable here, so there's no caching.
- **Pagination happens in SQLite.** The query is `ORDER BY movieId LIMIT ? OFFSET ?`
  with bound parameters. `movieId` is the table's `INTEGER PRIMARY KEY` (its
  rowid), so ordering needs no extra index and nothing was added to the schema.
  The count is a separate query. The service skips the data query for pages past
  the end, so no unsafe offset is ever computed, and the repository refuses
  unsafe windows as a second guard.
- **Stored data is validated, never repaired.** Each row is checked with Zod and
  its genre JSON is parsed in the repository. Anything unexpected raises a
  `DataIntegrityError`, which the central handler logs (with the row id and failing
  fields, not the record contents) and answers with a generic 500. Today all
  45,430 rows pass. The one agreed exception is unparseable production-company
  JSON, which becomes `[]`.
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

- User Stories 1 and 2 are implemented. Movies By Year and Movies By Genre don't
  exist yet, and nothing under `/api/v2` is implemented.
- **V1 average ratings are joined by a mismatched id** (TMDB vs MovieLens) and
  may describe another movie. See
  [V1 ratings: the identifier mismatch](#v1-ratings-the-identifier-mismatch).
- V1 returns the supplied data as-is, including these issues:
  - **17 movies have an empty `imdbId` (`""`).** It's returned unchanged, so
    treat `""` as "unknown".
  - **36,550 movies (about 80%) have `budget: 0`.** V1 can't tell "unknown"
    apart from a real zero, so it returns `0` as stored.
  - **84 movies have no release date.** It's returned as `null`.
  - **All 45,430 movies have no language.** `originalLanguage` is always `null`.
    V2 is planned to restore it from the upstream data.
  - **483 movies have malformed production-company JSON.** These return `[]`.
  - **257 movies store runtime as an empty value.** These return `null`.
    Another 1,558 have runtime `0`, returned as stored.
  - **959 movies have an empty overview.** `description` is `null` for these.
- Offset pagination isn't snapshot-consistent in general. That's harmless here
  because V1 data is read-only.
- Rating lookups scan the unindexed `ratings` table (about 2 ms each), because
  the supplied schema must not change.
- `V2_DB_PATH` is validated for shape only, not opened or checked for existence.
- The Docker base image is pinned by tag, not digest.
- Swagger UI loads its assets from the app, so it doesn't depend on a CDN. The
  `/docs` → `/docs/` redirect assumes the app is served at the host root.

## Remaining work

1. Movies by year (with sort direction) and movies by genre.
2. Build the V2 dataset from `kaggle/` and implement V2 data access. This
   includes the correct TMDB↔MovieLens rating mapping (via `links_small.csv`),
   original language and recovered production companies.
3. Deploy through a Cloudflare Tunnel.

## Source data

`kaggle/` (~920 MB, from the Kaggle "The Movies Dataset") is excluded from git
and from the Docker build context. Place the CSVs there before running the
future V2 import.
