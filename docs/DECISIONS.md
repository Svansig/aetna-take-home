# Engineering decisions

[ASSUMPTIONS.md](ASSUMPTIONS.md) records how the four user stories were
interpreted. This document records everything else: the scope, technology,
architecture, security, operational and process decisions that the brief doesn't
cover. Some were stated only in code comments, commit messages or a README
section that was removed with the V2 scaffolding (`a874964`); they are collected
here so they can be reviewed in one place.

The production runbook ([DEPLOYMENT.md](DEPLOYMENT.md)) already explains the
deployment design in detail. Section H only summarises it and links there.

**Status key**

- **Decided:** a deliberate choice; the rationale is given.
- **Trade-off:** a known cost accepted on purpose.
- **Open:** no deliberate decision was found; the current behaviour is a default.
  It needs an owner to confirm or change it.

## Summary

| #   | Topic                                      | Decision                                                                 | Status    |
| --- | ------------------------------------------ | ------------------------------------------------------------------------ | --------- |
|     | **A. Scope and data**                      |                                                                          |           |
| A1  | Data sources                               | Only the supplied `db/*.db`; the local Kaggle CSVs are unused            | Decided   |
| A2  | Corrected dataset (V2)                     | Designed and scaffolded, then removed; `/api/v1` prefix kept             | Open      |
| A3  | Databases in Git                           | `db/*.db` (~31 MB) committed; never baked into the image                 | Decided   |
|     | **B. Technology**                          |                                                                          |           |
| B1  | Language and runtime                       | TypeScript (strict, ESM) on Node.js ≥ 26                                 | Decided   |
| B2  | HTTP framework                             | Express 5                                                                | Open      |
| B3  | SQLite driver                              | Built-in `node:sqlite`, not `better-sqlite3`                             | Decided   |
| B4  | Data access                                | Plain SQL; no ORM or query builder                                       | Decided   |
| B5  | Schemas                                    | Zod is the single source for validation and OpenAPI                      | Decided   |
| B6  | TypeScript version                         | Pinned to 6.0.x                                                          | Decided   |
| B7  | Dependency versions                        | Exact versions, lockfile, `npm ci`                                       | Decided   |
|     | **C. Architecture**                        |                                                                          |           |
| C1  | Layering and dependency injection          | Routes → service → repository / rating source; factory-parameter DI      | Decided   |
| C2  | Two connections, no `ATTACH`               | One read-only connection per database                                    | Decided   |
| C3  | Concurrency model                          | One process, synchronous queries on the event loop                       | Trade-off |
| C4  | Performance                                | No indexes, no caching; measured and accepted                            | Trade-off |
| C5  | One listing query                          | Shared `WHERE` switched by NULL; `ORDER BY` from a fixed map             | Decided   |
| C6  | Pagination mechanism                       | `LIMIT/OFFSET` in SQLite, not cursors                                    | Decided   |
| C7  | Stored-data validation                     | Every row is checked; mismatches are a 500, never repaired               | Decided   |
| C8  | Response validation                        | Response schemas are enforced by tests, not at runtime                   | Decided   |
|     | **D. HTTP behaviour and security posture** |                                                                          |           |
| D1  | Authentication                             | None; the API is public                                                  | Decided   |
| D2  | Rate limiting, CORS, caching, compression  | None of these are implemented                                            | Open      |
| D3  | Error responses                            | One envelope; 500s always generic; Express client errors → `BAD_REQUEST` | Decided   |
| D4  | Missing path value                         | `/movies/year` and `/movies/genre` → `400`, not `404`                    | Decided   |
| D5  | Landing page                               | Static, script-free, strict CSP                                          | Decided   |
| D6  | Swagger UI                                 | Self-hosted assets, no CDN; no CSP on `/docs`                            | Decided   |
| D7  | Health check                               | Liveness only; doesn't touch the databases                               | Decided   |
|     | **E. Configuration and observability**     |                                                                          |           |
| E1  | Configuration                              | Environment only, every value defaulted and validated                    | Decided   |
| E2  | Log format                                 | Always JSON (pino); pretty-printing only through a pipe                  | Decided   |
| E3  | Request ids                                | Generated by the server; client-supplied ids ignored                     | Decided   |
| E4  | Request log content                        | Method, URL, status, id; credentials redacted; `/health` not logged      | Decided   |
| E5  | Process failure                            | Fail fast at startup; exit on uncaught errors; 10 s graceful shutdown    | Decided   |
|     | **F. Testing and quality**                 |                                                                          |           |
| F1  | Test data                                  | Real databases with independent oracles, plus in-memory fixtures         | Decided   |
| F2  | Coverage                                   | Measured, no threshold enforced                                          | Open      |
| F3  | Static checks                              | `strictTypeChecked` ESLint, Prettier, strict `tsc`; all gate CI          | Decided   |
|     | **G. Build, supply chain and release**     |                                                                          |           |
| G1  | Container image                            | Multi-stage, production deps only, non-root, no install scripts          | Decided   |
| G2  | Base image pinning                         | Node image pinned by tag, not digest                                     | Trade-off |
| G3  | Architecture                               | `linux/amd64` only                                                       | Decided   |
| G4  | GitHub Actions                             | Pinned to commit SHAs; CI unprivileged; publish verified separately      | Decided   |
| G5  | Release identity                           | Images tagged by commit SHA; no semver; `info.version` stays `0.1.0`     | Open      |
|     | **H. Production**                          |                                                                          |           |
| H1  | Deployment model                           | Pull-based, by digest, with automatic rollback                           | Decided   |
| H2  | Network exposure                           | Cloudflare Tunnel; no inbound ports                                      | Decided   |
| H3  | Availability                               | One replica; seconds of downtime per deployment                          | Trade-off |
| H4  | Data lifecycle                             | Datasets provisioned separately; rollback is image-only                  | Decided   |

