import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { ErrorResponseSchema } from '../http/errors.js';
import { PAGE_SIZE } from '../http/pagination.js';
import {
  MovieDetailsSchema,
  MovieGenreParamsSchema,
  MovieIdParamsSchema,
  MovieListQuerySchema,
  MovieListResponseSchema,
  MoviesByGenreQuerySchema,
  MoviesByYearQuerySchema,
  MovieYearParamsSchema,
} from '../movies/schemas.js';
import {
  DETAILS_EXAMPLES,
  EMPTY_YEAR_EXAMPLE,
  FIRST_PAGE_EXAMPLE,
  GENRE_EXAMPLES,
  YEAR_1999_EXAMPLES,
} from './movie-examples.js';

/** Register every `/movies` operation under `basePath` (e.g. `/api/v1`). */
export function registerMoviesDocs(registry: OpenAPIRegistry, basePath: string): void {
  const totals = FIRST_PAGE_EXAMPLE.pagination;
  const tag = 'Movies';
  const validationError = (path: string, message: string) => ({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: [{ path, message }],
      requestId: '6f1c1c3e-2b8e-4d55-9b0c-2f1f5a3c9e21',
    },
  });
  const serverError = {
    description: 'Unexpected error. Details are logged server-side, never returned.',
    content: { 'application/json': { schema: ErrorResponseSchema } },
  };
  const notFoundError = (message: string) => ({
    error: { code: 'GENRE_NOT_FOUND', message, requestId: '6f1c1c3e-2b8e-4d55-9b0c-2f1f5a3c9e21' },
  });
  const yearExamples = {
    year1999: {
      summary: '1999, ascending (default): first 3 of 50 movies on page 1',
      value: YEAR_1999_EXAMPLES.asc,
    },
    year1999Desc: {
      summary: '1999, sortOrder=desc: first 3 of 50 movies on page 1',
      value: YEAR_1999_EXAMPLES.desc,
    },
    emptyYear: {
      summary: `${String(EMPTY_YEAR_EXAMPLE.year)}: a valid year with no movies`,
      value: EMPTY_YEAR_EXAMPLE.response,
    },
  };
  const genreExample = {
    action: {
      summary: 'Action (or 28, or action): first 3 of 50 movies on page 1, by movieId',
      value: GENRE_EXAMPLES.action,
    },
  };
  const unknownGenre = {
    description: 'Valid `genre`, but no movie has it.',
    content: {
      'application/json': {
        schema: ErrorResponseSchema,
        examples: {
          name: { value: notFoundError('Genre "Space Western" not found') },
          id: { value: notFoundError('Genre 99999 not found') },
        },
      },
    },
  };
  const yearRules = [
    '* `year` is exactly four digits, `0001` to `9999` (e.g. `1999`, `0001`). Anything',
    '  else (`99`, `10000`, `-1999`, `1999.5`, `abc`, empty) is a `400`. Movies without a',
    '  release date never match a year.',
  ];
  const genreRules = [
    '* `genre` made only of decimal digits is a genre id (`28`); it must be from 1 to',
    '  2^53−1 or the request is a `400`. Anything else is a genre name (`Action`,',
    '  `Science Fiction`), matched exactly except for ASCII letter case (`action` and',
    '  `ACTION` work; `Act` does not). An empty name is a `400`.',
    '* A genre no movie has is a `404 GENRE_NOT_FOUND`. A known genre with nothing',
    '  matching the other filters is a `200` with `data: []`.',
    '* Responses keep the stored genre names; the query value only selects movies.',
  ];
  const listRules = (repeatable: string) => [
    '* `totalItems` and `totalPages` count only the matching movies. No matches returns',
    '  `200` with `data: []`, `totalItems: 0` and `totalPages: 0`.',
    '* `page` is 1-indexed and defaults to 1. The page size is fixed. A page past the',
    '  end returns `200` with `data: []` and accurate `pagination`.',
    '* `movieId` identifies the movie for `GET /movies/{movieId}`. `budget` is a US dollar',
    '  string such as `$4,000,000`. `releaseDate` is a `YYYY-MM-DD` date or `null`.',
    `* Unknown query parameters are ignored. A repeated ${repeatable} is a \`400\`.`,
  ];
  const badRequest = (examples: Record<string, [string, string]>) => ({
    description: 'An invalid parameter (all parameters are validated before any lookup).',
    content: {
      'application/json': {
        schema: ErrorResponseSchema,
        examples: Object.fromEntries(
          Object.entries(examples).map(([key, [path, message]]) => [
            key,
            { value: validationError(path, message) },
          ]),
        ),
      },
    },
  });
  const YEAR_400: [string, string] = ['year', 'year must be a four-digit year from 0001 to 9999'];
  const GENRE_400: [string, string] = ['genre', 'genre must not be empty'];
  const SORT_400: [string, string] = ['sortOrder', 'sortOrder must be "asc" or "desc"'];

  registry.registerPath({
    method: 'get',
    path: `${basePath}/movies`,
    operationId: 'listMovies',
    tags: [tag],
    summary: 'List movies, optionally filtered by year and/or genre',
    description: [
      `Returns movies, ${String(PAGE_SIZE)} per page. With no filters, that is every movie.`,
      '`year` and `genre` are optional and combine with AND: `?year=1999&genre=Action`',
      'lists the Action movies released in 1999.',
      '',
      '**Order** (`sortOrder` is `asc` by default, or `desc`):',
      '',
      '* Without `year`, by the internal `movieId`. The order is stable but has no',
      '  meaning to clients.',
      '* With `year`, chronological: `releaseDate`, then `movieId` for movies released on',
      '  the same day, both in the `sortOrder` direction.',
      '',
      'Equivalent to `GET /movies/year/{year}` (only `year`) and `GET /movies/genre/{genre}`',
      '(only `genre`) with the same `page` and `sortOrder`.',
      '',
      ...yearRules,
      ...genreRules,
      ...listRules('`page`, `year`, `genre` or `sortOrder`'),
    ].join('\n'),
    request: { query: MovieListQuerySchema },
    responses: {
      200: {
        description: 'One page of movies.',
        content: {
          'application/json': {
            schema: MovieListResponseSchema,
            examples: {
              firstPage: {
                summary: 'No filters, page 1 (first 3 of 50 movies)',
                value: FIRST_PAGE_EXAMPLE,
              },
              pastTheEnd: {
                summary: 'A page past the end',
                value: { data: [], pagination: { ...totals, page: 1000 } },
              },
              ...yearExamples,
              ...genreExample,
              action1999: {
                summary: 'year=1999&genre=Action: first 3 of 50 movies on page 1',
                value: GENRE_EXAMPLES.action1999,
              },
            },
          },
        },
      },
      400: badRequest({
        page: ['page', 'page must be at least 1'],
        year: YEAR_400,
        genre: GENRE_400,
        sortOrder: SORT_400,
      }),
      404: unknownGenre,
      500: serverError,
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${basePath}/movies/year/{year}`,
    operationId: 'listMoviesByYear',
    tags: [tag],
    summary: 'List movies released in a year',
    description: [
      `Returns the movies released in \`year\`, ${String(PAGE_SIZE)} per page, in chronological`,
      'order: `releaseDate`, then `movieId` for movies released on the same day, both',
      'ascending by default or descending with `sortOrder=desc`. Equivalent to',
      '`GET /movies?year={year}` with the same `page` and `sortOrder`.',
      '',
      ...yearRules,
      ...listRules('`page` or `sortOrder`'),
    ].join('\n'),
    request: { params: MovieYearParamsSchema, query: MoviesByYearQuerySchema },
    responses: {
      200: {
        description: 'One page of the movies released in the year.',
        content: {
          'application/json': { schema: MovieListResponseSchema, examples: yearExamples },
        },
      },
      400: badRequest({ year: YEAR_400, sortOrder: SORT_400 }),
      500: serverError,
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${basePath}/movies/genre/{genre}`,
    operationId: 'listMoviesByGenre',
    tags: [tag],
    summary: 'List movies in a genre',
    description: [
      `Returns the movies that have \`genre\`, ${String(PAGE_SIZE)} per page, by \`movieId\``,
      '(ascending by default, descending with `sortOrder=desc`). Equivalent to',
      '`GET /movies?genre={genre}` with the same `page` and `sortOrder`.',
      '',
      ...genreRules,
      ...listRules('`page` or `sortOrder`'),
    ].join('\n'),
    request: { params: MovieGenreParamsSchema, query: MoviesByGenreQuerySchema },
    responses: {
      200: {
        description: 'One page of the movies in the genre.',
        content: {
          'application/json': { schema: MovieListResponseSchema, examples: genreExample },
        },
      },
      400: badRequest({
        genreId: ['genre', 'genre id must be a positive integer no larger than 2^53-1'],
        sortOrder: SORT_400,
      }),
      404: unknownGenre,
      500: serverError,
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${basePath}/movies/{movieId}`,
    operationId: 'getMovieDetails',
    tags: [tag],
    summary: 'Get movie details',
    description: [
      'Returns one movie, looked up by its numeric `movieId` (the id used by the movies',
      'database, not an IMDb id).',
      '',
      '* `budget` is a US dollar string such as `$11,000,000`. `$0` usually means the',
      '  budget was not recorded in the original dataset.',
      '* `runtime` is in minutes, or `null` when the source value is empty.',
      '* `averageRating` is the mean of matching ratings on a 0.5–5.0 scale, rounded to 2',
      '  decimal places. It is `null` (never `0`) when no ratings match.',
      '* `description`, `releaseDate` and `originalLanguage` are `null` when the source',
      '  value is empty. `originalLanguage` is always `null`, because the supplied',
      '  database has no language values.',
      '* `productionCompanies` is `[]` for the 483 records whose company data is',
      '  malformed JSON. The request still succeeds and no repair is attempted.',
      '',
      '**Known limitation: ratings may belong to a different movie.** The movies',
      'database uses TMDB ids and the ratings database uses MovieLens ids. The API',
      'deliberately joins them by the raw number (`movies.movieId = ratings.movieId`),',
      'so many averages come from an unrelated film. For example, Star Wars',
      "(`movieId` 11) reports 3.69, the average for MovieLens movie 11. Star Wars' real",
      'MovieLens id is 260, which averages 4.22. Correct averages would need an',
      'authoritative TMDB-to-MovieLens id mapping, which the supplied data lacks.',
    ].join('\n'),
    request: { params: MovieIdParamsSchema },
    responses: {
      200: {
        description: 'The movie.',
        content: {
          'application/json': {
            schema: MovieDetailsSchema,
            examples: {
              starWars: {
                summary: 'movieId 11: Star Wars (naive rating: 3.69, not 4.22)',
                value: DETAILS_EXAMPLES[11],
              },
              capote: {
                summary: 'movieId 398: Capote (no matching ratings; malformed company JSON)',
                value: DETAILS_EXAMPLES[398],
              },
            },
          },
        },
      },
      400: {
        description: 'Invalid `movieId` (not a positive base-10 integer, or too large).',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
            example: validationError('movieId', 'movieId must be a positive base-10 integer'),
          },
        },
      },
      404: {
        description: 'No movie has this `movieId`.',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
            example: {
              error: {
                code: 'MOVIE_NOT_FOUND',
                message: 'Movie 1 not found',
                requestId: '6f1c1c3e-2b8e-4d55-9b0c-2f1f5a3c9e21',
              },
            },
          },
        },
      },
      500: serverError,
    },
  });
}
