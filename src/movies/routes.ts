import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { Router } from 'express';
import { ErrorResponseSchema } from '../http/errors.js';
import { PAGE_SIZE } from '../http/pagination.js';
import {
  MovieDetailsSchema,
  MovieIdParamsSchema,
  MovieGenreParamsSchema,
  MovieListQuerySchema,
  MovieListResponseSchema,
  MoviesByGenreQuerySchema,
  MoviesByYearQuerySchema,
  MovieYearParamsSchema,
  type MovieDetails,
  type MovieListResponse,
} from './schemas.js';
import type { MovieService } from './service.js';

/** Movie routes over an injected `MovieService`. */
export function createMoviesRouter(service: MovieService): Router {
  const router = Router();

  // Every handler validates all of its parameters before calling the service, so
  // a ZodError (400, via the central error handler) always wins over a 404. All
  // listing URLs share `service.listMovies`.

  router.get('/movies', (req, res) => {
    const { page, sortOrder, year, genre } = MovieListQuerySchema.parse(req.query);
    res.json(service.listMovies({ page, sortOrder, releaseYear: year, genre }));
  });

  // The year and genre routes are registered before `/movies/:movieId` so their
  // paths never reach it. The optional `{/:param}` segment turns a missing value
  // into a validation error for that parameter rather than a `movieId` one.
  router.get('/movies/year{/:year}', (req, res) => {
    const { year } = MovieYearParamsSchema.parse(req.params);
    const { page, sortOrder } = MoviesByYearQuerySchema.parse(req.query);
    res.json(service.listMovies({ page, sortOrder, releaseYear: year }));
  });

  router.get('/movies/genre{/:genre}', (req, res) => {
    const { genre } = MovieGenreParamsSchema.parse(req.params);
    const { page, sortOrder } = MoviesByGenreQuerySchema.parse(req.query);
    res.json(service.listMovies({ page, sortOrder, genre }));
  });

  router.get('/movies/:movieId', (req, res) => {
    // Invalid ids become a 400 and unknown ids a 404 (MovieNotFoundError), both
    // in the central error handler.
    const { movieId } = MovieIdParamsSchema.parse(req.params);
    res.json(service.getMovieDetails(movieId));
  });

  return router;
}

/**
 * The first three movies of page 1 in the supplied database, verbatim. A test
 * checks them against the database so the documentation can't drift.
 */
export const FIRST_PAGE_EXAMPLE: MovieListResponse = {
  data: [
    {
      movieId: 2,
      imdbId: 'tt0094675',
      title: 'Ariel',
      genres: [
        { id: 18, name: 'Drama' },
        { id: 80, name: 'Crime' },
      ],
      releaseDate: '1988-10-21',
      budget: '$0',
    },
    {
      movieId: 3,
      imdbId: 'tt0092149',
      title: 'Shadows in Paradise',
      genres: [
        { id: 18, name: 'Drama' },
        { id: 35, name: 'Comedy' },
      ],
      releaseDate: '1986-10-16',
      budget: '$0',
    },
    {
      movieId: 5,
      imdbId: 'tt0113101',
      title: 'Four Rooms',
      genres: [
        { id: 80, name: 'Crime' },
        { id: 35, name: 'Comedy' },
      ],
      releaseDate: '1995-12-09',
      budget: '$4,000,000',
    },
  ],
  pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 45430, totalPages: 909 },
};

/**
 * The first three movies of 1999 (page 1 of 15) in each direction, verbatim from
 * the supplied database. A test checks them against the database. 67 movies of
 * 1999 share the date 1999-01-01, so ascending order shows the movieId tie-break.
 */
export const YEAR_1999_EXAMPLES = {
  asc: {
    data: [
      {
        movieId: 3144,
        imdbId: 'tt0183717',
        title: "Rock 'n' Roll Frankenstein",
        genres: [
          { id: 35, name: 'Comedy' },
          { id: 27, name: 'Horror' },
        ],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
      {
        movieId: 15752,
        imdbId: 'tt0211219',
        title: 'Barenaked in America',
        genres: [{ id: 99, name: 'Documentary' }],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
      {
        movieId: 18143,
        imdbId: 'tt0373960',
        title: 'She and Her Cat: Their Standing Points',
        genres: [
          { id: 16, name: 'Animation' },
          { id: 10749, name: 'Romance' },
        ],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
    ],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 723, totalPages: 15 },
  },
  desc: {
    data: [
      {
        movieId: 105980,
        imdbId: 'tt0129023',
        title: 'Dark Harbor',
        genres: [
          { id: 53, name: 'Thriller' },
          { id: 18, name: 'Drama' },
        ],
        releaseDate: '1999-12-31',
        budget: '$0',
      },
      {
        movieId: 56828,
        imdbId: 'tt0293092',
        title: "Dexter's Laboratory: Ego Trip",
        genres: [
          { id: 16, name: 'Animation' },
          { id: 35, name: 'Comedy' },
          { id: 10751, name: 'Family' },
          { id: 878, name: 'Science Fiction' },
        ],
        releaseDate: '1999-12-31',
        budget: '$0',
      },
      {
        movieId: 41245,
        imdbId: 'tt0247613',
        title: 'Peppermint Candy',
        genres: [{ id: 18, name: 'Drama' }],
        releaseDate: '1999-12-31',
        budget: '$0',
      },
    ],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 723, totalPages: 15 },
  },
} satisfies Record<'asc' | 'desc', MovieListResponse>;

/** A valid year with no movies in the supplied database (checked by a test). */
export const EMPTY_YEAR_EXAMPLE = {
  year: 1850,
  response: {
    data: [],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 0 },
  },
} satisfies { year: number; response: MovieListResponse };