## A. Scope and data

### A1. Data sources — Decided

The only data the API reads is the two supplied databases in `db/`, unmodified.
The git-ignored `kaggle/` directory holds the upstream Kaggle CSVs. They were
downloaded for the planned V2 (A2) and aren't used by the code, tests or image.

Note that `kaggle/links.csv` maps MovieLens ids to TMDB and IMDb ids, which is
the mapping needed to fix the rating mismatch
([ASSUMPTIONS #3](ASSUMPTIONS.md#3-joining-ratings-to-movies--known-issue)). The
statement that "the supplied data contains no mapping" is true of `db/`, but a
candidate mapping exists outside it.

### A2. Corrected dataset (V2) — Open

An `/api/v2` serving a dataset rebuilt from the Kaggle sources, with the correct
rating mapping and `originalLanguage` restored, was designed and partly
scaffolded: an `ApiVersion` contract, a mounted `/api/v2` with no operations, and
a `V2_DB_PATH` setting. Commit `a874964` removed all of it. The commit doesn't
record why.

What remains of the design:

- The `/api/v1` prefix and the production data path `/srv/aetna/data/v1/`.
- `RatingSource` is still a separate interface (C1), so a corrected mapping
  could be added without changing the HTTP layer.
- Tests assert that `/api/v2/*` returns `404`.

**To decide:** record the reason for dropping V2 (out of scope for the brief, or
deferred), and whether the corrected mapping is a non-goal.

### A3. Databases in Git — Decided

`db/movies.db` (29 MB) and `db/ratings.db` (2.2 MB) are committed, so local
runs, tests, CI and the publish workflow's smoke test all use the real data with
no download step. They are excluded from the Docker build context and the image
(the publish workflow fails if any `.db` file is found in it). Production
provisions its own copies (H4).

## B. Technology

### B1. Language and runtime — Decided

The brief favours Node.js, Java or Ruby; this uses TypeScript on Node.js. The
code is ESM, compiled with `tsc`, with `strict`, `noUncheckedIndexedAccess` and
`verbatimModuleSyntax` enabled. Node ≥ 26 is required (`engines`, `.nvmrc`)
because `node:sqlite` (B3) opens a database read-only there with no experimental
warning.

### B2. HTTP framework — Open

Express 5. Handlers throw (Zod validation errors, `HttpError`s) and Express
forwards them to the central error middleware, so routes need no try/catch.
The reason for choosing Express, and whether alternatives such as Fastify were
considered, isn't recorded.

### B3. SQLite driver — Decided

The built-in `node:sqlite` rather than `better-sqlite3`. Both are synchronous
in-process drivers, which suits a read-only single-process API: reads take
microseconds and need no connection pool. The built-in module needs no native
compile or prebuilt-binary download, so the Docker build stays simple and
reproducible. The trade-off: `better-sqlite3` is more battle-tested and has a
slightly richer API.

### B4. Data access — Decided

Plain SQL with prepared statements in two small repository classes. The data is
two read-only tables, so an ORM or query builder would add indirection without
removing complexity.

### B5. Schemas — Decided

Zod defines the configuration, request parameters, stored-row shapes and response
bodies. `@asteasolutions/zod-to-openapi` generates OpenAPI 3.1 from the same
schemas, so the documented contract can't drift from the validated one. Response
examples in the OpenAPI document are checked against the database by tests.

### B6. TypeScript version — Decided

Pinned to 6.0.x. typescript-eslint 8.72 declares `typescript >=4.8.4 <6.1.0`,
and TypeScript 7 is current. Upgrade TypeScript only after typescript-eslint
supports it.

### B7. Dependency versions — Decided

Every dependency in `package.json` is an exact version (no `^` or `~`), the
lockfile is committed, and CI and Docker install with `npm ci`. Upgrades are
deliberate changes.

## C. Architecture

### C1. Layering and dependency injection — Decided

- **Routes** validate parameters and call `MovieService`. **The service** holds
  the business rules (genre existence, sort selection, pagination, rating
  rounding, budget formatting). **`MovieRepository`** and **`RatingSource`**
  are interfaces; SQL exists only in their SQLite implementations.
- `RatingSource` is separate from `MovieRepository` because ratings live in a
  different database with a different id system. The association between them
  is the part most likely to change (A2).
- Dependencies are passed as constructor and factory parameters, without a DI
  container. `createApp({ logger, apiRouter })` doesn't read `process.env` or
  listen, so tests build it directly. `server.ts` is the only module that reads
  the environment, opens databases or binds a port.

### C2. Two connections, no `ATTACH` — Decided

Each database gets its own read-only connection, opened at startup and closed
after in-flight requests finish at shutdown. Not `ATTACH`ing keeps each source
independently injectable (tests pair real movies with fixture ratings) and keeps
the naive cross-database association out of SQL.

### C3. Concurrency model — Trade-off

One Node.js process with synchronous SQLite calls. A query blocks the event loop
for its duration, so the slowest request (a genre-only listing, up to ~90 ms)
delays every other request queued behind it. This assumes low concurrency,
which fits a code-test service. Scaling options, none implemented: more
replicas, worker threads, or indexes (C4).

### C4. Performance — Trade-off

The supplied databases aren't modified, so no indexes are added
([ASSUMPTIONS #20](ASSUMPTIONS.md#20-the-supplied-databases--assumed)). Measured
on the supplied data during implementation:

| Query                                          | Time         |
| ---------------------------------------------- | ------------ |
| Unfiltered page 1 / last page                  | <0.1 / ~4 ms |
| Year (largest, 2014: count + page)             | ~10 ms       |
| Year + genre (1999 Action: count + page)       | ~11 ms       |
| Genre only (count + page; `json_each` per row) | ~45–90 ms    |
| Unknown-genre check (full scan)                | ~47 ms       |
| Known-genre check (stops at first match)       | <1 ms        |
| Rating lookup (scans 100,004 ratings)          | ~2 ms        |

These were judged acceptable, so nothing is cached. If this changed, a derived
database with a genre table and an index on `ratings.movieId` would remove the
scans.

### C5. One listing query — Decided

Every listing URL calls `MovieService.listMovies`. The count, the page and the
genre-existence check share one `WHERE` clause; an unused filter binds `NULL`,
so every combination runs the same prepared statements and counts can't disagree
with pages. `ORDER BY` can only come from a fixed four-entry map, so nothing from
the request reaches SQL text.

### C6. Pagination mechanism — Decided

`LIMIT/OFFSET` in SQLite with a separate `COUNT`. Offset pagination isn't
snapshot-consistent in general, but the data is read-only, so pages never shift.
Pages past the end skip the data query, and both the service and the repository
refuse unsafe offsets.

### C7. Stored-data validation — Decided

Each row is parsed with Zod. A mismatch raises `DataIntegrityError`, which is
logged with the table, row id and failing fields (not the record contents) and
answered with a generic `500`. The single agreed exception is unparseable
production-company JSON
([ASSUMPTIONS #8](ASSUMPTIONS.md#8-malformed-production-companies--assumed)).

### C8. Response validation — Decided

Response bodies aren't parsed against their schemas at runtime. Tests map every
movie in the supplied data through the listing and details schemas instead,
which avoids the per-request cost.

## D. HTTP behaviour and security posture

### D1. Authentication — Decided

None. The API serves public reference data and is intentionally open
([DEPLOYMENT §6](DEPLOYMENT.md#6-create-the-cloudflare-tunnel): no Cloudflare
Access policy).

### D2. Rate limiting, CORS, caching, compression — Open

None of these is implemented, and no decision is recorded:

- **Rate limiting.** None in the app. C3 makes the genre listing the cheapest
  way to load the service. Cloudflare's default protections are the only layer.
- **CORS.** No `Access-Control-Allow-Origin` header, so browser code on other
  origins can't call the API. Swagger UI and the landing page are same-origin
  and unaffected.
- **HTTP caching.** No `Cache-Control` or validators on API responses, although
  the data never changes between deployments.
- **Compression.** None in the app; Cloudflare compresses at the edge in
  production.

### D3. Error responses — Decided

- One envelope for every error: `{ error: { code, message, details?, requestId } }`.
- `500`s always say only "An unexpected error occurred" plus the request id. The
  stack, SQL and paths go to the log. There is no development mode that returns
  more.
- Client errors raised inside Express or its dependencies (for example a
  malformed `%` escape in a path) keep their 4xx status, with code `BAD_REQUEST`.
- Unknown routes get a JSON `404 NOT_FOUND`, never Express's HTML page.
- `X-Powered-By` is disabled.

### D4. Missing path value — Decided

`/api/v1/movies/year` and `/api/v1/movies/genre` (no value) are `400`
validation errors for `year` or `genre`. They aren't treated as unknown routes
or as a `movieId` of `"year"`.

### D5. Landing page — Decided

`GET /` serves static files from `public/`: a summary of the test, live example
links per user story, and the rating warning. It has no scripts. It is sent with
`Content-Security-Policy: default-src 'none'; style-src 'self'; …` and
`X-Content-Type-Options: nosniff`. Paths that aren't files fall through to the
JSON 404, and directory redirects are off.

### D6. Swagger UI — Decided

Served from the app's own `swagger-ui-express` assets, so `/docs` doesn't depend
on a CDN. Unlike the landing page, it's served without a CSP. The
`/docs` → `/docs/` redirect assumes the app is mounted at the host root.

### D7. Health check — Decided

`GET /health` returns `{ "status": "ok" }` whenever the process serves HTTP. It
doesn't query the databases, which are opened at startup and fail the process
if missing (E5), so it stays cheap and reveals nothing. The Docker
`HEALTHCHECK`, the production updater and the public monitor all use it.

## E. Configuration and observability

### E1. Configuration — Decided

Following 12-factor: all settings come from environment variables, validated by
Zod at startup, and every one has a working default, so no `.env` is required.

- An empty value counts as unset (`PORT=` falls back to the default).
- Errors name the variable but never echo its value.
- Relative database paths resolve against the project root, not the CWD.
- `HOST` defaults to `127.0.0.1` locally; the image sets `0.0.0.0`.
- There are no secrets in the application's configuration.

### E2. Log format — Decided

The app always writes structured JSON to stdout with pino. `npm run dev` pipes
it through `pino-pretty`, so the code has no development-only logging path.

### E3. Request ids — Decided

Each request gets a server-generated UUID, returned in `X-Request-Id`, attached
to every log line of that request, and included in error bodies. A
client-supplied `X-Request-Id` is ignored, so clients can't forge or collide
ids in the logs.

### E4. Request log content — Decided

One line per completed request with only method, URL, status and id, with no
header dumps. `authorization`, `cookie` and `set-cookie` are redacted as
defence in depth. Levels follow the status: `5xx` is `error` and `4xx` is
`warn`. `/health` isn't logged, because container probes would dominate the log.

### E5. Process failure — Decided

- Invalid configuration or an unopenable database exits with status 1 before
  listening.
- An uncaught exception or unhandled rejection is logged at `fatal` and exits; the
  container's restart policy recovers.
- On SIGTERM or SIGINT the server stops accepting connections, finishes
  in-flight requests, closes both databases and exits. It forces an exit after
  10 seconds.
- The image runs `node` directly (no npm wrapper) and Compose uses `init: true`,
  so signals reach the process.

## F. Testing and quality

### F1. Test data — Decided

- Most API tests run against the supplied databases, opened read-only. Results
  are compared with independent SQL or JavaScript oracles, not snapshots. A test
  checks that the databases' SHA-256 hashes are unchanged.
- In-memory SQLite fixtures cover cases the real data lacks: malformed JSON,
  empty values, year boundaries, ties across pages and rating rounding.
- Tests drive the app in-process with Supertest. One process-level test starts
  `src/server.ts` and checks graceful shutdown.
- The test timeout is 30 s because full-dataset sweeps exceed Vitest's 5 s
  default on CI runners.

### F2. Coverage — Open

`npm run test:coverage` reports V8 coverage (excluding `src/server.ts`, which
runs in a child process), but CI doesn't run it and no threshold is enforced.

### F3. Static checks — Decided

typescript-eslint `strictTypeChecked` (relaxed only for `any`-typed Supertest
bodies in tests), Prettier, and `tsc` over sources and tests. CI runs format,
lint, typecheck, test and build, and any failure fails the PR.

## G. Build, supply chain and release

### G1. Container image — Decided

- A multi-stage build: compile with dev dependencies, then copy only production
  `node_modules`, `dist/` and `public/` into the runtime stage.
- Application files are root-owned and the process runs as the non-root `node`
  user, so it can't modify its own code.
- `npm ci --ignore-scripts`: no dependency needs an install script, and it
  blocks swagger-ui's `@scarf/scarf` analytics postinstall.
- Databases and `.env` files are never in the image (A3); the publish workflow
  checks this.
- Containers run with a read-only root filesystem, all capabilities dropped and
  `no-new-privileges`.

### G2. Base image pinning — Trade-off

The Node base image is pinned by exact tag (`node:26.13.0-slim`), not digest, so
a re-pushed tag could change a rebuild. The `cloudflared` image in production is
pinned by digest. Pinning Node by digest as well would make builds fully
reproducible, at the cost of manual updates for security patches.

### G3. Architecture — Decided

Images are built for `linux/amd64` only, matching the production host.

### G4. GitHub Actions — Decided

- Third-party actions are pinned to reviewed commit SHAs.
- CI has a read-only token and no secrets. Superseded PR runs are cancelled;
  runs on `main` never are, so a release-triggering run can't be interrupted.
- Publishing is a separate `workflow_run` workflow. It runs from the default
  branch, re-verifies that the triggering run was a successful CI push to `main`
  of this repository, and only then gets `packages: write`. It rebuilds from the
  verified commit rather than trusting CI artifacts.

### G5. Release identity — Open

Each image is tagged with its full commit SHA, and the moving `production` tag
only moves forward along `main`. There is no semantic version.
`package.json`'s `version` is `0.1.0` and is published as the OpenAPI
`info.version`, so it doesn't change between releases. **To decide:** whether
`info.version` should carry the commit, or `version` be bumped on release.

## H. Production

These are summarised from [DEPLOYMENT.md](DEPLOYMENT.md), which has the details
and rationale.

### H1. Deployment model — Decided

A systemd timer on the host polls GHCR every 60 s, pulls the `production` tag by
digest, validates the datasets, replaces the container, then health-checks and
smoke-tests it. A failure blocks that digest and rolls back automatically.
GitHub never connects to the host: there's no SSH, self-hosted runner or
Watchtower. Changes to the deployment files themselves are manual
(`git pull && install.sh`), so the host trusts only images, by digest.

### H2. Network exposure — Decided

An unprivileged Proxmox LXC with no inbound ports. A Cloudflare Tunnel connector,
in its own Compose project, reaches the API over an internal Docker network. The
GHCR package is public, so the host needs no registry credentials; the tunnel
token is the only secret.

### H3. Availability — Trade-off

One replica, stopped then started, so each deployment or rollback returns `502`
for about 5–15 s. Public reachability is monitored but only logged, with no
alerting.

### H4. Data lifecycle — Decided

Production datasets are provisioned once on the host, mounted read-only, and
never changed by a deployment. Rollback restores the image, not the data.
Replacing a dataset is a separate, manual operation
([DEPLOYMENT §10](DEPLOYMENT.md#10-replacing-datasets)).
