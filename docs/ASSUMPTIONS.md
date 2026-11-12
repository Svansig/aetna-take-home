# Assumptions and interpretations

The brief ([ASSIGNMENT.md](../ASSIGNMENT.md)) leaves several details open. This
document records every interpretation made while implementing it, so a reviewer
can challenge any of them in one place.

**Status key**

- **Confirmed:** agreed with the product owner after implementation.
- **Known issue:** a gap we accept in V1 and plan to fix.
- **Assumed:** chosen by the implementer. It is consistent with the brief, but
  hasn't been confirmed.

## Summary

| #   | Topic                                  | Decision                                                        | Status      |
| --- | -------------------------------------- | --------------------------------------------------------------- | ----------- |
| 1   | How a client identifies a movie        | `movieId` (TMDB id) is in every listing and in the details path | Confirmed   |
| 2   | Budget display                         | `"$4,000,000"`: dollar sign, thousands separators, no decimals  | Confirmed   |
| 3   | Joining ratings to movies              | Naive `movies.movieId = ratings.movieId`                        | Known issue |
| 4   | Budget of 0                            | Returned as `"$0"`, not `null`                                  | Assumed     |
| 5   | Original language                      | Always `null` (the source column is empty)                      | Known issue |
| 6   | Average rating format                  | Mean, rounded half-up to 2 decimals; `null` with no ratings     | Assumed     |
| 7   | Description                            | The `overview` column; `null` when empty                        | Assumed     |
| 8   | Malformed production companies         | `[]`, request still succeeds                                    | Assumed     |
| 9   | Other missing values                   | `null` (`releaseDate`, `runtime`); `""` kept for `imdbId`       | Assumed     |
| 10  | Order of unfiltered and genre listings | By `movieId`                                                    | Assumed     |
| 11  | "Chronological" for movies by year     | `releaseDate`, ties broken by `movieId`                         | Assumed     |
| 12  | Sort order on other listings           | `sortOrder` accepted on every listing                           | Assumed     |
| 13  | Year format                            | Exactly four digits, `0001` to `9999`                           | Assumed     |
| 14  | Genre identification                   | Genre id or exact name, case-insensitive                        | Assumed     |
| 15  | Unknown genre vs. unknown year         | Genre: `404`. Year: empty `200`                                 | Assumed     |
| 16  | Pagination edge cases                  | 1-indexed; past the end is an empty `200`; size fixed at 50     | Assumed     |
| 17  | Response envelope                      | `{ data, pagination }` for lists, bare object for details       | Assumed     |
| 18  | URL design                             | `/api/v1/movies/...` with dedicated year and genre routes       | Assumed     |
| 19  | Combined filters                       | `?year=&genre=` on `/movies`, combined with AND                 | Assumed     |
| 20  | The supplied databases                 | Read-only and never modified, no indexes added                  | Assumed     |

## Details

### 1. How a client identifies a movie — Confirmed

The details story says "a particular movie" without naming the key. The details
endpoint uses the numeric `movieId` from `movies.db` (a TMDB id):
`GET /api/v1/movies/{movieId}`.

The brief's listing columns don't include an id, so the first version of the
listing gave clients no way to reach the details. **`movieId` is now returned in
every listing and in the details response.** This is a sixth field beyond the
five the brief lists.

`imdbId` was considered as the key instead and rejected because it isn't
unique. The schema has no unique constraint on it, and 17 movies share the
same blank value (`""`), so it can't identify every movie. `movieId` is the
table's primary key, so it is guaranteed to be unique.

### 2. Budget display — Confirmed

"Budget is displayed in dollars." The stored values are already whole US
dollars, so this is read as a display format: a string with a dollar sign,
thousands separators and no decimal portion, such as `"$4,000,000"`. Cents are
omitted because every stored value is whole dollars, so they would always be `.00`.

- Formatting uses `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })`,
  fixed in code so the server's locale never changes the output.
- The value is a string, so clients can't do arithmetic with it directly. That
  is a consequence of formatting on the server.
- Repositories keep the integer, and `MovieService` formats it. A future V2
  repository gets the same format automatically.

### 3. Joining ratings to movies — Known issue (fix planned for V2)

"Ratings are pulled from the rating database." `movies.movieId` is a TMDB id and
`ratings.movieId` is a MovieLens id. The supplied data contains no mapping
between them (in the Kaggle source, it is `links_small.csv`).

V1 joins them by the raw number. Many averages therefore belong to a different
film: Star Wars (`movieId` 11) reports 3.69, MovieLens movie 11's average, while
its real MovieLens id 260 averages 4.22. This is documented in the README and in
the OpenAPI description. V2 will rebuild the data with the correct mapping.

### 4. Budget of 0 — Assumed

36,550 movies (about 80%) store a budget of 0, which almost always means
"not recorded." V1 can't tell that apart from a real zero, so it returns
`"$0"` as stored instead of guessing `null`.

### 5. Original language — Known issue

The details story requires "original language." The only candidate column,
`movies.language`, is empty for all 45,430 movies, so `originalLanguage` is
always `null` in V1. V2 is planned to restore it from the Kaggle source.

### 6. Average rating format — Assumed