/**
 * Genre and combined-filter pages from the supplied database, verbatim (first
 * three movies of page 1). A test checks them against the database.
 */
export const GENRE_EXAMPLES = {
  action: {
    data: [
      {
        movieId: 6,
        imdbId: 'tt0107286',
        title: 'Judgment Night',
        genres: [
          { id: 28, name: 'Action' },
          { id: 53, name: 'Thriller' },
          { id: 80, name: 'Crime' },
        ],
        releaseDate: '1993-10-15',
        budget: '$0',
      },
      {
        movieId: 11,
        imdbId: 'tt0076759',
        title: 'Star Wars',
        genres: [
          { id: 12, name: 'Adventure' },
          { id: 28, name: 'Action' },
          { id: 878, name: 'Science Fiction' },
        ],
        releaseDate: '1977-05-25',
        budget: '$11,000,000',
      },
      {
        movieId: 18,
        imdbId: 'tt0119116',
        title: 'The Fifth Element',
        genres: [
          { id: 12, name: 'Adventure' },
          { id: 14, name: 'Fantasy' },
          { id: 28, name: 'Action' },
          { id: 53, name: 'Thriller' },
          { id: 878, name: 'Science Fiction' },
        ],
        releaseDate: '1997-05-07',
        budget: '$90,000,000',
      },
    ],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 6590, totalPages: 132 },
  },
  action1999: {
    data: [
      {
        movieId: 25660,
        imdbId: 'tt0223530',
        title: 'Nowhere to Hide',
        genres: [
          { id: 28, name: 'Action' },
          { id: 35, name: 'Comedy' },
          { id: 80, name: 'Crime' },
        ],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
      {
        movieId: 30817,
        imdbId: 'tt0181838',
        title: 'Stealth Fighter',
        genres: [
          { id: 28, name: 'Action' },
          { id: 53, name: 'Thriller' },
        ],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
      {
        movieId: 31501,
        imdbId: 'tt0203082',
        title: 'Samurai X: Trust & Betrayal',
        genres: [
          { id: 16, name: 'Animation' },
          { id: 28, name: 'Action' },
          { id: 12, name: 'Adventure' },
          { id: 18, name: 'Drama' },
          { id: 10749, name: 'Romance' },
        ],
        releaseDate: '1999-01-01',
        budget: '$0',
      },
    ],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 100, totalPages: 2 },
  },
} satisfies Record<string, MovieListResponse>;

/**
 * Real detail responses, verbatim. A test checks them against the supplied
 * databases. Star Wars shows the naive rating association: 3.69 comes from
 * MovieLens movie 11, while Star Wars' real MovieLens id 260 averages 4.22.
 * Capote shows both a `null` rating and the malformed-company fallback.
 */
export const DETAILS_EXAMPLES = {
  11: {
    movieId: 11,
    imdbId: 'tt0076759',
    title: 'Star Wars',
    description:
      'Princess Leia is captured and held hostage by the evil Imperial forces in their effort ' +
      'to take over the galactic Empire. Venturesome Luke Skywalker and dashing captain Han ' +
      'Solo team together with the loveable robot duo R2-D2 and C-3PO to rescue the beautiful ' +
      'princess and restore peace and justice in the Empire.',
    releaseDate: '1977-05-25',
    budget: '$11,000,000',
    runtime: 121,
    averageRating: 3.69,
    genres: [
      { id: 12, name: 'Adventure' },
      { id: 28, name: 'Action' },
      { id: 878, name: 'Science Fiction' },
    ],
    originalLanguage: null,
    productionCompanies: [
      { id: 1, name: 'Lucasfilm' },
      { id: 306, name: 'Twentieth Century Fox Film Corporation' },
    ],
  },
  398: {
    movieId: 398,
    imdbId: 'tt0379725',
    title: 'Capote',
    description:
      "A biopic of the writer, Truman Capote and his assignment for The New Yorker to write the non-fiction book, 'In Cold Blood'.",
    releaseDate: '2005-09-30',
    budget: '$7,000,000',
    runtime: 114,
    averageRating: null,
    genres: [
      { id: 80, name: 'Crime' },
      { id: 18, name: 'Drama' },
    ],
    originalLanguage: null,
    productionCompanies: [],
  },
} satisfies Record<number, MovieDetails>;

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
