# Movie Services API

A read-only TypeScript/Express API over a movie metadata dataset and a user ratings
dataset. The original brief and user stories are in [ASSIGNMENT.md](ASSIGNMENT.md).

> **Status: V1 complete (Phase 4).** All four user stories are implemented on
> `/api/v1` over the original supplied databases: **List All Movies**
> (`GET /api/v1/movies`), **Movie Details** (`GET /api/v1/movies/{movieId}`),
> **Movies By Year** (`GET /api/v1/movies/year/{year}`) and **Movies By Genre**
> (`GET /api/v1/movies/genre/{genre}`), plus combined `year` and `genre` filters on
> `GET /api/v1/movies`. **V2, the corrected dataset, is planned and not implemented.**
>
> ⚠️ **V1 average ratings may belong to a different movie.** The supplied movies
> and ratings databases use different movie id systems (TMDB vs MovieLens), and V1
> deliberately matches them by the raw number. See
> [V1 ratings: the identifier mismatch](#v1-ratings-the-identifier-mismatch).

## Implemented vs. planned

| Area                                                                                     | Status                                       |
| ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| App factory, server bootstrap, graceful shutdown                                         | ✅ Implemented                               |
| Zod-validated environment configuration                                                  | ✅ Implemented                               |
| Structured logging (pino), per-request ids                                               | ✅ Implemented                               |
| Centralised error handling (400 / 404 / 500 envelope)                                    | ✅ Implemented                               |
| `GET /health`                                                                            | ✅ Implemented                               |
| OpenAPI 3.1 at `/openapi.json`, Swagger UI at `/docs`                                    | ✅ Implemented                               |
| Docker image and Compose deployment                                                      | ✅ Implemented                               |
| GitHub Actions CI (format, lint, typecheck, test, build)                                 | ✅ Implemented                               |
| Production image published to GHCR after CI on `main`                                    | ✅ Implemented                               |
| **US1 List All Movies:** `GET /api/v1/movies`                                            | ✅ Implemented (V1 only)                     |
| **US2 Movie Details:** `GET /api/v1/movies/{movieId}`                                    | ✅ Implemented (V1 only, naive ratings join) |
| **US3 Movies By Year:** `GET /api/v1/movies/year/{year}`, `GET /api/v1/movies?year=`     | ✅ Implemented (V1 only)                     |
| Correct movie ↔ rating id mapping                                                        | ⏳ Planned for V2                            |
| **US4 Movies By Genre:** `GET /api/v1/movies/genre/{genre}`, `GET /api/v1/movies?genre=` | ✅ Implemented (V1 only)                     |
| Combined `year` + `genre` filtering, `sortOrder` on every listing                        | ✅ Implemented (V1 only)                     |
| `/api/v2` (rebuilt dataset)                                                              | ⏳ Mounted, with no operations (returns 404) |
| V2 dataset rebuilt from Kaggle sources                                                   | ⏳ Planned                                   |
| Cloudflare Tunnel deployment                                                             | ⏳ Planned                                   |

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
- Movies by year: <http://127.0.0.1:3000/api/v1/movies/year/1999?sortOrder=desc>
- Movies by genre: <http://127.0.0.1:3000/api/v1/movies/genre/science%20fiction>
- Combined: <http://127.0.0.1:3000/api/v1/movies?year=1999&genre=Action>

## Endpoints

### `GET /api/v1/movies`: list movies, with optional filters (User Stories 1, 3, 4)

Lists the movies in the original supplied `db/movies.db`, 50 per page. With no
filters that is every movie (User Story 1). `year` and `genre` filter it and
combine with AND.

| Query parameter | Required | Default | Rules                                                                                               |
| --------------- | -------- | ------- | --------------------------------------------------------------------------------------------------- |
| `page`          | no       | `1`     | 1-indexed, plain base-10 digits, from 1 to 2^53−1 (`Number.MAX_SAFE_INTEGER`).                      |
| `year`          | no       |         | One release year. See [movies by year](#get-apiv1moviesyearyear-movies-by-year-user-story-3).       |
| `genre`         | no       |         | A genre id or name. See [movies by genre](#get-apiv1moviesgenregenre-movies-by-genre-user-story-4). |
| `sortOrder`     | no       | `asc`   | `asc` or `desc`, case-sensitive. Applies to every listing; see [sorting](#sorting-every-listing).   |

`GET /api/v1/movies?year=Y` is identical to `GET /api/v1/movies/year/Y`, and
`GET /api/v1/movies?genre=G` to `GET /api/v1/movies/genre/G`, for the same `page`
and `sortOrder`. `?year=1999&genre=Action` lists the 100 Action movies released
in 1999; its totals count only those.

#### Sorting (every listing)

| Listing                                                | `sortOrder=asc` (default)         | `sortOrder=desc`                  |
| ------------------------------------------------------ | --------------------------------- | --------------------------------- |
| No filter, or `genre` only (incl. `/movies/genre/{g}`) | `movieId` ascending               | `movieId` descending              |
| Any `year` (incl. `/movies/year/{y}`, year + genre)    | `releaseDate` ↑, then `movieId` ↑ | `releaseDate` ↓, then `movieId` ↓ |

The `movieId` tie-break makes every order total, so pages never overlap or skip
movies. An invalid `sortOrder` (`bogus`, `ASC`, empty) is a `400` on every listing.

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
- Unknown query parameters are ignored. A repeated `page`, `year`, `genre` or
  `sortOrder` is a `400`, and all parameters are validated before any lookup, so
  an invalid value is a `400` even alongside an unknown genre.

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

### `GET /api/v1/movies/year/{year}`: movies by year (User Story 3)

Lists the movies released in one calendar year, 50 per page, in chronological
order. The same listing is available as a filter on the collection,
`GET /api/v1/movies?year={year}`. Both forms call the same service method and SQL,
so the same `year`, `page` and `sortOrder` give identical responses.

| Parameter   | In                           | Required | Default | Rules                                                                                    |
| ----------- | ---------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------- |
| `year`      | path (or query on `/movies`) | yes      |         | Exactly four decimal digits, `0001` to `9999`. Not limited to years present in the data. |
| `page`      | query                        | no       | `1`     | Same rules as the listing: 1-indexed, plain digits, leading zeros allowed.               |
| `sortOrder` | query                        | no       | `asc`   | `asc` or `desc`, case-sensitive.                                                         |

**Ordering.** `asc` sorts by `releaseDate` ascending, then `movieId` ascending for
movies released on the same day. `desc` reverses both. The `movieId` tie-break
keeps page boundaries deterministic: 67 of the 723 movies of 1999 share
`1999-01-01`, so that date spans pages 1 and 2.

**Filtering.** A movie matches when its stored `YYYY-MM-DD` date lies between
`YYYY-01-01` and `YYYY-12-31` inclusive. This is a plain string range in SQLite, so
there's no date parsing, no time zone, and year 9999 needs no year 10000. The 84
movies without a release date never match any year.

**Pagination and empty results.** `totalItems` and `totalPages` count only the
matching movies. A valid year with no movies (for example `1850`, `0001` or
`9999` in V1) returns `200` with `data: []`, `totalItems: 0`, `totalPages: 0` and
the requested `page`. It is never a 404. A page past the end also returns `200`
with `data: []`.

**Response.** The same `MovieListResponse` envelope and five-field
`MovieSummary` items as the unfiltered listing. `releaseDate` stays
`string | null` in the schema for consistency, but is always a date here.

| Status | When                                                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `200`  | Any valid `year` and `page`, whether or not movies match.                                                                                                                                                                                        |
| `400`  | `VALIDATION_ERROR`: `year` is not four digits (`99`, `999`, `10000`, `-1999`, `1999.5`, `abc`, `1e3`, empty) or is `0000`; an invalid `page` or `sortOrder` (`random`, `ASC`, `descending`, empty); or a repeated `year`, `page` or `sortOrder`. |
| `500`  | `INTERNAL_ERROR`: an unexpected error, such as a malformed stored row. Details are only logged.                                                                                                                                                  |

```sh
curl 'http://127.0.0.1:3000/api/v1/movies/year/1999'                  # 723 movies, 15 pages, ascending
curl 'http://127.0.0.1:3000/api/v1/movies/year/1999?page=15'          # final page: 23 movies
curl 'http://127.0.0.1:3000/api/v1/movies/year/1999?sortOrder=desc'   # newest first
curl 'http://127.0.0.1:3000/api/v1/movies?year=1999&page=2&sortOrder=desc'  # same as the path form
curl 'http://127.0.0.1:3000/api/v1/movies/year/1850'                  # 200, empty
curl 'http://127.0.0.1:3000/api/v1/movies/year/999'                   # 400
```

In Swagger UI, open **Movies (v1) → GET /api/v1/movies/year/{year}** (or
**GET /api/v1/movies** and fill in `year`), choose **Try it out**, enter a year,
an optional `page`, pick a `sortOrder` and click **Execute**. The response
examples are real 1999 records, checked against the database by a test.

### `GET /api/v1/movies/genre/{genre}`: movies by genre (User Story 4)

Lists the movies that have a genre, 50 per page, by `movieId` (`sortOrder=desc`
reverses it). The same listing is `GET /api/v1/movies?genre={genre}`, which can
also be combined with `year`. All URLs call the same service method and SQL.

**Identifying a genre.**

- A value made only of decimal digits is a **genre id**: `28` (Action), `878`
  (Science Fiction). Leading zeros are allowed, as for `page`. It must be from 1 to
  2^53−1, so `0` or a huge number is a `400`.
- Anything else is a **genre name**, matched against the stored names exactly
  except for ASCII letter case: `Action`, `action` and `ACTION` are the same genre,
  and `science fiction` works (URL-encode the space). There's no partial,
  prefix, pattern or fuzzy matching: `Act`, `Science` and `Action ` (with a space)
  match nothing. All 20 V1 genre names are ASCII. Values such as `-28` or `28.0`
  aren't all digits, so they are names, and unknown ones.
- An empty or whitespace-only value is a `400`.
- Responses always show the stored names (`"TV Movie"`), whatever case was asked for.

**Unknown genres and empty results.** Genres are whatever the V1 data contains
(there's no hard-coded list): a genre no movie has is a `404 GENRE_NOT_FOUND`
(`Genre "Space Western" not found`, `Genre 99999 not found`), with or without
`year`. A known genre with no movies under the other filters, such as
`?year=1874&genre=Action`, is a `200` with `data: []` and zero totals.

**How it's matched.** `genres` is stored as JSON text. The repository uses
SQLite's `json_each` with `EXISTS`, comparing the JSON `id` field for ids and the
`name` field with `COLLATE NOCASE` for names. There's no `LIKE` on the serialised
text, and a movie whose array lists a genre twice is still returned once.

| Status | When                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `200`  | A known genre and valid `page`, whether or not movies match the other filters.                                            |
| `400`  | `VALIDATION_ERROR`: `genre` id `0` or too large, an empty `genre`, an invalid `year`, `page` or `sortOrder`, or a repeat. |
| `404`  | `GENRE_NOT_FOUND`: valid, but no V1 movie has the genre.                                                                  |
| `500`  | `INTERNAL_ERROR`: an unexpected error. Details are only logged.                                                           |

```sh
curl 'http://127.0.0.1:3000/api/v1/movies/genre/Action'                    # 6,590 movies, 132 pages
curl 'http://127.0.0.1:3000/api/v1/movies/genre/28?page=2'                 # same genre by id
curl 'http://127.0.0.1:3000/api/v1/movies/genre/science%20fiction?sortOrder=desc'
curl 'http://127.0.0.1:3000/api/v1/movies?genre=action'                    # same as /genre/action
curl 'http://127.0.0.1:3000/api/v1/movies?year=1999&genre=Action&sortOrder=desc'  # 100 movies, chronological
curl 'http://127.0.0.1:3000/api/v1/movies?year=1874&genre=Action'          # 200, empty
curl 'http://127.0.0.1:3000/api/v1/movies/genre/Act'                       # 404, no partial matches
curl 'http://127.0.0.1:3000/api/v1/movies/genre/0'                         # 400
```

In Swagger UI, open **Movies (v1) → GET /api/v1/movies/genre/{genre}**, choose
**Try it out**, enter a genre name or id, optionally a `page` and `sortOrder`,
and click **Execute**. For combined filters use **GET /api/v1/movies** and fill in
`year` and `genre`; filter fields start empty, so leaving them blank lists every movie.

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
  - All 15 pages of 1999 are fetched in both directions through both endpoint
    styles and compared with an independent query that extracts the year
    (rather than using the date range). Every year's count is checked the same way.
  - Genre results are compared with an oracle that parses every row's genre JSON
    in JavaScript: all 61 Science Fiction pages, Action by id and by name in
    several cases, descending order, all 100 1999 Action movies in both
    directions, and every genre's count by id, name and upper-case name.
  - A test confirms the SHA-256 hashes of both databases don't change during
    the detail requests.
- **In-memory SQLite fixtures** for edge cases and exact arithmetic:
  - malformed genre and company JSON, empty or non-numeric runtimes, impossible
    dates, NULL budgets
  - rating averages and rounding, movies with no ratings
  - an empty table and closed connections
  - year boundaries (`1999-01-01`, `1999-12-31`, adjacent years, years `0001` and
    `9999`, empty and NULL dates) and a 120-movie same-date tie across pages
  - a movie listing the same genre twice, partial and pattern-like names (`Act`,
    `%`, `_ction`), and malformed genre JSON under a genre filter
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

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request
targeting `main` and every push to `main`, on a GitHub-hosted `ubuntu-24.04` runner.

| Step             | Command                                             |
| ---------------- | --------------------------------------------------- |
| Node.js          | Version from `.nvmrc` (`actions/setup-node`)        |
| Install          | `npm ci --ignore-scripts` (committed lockfile)      |
| Formatting       | `npm run format:check`                              |
| Lint             | `npm run lint`                                      |
| Types            | `npm run typecheck`                                 |
| Tests            | `npm test` (Vitest + Supertest, `db/*.db` fixtures) |
| Production build | `npm run build`                                     |

- Every step must pass; the first failure fails the run. Protect `main` with the
  **CI / Validate** status check (repository settings → branch rules) so a failing
  PR can't merge.
- The token is read-only (`permissions: contents: read`), checkout doesn't persist
  credentials, and no secrets or homelab credentials are used. Tests run against
  the committed SQLite fixtures, opened read-only.
- npm's download cache (`~/.npm`) is cached, keyed on `package-lock.json`.
  `node_modules` is never cached; `npm ci` always rebuilds it.
- A new commit on a PR cancels the PR's previous run. Pushes to `main` each get
  their own concurrency group and are never cancelled, because a successful
  `main` run is what triggers a release.
- CI never publishes or deploys. Third-party actions are pinned to commit SHAs:

  | Action                                   | Version | Commit                                     |
  | ---------------------------------------- | ------- | ------------------------------------------ |
  | `actions/checkout`                       | v7.0.1  | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
  | `actions/setup-node`                     | v7.1.0  | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
  | `actions/upload-artifact` (publish only) | v7.0.2  | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

  To upgrade, review the new release, then replace both the SHA and the version
  comment.

To reproduce CI locally:

```sh
npm ci --ignore-scripts && npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```

## Image publishing

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) publishes the
production image to **`ghcr.io/svansig/aetna-take-home`** after CI succeeds for a
push to `main`. Pull requests never publish: the workflow is triggered by
`workflow_run`, always runs from the default branch, and accepts only a
successful CI run for a `push` to `main` of this repository.

How a release is produced:

1. **Verify** (read-only token). The CI run's event, conclusion, branch,
   repository, workflow file and commit SHA are checked, and the SHA must be
   reachable from `main`. Nothing else from the CI run is used: no artifacts are
   downloaded.
2. **Build** that exact commit for `linux/amd64` with the existing multi-stage
   Dockerfile. OCI labels link the image to the repository
   (`org.opencontainers.image.source`) and commit (`org.opencontainers.image.revision`).
3. **Check** the image: no `*.db`, `*.sqlite*` or `.env*` files, no dev
   dependencies, non-root `node` user. The container must refuse to start without
   its databases, then must become `healthy` and pass
   [`deploy/smoke-test.js`](deploy/smoke-test.js) with the committed databases
   mounted read-only and a read-only root filesystem.
4. **Push** with the `GITHUB_TOKEN` (`packages: write` on this job only; no PAT).

| Reference                                      | Meaning                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `ghcr.io/svansig/aetna-take-home:<commit-sha>` | Immutable by convention: the build of that full 40-character commit SHA. |
| `ghcr.io/svansig/aetna-take-home@sha256:<…>`   | Immutable: what production deploys.                                      |
| `ghcr.io/svansig/aetna-take-home:production`   | Moving: the latest approved release, polled by the production host.      |

- The digest is recorded in the run's job summary and in a `release-<sha>`
  artifact (`release.json`, kept 90 days), and the workflow checks that
  `production` resolves to exactly that digest after moving it.
- Releases run one at a time (`concurrency: publish-production`, never
  cancelled). `production` only moves forward: if the commit it currently points
  to isn't an ancestor of the new commit, the commit tag is still pushed but
  `production` is left alone. An older run finishing late can't roll production
  back.
- No database files, environment files or Cloudflare credentials are in the
  image. The token is only piped to `docker login`, never printed.

### Making the package public (one-time)

GHCR creates the package as **private** on the first push. After the first
successful publish run:

1. GitHub → your profile → **Packages** → `aetna-take-home` → **Package settings**.
2. **Danger zone → Change visibility → Public**.
3. Under **Manage Actions access**, confirm `Svansig/aetna-take-home` has
   **Write** (it is linked automatically by the `org.opencontainers.image.source`
   label).

The last step of every publish run checks anonymous pull access and logs a
warning while the package is still private. To check it yourself, with no
credentials:

```sh
docker logout ghcr.io
docker pull ghcr.io/svansig/aetna-take-home:production
docker image inspect ghcr.io/svansig/aetna-take-home:production \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

To find a commit's digest: open the publish run for that commit (Actions →
Publish) and read the job summary, or run
`docker buildx imagetools inspect ghcr.io/svansig/aetna-take-home:<commit-sha>`.

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
    pagination.ts      PAGE_SIZE, page query schema, pagination metadata, page → LIMIT/OFFSET, paginate()
    params.ts          Shared parameter validation (positive integers, four-digit years, repeats)
    request-logger.ts  pino-http: request ids, per-request logging
  movies/
    schemas.ts         Genre, MovieSummary, MovieListResponse, ProductionCompany, MovieDetails; movieId, year, genre, sortOrder params
    repository.ts      MovieRepository and RatingSource interfaces (implemented per version)
    sqlite-movie-repository.ts  V1 movies: prepared SQL, row validation, JSON parsing, fallbacks
    naive-sqlite-rating-source.ts  V1 ratings: naive numeric-id aggregate over ratings.db
    service.ts         MovieService: one filtered listing, genre 404, details, rating rounding (no Express)
    routes.ts          Shared router factory and OpenAPI registration for every /movies operation
  docs/
    openapi.ts         OpenAPI 3.1 document builder and /docs, /openapi.json router
test/                  Vitest + Supertest suites and helpers
db/                    Supplied SQLite databases (read-only, never modified)
kaggle/                Kaggle source CSVs for the future V2 rebuild (git- and docker-ignored)
```

## API versions

- **`/api/v1`** serves the **original supplied databases, unchanged**, and keeps
  their known limitations. That means all four user stories:
  `GET /api/v1/movies` (with optional `year`, `genre` and `sortOrder`),
  `GET /api/v1/movies/{movieId}`, `GET /api/v1/movies/year/{year}` and
  `GET /api/v1/movies/genre/{genre}`. Most importantly, `movies.movieId` holds TMDB
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
- **Pagination happens in SQLite.** Queries end in `ORDER BY … LIMIT ? OFFSET ?`
  with bound parameters. `movieId` is the table's `INTEGER PRIMARY KEY` (its
  rowid), so ordering by it needs no extra index and nothing was added to the schema.
  The count is a separate query. The service skips the data query for pages past
  the end, so no unsafe offset is ever computed, and the repository refuses
  unsafe windows as a second guard. Both listings share one `paginate()` helper,
  so their metadata and out-of-range rules can't diverge.
- **One listing operation behind every listing URL.** `/movies`,
  `/movies/year/{year}` and `/movies/genre/{genre}` only validate their
  parameters and call `MovieService.listMovies({ page, sortOrder, releaseYear?, genre? })`.
  The service checks that a genre exists (404 otherwise), picks the sort
  (chronological with a year, by `movieId` without) and paginates. The repository
  contract is three listing methods, all version-neutral: `countMovies(filter)`,
  `listMovies(filter, sort, window)` and `hasGenre(genre)`. V2 can implement them
  over its own data.
- **One SQL filter, switched by NULL parameters.** The count, the listing and the
  genre check share one `WHERE` clause:
  `(:yearStart IS NULL OR releaseDate BETWEEN …) AND (no genre OR EXISTS (… json_each …))`.
  An unused filter binds NULL, so all combinations (none, year, genre, both) run
  the same prepared statements, and counts can't disagree with listings. Only the
  `ORDER BY` varies, and it can only come from a fixed four-entry map
  (`movieId` or `releaseDate, movieId`, each `ASC` or `DESC`). Measured on the
  supplied data, the shared statement adds nothing noticeable to the unfiltered
  listing.
- **Year filtering as a string range, not a date function.** Release dates are
  stored as `YYYY-MM-DD` text, so `releaseDate BETWEEN 'YYYY-01-01' AND 'YYYY-12-31'`
  is exact, has no time zone, and works for year 9999.
- **Genre names resolve by data, not a catalog.** A genre exists if any V1 movie
  has it, so V1 needs no hard-coded list and V2 will reflect its own data. Ids and
  names map one-to-one in V1 (20 genres), so a name and its id always give
  identical results; a test checks this for every genre.
- **Performance, measured, not optimised.** No index may be added, so filters
  scan the table:

  | Query (supplied data)                          | Time         |
  | ---------------------------------------------- | ------------ |
  | Unfiltered page 1 / last page                  | <0.1 / ~4 ms |
  | Year (largest, 2014: count + page)             | ~10 ms       |
  | Year + genre (1999 Action: count + page)       | ~11 ms       |
  | Genre only (count + page; `json_each` per row) | ~45–90 ms    |
  | Unknown-genre check (full scan)                | ~47 ms       |
  | Known-genre check (stops at first match)       | <1 ms        |

  That's acceptable for this assignment, so there's no caching. If it mattered,
  V2's rebuilt database could store genres in their own indexed table.

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

- V1 implements all four user stories. Nothing under `/api/v2` is implemented,
  and the corrected dataset doesn't exist yet.
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
- Rating lookups scan the unindexed `ratings` table (about 2 ms each), and
  filtered listings scan `movies` (up to about 90 ms for a genre-only request),
  because the supplied schema must not change.
- Genre-name matching is ASCII case-insensitive (SQLite `NOCASE`). Every V1 genre
  name is ASCII; a non-ASCII name would match only with its exact case.
- The dedicated `/movies/year/{year}` and `/movies/genre/{genre}` routes take only
  `page` and `sortOrder`; other query parameters (including `genre` or `year`)
  are ignored there. Combined filters use `/movies?year=&genre=`.
- `V2_DB_PATH` is validated for shape only, not opened or checked for existence.
- The Docker base image is pinned by tag, not digest.
- Swagger UI loads its assets from the app, so it doesn't depend on a CDN. The
  `/docs` → `/docs/` redirect assumes the app is served at the host root.

## Remaining work

V1 is complete. Planned, not implemented:

1. **V2:** build a corrected dataset from `kaggle/` and serve it on `/api/v2`
   through the same routes, schemas and service, with its own `MovieRepository`
   and `RatingSource`. This includes the correct TMDB↔MovieLens rating mapping
   (via `links_small.csv`), original language and recovered production companies.
2. Deploy through a Cloudflare Tunnel.

## Source data

`kaggle/` (~920 MB, from the Kaggle "The Movies Dataset") is excluded from git
and from the Docker build context. Place the CSVs there before running the
future V2 import.