The brief doesn't specify precision or the no-ratings case.

- The value is the arithmetic mean of the matching ratings (0.5 to 5.0 scale).
- It is rounded half-up to 2 decimal places (`1.005` becomes `1.01`), computed
  so binary floating point can't round an exact half down.
- A movie with no matching ratings gets `null`, never `0`, because 0 is not a
  possible rating.
- The rating count is not returned.

### 7. Description — Assumed

"Description" is taken from the `overview` column, returned verbatim. The 959
movies with an empty overview return `null`.

### 8. Malformed production companies — Assumed

483 movies store production-company text that isn't valid JSON, mostly because
of unescaped quotes in names (for example Capote, `movieId` 398). These return
`productionCompanies: []` and the request still succeeds. Nothing is repaired or
guessed. Company JSON that parses but has an unexpected shape is still treated as
a data error (`500`); no current record does this.

Malformed genre JSON, by contrast, is a `500`, because genres appear in every
listing and the stories require them. No current record has malformed genres.

### 9. Other missing values — Assumed

- `releaseDate`: 84 movies have none. They return `null` and never match a year.
- `runtime`: 257 movies store an empty value, which returns `null`. Another 1,558
  store `0`, returned as `0`. Runtime is in minutes and isn't rounded.
- `imdbId`: 17 movies store an empty string. It is returned unchanged as `""`.
- Dates are returned exactly as stored (`YYYY-MM-DD`) and never converted to
  timestamps, so time zones can't shift them.

### 10. Order of unfiltered and genre listings — Assumed

The brief specifies an order only for movies by year. The other listings sort by
`movieId`. The order is stable, which offset pagination needs, but has no meaning
to clients. Title or release date would be alternatives.

### 11. "Chronological" for movies by year — Assumed

Movies sort by `releaseDate`. Movies released on the same day (67 movies of 1999
share `1999-01-01`) are then sorted by `movieId`, so page boundaries are
deterministic. `sortOrder=desc` reverses both.

### 12. Sort order on other listings — Assumed (beyond the brief)

"Sort order can be descending" appears only in the movies-by-year story.
`sortOrder=asc|desc` is accepted on every listing for consistency. It is
case-sensitive, and an invalid value is a `400`.

### 13. Year format — Assumed

A year must be exactly four digits from `0001` to `9999`. `99`, `10000`, `-1999`
and `1999.5` are `400`s. A year is matched with the string range
`YYYY-01-01` to `YYYY-12-31` against the stored date.

### 14. Genre identification — Assumed

"List all movies by a genre" doesn't say how a genre is named.

- A value made only of digits is a genre id (`28`).
- Anything else is a genre name, matched exactly except for ASCII letter case:
  `Action`, `action` and `ACTION` are the same. `Act` matches nothing; there is
  no partial or fuzzy matching.
- The genre list comes from the data itself; nothing is hard-coded.

### 15. Unknown genre vs. unknown year — Assumed

- A genre that no movie has is a `404 GENRE_NOT_FOUND`, because it most likely
  means a typo.
- A valid year with no movies (for example `1850`) is a `200` with an empty
  page, because every year is a meaningful value even when it has no data.
- A known genre with no movies under other filters is also an empty `200`.

### 16. Pagination edge cases — Assumed

- Pages are 1-indexed, and `page` defaults to 1.
- The page size is fixed at 50 and clients can't change it.
- A page past the end returns `200` with `data: []` and accurate totals.
- `page=0`, negative, decimal, non-numeric or repeated values are `400`s.
- Each list response includes `page`, `pageSize`, `totalItems` and `totalPages`.

### 17. Response envelope — Assumed

Lists return `{ "data": [...], "pagination": {...} }`. Details return the movie
object directly. Errors share one shape:
`{ "error": { "code", "message", "details"?, "requestId" } }`. Field names are
camelCase.

### 18. URL design — Assumed

All endpoints are versioned under `/api/v1`:

- `GET /movies`
- `GET /movies/{movieId}`
- `GET /movies/year/{year}`
- `GET /movies/genre/{genre}`

Dedicated year and genre routes were chosen to map one-to-one onto the user
stories.

### 19. Combined filters — Assumed (beyond the brief)

`GET /movies` also accepts `year` and `genre` as query parameters, alone or
together (combined with AND). `/movies?year=1999` returns exactly the same as
`/movies/year/1999`. The dedicated routes ignore extra filters.

### 20. The supplied databases — Assumed

The databases are treated as read-only reference data: opened read-only, never
modified, and no indexes are added. As a result, genre listings scan the table
(up to about 90 ms) and each rating lookup scans the ratings table (about 2 ms).
Both were measured and judged acceptable, so nothing is cached.

## Beyond the brief

These weren't requested. They're listed so it's clear they're additions, not
interpretations of a requirement:

- `/api/v2` is mounted with no operations (`404`), reserved for the corrected
  dataset.
- OpenAPI 3.1 at `/openapi.json` and Swagger UI at `/docs`.
- `GET /health` liveness endpoint.
- Docker image, GitHub Actions CI, publishing the image to GHCR, and a
  pull-based production deployment (see [DEPLOYMENT.md](DEPLOYMENT.md)).
